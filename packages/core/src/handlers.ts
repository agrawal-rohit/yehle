import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { unwrapModuleExport } from "./cjs-export";
import {
	policyForConditionKind,
	type RegistryContext,
	type RegistryContextValue,
} from "./condition-kind";
import { isMissingPathError } from "./fs";
import {
	compiledItem,
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
	type RegistryPackageManager,
	reservedInterpolationKeys,
} from "./packages";
import { parseWithSchema } from "./parse";
import type { RequiredCondition } from "./plan";
import {
	type CompiledItem,
	type CompiledItemFile,
	compiledItemSchema,
	type RegistryConditionValue,
	RegistryEcosystem,
	type RegistryEcosystemCommands,
	type RegistryEcosystemDependencies,
} from "./schema";
import type { ScriptExecutor } from "./scripts";
import { isAbsoluteHttpUrl, joinRelativePathUnderRoot } from "./urls";

const requireScript = createRequire(__filename);

/** Active script loader (in-process by default; CLI may install a sandboxed executor). */
let activeScriptExecutor: ScriptExecutor | undefined;

/**
 * Install the script executor used by install and condition hooks.
 * @param executor - Executor to use for subsequent script loads, or undefined to reset.
 */
export function setScriptExecutor(executor: ScriptExecutor | undefined): void {
	activeScriptExecutor = executor;
}

/**
 * Read the active script executor, if one was installed.
 * @returns Active executor or undefined when using the built-in in-process loader.
 */
export function getScriptExecutor(): ScriptExecutor | undefined {
	return activeScriptExecutor;
}

/** One option offered by a select prompt. */
export interface HandlerSelectOption extends RegistryConditionValue {
	/** Optional hint shown beside the option. */
	hint?: string;
}

/** Prompt helper used by the CLI when capturing conditions. */
export interface PromptHost {
	/**
	 * Prompt for free-form text.
	 * @param message - Prompt message.
	 * @param opts - Optional placeholder and required flag.
	 * @param defaultValue - Optional initial value.
	 * @returns Trimmed user input.
	 */
	text: (
		message: string,
		opts?: { placeholder?: string; required?: boolean },
		defaultValue?: string,
	) => Promise<string>;

	/**
	 * Prompt for a single selection.
	 * @param message - Prompt message.
	 * @param opts - Options list.
	 * @param defaultValue - Optional initial selection.
	 * @returns Selected value.
	 */
	select: (
		message: string,
		opts: { options: HandlerSelectOption[] },
		defaultValue?: string,
	) => Promise<string>;

	/**
	 * Prompt for multiple selections.
	 * @param message - Prompt message.
	 * @param opts - Options list.
	 * @param defaultValues - Optional initial selections.
	 * @returns Selected values.
	 */
	multiselect: (
		message: string,
		opts: { options: HandlerSelectOption[] },
		defaultValues?: string[],
	) => Promise<string[]>;

	/**
	 * Prompt for a yes/no confirmation.
	 * @param message - Prompt message.
	 * @param opts - Optional active/inactive labels.
	 * @param defaultValue - Optional initial boolean.
	 * @returns User confirmation result.
	 */
	confirm: (
		message: string,
		opts?: { active?: string; inactive?: string },
		defaultValue?: boolean,
	) => Promise<boolean>;
}

/**
 * Shared filesystem and process helpers available to install and infer scripts.
 *
 * `isFile` / `readFile` only accept paths under {@linkcode HandlerRuntime.projectDir}.
 * Scripts should use these helpers instead of Node builtins; sandboxed execution
 * denies direct filesystem, network, and child_process access outside `ctx`.
 */
export interface HandlerRuntime {
	/** Absolute project root receiving the install. */
	projectDir: string;
	/**
	 * Check whether a path is an existing file under the project root.
	 * @param filePath - Project-relative path, or absolute path under `projectDir`.
	 */
	isFile: (filePath: string) => Promise<boolean>;
	/**
	 * Check whether a path is an existing directory under the project root.
	 * @param filePath - Project-relative path, or absolute path under `projectDir`.
	 */
	isDirectory: (filePath: string) => Promise<boolean>;
	/**
	 * Read a UTF-8 text file under the project root.
	 * @param filePath - Project-relative path, or absolute path under `projectDir`.
	 */
	readFile: (filePath: string) => Promise<string>;
	/**
	 * Run a shell command in the project directory (parent-mediated; sanitized env).
	 * @param command - Command string.
	 */
	run: (command: string) => Promise<string>;
}

/** Shared options for install lifecycle scripts. */
export interface RunInstallHookOptions {
	itemId: string;
	packIds?: string[];
	conditions: RegistryContext;
	/** Selected package manager when this install uses an ecosystem manager. */
	packageManager?: RegistryPackageManager;
	bindings?: Record<string, string>;
	compiledItem: CompiledItem;
}

/**
 * Build shared options for an install lifecycle script from a plan node.
 * @param node - Item id and optional pack ids.
 * @param rest - Conditions, package manager, bindings, and working compiled item.
 * @returns Options passed to beforeWrite and afterInstall runners.
 */
export function runInstallHookOptions(
	node: Pick<RunInstallHookOptions, "itemId" | "packIds">,
	rest: Omit<RunInstallHookOptions, "itemId" | "packIds">,
): RunInstallHookOptions {
	return {
		itemId: node.itemId,
		...(node.packIds ? { packIds: node.packIds } : {}),
		...rest,
	};
}

/**
 * Build the context object passed into an install hook.
 * @param runtime - Shared handler runtime.
 * @param options - Item identity and install state.
 * @param compiledItem - Working compiled item for this invocation.
 * @param bindings - Bindings visible to the hook.
 * @returns Install hook context.
 */
function installHookContext(
	runtime: HandlerRuntime,
	options: RunInstallHookOptions,
	compiledItem: CompiledItem,
	bindings: Record<string, string>,
): InstallHookContext {
	return {
		...runtime,
		itemId: options.itemId,
		...(options.packIds ? { packIds: [...options.packIds] } : {}),
		conditions: structuredClone(options.conditions),
		packageManager: options.packageManager,
		bindings: structuredClone(bindings),
		compiledItem: structuredClone(compiledItem),
	};
}

/** Context passed to install lifecycle scripts. */
export interface InstallHookContext extends HandlerRuntime {
	/** Registry item id being installed. */
	itemId: string;
	/** Selected pack ids layered onto this item. */
	packIds?: string[];
	/** Condition values captured from the install plan. */
	conditions: RegistryContext;
	/** Selected package manager when this install uses an ecosystem manager. */
	packageManager?: RegistryPackageManager;
	/** Bindings collected from earlier install scripts in this run. */
	bindings: Record<string, string>;
	/** Working compiled item (files may be empty before scripts run). */
	compiledItem: CompiledItem;
}

/** Optional result from a `beforeWrite` script. */
export interface BeforeWriteHookResult {
	/** Files to upsert into the working compiled item by `target`. */
	files?: CompiledItemFile[];
	/** Target paths to remove from the working compiled item. */
	removeFiles?: string[];
	/** Bindings merged into the shared install context. */
	bindings?: Record<string, string>;
	/** Ecosystem commands to fold into the payload when returned from a hook. */
	commands?: RegistryEcosystemCommands;
	/** Ecosystem packages to install. */
	dependencies?: RegistryEcosystemDependencies;
	/** Repository secret names to remind about after install. */
	secrets?: string[];
}

/** Install hook script invoked before files are written. */
export type BeforeWriteHook = (
	ctx: InstallHookContext,
) => Promise<BeforeWriteHookResult | undefined>;

/** Install hook script invoked after files and packages are applied. Must not return a value. */
export type AfterInstallHook = (ctx: InstallHookContext) => Promise<void>;

/** Context passed to condition `infer` hooks. */
export interface ConditionHandlerContext extends HandlerRuntime {
	/** Condition key being captured. */
	key: string;
	/** Display label for the condition. */
	label: string;
	/** Optional description for the condition. */
	description?: string;
	/** Declared select/multiselect values when the condition has fixed options. */
	values?: RegistryConditionValue[];
	/** Condition values already captured. */
	conditions: RegistryContext;
}

/** Install-time hooks for a shared registry condition. */
export interface ConditionHandler {
	/**
	 * Suggest a default value for the condition prompt.
	 * Returning undefined falls back to a static `default` when declared.
	 * @param ctx - Condition handler context.
	 * @returns Suggested default (string, string[] for multiselect, or boolean), or undefined.
	 */
	infer?: (
		ctx: ConditionHandlerContext,
	) => Promise<string | string[] | boolean | undefined>;
}

/**
 * Upsert returned files into the working list by target path.
 * @param files - Current working file list.
 * @param upserts - Files returned from a beforeWrite hook.
 * @returns Updated file list.
 */
function upsertCompiledItemFiles(
	files: CompiledItemFile[],
	upserts: CompiledItemFile[],
): CompiledItemFile[] {
	const next = [...files];
	for (const file of upserts) {
		const index = next.findIndex((entry) => entry.target === file.target);
		if (index === -1) next.push(file);
		else next[index] = file;
	}
	return next;
}

/**
 * Remove files whose targets appear in `removeFiles`.
 * @param files - Current working file list.
 * @param removeFiles - Targets to drop.
 * @returns Filtered file list.
 */
function removeCompiledItemFiles(
	files: CompiledItemFile[],
	removeFiles: string[],
): CompiledItemFile[] {
	const removed = new Set(removeFiles);
	return files.filter((file) => !removed.has(file.target));
}

/**
 * Join a index-relative script URI to an absolute local file path (rejects remote registries, absolute paths, URLs, and parent-directory escapes).
 * @param indexLocation - Absolute path or HTTPS URL of registry.json.
 * @param scriptUri - Catalog script URI such as `r/item.beforeWrite.0.js`.
 * @returns Absolute path to the script module.
 * @throws Error when the index is remote or the URI is unsafe.
 */
export function localScriptPath(
	indexLocation: string,
	scriptUri: string,
): string {
	if (isAbsoluteHttpUrl(indexLocation))
		throw new Error(
			"Registry scripts require a local registry. Remote HTTPS registries cannot execute custom scripts.",
		);
	if (!path.isAbsolute(indexLocation))
		throw new Error(
			"Registry index location must be an absolute path or HTTPS URL.",
		);

	const indexDir = path.dirname(path.resolve(indexLocation));
	// joinRelativePathUnderRoot rejects empty and absolute-URL URIs with this exact message.
	return joinRelativePathUnderRoot(
		indexDir,
		scriptUri,
		"Script URI",
		"registry directory",
	);
}

/**
 * Load a local script module and validate its export shape.
 * @param indexLocation - Absolute path to registry.json (must be local).
 * @param scriptUri - Catalog script URI.
 * @param isValid - Predicate that accepts a usable export.
 * @param errorMessage - Error when the export shape is invalid.
 * @returns Loaded export (default export or module itself).
 * @throws Error when the module cannot be loaded or has no usable export.
 */
async function loadScriptModule<T>(
	indexLocation: string,
	scriptUri: string,
	isValid: (value: unknown) => value is T,
	errorMessage: string,
): Promise<T> {
	if (activeScriptExecutor)
		return activeScriptExecutor.loadModule(
			indexLocation,
			scriptUri,
			isValid,
			errorMessage,
		);

	const absolutePath = localScriptPath(indexLocation, scriptUri);
	// Delete the script from the require cache so rebuilt scripts are picked up in long-lived processes.
	Reflect.deleteProperty(requireScript.cache, absolutePath);
	const script = unwrapModuleExport(requireScript(absolutePath));
	if (!isValid(script)) throw new Error(errorMessage);
	return script;
}

/** Public install state returned after a beforeWrite hook. */
export interface BeforeWriteHookState {
	files: CompiledItemFile[];
	bindings: Record<string, string>;
	commands?: RegistryEcosystemCommands;
	dependencies?: RegistryEcosystemDependencies;
	secrets?: string[];
}

/**
 * Check whether a value is a plain record suitable for hook data.
 * @param value - Candidate hook data.
 * @returns True when the value has an object or null prototype.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/**
 * Fail when a beforeWrite return value is not a plain object with known keys.
 * @param result - Raw hook return value.
 * @param scriptUri - Catalog script URI for error messages.
 * @throws Error when the result is not an object or declares unknown keys.
 */
function assertBeforeWriteHookResultShape(
	result: unknown,
	scriptUri: string,
): asserts result is BeforeWriteHookResult {
	if (!isPlainRecord(result))
		throw new Error(
			`Before-write hook at "${scriptUri}" must return an object or undefined.`,
		);
	const knownKeys = new Set([
		"files",
		"removeFiles",
		"bindings",
		"commands",
		"dependencies",
		"secrets",
	]);
	for (const key of Object.keys(result)) {
		if (!knownKeys.has(key))
			throw new Error(
				`Before-write hook at "${scriptUri}" returned unknown key "${key}".`,
			);
	}
}

/**
 * Fail when hook bindings are present but not a plain object.
 * @param incoming - Bindings returned from the hook.
 * @param scriptUri - Catalog script URI for error messages.
 * @throws Error when `incoming` is defined but not a plain object.
 */
function assertIncomingBindingsObject(
	incoming: unknown,
	scriptUri: string,
): asserts incoming is Record<string, unknown> | undefined {
	if (incoming !== undefined && !isPlainRecord(incoming))
		throw new Error(
			`Before-write hook at "${scriptUri}" bindings must be an object.`,
		);
}

/**
 * Merge hook bindings onto the working map without spreading prototype keys.
 * @param existing - Bindings already collected.
 * @param incoming - Bindings returned from the hook.
 * @param scriptUri - Catalog script URI for error messages.
 * @returns Combined bindings.
 * @throws Error when a key is empty, `__proto__`, or reserved.
 */
function mergeHookBindings(
	existing: Record<string, string>,
	incoming: unknown,
	scriptUri: string,
): Record<string, string> {
	assertIncomingBindingsObject(incoming, scriptUri);
	const merged: Record<string, string> = {};
	assignHookBindings(merged, existing, scriptUri);
	if (incoming !== undefined)
		assignHookBindings(
			merged,
			incoming,
			scriptUri,
			new Set(reservedInterpolationKeys()),
		);
	return merged;
}

/**
 * Copy one binding map onto `merged`, rejecting empty, `__proto__`, reserved, and non-string entries.
 * @param merged - Bindings collected so far.
 * @param source - Own-key map to copy.
 * @param scriptUri - Catalog script URI for error messages.
 * @param reserved - When set, these keys are rejected (incoming hook bindings only).
 * @throws Error when a key is empty, `__proto__`, reserved, or the value is not a string.
 */
function assignHookBindings(
	merged: Record<string, string>,
	source: object,
	scriptUri: string,
	reserved?: ReadonlySet<string>,
): void {
	const record = source as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key.length === 0 || key === "__proto__")
			throw new Error(
				`Before-write hook at "${scriptUri}" binding "${key}" is not allowed.`,
			);
		if (reserved?.has(key))
			throw new Error(
				`Before-write hook at "${scriptUri}" binding "${key}" is reserved.`,
			);
		const value = record[key];
		if (typeof value !== "string")
			throw new Error(
				`Before-write hook at "${scriptUri}" binding "${key}" must be a string.`,
			);
		merged[key] = value;
	}
}

/**
 * Reject an ecosystem map entry that is not a non-null, non-array object.
 * @param entryValue - Candidate ecosystem commands/dependencies map.
 * @param field - Field name for error reporting.
 * @param key - Ecosystem key.
 * @param scriptUri - Catalog script URI for error messages.
 * @throws Error when the entry is not a plain object.
 */
function assertEcosystemEntryIsObject(
	entryValue: unknown,
	field: string,
	key: string,
	scriptUri: string,
): void {
	if (
		typeof entryValue !== "object" ||
		entryValue === null ||
		Array.isArray(entryValue)
	) {
		throw new Error(
			`Before-write hook at "${scriptUri}" ${field}.${key} must be an object.`,
		);
	}
}

/**
 * Reject ecosystem maps that use undeclared ecosystem keys or non-object values.
 * @param value - Commands or dependencies object from the hook.
 * @param field - Field name for the error.
 * @param scriptUri - Catalog script URI for error messages.
 * @throws Error when a key is not a known {@link RegistryEcosystem}.
 */
function assertKnownEcosystemKeys(
	value: unknown,
	field: string,
	scriptUri: string,
): void {
	if (value === undefined) return;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(
			`Before-write hook at "${scriptUri}" ${field} must be an object.`,
		);
	const known = new Set<string>(Object.values(RegistryEcosystem));
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!known.has(key))
			throw new Error(
				`Before-write hook at "${scriptUri}" ${field} has unknown ecosystem "${key}".`,
			);
		assertEcosystemEntryIsObject(record[key], field, key, scriptUri);
	}
}

/**
 * Fail when a hook field is not an array of non-empty strings.
 * @param value - Candidate string array field.
 * @param field - Field name for the error.
 * @param scriptUri - Catalog script URI for error messages.
 * @throws Error when `value` is defined and not an array of non-empty strings.
 */
function assertNonEmptyStringArray(
	value: unknown,
	field: string,
	scriptUri: string,
): asserts value is string[] | undefined {
	if (value === undefined) return;
	if (!Array.isArray(value))
		throw new Error(
			`Before-write hook at "${scriptUri}" ${field} must be an array.`,
		);
	for (const entry of value) {
		if (typeof entry !== "string" || entry.length === 0)
			throw new Error(
				`Before-write hook at "${scriptUri}" ${field} entries must be non-empty strings.`,
			);
	}
}

/**
 * Apply a beforeWrite hook result onto the working install state.
 * @param state - Current files, bindings, and optional payload fields.
 * @param result - Hook return value.
 * @param scriptUri - Catalog script URI for error messages.
 * @returns Updated install state.
 */
function applyBeforeWriteResult(
	state: BeforeWriteHookState,
	result: unknown,
	scriptUri: string,
): BeforeWriteHookState {
	assertBeforeWriteHookResultShape(result, scriptUri);
	assertKnownEcosystemKeys(result.commands, "commands", scriptUri);
	assertKnownEcosystemKeys(result.dependencies, "dependencies", scriptUri);
	assertNonEmptyStringArray(result.removeFiles, "removeFiles", scriptUri);

	const parsed = parseWithSchema(
		compiledItemSchema,
		{
			files: result.files,
			commands: result.commands,
			dependencies: result.dependencies,
			secrets: result.secrets,
		},
		`Before-write hook at "${scriptUri}"`,
	);
	let files = state.files;
	if (result.removeFiles)
		files = removeCompiledItemFiles(files, result.removeFiles);
	if (result.files) files = upsertCompiledItemFiles(files, parsed.files);

	return {
		files,
		bindings: mergeHookBindings(state.bindings, result.bindings, scriptUri),
		// Re-folding an absent hook field is a no-op, so unconditional merges are safe.
		commands: mergeEcosystemMaps(
			mergeCommandSet,
			state.commands,
			parsed.commands,
		),
		dependencies: mergeEcosystemMaps(
			mergeDependencySet,
			state.dependencies,
			parsed.dependencies,
		),
		secrets: mergeSecretNames(state.secrets, parsed.secrets),
	};
}

/**
 * Run one compiled `beforeWrite` script.
 * @param indexLocation - Absolute local path to registry.json.
 * @param scriptUri - Catalog script URI.
 * @param runtime - Shared handler runtime.
 * @param options - Item identity, payload, and install state.
 * @returns Updated files, bindings, and merged payload fields.
 */
export async function runBeforeWriteHook(
	indexLocation: string,
	scriptUri: string,
	runtime: HandlerRuntime,
	options: RunInstallHookOptions,
): Promise<BeforeWriteHookState> {
	const hook = await loadScriptModule(
		indexLocation,
		scriptUri,
		(script): script is BeforeWriteHook => typeof script === "function",
		`Script at "${scriptUri}" must export a \`beforeWrite\` hook function.`,
	);
	let state: BeforeWriteHookState = {
		files: [...options.compiledItem.files],
		bindings: { ...options.bindings },
		commands: options.compiledItem.commands,
		dependencies: options.compiledItem.dependencies,
		secrets: options.compiledItem.secrets,
	};

	const ctx = installHookContext(
		runtime,
		options,
		{ ...options.compiledItem, files: state.files },
		state.bindings,
	);

	const result: unknown = await hook(ctx);
	if (result !== undefined)
		state = applyBeforeWriteResult(state, result, scriptUri);

	return {
		bindings: state.bindings,
		...compiledItem({
			files: state.files,
			commands: state.commands,
			dependencies: state.dependencies,
			secrets: state.secrets,
		}),
	};
}

/**
 * Run one compiled `afterInstall` script.
 * @param indexLocation - Absolute local path to registry.json.
 * @param scriptUri - Catalog script URI.
 * @param runtime - Shared handler runtime.
 * @param options - Item identity, payload, and install state.
 * @throws Error when the module is not a function or the hook returns a value.
 */
export async function runAfterInstallHook(
	indexLocation: string,
	scriptUri: string,
	runtime: HandlerRuntime,
	options: RunInstallHookOptions,
): Promise<void> {
	const hook = await loadScriptModule(
		indexLocation,
		scriptUri,
		(script): script is AfterInstallHook => typeof script === "function",
		`Script at "${scriptUri}" must export an \`afterInstall\` hook function.`,
	);
	const ctx = installHookContext(runtime, options, options.compiledItem, {
		...options.bindings,
	});
	const result: unknown = await hook(ctx);
	if (result !== undefined)
		throw new Error(
			`After-install hook at "${scriptUri}" must not return a value.`,
		);
}

/**
 * Build the shared runtime helpers injected into every install script.
 * @param projectDir - Absolute project root.
 * @param helpers - Filesystem and process helpers.
 * @returns Handler runtime object.
 */
export function createHandlerRuntime(
	projectDir: string,
	helpers: {
		isFile: (filePath: string) => Promise<boolean>;
		/** Directory check. Optional so test stubs can omit it; production callers inject the stat-based check. */
		isDirectory?: (filePath: string) => Promise<boolean>;
		readFile: (filePath: string) => Promise<string>;
		run: (command: string) => Promise<string>;
	},
): HandlerRuntime {
	if (!path.isAbsolute(projectDir))
		throw new Error("Project directory must be an absolute path.");
	const resolvedRoot = path.resolve(projectDir);
	let realRoot = resolvedRoot;
	try {
		realRoot = fs.realpathSync(resolvedRoot);
	} catch (error) {
		if (!isMissingPathError(error)) throw error;
	}

	/**
	 * Fail when `resolved` is outside the specified project root.
	 * @param root - Absolute project root used for the comparison.
	 * @param resolved - Absolute path after resolve/realpath.
	 * @param filePath - Original handler argument for the error.
	 */
	const assertUnderProject = (
		root: string,
		resolved: string,
		filePath: string,
	): void => {
		const relative = path.relative(root, resolved);
		if (relative.startsWith("..") || path.isAbsolute(relative))
			throw new Error(
				`Handler path "${filePath}" escapes the project directory.`,
			);
	};

	/**
	 * Resolve a handler path and reject lexical escapes outside the project root.
	 * @param filePath - Project-relative or absolute path.
	 * @returns Absolute path under `projectDir`.
	 */
	const confinedPath = (filePath: string): string => {
		if (path.isAbsolute(filePath)) {
			const resolved = path.resolve(filePath);
			assertUnderProject(resolvedRoot, resolved, filePath);
			return resolved;
		}
		return joinRelativePathUnderRoot(
			resolvedRoot,
			filePath,
			"Handler path",
			"project directory",
		);
	};

	/**
	 * Resolve an existing path and reject symlinked ancestors outside the project.
	 * @param confined - Lexically confined absolute path.
	 * @param filePath - Original handler argument for the error.
	 * @returns Path to pass to filesystem helpers.
	 */
	const confinePath = async (
		confined: string,
		filePath: string,
	): Promise<string> => {
		try {
			const real = await fs.promises.realpath(confined);
			assertUnderProject(realRoot, real, filePath);
			return real;
		} catch (error) {
			if (isMissingPathError(error)) return confined;
			throw error;
		}
	};

	return {
		projectDir: resolvedRoot,
		isFile: async (filePath) => {
			const confined = confinedPath(filePath);
			return helpers.isFile(await confinePath(confined, filePath));
		},
		isDirectory: async (filePath) => {
			const confined = confinedPath(filePath);
			return helpers.isDirectory
				? helpers.isDirectory(await confinePath(confined, filePath))
				: // Fail closed like a missing directory when no checker is provided.
					false;
		},
		readFile: async (filePath) => {
			const confined = confinedPath(filePath);
			return helpers.readFile(await confinePath(confined, filePath));
		},
		run: helpers.run,
	};
}

/**
 * Infer a prompt default for one required condition.
 * @param indexLocation - Absolute local path to registry.json.
 * @param condition - Required condition from the install plan.
 * @param runtime - Shared handler runtime.
 * @param context - Condition values already captured.
 * @param options - When `allowHandler` is false, skip infer scripts and keep schema `default`.
 * @returns Suggested default when confident, otherwise undefined.
 */
export async function inferConditionDefault(
	indexLocation: string,
	condition: RequiredCondition,
	runtime: HandlerRuntime,
	context: RegistryContext,
	options: { allowHandler?: boolean } = {},
): Promise<RegistryContextValue | undefined> {
	const policy = policyForConditionKind(condition.kind);

	if ((options.allowHandler ?? true) && condition.handler) {
		const handler = await loadScriptModule(
			indexLocation,
			condition.handler,
			(
				loaded,
			): loaded is ConditionHandler & {
				infer: NonNullable<ConditionHandler["infer"]>;
			} =>
				typeof loaded === "object" &&
				loaded !== null &&
				typeof (loaded as ConditionHandler).infer === "function",
			`Handler at "${condition.handler}" must export a condition handler with an infer hook.`,
		);

		const ctx: ConditionHandlerContext = {
			...runtime,
			key: condition.key,
			label: condition.label,
			...(condition.description ? { description: condition.description } : {}),
			...(condition.values.length > 0
				? { values: structuredClone(condition.values) }
				: {}),
			conditions: structuredClone(context),
		};

		const inferred = await handler.infer(ctx);
		if (inferred !== undefined) {
			// Every kind policy rejects empty values, so no pre-filter is needed.
			const inferredDefault = policy.inferredContextValue(
				inferred,
				condition.values,
			);
			if (inferredDefault !== undefined) return inferredDefault;
		}
	}

	if (condition.default === undefined) return undefined;

	return policy.inferredContextValue(condition.default, condition.values);
}
