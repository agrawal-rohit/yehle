import fs from "node:fs";
import path from "node:path";
import {
	RegistryDependencyKind,
	type RegistryDependencySet,
	RegistryEcosystem,
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
export type PackageManagerSpec = {
	/** Manager id selected by the user or inferred from lockfiles. */
	manager: RegistryPackageManager;
	/** Lockfiles that identify this manager when present in the project root. */
	lockfiles: readonly string[];
} & Record<RegistryDependencyKind, string>;

/** Package managers keyed by ecosystem. */
export const ecosystemManagers = {
	// First manager in each list is the CLI fallback when the user skips the prompt.
	[RegistryEcosystem.NPM]: [
		{
			manager: NpmPackageManager.NPM,
			lockfiles: ["package-lock.json"],
			[RegistryDependencyKind.RUNTIME]: "npm install",
			[RegistryDependencyKind.DEV]: "npm install -D",
		},
		{
			manager: NpmPackageManager.PNPM,
			lockfiles: ["pnpm-lock.yaml"],
			[RegistryDependencyKind.RUNTIME]: "pnpm add",
			[RegistryDependencyKind.DEV]: "pnpm add -D",
		},
		{
			manager: NpmPackageManager.YARN,
			lockfiles: ["yarn.lock"],
			[RegistryDependencyKind.RUNTIME]: "yarn add",
			[RegistryDependencyKind.DEV]: "yarn add -D",
		},
		{
			manager: NpmPackageManager.BUN,
			// bun.lock is the current text lockfile; bun.lockb is the older binary format.
			lockfiles: ["bun.lock", "bun.lockb"],
			[RegistryDependencyKind.RUNTIME]: "bun add",
			[RegistryDependencyKind.DEV]: "bun add -D",
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
 * Merge non-empty dependency lists within one ecosystem dependency set.
 * @param left - Existing merged set.
 * @param right - Set to fold in.
 * @returns Combined dependency set, or undefined when both sides are empty.
 */
export function mergeDependencySet(
	left: RegistryDependencySet | undefined,
	right: RegistryDependencySet | undefined,
): RegistryDependencySet | undefined {
	const runtime = uniqueSortedNames([
		...(left?.[RegistryDependencyKind.RUNTIME] ?? []),
		...(right?.[RegistryDependencyKind.RUNTIME] ?? []),
	]);
	const dev = uniqueSortedNames([
		...(left?.[RegistryDependencyKind.DEV] ?? []),
		...(right?.[RegistryDependencyKind.DEV] ?? []),
	]);

	if (runtime.length === 0 && dev.length === 0) return undefined;

	const merged: RegistryDependencySet = {};
	if (runtime.length > 0) merged[RegistryDependencyKind.RUNTIME] = runtime;
	if (dev.length > 0) merged[RegistryDependencyKind.DEV] = dev;
	return merged;
}

/**
 * Merge non-empty command maps within one ecosystem.
 * Later sources overwrite earlier keys with the same name.
 * @param left - Existing merged set.
 * @param right - Set to fold in.
 * @returns Combined command set, or undefined when both sides are empty.
 */
export function mergeCommandSet(
	left: Record<string, string> | undefined,
	right: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!left && !right) return undefined;
	const merged = { ...left, ...right };
	return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Merge ecosystem-keyed maps by folding each ecosystem with `mergeSet`.
 * @param mergeSet - Per-ecosystem merge function.
 * @param sources - Item, pack, hook, or payload maps.
 * @returns Combined map keyed by ecosystem, or undefined when empty.
 */
export function mergeEcosystemMaps<T>(
	mergeSet: (left: T | undefined, right: T | undefined) => T | undefined,
	...sources: Array<Partial<Record<RegistryEcosystem, T>> | undefined>
): Partial<Record<RegistryEcosystem, T>> | undefined {
	const merged: Partial<Record<RegistryEcosystem, T>> = {};

	for (const source of sources) {
		if (!source) continue;
		for (const ecosystem of Object.values(RegistryEcosystem)) {
			const next = mergeSet(merged[ecosystem], source[ecosystem]);
			if (next !== undefined) merged[ecosystem] = next;
			else Reflect.deleteProperty(merged, ecosystem);
		}
	}

	return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Merge and dedupe repository secret name lists.
 * @param sources - Item, pack, hook, or payload secret lists.
 * @returns Sorted unique secret names, or undefined when empty.
 */
export function mergeSecretNames(
	...sources: Array<string[] | undefined>
): string[] | undefined {
	const names = new Set<string>();
	for (const source of sources) {
		if (!source) continue;
		for (const name of source) names.add(name);
	}
	if (names.size === 0) return undefined;
	return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Detect a single package manager from lockfiles in the project root.
 * @param projectDir - Absolute project root.
 * @param ecosystem - Registry ecosystem to detect for.
 * @param pathExists - Existence checker for absolute paths. Defaults to `fs.existsSync`.
 * @returns Matching manager and lockfile name, or undefined when none/ambiguous.
 */
export function detectPackageManagerFromLockfile(
	projectDir: string,
	ecosystem: RegistryEcosystem,
	pathExists: (absolutePath: string) => boolean = (absolutePath) =>
		fs.existsSync(absolutePath),
): { manager: RegistryPackageManager; lockfile: string } | undefined {
	const matches: { manager: RegistryPackageManager; lockfile: string }[] = [];
	for (const spec of ecosystemManagers[ecosystem]) {
		const lockfile = spec.lockfiles.find((name) =>
			pathExists(path.join(projectDir, name)),
		);
		if (lockfile) matches.push({ manager: spec.manager, lockfile });
	}
	if (matches.length !== 1) return undefined;
	return matches[0];
}

/**
 * Build shell commands that install packages for a chosen ecosystem manager.
 * @param ecosystem - Registry ecosystem for the packages.
 * @param manager - Selected package manager.
 * @param dependencySet - Runtime and dev packages to install.
 * @returns Shell commands to run, or an empty list when there is nothing to install.
 * @throws Error when `manager` is not valid for `ecosystem`.
 */
export function buildPackageInstallCommands(
	ecosystem: RegistryEcosystem,
	manager: RegistryPackageManager,
	dependencySet: RegistryDependencySet,
): string[] {
	// Dedupe and sort so generated command strings are stable across payloads.
	const runtime = uniqueSortedNames(
		dependencySet[RegistryDependencyKind.RUNTIME] ?? [],
	);
	const dev = uniqueSortedNames(
		dependencySet[RegistryDependencyKind.DEV] ?? [],
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
	if (runtime.length > 0)
		commands.push(
			`${spec[RegistryDependencyKind.RUNTIME]} ${runtime.join(" ")}`,
		);
	if (dev.length > 0)
		commands.push(`${spec[RegistryDependencyKind.DEV]} ${dev.join(" ")}`);

	return commands;
}
