import fs from "node:fs";
import path from "node:path";
import {
	RegistryEcosystem,
	type RegistryPackageSet,
	type RegistryPackages,
} from "./schema";

/** JavaScript package managers supported for the npm ecosystem. */
export enum NpmPackageManager {
	NPM = "npm",
	PNPM = "pnpm",
	YARN = "yarn",
	BUN = "bun",
}

/** Package manager selected for a registry ecosystem. Add a manager enum to this union when introducing a new language. */
export type RegistryPackageManager = NpmPackageManager;

/** Detection and install metadata for one package manager. */
export interface PackageManagerSpec {
	/** Manager id selected by the user or inferred from lockfiles. */
	manager: RegistryPackageManager;
	/** Lockfiles that identify this manager when present in the project root. */
	lockfiles: readonly string[];
	/** Shell prefix used to install runtime dependencies. */
	runtime: string;
	/** Shell prefix used to install dev dependencies. */
	dev: string;
}

/** Package managers keyed by ecosystem. */
export const ecosystemManagers = {
	// First manager in each list is the CLI fallback when the user skips the prompt.
	[RegistryEcosystem.NPM]: [
		{
			manager: NpmPackageManager.NPM,
			lockfiles: ["package-lock.json"],
			runtime: "npm install",
			dev: "npm install -D",
		},
		{
			manager: NpmPackageManager.PNPM,
			lockfiles: ["pnpm-lock.yaml"],
			runtime: "pnpm add",
			dev: "pnpm add -D",
		},
		{
			manager: NpmPackageManager.YARN,
			lockfiles: ["yarn.lock"],
			runtime: "yarn add",
			dev: "yarn add -D",
		},
		{
			manager: NpmPackageManager.BUN,
			// bun.lock is the current text lockfile; bun.lockb is the older binary format.
			lockfiles: ["bun.lock", "bun.lockb"],
			runtime: "bun add",
			dev: "bun add -D",
		},
	],
} satisfies Record<RegistryEcosystem, readonly PackageManagerSpec[]>;

/**
 * Deduplicate and sort package names for stable merge output.
 * @param names - Package names from one or more sources.
 * @returns Sorted unique names.
 */
function uniqueSortedNames(names: string[]): string[] {
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Read one dependency list from a package set, treating missing sets as empty.
 * @param set - Package set that may be undefined.
 * @param key - Which dependency list to read.
 * @returns The named list, or an empty array.
 */
function packageNames(
	set: RegistryPackageSet | undefined,
	key: "dependencies" | "devDependencies",
): string[] {
	if (!set) return [];
	return set[key] ?? [];
}

/**
 * Merge non-empty dependency lists within one ecosystem package set.
 * @param left - Existing merged set.
 * @param right - Set to fold in.
 * @returns Combined package set, or undefined when both sides are empty.
 */
function mergePackageSet(
	left: RegistryPackageSet | undefined,
	right: RegistryPackageSet | undefined,
): RegistryPackageSet | undefined {
	const dependencies = uniqueSortedNames([
		...packageNames(left, "dependencies"),
		...packageNames(right, "dependencies"),
	]);
	const devDependencies = uniqueSortedNames([
		...packageNames(left, "devDependencies"),
		...packageNames(right, "devDependencies"),
	]);

	if (dependencies.length === 0 && devDependencies.length === 0)
		return undefined;

	const merged: RegistryPackageSet = {};
	if (dependencies.length > 0) merged.dependencies = dependencies;
	if (devDependencies.length > 0) merged.devDependencies = devDependencies;
	return merged;
}

/**
 * Merge package declarations from multiple registry sources.
 * @param sources - Item, variant, or payload package maps.
 * @returns Combined packages keyed by ecosystem, or undefined when empty.
 */
export function mergeRegistryPackages(
	...sources: Array<RegistryPackages | undefined>
): RegistryPackages | undefined {
	const merged: Partial<Record<RegistryEcosystem, RegistryPackageSet>> = {};

	for (const source of sources) {
		if (!source) continue;
		// Walk every known ecosystem so a later source can still fill in a language the earlier ones omitted.
		for (const ecosystem of Object.values(RegistryEcosystem)) {
			const next = mergePackageSet(merged[ecosystem], source[ecosystem]);
			if (next) merged[ecosystem] = next;
			// Drop empty folds so the returned map only contains ecosystems with packages to install.
			else Reflect.deleteProperty(merged, ecosystem);
		}
	}

	return Object.keys(merged).length > 0
		? (merged as RegistryPackages)
		: undefined;
}

/**
 * Infer a package manager from lockfile presence when exactly one manager matches.
 * @param projectDir - Absolute project root.
 * @param ecosystem - Registry ecosystem to infer for.
 * @param pathExists - Existence checker for absolute paths. Defaults to `fs.existsSync`.
 * @returns Inferred manager, or undefined when inference is ambiguous or unavailable.
 */
export function inferPackageManagerFromLockfile(
	projectDir: string,
	ecosystem: RegistryEcosystem,
	pathExists: (absolutePath: string) => boolean = (absolutePath) =>
		fs.existsSync(absolutePath),
): RegistryPackageManager | undefined {
	// Only lockfiles identify a manager; package.json is shared and must not imply npm.
	const matched = ecosystemManagers[ecosystem].filter((spec) =>
		spec.lockfiles.some((lockfile) =>
			pathExists(path.join(projectDir, lockfile)),
		),
	);

	// Zero matches → nothing to confirm; several matches → too ambiguous to guess.
	if (matched.length !== 1) return undefined;
	return matched[0].manager;
}

/**
 * Build shell commands that install packages for a chosen ecosystem manager.
 * @param ecosystem - Registry ecosystem for the packages.
 * @param manager - Selected package manager.
 * @param packageSet - Runtime and dev packages to install.
 * @returns Shell commands to run, or an empty list when there is nothing to install.
 * @throws Error when `manager` is not valid for `ecosystem`.
 */
export function buildPackageInstallCommands(
	ecosystem: RegistryEcosystem,
	manager: RegistryPackageManager,
	packageSet: RegistryPackageSet,
): string[] {
	// Dedupe and sort so generated command strings are stable across payloads.
	const runtime = [...new Set(packageSet.dependencies ?? [])].sort((a, b) =>
		a.localeCompare(b),
	);
	const dev = [...new Set(packageSet.devDependencies ?? [])].sort((a, b) =>
		a.localeCompare(b),
	);
	if (runtime.length === 0 && dev.length === 0) return [];

	const spec = ecosystemManagers[ecosystem].find(
		(entry) => entry.manager === manager,
	);
	if (!spec) {
		throw new Error(
			`Package manager "${manager}" is not valid for ecosystem "${ecosystem}".`,
		);
	}

	// Emit separate runtime/dev commands because each manager uses a distinct flag for -D installs.
	const commands: string[] = [];
	if (runtime.length > 0) commands.push(`${spec.runtime} ${runtime.join(" ")}`);
	if (dev.length > 0) commands.push(`${spec.dev} ${dev.join(" ")}`);
	return commands;
}
