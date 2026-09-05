import fs from "node:fs";
import path from "node:path";
import type { PromptHost } from "./handlers";
import {
	type CompiledItem,
	type CompiledItemFile,
	RegistryDependencyKind,
	type RegistryDependencySet,
	RegistryEcosystem,
	type RegistryEcosystemCommands,
	type RegistryEcosystemDependencies,
} from "./schema";
import { isEscapingRelativePath } from "./urls";

/** Pack `when` key and Mustache key for the selected package manager. */
export const PACKAGE_MANAGER_KEY = "packageManager";

/** Interpolation bindings derived from the selected package manager. */
export interface PackageManagerBindings {
	pmRun: string;
	pmExec: string;
	pmInstall: string;
	pmPublish: string;
}

/** JavaScript package managers supported for the npm ecosystem. */
export enum NpmPackageManager {
	NPM = "npm",
	PNPM = "pnpm",
	YARN = "yarn",
	BUN = "bun",
}

/** Package manager selected for a registry ecosystem. Add a manager enum to this union when introducing a new language. */
export type RegistryPackageManager = NpmPackageManager;

/** Planned install command ready for display or argv execution. */
export interface PackageInstallCommand {
	/** Program to spawn. */
	executable: string;
	/** Full argument vector including package names. */
	args: string[];
	/** Human-readable command line for prompts and next steps. */
	display: string;
}

/** Detection, prompt, install, and interpolation metadata for one package manager. */
export interface PackageManagerSpec {
	/** Manager id selected by the user or inferred from lockfiles. */
	manager: RegistryPackageManager;
	/** Display label for the package-manager prompt. */
	label: string;
	/** Lockfiles that identify this manager when present in the project root. */
	lockfiles: readonly string[];
	/** Mustache bindings injected when this manager is selected. */
	bindings: PackageManagerBindings;
	/** Argv after the executable for runtime and dev package installs. */
	install: Record<RegistryDependencyKind, readonly string[]>;
}

/** Package managers keyed by ecosystem. */
export const ecosystemManagers = {
	// First manager in each list is the CLI fallback when the user skips the prompt.
	[RegistryEcosystem.NPM]: [
		{
			manager: NpmPackageManager.NPM,
			label: "npm",
			lockfiles: ["package-lock.json"],
			install: {
				[RegistryDependencyKind.RUNTIME]: ["install", "--ignore-scripts"],
				[RegistryDependencyKind.DEV]: ["install", "--ignore-scripts", "-D"],
			},
			bindings: {
				pmRun: "npm run",
				pmExec: "npx",
				pmInstall: "npm ci --ignore-scripts",
				pmPublish:
					"npm publish --workspaces --provenance --access public --no-git-checks",
			},
		},
		{
			manager: NpmPackageManager.PNPM,
			label: "pnpm",
			lockfiles: ["pnpm-lock.yaml"],
			install: {
				[RegistryDependencyKind.RUNTIME]: ["add", "--ignore-scripts"],
				[RegistryDependencyKind.DEV]: ["add", "--ignore-scripts", "-D"],
			},
			bindings: {
				pmRun: "pnpm",
				pmExec: "pnpm exec",
				pmInstall: "pnpm install --ignore-scripts --frozen-lockfile",
				pmPublish:
					"pnpm -r publish --provenance --access public --no-git-checks",
			},
		},
		{
			manager: NpmPackageManager.YARN,
			label: "Yarn",
			lockfiles: ["yarn.lock"],
			install: {
				[RegistryDependencyKind.RUNTIME]: ["add", "--ignore-scripts"],
				[RegistryDependencyKind.DEV]: ["add", "--ignore-scripts", "-D"],
			},
			bindings: {
				pmRun: "yarn",
				pmExec: "yarn",
				pmInstall: "yarn install --frozen-lockfile --ignore-scripts",
				pmPublish:
					"yarn workspaces foreach -A npm publish --provenance --access public",
			},
		},
		{
			manager: NpmPackageManager.BUN,
			label: "Bun",
			// bun.lock is the current text lockfile; bun.lockb is the older binary format.
			lockfiles: ["bun.lock", "bun.lockb"],
			install: {
				[RegistryDependencyKind.RUNTIME]: ["add", "--ignore-scripts"],
				[RegistryDependencyKind.DEV]: ["add", "--ignore-scripts", "-D"],
			},
			bindings: {
				pmRun: "bun run",
				pmExec: "bunx",
				pmInstall: "bun install --frozen-lockfile",
				pmPublish: "bun publish --access public",
			},
		},
	],
} satisfies Record<RegistryEcosystem, readonly PackageManagerSpec[]>;

/**
 * Look up the package-manager spec for one ecosystem and manager id.
 * @param ecosystem - Registry ecosystem that owns the manager.
 * @param manager - Selected package manager.
 * @returns Spec for the manager.
 * @throws Error when the manager is not valid for the ecosystem.
 */
export function packageManagerSpec(
	ecosystem: RegistryEcosystem,
	manager: RegistryPackageManager,
): PackageManagerSpec {
	const spec = ecosystemManagers[ecosystem].find(
		(entry) => entry.manager === manager,
	);
	if (!spec) {
		throw new Error(
			`Package manager "${manager}" is not valid for ecosystem "${ecosystem}".`,
		);
	}
	return spec;
}

/**
 * Whether a string is a supported package manager for the given ecosystem.
 * @param ecosystem - Registry ecosystem to validate against.
 * @param value - Candidate manager id.
 * @returns True when the value is a known manager for that ecosystem.
 */
export function isPackageManagerForEcosystem(
	ecosystem: RegistryEcosystem,
	value: string,
): value is RegistryPackageManager {
	return ecosystemManagers[ecosystem].some((entry) => entry.manager === value);
}

/**
 * Deduplicate strings and sort them for stable output.
 * @param values - Values that may contain duplicates.
 * @returns Sorted unique copy.
 */
export function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Reject empty or prototype-polluting command names.
 * @param name - Command key from a payload or hook result.
 * @throws Error when the name is empty or `__proto__`.
 */
function assertSafeCommandName(name: string): void {
	if (name.length === 0) throw new Error("Command name must not be empty.");
	if (name === "__proto__")
		throw new Error(`Command "${name}" is not allowed.`);
}

/**
 * Reject empty or argv-flag package names.
 * @param name - Package specifier from a payload or hook result.
 * @throws Error when the name is empty or starts with `-`.
 */
function assertSafePackageName(name: string): void {
	if (name.length === 0) throw new Error("Package name must not be empty.");
	if (name.startsWith("-"))
		throw new Error(`Package name "${name}" is not allowed.`);
}

/**
 * Validate package names and combine dependency sets into unique sorted runtime/dev lists.
 * @param sets - Dependency sets to fold, in order.
 * @returns Tuple of unique sorted runtime and dev package names.
 * @throws Error when a package name is empty or starts with `-`.
 */
function uniqueValidatedDependencyLists(
	...sets: Array<RegistryDependencySet | undefined>
): [runtime: string[], dev: string[]] {
	const runtime = uniqueSorted(
		sets.flatMap((set) => set?.[RegistryDependencyKind.RUNTIME] ?? []),
	);
	const dev = uniqueSorted(
		sets.flatMap((set) => set?.[RegistryDependencyKind.DEV] ?? []),
	);
	for (const name of [...runtime, ...dev]) assertSafePackageName(name);
	return [runtime, dev];
}

/**
 * Merge non-empty dependency lists within one ecosystem dependency set.
 * @param left - Existing merged set.
 * @param right - Set to fold in.
 * @returns Combined dependency set, or undefined when both sides are empty.
 * @throws Error when a package name is empty or starts with `-`.
 */
export function mergeDependencySet(
	left: RegistryDependencySet | undefined,
	right: RegistryDependencySet | undefined,
): RegistryDependencySet | undefined {
	const [runtime, dev] = uniqueValidatedDependencyLists(left, right);

	if (runtime.length === 0 && dev.length === 0) return undefined;

	const merged: RegistryDependencySet = {};
	if (runtime.length > 0) merged[RegistryDependencyKind.RUNTIME] = runtime;
	if (dev.length > 0) merged[RegistryDependencyKind.DEV] = dev;
	return merged;
}

/**
 * Merge non-empty command maps within one ecosystem.
 * Later sources overwrite earlier keys with the same name.
 * Rejects empty names, `__proto__`, and empty command strings.
 * @param left - Existing merged set.
 * @param right - Set to fold in.
 * @returns Combined command set, or undefined when both sides are empty.
 * @throws Error when a command name or value is unsafe.
 */
export function mergeCommandSet(
	left: Record<string, string> | undefined,
	right: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!left && !right) return undefined;
	const merged: Record<string, string> = {};
	for (const source of [left, right]) {
		if (!source) continue;
		for (const name of Object.keys(source)) {
			assertSafeCommandName(name);
			const value = source[name];
			if (typeof value !== "string" || value.length === 0)
				throw new Error(`Command "${name}" must be a non-empty string.`);
			merged[name] = value;
		}
	}
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
 * @throws Error when a secret name is empty.
 */
export function mergeSecretNames(
	...sources: Array<string[] | undefined>
): string[] | undefined {
	const names = new Set<string>();
	for (const source of sources) {
		if (!source) continue;
		for (const name of source) {
			if (name.length === 0) throw new Error("Secret name must not be empty.");
			names.add(name);
		}
	}
	if (names.size === 0) return undefined;
	return [...names].sort((left, right) => left.localeCompare(right));
}

/**
 * Build a compiled item, omitting absent optional fields.
 * @param parts - Files plus optional deps, commands, and secrets.
 * @returns Compiled item with undefined optionals dropped.
 */
export function compiledItem(parts: {
	files: CompiledItemFile[];
	dependencies?: RegistryEcosystemDependencies;
	commands?: RegistryEcosystemCommands;
	secrets?: string[];
}): CompiledItem {
	return {
		files: parts.files,
		...(parts.dependencies ? { dependencies: parts.dependencies } : {}),
		...(parts.commands ? { commands: parts.commands } : {}),
		...(parts.secrets ? { secrets: parts.secrets } : {}),
	};
}

/**
 * Fail when two compiled item files share the same install target.
 * @param files - Combined file list.
 * @param messageForTarget - Error message for a duplicate target.
 * @throws Error when a target is unsafe or appears more than once.
 */
export function assertUniqueCompiledItemTargets(
	files: CompiledItemFile[],
	messageForTarget: (target: string) => string,
): void {
	const seen = new Set<string>();
	for (const file of files) {
		if (file.target.length === 0)
			throw new Error(
				"Compiled item file target must be a non-empty relative path.",
			);
		if (isEscapingRelativePath(file.target))
			throw new Error(
				`Compiled item file target "${file.target}" must be a relative path (no absolute paths, URLs, or "..").`,
			);
		if (seen.has(file.target)) throw new Error(messageForTarget(file.target));
		seen.add(file.target);
	}
}

/** Manifest fields folded across compiled items, raw items, or packs. */
export type CompiledItemFields = Pick<
	CompiledItem,
	"dependencies" | "commands" | "secrets"
>;

/**
 * Merge deps, commands, and secrets from compiled items or raw item/pack manifests.
 * @param items - Sources to fold in order.
 * @returns Merged optional fields, omitted when empty.
 */
export function mergeCompiledItemFields(
	...items: Array<CompiledItemFields | undefined>
): CompiledItemFields {
	const dependencies = mergeEcosystemMaps(
		mergeDependencySet,
		...items.map((item) => item?.dependencies),
	);
	const commands = mergeEcosystemMaps(
		mergeCommandSet,
		...items.map((item) => item?.commands),
	);
	const secrets = mergeSecretNames(...items.map((item) => item?.secrets));
	return {
		...(dependencies ? { dependencies } : {}),
		...(commands ? { commands } : {}),
		...(secrets ? { secrets } : {}),
	};
}

/**
 * Concatenate files and merge deps/commands/secrets from compiled items.
 * @param items - Payloads to fold in order (base first).
 * @param duplicateTargetMessage - Error for a colliding file target.
 * @returns Folded compiled item.
 * @throws Error when two files share a target.
 */
export function foldCompiledItems(
	items: CompiledItem[],
	duplicateTargetMessage: (target: string) => string,
): CompiledItem {
	const files = items.flatMap((item) => item.files);
	assertUniqueCompiledItemTargets(files, duplicateTargetMessage);
	return compiledItem({ files, ...mergeCompiledItemFields(...items) });
}

/**
 * Reserved Mustache keys for an ecosystem: `packageManager` plus that spec's `pm*` bindings.
 * @param ecosystem - Registry ecosystem whose manager bindings to reserve.
 * @returns Key names that option and hook bindings must not reuse.
 */
export function reservedInterpolationKeys(
	ecosystem: RegistryEcosystem = RegistryEcosystem.NPM,
): string[] {
	const spec = ecosystemManagers[ecosystem][0];
	if (!spec) return [PACKAGE_MANAGER_KEY];
	return [PACKAGE_MANAGER_KEY, ...Object.keys(spec.bindings)];
}

/**
 * Interpolation bindings for a selected package manager.
 * @param ecosystem - Registry ecosystem that owns the manager.
 * @param manager - Selected package manager.
 * @returns Mustache bindings (`pmRun`, `pmExec`, `pmInstall`, `pmPublish`).
 * @throws Error when the manager is not valid for the ecosystem.
 */
export function packageManagerBindings(
	ecosystem: RegistryEcosystem,
	manager: RegistryPackageManager,
): PackageManagerBindings {
	return { ...packageManagerSpec(ecosystem, manager).bindings };
}

/**
 * Detect a single package manager from lockfiles in the project root.
 * @param projectDir - Absolute project root.
 * @param ecosystem - Registry ecosystem to detect for.
 * @param pathExists - Existence checker for absolute paths. Defaults to `fs.existsSync`.
 * @returns Matching manager and lockfile name, or undefined when none/ambiguous.
 * @throws Error when `projectDir` is not absolute.
 */
export function detectPackageManagerFromLockfile(
	projectDir: string,
	ecosystem: RegistryEcosystem,
	pathExists: (absolutePath: string) => boolean = (absolutePath) =>
		fs.existsSync(absolutePath),
): { manager: RegistryPackageManager; lockfile: string } | undefined {
	if (!path.isAbsolute(projectDir))
		throw new Error("Project directory must be an absolute path.");

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
 * Whether compiled item files interpolate this ecosystem's package-manager bindings.
 * @param compiledItem - Compiled item whose file templates are scanned.
 * @param ecosystem - Registry ecosystem whose binding keys to look for.
 * @returns True when a Mustache tag for the manager or its `pm*` bindings appears.
 */
function compiledItemInterpolatesPackageManager(
	compiledItem: CompiledItem,
	ecosystem: RegistryEcosystem,
): boolean {
	// Reserved keys are exactly `packageManager` + the ecosystem's `pm*` bindings.
	const keys = reservedInterpolationKeys(ecosystem);
	const tag = new RegExp(String.raw`\{\{\s*(?:${keys.join("|")})\s*\}\}`);
	return compiledItem.files.some((file) => tag.test(file.content));
}

/**
 * Whether a compiled item needs a package manager for an ecosystem.
 * @param compiledItem - Compiled item from the install plan or a beforeWrite hook.
 * @param ecosystem - Registry ecosystem to check.
 * @returns True when that ecosystem appears on deps, commands, or interpolated files.
 */
export function compiledItemUsesEcosystem(
	compiledItem: CompiledItem,
	ecosystem: RegistryEcosystem,
): boolean {
	const deps = compiledItem.dependencies?.[ecosystem];
	const commands = compiledItem.commands?.[ecosystem];
	const hasDeps =
		(deps?.[RegistryDependencyKind.RUNTIME]?.length ?? 0) > 0 ||
		(deps?.[RegistryDependencyKind.DEV]?.length ?? 0) > 0;
	const hasCommands =
		commands !== undefined && Object.keys(commands).length > 0;
	return (
		hasDeps ||
		hasCommands ||
		compiledItemInterpolatesPackageManager(compiledItem, ecosystem)
	);
}

/**
 * Select a package manager for one ecosystem: lockfile when unambiguous, otherwise prompt.
 * @param ecosystem - Registry ecosystem to select for.
 * @param projectDir - Absolute project root.
 * @param prompt - Prompt host used when lockfile detection is inconclusive.
 * @param pathExists - Existence checker for absolute paths. Defaults to `fs.existsSync`.
 * @returns Selected manager for that ecosystem.
 */
export async function selectPackageManager(
	ecosystem: RegistryEcosystem,
	projectDir: string,
	prompt: Pick<PromptHost, "select">,
	pathExists: (absolutePath: string) => boolean = (absolutePath) =>
		fs.existsSync(absolutePath),
): Promise<RegistryPackageManager> {
	const detected = detectPackageManagerFromLockfile(
		projectDir,
		ecosystem,
		pathExists,
	);
	if (detected) return detected.manager;

	const specs = ecosystemManagers[ecosystem];
	const selected = await prompt.select(
		"Which package manager should be used for the project?",
		{
			options: specs.map((spec) => ({
				label: spec.label,
				value: spec.manager,
			})),
		},
		specs[0].manager,
	);

	if (!isPackageManagerForEcosystem(ecosystem, selected))
		throw new Error(
			`Unknown packageManager "${selected}". Expected one of: ${specs.map((entry) => entry.manager).join(", ")}.`,
		);

	return selected;
}

/**
 * Build argv install commands for a chosen ecosystem manager.
 * @param ecosystem - Registry ecosystem for the packages.
 * @param manager - Selected package manager.
 * @param dependencySet - Runtime and dev packages to install.
 * @returns Install commands to run, or an empty list when there is nothing to install.
 * @throws Error when `manager` is not valid for `ecosystem`, or a package name is unsafe.
 */
export function buildPackageInstallCommands(
	ecosystem: RegistryEcosystem,
	manager: RegistryPackageManager,
	dependencySet: RegistryDependencySet,
): PackageInstallCommand[] {
	// Dedupe, validate, and sort so generated command strings are stable across payloads.
	const [runtime, dev] = uniqueValidatedDependencyLists(dependencySet);
	if (runtime.length === 0 && dev.length === 0) return [];

	const spec = packageManagerSpec(ecosystem, manager);
	const commands: PackageInstallCommand[] = [];

	const append = (kind: RegistryDependencyKind, packages: string[]): void => {
		if (packages.length === 0) return;
		const args = [...spec.install[kind], ...packages];
		commands.push({
			executable: spec.manager,
			args,
			display: [spec.manager, ...args].join(" "),
		});
	};

	append(RegistryDependencyKind.RUNTIME, runtime);
	append(RegistryDependencyKind.DEV, dev);
	return commands;
}
