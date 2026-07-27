#!/usr/bin/env tsx
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
	getPackageById,
	getStagePathsForPackage,
	type ReleasePackageConfig,
} from "./release-config";
import type { PackageReleasePlan, ReleasePlan } from "./release-plan";

interface ApplyOptions {
	/**
	 * Path to the serialized release plan JSON.
	 */
	planPath: string;
}

/**
 * Apply a release plan by bumping manifests, writing changelogs, tagging, and publishing.
 *
 * @returns process exit code
 * @throws when the plan is missing, invalid, or the git tree is dirty before release
 */
function main(): number {
	const workspaceRoot = process.cwd();
	const options = parseArgs(process.argv.slice(2));
	const plan = readPlan(workspaceRoot, options.planPath);

	if (plan.releases.length === 0) {
		console.log("No releases to apply.");
		return 0;
	}

	assertCleanWorkingTree(workspaceRoot);

	const notesDirectory = fs.mkdtempSync(
		path.join(os.tmpdir(), "tuckshop-release-notes-"),
	);

	for (const release of plan.releases) {
		applyVersionBumps(workspaceRoot, plan, release);
		generateReleaseNotes(workspaceRoot, plan, release, notesDirectory);
		runPreVersionHooks(workspaceRoot, release.package);
	}

	stageReleaseFiles(workspaceRoot, plan);
	commitRelease(workspaceRoot, plan);
	pushReleaseCommit(workspaceRoot, plan.config.baseBranch ?? "main");
	createAndPushTags(workspaceRoot, plan);
	publishReleasedPackages(workspaceRoot, plan);
	createGitHubReleases(workspaceRoot, plan, notesDirectory);

	return 0;
}

/**
 * Parse CLI flags for release application.
 *
 * @param args raw process args after the script name
 * @returns parsed options
 * @throws when required flags are missing
 */
function parseArgs(args: string[]): ApplyOptions {
	let planPath: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--plan":
				planPath = requireValue(args, index, arg);
				index += 1;
				break;
			default:
				throw new Error(`Unknown argument "${arg}".`);
		}
	}

	if (!planPath) {
		throw new Error("--plan is required.");
	}

	return { planPath };
}

/**
 * Read the JSON release plan created by the analyzer.
 *
 * @param workspaceRoot absolute workspace path
 * @param planPath repo-relative or absolute plan path
 * @returns parsed release plan
 * @throws when the plan file is missing or malformed
 */
function readPlan(workspaceRoot: string, planPath: string): ReleasePlan {
	const resolvedPath = path.resolve(workspaceRoot, planPath);
	const rawPlan = fs.readFileSync(resolvedPath, "utf8");
	const parsed = JSON.parse(rawPlan) as ReleasePlan;

	if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.releases)) {
		throw new Error(`${resolvedPath} is not a supported release plan.`);
	}

	return parsed;
}

/**
 * Fail fast when unrelated git changes would be swept into the release commit.
 *
 * @param workspaceRoot absolute workspace path
 * @throws when the working tree is dirty
 */
function assertCleanWorkingTree(workspaceRoot: string): void {
	const status = git(workspaceRoot, ["status", "--short"]);
	if (status.length > 0) {
		throw new Error(
			"Release application requires a clean working tree before version bumps.",
		);
	}
}

/**
 * Apply manifest version bumps for a release and its linked packages.
 *
 * @param workspaceRoot absolute workspace path
 * @param plan full release plan
 * @param release target release entry
 */
function applyVersionBumps(
	workspaceRoot: string,
	plan: ReleasePlan,
	release: PackageReleasePlan,
): void {
	for (const pkg of getPackagesToBump(plan, release)) {
		runTemplatedCommand(
			workspaceRoot,
			pkg.path,
			pkg.bumpCommand,
			release.nextVersion,
			release.tag,
		);
	}
}

/**
 * Render package-specific release notes and changelog updates with git-cliff.
 *
 * @param workspaceRoot absolute workspace path
 * @param plan full release plan
 * @param release target release entry
 * @param notesDirectory temp notes directory
 */
function generateReleaseNotes(
	workspaceRoot: string,
	plan: ReleasePlan,
	release: PackageReleasePlan,
	notesDirectory: string,
): void {
	const notePath = path.join(notesDirectory, `${release.id}.md`);
	const changelogPath = path.join(
		workspaceRoot,
		release.package.path,
		release.package.changelogFile ?? "CHANGELOG.md",
	);
	const includeArgs = release.package.paths.flatMap((pattern) => [
		"--include-path",
		pattern,
	]);

	run("git-cliff", [
		"--config",
		"cliff.toml",
		"--tag",
		release.tag,
		"--output",
		notePath,
		...includeArgs,
	], workspaceRoot);

	if (release.previousTag && fs.existsSync(changelogPath)) {
		run("git-cliff", [
			"--config",
			"cliff.toml",
			"--tag",
			release.tag,
			"--output",
			changelogPath,
			"--prepend",
			changelogPath,
			...includeArgs,
		], workspaceRoot);
		return;
	}

	run("git-cliff", [
		"--config",
		"cliff.toml",
		"--tag",
		release.tag,
		"--output",
		changelogPath,
		...includeArgs,
	], workspaceRoot);
}

/**
 * Run configured post-bump hooks for a package.
 *
 * @param workspaceRoot absolute workspace path
 * @param pkg package whose hooks should run
 */
function runPreVersionHooks(
	workspaceRoot: string,
	pkg: ReleasePackageConfig,
): void {
	for (const hook of pkg.preVersionHooks ?? []) {
		runShellCommand(hook, workspaceRoot);
	}
}

/**
 * Stage only the files explicitly owned by the release plan.
 *
 * @param workspaceRoot absolute workspace path
 * @param plan full release plan
 */
function stageReleaseFiles(workspaceRoot: string, plan: ReleasePlan): void {
	const stagePaths = new Set<string>();

	for (const release of plan.releases) {
		for (const pkg of getPackagesToBump(plan, release)) {
			for (const stagePath of getStagePathsForPackage(workspaceRoot, pkg)) {
				stagePaths.add(stagePath);
			}
		}

		stagePaths.add(
			path
				.join(release.package.path, release.package.changelogFile ?? "CHANGELOG.md")
				.replaceAll(path.sep, "/"),
		);
	}

	run("git", ["add", ...stagePaths], workspaceRoot);
}

/**
 * Create the release commit after all release-owned files are staged.
 *
 * @param workspaceRoot absolute workspace path
 * @param plan full release plan
 */
function commitRelease(workspaceRoot: string, plan: ReleasePlan): void {
	const tags = plan.releases.map((release) => release.tag).join(", ");
	const messageTemplate =
		plan.config.releaseCommitMessage ?? "chore(release): {tags} [skip ci]";
	const message = messageTemplate.replaceAll("{tags}", tags);

	run("git", ["commit", "-m", message], workspaceRoot);
}

/**
 * Push the release commit to the configured branch.
 *
 * @param workspaceRoot absolute workspace path
 * @param branch branch that receives the release commit
 */
function pushReleaseCommit(workspaceRoot: string, branch: string): void {
	run("git", ["push", "origin", `HEAD:${branch}`], workspaceRoot);
}

/**
 * Create and push git tags for all releases in the plan.
 *
 * @param workspaceRoot absolute workspace path
 * @param plan full release plan
 */
function createAndPushTags(workspaceRoot: string, plan: ReleasePlan): void {
	for (const release of plan.releases) {
		run("git", ["tag", release.tag], workspaceRoot);
	}

	run("git", ["push", "origin", "--tags"], workspaceRoot);
}

/**
 * Publish all externally visible packages in the release plan.
 *
 * @param workspaceRoot absolute workspace path
 * @param plan full release plan
 */
function publishReleasedPackages(workspaceRoot: string, plan: ReleasePlan): void {
	for (const release of plan.releases) {
		if (!release.package.publish || !release.package.publishCommand) {
			continue;
		}

		runTemplatedCommand(
			workspaceRoot,
			release.package.path,
			release.package.publishCommand,
			release.nextVersion,
			release.tag,
		);
	}
}

/**
 * Create GitHub releases whose body matches the generated git-cliff notes.
 *
 * @param workspaceRoot absolute workspace path
 * @param plan full release plan
 * @param notesDirectory temp notes directory
 */
function createGitHubReleases(
	workspaceRoot: string,
	plan: ReleasePlan,
	notesDirectory: string,
): void {
	for (const release of plan.releases) {
		const notePath = path.join(notesDirectory, `${release.id}.md`);
		run("gh", [
			"release",
			"create",
			release.tag,
			"--title",
			release.tag,
			"--notes-file",
			notePath,
		], workspaceRoot);
	}
}

/**
 * Resolve the primary package plus its linked package configs.
 *
 * @param plan full release plan
 * @param release target release entry
 * @returns unique packages to bump and stage
 */
function getPackagesToBump(
	plan: ReleasePlan,
	release: PackageReleasePlan,
): ReleasePackageConfig[] {
	const packages = [release.package];
	for (const linkedId of release.linkedPackageIds) {
		packages.push(getPackageById(plan.config, linkedId));
	}

	return packages.filter(
		(pkg, index, allPackages) =>
			allPackages.findIndex((candidate) => candidate.id === pkg.id) === index,
	);
}

/**
 * Run a command template with `{version}` and `{tag}` substitutions.
 *
 * @param workspaceRoot absolute workspace path
 * @param relativeCwd repo-relative working directory
 * @param command command template
 * @param version target version
 * @param tag release tag
 */
function runTemplatedCommand(
	workspaceRoot: string,
	relativeCwd: string,
	command: string,
	version: string,
	tag: string,
): void {
	const renderedCommand = command
		.replaceAll("{version}", version)
		.replaceAll("{tag}", tag);

	runShellCommand(renderedCommand, path.join(workspaceRoot, relativeCwd));
}

/**
 * Run a command through the shell when the config stores it as a string template.
 *
 * @param command shell command to execute
 * @param cwd working directory
 */
function runShellCommand(command: string, cwd: string): void {
	execFileSync("bash", ["-lc", command], {
		cwd,
		stdio: "inherit",
	});
}

/**
 * Run an executable with arguments and inherit stdio for debugging.
 *
 * @param command executable name
 * @param args executable arguments
 * @param cwd working directory
 */
function run(command: string, args: string[], cwd: string): void {
	execFileSync(command, args, {
		cwd,
		stdio: "inherit",
	});
}

/**
 * Run a git command and return trimmed stdout.
 *
 * @param workspaceRoot absolute workspace path
 * @param args git arguments
 * @returns trimmed stdout
 */
function git(workspaceRoot: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd: workspaceRoot,
		encoding: "utf8",
	}).trim();
}

/**
 * Read the next CLI token as a required value.
 *
 * @param args raw CLI args
 * @param index current option index
 * @param option current option name
 * @returns next token value
 * @throws when the value is missing
 */
function requireValue(args: string[], index: number, option: string): string {
	const value = args[index + 1];
	if (!value) {
		throw new Error(`${option} requires a value.`);
	}

	return value;
}

process.exitCode = main();
