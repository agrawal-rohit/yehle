#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { minimatch } from "minimatch";
import {
	buildReleaseTag,
	getPackageById,
	loadReleaseConfig,
	type ReleaseConfig,
	type ReleasePackageConfig,
} from "./release-config";
import type {
	PackageReleasePlan,
	ReleaseBump,
	ReleaseCommit,
	ReleasePlan,
} from "./release-plan";

interface AnalyzeOptions {
	/**
	 * Optional output path for the JSON release plan.
	 */
	outputPath?: string;
	/**
	 * Comma-separated package ids to analyze.
	 */
	packageIds?: string[];
	/**
	 * Optional bump override for all selected releases.
	 */
	bumpOverride?: ReleaseBump;
	/**
	 * Optional ref to use before the first package tag exists.
	 */
	sinceRef?: string;
	/**
	 * Whether the current invocation is a dry run.
	 */
	dryRun: boolean;
}

const BUMP_PRIORITY: Record<ReleaseBump, number> = {
	patch: 1,
	minor: 2,
	major: 3,
};

/**
 * Build a release plan from the repo config and current git history.
 *
 * @returns process exit code
 * @throws when the repo config or git state is invalid
 */
function main(): number {
	const workspaceRoot = process.cwd();
	const options = parseArgs(process.argv.slice(2));
	const config = loadReleaseConfig(workspaceRoot);
	const selectedPackages = resolveSelectedPackages(config, options.packageIds);
	const fallbackOwnerId = selectedPackages[0]?.id ?? config.packages[0]?.id;

	if (!fallbackOwnerId) {
		throw new Error("release.config.json must define at least one package.");
	}

	const releases: PackageReleasePlan[] = [];
	for (const pkg of selectedPackages) {
		if (!pkg.publish) {
			continue;
		}

		const plan = analyzePackageRelease(
			workspaceRoot,
			config,
			pkg,
			options.sinceRef,
			options.bumpOverride,
			fallbackOwnerId,
		);

		if (plan) {
			releases.push(plan);
		}
	}

	const releasePlan: ReleasePlan = {
		schemaVersion: 1,
		config,
		releases,
	};
	const serializedPlan = `${JSON.stringify(releasePlan, null, 2)}\n`;

	if (options.outputPath) {
		fs.writeFileSync(path.resolve(workspaceRoot, options.outputPath), serializedPlan);
	} else {
		process.stdout.write(serializedPlan);
	}

	const summary = renderSummary(releasePlan, options.dryRun);
	writeGitHubSummary(summary);

	return 0;
}

/**
 * Parse CLI flags for release analysis.
 *
 * @param args raw process args after the script name
 * @returns parsed options
 * @throws when an unknown flag or invalid value is provided
 */
function parseArgs(args: string[]): AnalyzeOptions {
	const options: AnalyzeOptions = { dryRun: false };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		switch (arg) {
			case "--output":
				options.outputPath = requireValue(args, index, arg);
				index += 1;
				break;
			case "--packages":
				options.packageIds = requireValue(args, index, arg)
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean);
				index += 1;
				break;
			case "--bump-override":
				options.bumpOverride = parseBump(
					requireValue(args, index, arg),
					`${arg} value`,
				);
				index += 1;
				break;
			case "--since":
				options.sinceRef = requireValue(args, index, arg);
				index += 1;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			default:
				throw new Error(`Unknown argument "${arg}".`);
		}
	}

	return options;
}

/**
 * Resolve the package list selected by the CLI.
 *
 * @param config repo release configuration
 * @param packageIds optional requested package ids
 * @returns packages to analyze in config order
 * @throws when a requested package id does not exist
 */
function resolveSelectedPackages(
	config: ReleaseConfig,
	packageIds?: string[],
): ReleasePackageConfig[] {
	if (!packageIds || packageIds.length === 0 || packageIds.includes("all")) {
		return config.packages;
	}

	return packageIds.map((packageId) => getPackageById(config, packageId));
}

/**
 * Analyze one publishable package and compute the next release version.
 *
 * @param workspaceRoot absolute workspace path
 * @param config repo release configuration
 * @param pkg package being analyzed
 * @param sinceRef optional bootstrap ref override
 * @param bumpOverride optional explicit bump override
 * @param fallbackOwnerId package id that claims fallback-matched commits
 * @returns release plan when a bump is required, otherwise null
 */
function analyzePackageRelease(
	workspaceRoot: string,
	config: ReleaseConfig,
	pkg: ReleasePackageConfig,
	sinceRef: string | undefined,
	bumpOverride: ReleaseBump | undefined,
	fallbackOwnerId: string,
): PackageReleasePlan | null {
	const { previousTag, baselineRef } = resolveBaselineRef(
		workspaceRoot,
		config,
		pkg,
		sinceRef,
	);
	const commits = getReleaseCommits(
		workspaceRoot,
		config,
		pkg,
		baselineRef,
		fallbackOwnerId,
	);

	if (commits.length === 0) {
		return null;
	}

	const currentVersion = readCurrentVersion(workspaceRoot, pkg);
	const bump = bumpOverride ?? deriveBumpFromCommits(commits);
	const nextVersion = bumpVersion(currentVersion, bump);
	const linkedPackageIds = [...(pkg.linkedBumps ?? [])];

	return {
		id: pkg.id,
		displayName: pkg.tagName ?? pkg.id,
		package: pkg,
		baselineRef,
		previousTag,
		currentVersion,
		bump,
		nextVersion,
		tag: buildReleaseTag(config, pkg, nextVersion),
		commits,
		linkedPackageIds,
	};
}

/**
 * Resolve the git ref that bounds the package history.
 *
 * @param workspaceRoot absolute workspace path
 * @param config repo release configuration
 * @param pkg package being analyzed
 * @param sinceRef optional CLI override
 * @returns previous tag and baseline ref
 * @throws when no matching tag or bootstrap ref can be found
 */
function resolveBaselineRef(
	workspaceRoot: string,
	config: ReleaseConfig,
	pkg: ReleasePackageConfig,
	sinceRef?: string,
): { previousTag: string | null; baselineRef: string } {
	const tagPattern = `${pkg.tagName ?? pkg.id}${config.tagSeparator}*`;
	const previousTag = tryGitCommand(
		workspaceRoot,
		"git",
		["describe", "--tags", "--abbrev=0", "--match", tagPattern],
	);

	if (previousTag) {
		return { previousTag, baselineRef: previousTag };
	}

	const fallbackRef = sinceRef ?? config.bootstrapRef;
	if (fallbackRef) {
		return { previousTag: null, baselineRef: fallbackRef };
	}

	throw new Error(
		`No previous tag matched "${tagPattern}" for package "${pkg.id}". Pass --since or set bootstrapRef in release.config.json.`,
	);
}

/**
 * Gather release-worthy commits since the baseline ref.
 *
 * @param workspaceRoot absolute workspace path
 * @param config repo release configuration
 * @param pkg package being analyzed
 * @param baselineRef lower git ref bound
 * @param fallbackOwnerId package id that claims fallback matches
 * @returns commits that should influence the release
 */
function getReleaseCommits(
	workspaceRoot: string,
	config: ReleaseConfig,
	pkg: ReleasePackageConfig,
	baselineRef: string,
	fallbackOwnerId: string,
): ReleaseCommit[] {
	const hashes = git(
		workspaceRoot,
		["rev-list", "--reverse", `${baselineRef}..HEAD`],
	)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const commits: ReleaseCommit[] = [];

	for (const hash of hashes) {
		const commit = readCommit(workspaceRoot, hash);
		if (!shouldIncludeCommit(config, pkg, commit.files, fallbackOwnerId)) {
			continue;
		}

		const bump = classifyCommit(commit.subject, commit.body);
		if (!bump) {
			continue;
		}

		commits.push({ ...commit, bump });
	}

	return commits;
}

/**
 * Determine whether a commit affects the target package.
 *
 * @param config repo release configuration
 * @param pkg package being analyzed
 * @param files repo-relative changed files
 * @param fallbackOwnerId package id that claims fallback matches
 * @returns true when the commit should count toward the package release
 */
function shouldIncludeCommit(
	config: ReleaseConfig,
	pkg: ReleasePackageConfig,
	files: string[],
	fallbackOwnerId: string,
): boolean {
	if (matchesAny(files, pkg.paths)) {
		return true;
	}

	if (pkg.id !== fallbackOwnerId) {
		return false;
	}

	return matchesAny(files, config.commitPathFallback ?? []);
}

/**
 * Read structured commit details from git.
 *
 * @param workspaceRoot absolute workspace path
 * @param hash commit hash
 * @returns normalized commit data
 */
function readCommit(workspaceRoot: string, hash: string): Omit<ReleaseCommit, "bump"> {
	const fields = git(workspaceRoot, [
		"show",
		"--quiet",
		"--format=%H%x1f%s%x1f%B",
		hash,
	]).split("\u001f");
	const files = git(workspaceRoot, [
		"show",
		"--pretty=",
		"--name-only",
		hash,
	])
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	return {
		hash: fields[0] ?? hash,
		subject: fields[1] ?? "",
		body: fields[2] ?? "",
		files,
	};
}

/**
 * Parse a conventional commit and map it to a semver bump.
 *
 * @param subject first line of the commit message
 * @param body full commit body
 * @returns inferred bump or null when the commit should not affect versions
 */
function classifyCommit(
	subject: string,
	body: string,
): ReleaseBump | null {
	const breakingInBody = /\bBREAKING CHANGE\b:/m.test(body);
	const match = /^(?<type>[a-z]+)(?:\([^)]+\))?(?<breaking>!)?:\s+/i.exec(subject);
	const type = match?.groups?.type?.toLowerCase() ?? "";
	const breakingInSubject = match?.groups?.breaking === "!";

	if (breakingInBody || breakingInSubject) {
		return "major";
	}

	switch (type) {
		case "feat":
			return "minor";
		case "fix":
		case "perf":
			return "patch";
		case "revert":
			return classifyRevertedCommit(body);
		default:
			return null;
	}
}

/**
 * Infer the bump for a revert commit from the reverted header.
 *
 * @param body full commit message body
 * @returns inherited bump or null when the reverted type cannot be determined
 */
function classifyRevertedCommit(body: string): ReleaseBump | null {
	const revertedHeader = /This reverts commit [\s\S]*?\n(?<subject>[a-z]+(?:\([^)]+\))?!?: .+)$/m.exec(
		body,
	)?.groups?.subject;

	if (!revertedHeader) {
		return null;
	}

	return classifyCommit(revertedHeader, revertedHeader);
}

/**
 * Collapse release commits into a single highest-priority bump.
 *
 * @param commits commits included in the release
 * @returns highest semver bump
 */
function deriveBumpFromCommits(commits: ReleaseCommit[]): ReleaseBump {
	return commits.reduce<ReleaseBump>((current, commit) => {
		if (BUMP_PRIORITY[commit.bump] > BUMP_PRIORITY[current]) {
			return commit.bump;
		}

		return current;
	}, "patch");
}

/**
 * Bump a semver string by one major/minor/patch step.
 *
 * @param version current version string
 * @param bump desired semver bump
 * @returns bumped version string
 * @throws when the version is not `x.y.z`
 */
function bumpVersion(version: string, bump: ReleaseBump): string {
	const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/.exec(version);
	if (!match?.groups) {
		throw new Error(`Version "${version}" must follow x.y.z semantics.`);
	}

	const next = {
		major: Number(match.groups.major),
		minor: Number(match.groups.minor),
		patch: Number(match.groups.patch),
	};

	switch (bump) {
		case "major":
			next.major += 1;
			next.minor = 0;
			next.patch = 0;
			break;
		case "minor":
			next.minor += 1;
			next.patch = 0;
			break;
		case "patch":
			next.patch += 1;
			break;
		default: {
			const unreachable: never = bump;
			throw new Error(`Unsupported bump "${unreachable}".`);
		}
	}

	return `${next.major}.${next.minor}.${next.patch}`;
}

/**
 * Read the current package version from package.json.
 *
 * @param workspaceRoot absolute workspace path
 * @param pkg package being analyzed
 * @returns current version string
 */
function readCurrentVersion(
	workspaceRoot: string,
	pkg: ReleasePackageConfig,
): string {
	const packageJsonPath = path.join(workspaceRoot, pkg.path, "package.json");
	const rawPackage = fs.readFileSync(packageJsonPath, "utf8");
	const parsed = JSON.parse(rawPackage) as { version?: string };

	if (!parsed.version) {
		throw new Error(`Missing version in ${packageJsonPath}.`);
	}

	return parsed.version;
}

/**
 * Render a human-readable plan summary for the Actions UI.
 *
 * @param plan full release plan
 * @param dryRun whether the current invocation is a dry run
 * @returns markdown summary
 */
function renderSummary(plan: ReleasePlan, dryRun: boolean): string {
	const lines = [
		`## Release plan${dryRun ? " (dry-run)" : ""}`,
		"",
	];

	if (plan.releases.length === 0) {
		lines.push("No publishable packages require a release.");
		return `${lines.join("\n")}\n`;
	}

	for (const release of plan.releases) {
		const linkedLabel =
			release.linkedPackageIds.length > 0
				? ` (linked: ${release.linkedPackageIds.join(", ")})`
				: "";

		lines.push(
			`### ${release.displayName} ${release.currentVersion} -> ${release.nextVersion} (${release.bump})${linkedLabel}`,
		);
		lines.push(`Tag: \`${release.tag}\``);
		lines.push(`Baseline: \`${release.baselineRef}\``);
		lines.push("");
		lines.push("Included commits:");

		for (const commit of release.commits) {
			lines.push(`- ${commit.subject}`);
		}

		lines.push("");
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Write the plan summary to the GitHub Actions summary file when available.
 *
 * @param summary markdown summary text
 */
function writeGitHubSummary(summary: string): void {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (!summaryPath) {
		return;
	}

	fs.appendFileSync(summaryPath, summary);
}

/**
 * Check whether any changed file matches the provided globs.
 *
 * @param files repo-relative changed files
 * @param patterns glob patterns
 * @returns true when at least one match exists
 */
function matchesAny(files: string[], patterns: string[]): boolean {
	for (const filePath of files) {
		for (const pattern of patterns) {
			if (minimatch(filePath, pattern, { dot: true })) {
				return true;
			}
		}
	}

	return false;
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
 * Run a command that may legitimately fail and return null instead.
 *
 * @param workspaceRoot absolute workspace path
 * @param command executable name
 * @param args command arguments
 * @returns trimmed stdout or null when the command exits non-zero
 */
function tryGitCommand(
	workspaceRoot: string,
	command: string,
	args: string[],
): string | null {
	try {
		return execFileSync(command, args, {
			cwd: workspaceRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Parse a bump string and validate the allowed values.
 *
 * @param value raw CLI value
 * @param label error label
 * @returns validated bump value
 * @throws when the value is not supported
 */
function parseBump(value: string, label: string): ReleaseBump {
	if (value === "major" || value === "minor" || value === "patch") {
		return value;
	}

	throw new Error(`${label} must be one of: patch, minor, major.`);
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
