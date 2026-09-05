import {
	assertScriptsAllowed,
	type CompiledItem,
	classifyRegistryTrust,
	collectDeclaredScriptUris,
	createHandlerRuntime,
	createRejectedScriptExecutor,
	createScriptExecutor,
	type HandlerRuntime,
	isFileAsync,
	localScriptPath,
	type Registry,
	type RegistryContext,
	type RegistryPackageManager,
	type RegistryTrust,
	readFileAsync,
	runAsync,
	sandboxRunnerPath,
	setScriptExecutor,
	uniqueSorted,
} from "@tuckshop/core";
import { confirmInput } from "../cli/prompts";
import { bundledRegistryPath } from "./registry";

/**
 * Build project-scoped helpers that catalog scripts may call (`isFile`, `readFile`, `run`).
 * Paths are confined to `projectDir` by core; `run` executes with that directory as cwd.
 * @param projectDir - Absolute project root.
 * @returns Handler runtime bound to the project filesystem and shell.
 */
export function projectScriptHelpers(projectDir: string): HandlerRuntime {
	return createHandlerRuntime(projectDir, {
		isFile: isFileAsync,
		readFile: readFileAsync,
		run: (command) => runAsync(command, { cwd: projectDir, stdio: "pipe" }),
	});
}

/**
 * Classify trust, collect infer vs mutation scripts, prompt when needed, and install an executor.
 * Always installs an executor so a later load cannot fall back to in-process `require`.
 * @param options - Index location, registry, candidate items, and project dir.
 * @returns Trust classification and which script kinds may load.
 */
export async function prepareScriptExecution(options: {
	indexLocation: string;
	registry: Registry;
	itemIds: readonly string[];
	projectDir: string;
	selectedItems?: readonly string[];
	context?: RegistryContext;
	packageManager?: RegistryPackageManager;
}): Promise<{
	trust: RegistryTrust;
	allowInfer: boolean;
	allowMutation: boolean;
}> {
	const trust = classifyRegistryTrust(
		options.indexLocation,
		bundledRegistryPath(),
	);
	const scripts = collectDeclaredScriptUris(options.registry, options.itemIds, {
		selectedItems: options.selectedItems,
		context: options.context,
		packageManager: options.packageManager,
	});

	const policy = await assertScriptsAllowed(trust, scripts, (message) =>
		confirmInput(message, {}, false),
	);

	setScriptExecutor(
		policy.allowInfer || policy.allowMutation
			? createScriptExecutor({
					locateScriptPath: localScriptPath,
					scriptIntegrity: options.registry.scriptIntegrity,
					mode: "sandbox",
					projectDir: options.projectDir,
					runnerPath: sandboxRunnerPath(),
				})
			: createRejectedScriptExecutor(),
	);

	return { trust, ...policy };
}

/** One beforeWrite payload paired with the matching after payload. */
interface HookPayloadPair {
	before: CompiledItem;
	after: CompiledItem;
}

/**
 * Pair before/after payloads in order.
 * @param before - Items before beforeWrite.
 * @param after - The same items after beforeWrite, in the same order.
 * @returns Paired compiled items.
 * @throws Error when the lists differ in length.
 */
function pairedHookPayloads(
	before: Array<{ compiledItem: CompiledItem }>,
	after: Array<{ compiledItem: CompiledItem }>,
): HookPayloadPair[] {
	if (before.length !== after.length)
		throw new Error(
			"beforeWrite hook confirmation received mismatched item lists.",
		);

	return before.map((beforeItem, index) => {
		const afterItem = after[index];
		return { before: beforeItem.compiledItem, after: afterItem.compiledItem };
	});
}

/**
 * Values present in `after` and absent from `before`.
 * @param before - Prior values.
 * @param after - Next values.
 * @returns Sorted added values.
 */
function addedValues(before: string[], after: string[]): string[] {
	const prior = new Set(before);
	return uniqueSorted(after.filter((value) => !prior.has(value)));
}

/**
 * File targets declared on a compiled item.
 * @param compiledItem - Payload to read.
 * @returns Target paths.
 */
function compiledItemTargets(compiledItem: CompiledItem): string[] {
	return compiledItem.files.map((file) => file.target);
}

/**
 * Package names on a compiled item across every ecosystem.
 * @param compiledItem - Payload to read.
 * @returns Runtime and dev package names.
 */
function compiledItemPackageNames(compiledItem: CompiledItem): string[] {
	const names: string[] = [];
	for (const deps of Object.values(compiledItem.dependencies ?? {})) {
		if (!deps) continue;
		names.push(...(deps.runtime ?? []), ...(deps.dev ?? []));
	}
	return names;
}

/**
 * Command names on a compiled item across every ecosystem.
 * @param compiledItem - Payload to read.
 * @returns package.json script names.
 */
function compiledItemCommandNames(compiledItem: CompiledItem): string[] {
	const names: string[] = [];
	for (const set of Object.values(compiledItem.commands ?? {})) {
		if (!set) continue;
		names.push(...Object.keys(set));
	}
	return names;
}

/**
 * Command bodies keyed by script name.
 * @param compiledItem - Payload to read.
 * @returns Map of command name to command body.
 */
function compiledItemCommandBodies(
	compiledItem: CompiledItem,
): Map<string, string> {
	const bodies = new Map<string, string>();
	for (const set of Object.values(compiledItem.commands ?? {})) {
		if (!set) continue;
		for (const [name, value] of Object.entries(set)) bodies.set(name, value);
	}
	return bodies;
}

/** Added, removed, and rewritten install artifacts from beforeWrite hooks. */
interface HookMutationDelta {
	addedFiles: string[];
	removedFiles: string[];
	changedFiles: string[];
	packages: string[];
	commands: string[];
	secrets: string[];
}

/**
 * Diff one field across paired before/after payloads.
 * @param pairs - Paired compiled items.
 * @param read - Field reader.
 * @returns Sorted values present only after beforeWrite.
 */
function addedFieldValues(
	pairs: HookPayloadPair[],
	read: (compiledItem: CompiledItem) => string[],
): string[] {
	const added: string[] = [];
	for (const pair of pairs)
		added.push(...addedValues(read(pair.before), read(pair.after)));
	return uniqueSorted(added);
}

/**
 * Values present before beforeWrite and absent after.
 * @param pairs - Paired compiled items.
 * @param read - Field reader.
 * @returns Sorted values present only before beforeWrite.
 */
function removedFieldValues(
	pairs: HookPayloadPair[],
	read: (compiledItem: CompiledItem) => string[],
): string[] {
	const removed: string[] = [];
	for (const pair of pairs)
		removed.push(...addedValues(read(pair.after), read(pair.before)));
	return uniqueSorted(removed);
}

/**
 * File targets whose contents changed but whose path did not.
 * @param pairs - Paired compiled items.
 * @returns Sorted rewritten targets.
 */
function changedFileTargets(pairs: HookPayloadPair[]): string[] {
	const changed: string[] = [];
	for (const pair of pairs) {
		const beforeFiles = new Map(
			pair.before.files.map((file) => [file.target, file.content]),
		);
		for (const file of pair.after.files) {
			const previous = beforeFiles.get(file.target);
			if (previous !== undefined && previous !== file.content)
				changed.push(file.target);
		}
	}
	return uniqueSorted(changed);
}

/**
 * Command names whose bodies changed but whose names did not.
 * @param pairs - Paired compiled items.
 * @returns Sorted rewritten command names.
 */
function changedCommandNames(pairs: HookPayloadPair[]): string[] {
	const changed: string[] = [];
	for (const pair of pairs) {
		const beforeBodies = compiledItemCommandBodies(pair.before);
		for (const [name, value] of compiledItemCommandBodies(pair.after)) {
			const previous = beforeBodies.get(name);
			if (previous !== undefined && previous !== value) changed.push(name);
		}
	}
	return uniqueSorted(changed);
}

/**
 * Collect beforeWrite-hook mutations by comparing payloads before and after.
 * @param before - Prepared items before beforeWrite hooks.
 * @param after - The same items after beforeWrite hooks, in the same order.
 * @returns Deduped added/removed/rewritten artifact names.
 * @throws Error when the lists differ in length.
 */
function hookMutationDelta(
	before: Array<{ compiledItem: CompiledItem }>,
	after: Array<{ compiledItem: CompiledItem }>,
): HookMutationDelta {
	const pairs = pairedHookPayloads(before, after);
	return {
		addedFiles: addedFieldValues(pairs, compiledItemTargets),
		removedFiles: removedFieldValues(pairs, compiledItemTargets),
		changedFiles: changedFileTargets(pairs),
		packages: addedFieldValues(pairs, compiledItemPackageNames),
		commands: uniqueSorted([
			...addedFieldValues(pairs, compiledItemCommandNames),
			...changedCommandNames(pairs),
		]),
		secrets: addedFieldValues(
			pairs,
			(compiledItem) => compiledItem.secrets ?? [],
		),
	};
}

/**
 * Whether a hook delta contains nothing the user needs to confirm.
 * @param delta - Diff of beforeWrite-hook payloads.
 * @returns True when every list is empty.
 */
function hookMutationDeltaIsEmpty(delta: HookMutationDelta): boolean {
	return Object.values(delta).every((values) => values.length === 0);
}

/**
 * Print one labeled list of hook mutations.
 * @param heading - Section title.
 * @param values - Names to list.
 */
function printHookMutationSection(heading: string, values: string[]): void {
	if (values.length === 0) return;
	console.log(`  ${heading}:`);
	for (const name of values) console.log(`    - ${name}`);
}

/**
 * Prompt the user to review mutations returned by beforeWrite hooks.
 * Compares payloads before and after beforeWrite so static files are not listed.
 * @param before - Prepared items before beforeWrite hooks.
 * @param after - The same items after beforeWrite hooks, in the same order.
 * @returns False when the user cancels the install.
 * @throws Error when the before/after lists have different lengths.
 */
export async function confirmHookMutations(
	before: Array<{ compiledItem: CompiledItem }>,
	after: Array<{ compiledItem: CompiledItem }>,
): Promise<boolean> {
	const delta = hookMutationDelta(before, after);
	if (hookMutationDeltaIsEmpty(delta)) return true;

	console.log();
	console.log("Install scripts proposed the following changes:");
	printHookMutationSection("Files", delta.addedFiles);
	printHookMutationSection("Files removed", delta.removedFiles);
	printHookMutationSection("Files changed", delta.changedFiles);
	printHookMutationSection("Packages", delta.packages);
	printHookMutationSection("package.json scripts", delta.commands);
	printHookMutationSection("Secrets", delta.secrets);

	return confirmInput("Continue with these script-proposed changes?", {}, true);
}
