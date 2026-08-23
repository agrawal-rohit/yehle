import { createRequire } from "node:module";
import path from "node:path";
import {
	policyForConditionKind,
	type RegistryContext,
	type RegistryContextValue,
} from "./condition-kind";
import type { RequiredCondition } from "./plan";
import type {
	RegistryConditionValue,
	RegistryPayload,
	RegistryPayloadFile,
} from "./schema";
import { isAbsoluteHttpUrl, joinRelativePathUnderRoot } from "./urls";

const requireScript = createRequire(__filename);

/** One option offered by a select prompt. */
export interface HandlerSelectOption extends RegistryConditionValue {
	/** Optional hint shown beside the option. */
	hint?: string;
}

/** Prompt helper injected into install scripts so they never import the CLI. */
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

/** Shared filesystem and process helpers available to install scripts. */
export interface HandlerRuntime {
	/** Absolute project root receiving the install. */
	projectDir: string;
	/** Prompt host for interactive questions. */
	prompts: PromptHost;
	/**
	 * Check whether a path is an existing file.
	 * @param filePath - Absolute or project-relative path.
	 */
	isFile: (filePath: string) => Promise<boolean>;
	/**
	 * Read a UTF-8 text file.
	 * @param filePath - Absolute or project-relative path.
	 */
	readFile: (filePath: string) => Promise<string>;
	/**
	 * Run a shell command in the project directory.
	 * @param command - Command string.
	 */
	run: (command: string) => Promise<string>;
}

/** Shared options for install lifecycle scripts. */
export interface RunInstallHookOptions {
	itemId: string;
	variantId?: string;
	conditions: RegistryContext;
	variables?: Record<string, string>;
	payload: RegistryPayload;
	files: RegistryPayloadFile[];
}

/** Context passed to install lifecycle scripts. */
export interface InstallHookContext extends HandlerRuntime {
	/** Registry item id being installed. */
	itemId: string;
	/** Selected variant id when the item has variants. */
	variantId?: string;
	/** Condition values captured from the install plan. */
	conditions: RegistryContext;
	/** Variables collected from earlier install scripts in this run. */
	variables: Record<string, string>;
	/** Parsed install payload (may have empty files before scripts run). */
	payload: RegistryPayload;
	/** Working file list (payload files plus any generated so far). */
	files: RegistryPayloadFile[];
}

/** Optional result from a `beforeInstall` script. */
export interface BeforeInstallHookResult {
	/** Final file list for overwrite checks and writes. Replaces `ctx.files` when set. */
	files?: RegistryPayloadFile[];
	/** Variables merged into the shared install context. */
	variables?: Record<string, string>;
}

/** Install hook script invoked before files are written. */
export type BeforeInstallHook = (
	ctx: InstallHookContext,
) => Promise<BeforeInstallHookResult | undefined>;

/** Install hook script invoked after files are written. */
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
	 * Returning undefined leaves the prompt without a default.
	 * @param ctx - Condition handler context.
	 * @returns Suggested default (string, string[] for multiselect, or boolean), or undefined.
	 */
	infer?: (
		ctx: ConditionHandlerContext,
	) => Promise<string | string[] | boolean | undefined>;
}

/**
 * Join a catalog-relative script URI to an absolute local file path (rejects remote catalogs, absolute paths, URLs, and parent-directory escapes).
 * @param catalogLocation - Absolute path or HTTPS URL of registry.json.
 * @param scriptUri - Catalog script URI such as `r/item.beforeInstall.0.js`.
 * @returns Absolute path to the script module.
 * @throws Error when the catalog is remote or the URI is unsafe.
 */
export function localScriptPath(
	catalogLocation: string,
	scriptUri: string,
): string {
	if (isAbsoluteHttpUrl(catalogLocation))
		throw new Error(
			"Registry scripts require a local catalog. Remote HTTPS registries cannot execute custom scripts.",
		);

	const catalogDir = path.dirname(path.resolve(catalogLocation));
	const trimmed = scriptUri.trim();
	if (!trimmed || isAbsoluteHttpUrl(trimmed))
		throw new Error(
			`Script URI "${scriptUri}" must be a relative path under the catalog directory.`,
		);

	return joinRelativePathUnderRoot(
		catalogDir,
		trimmed,
		"Script URI",
		"catalog directory",
	);
}

/**
 * Load a CommonJS script module from disk.
 * @param absolutePath - Absolute path to the compiled script.
 * @returns Module exports object.
 */
function requireScriptModule(absolutePath: string): Record<string, unknown> {
	// Delete the script from the require cache so rebuilt scripts are picked up in long-lived processes.
	Reflect.deleteProperty(requireScript.cache, absolutePath);
	return requireScript(absolutePath) as Record<string, unknown>;
}

/**
 * Dynamically import a local script module and validate its export shape.
 * @param catalogLocation - Absolute path to registry.json (must be local).
 * @param scriptUri - Catalog script URI.
 * @param isValid - Predicate that accepts a usable export.
 * @param errorMessage - Error when the export shape is invalid.
 * @returns Loaded export (default export or module itself).
 * @throws Error when the module cannot be loaded or has no usable export.
 */
async function loadScriptModule<T>(
	catalogLocation: string,
	scriptUri: string,
	isValid: (value: unknown) => value is T,
	errorMessage: string,
): Promise<T> {
	const absolutePath = localScriptPath(catalogLocation, scriptUri);
	const imported = requireScriptModule(absolutePath);
	// Accept either `export default fn` or `module.exports = fn`.
	const script =
		imported !== null &&
		typeof imported === "object" &&
		"default" in imported &&
		imported.default !== undefined
			? imported.default
			: imported;
	if (!isValid(script)) throw new Error(errorMessage);
	return script;
}

/**
 * Run one compiled `beforeInstall` script.
 * @param catalogLocation - Absolute local path to registry.json.
 * @param scriptUri - Catalog script URI.
 * @param runtime - Shared handler runtime.
 * @param options - Item identity, payload, and install state.
 * @returns Updated files and variables.
 */
export async function runBeforeInstallHook(
	catalogLocation: string,
	scriptUri: string,
	runtime: HandlerRuntime,
	options: RunInstallHookOptions,
): Promise<{
	files: RegistryPayloadFile[];
	variables: Record<string, string>;
}> {
	const hook = await loadScriptModule(
		catalogLocation,
		scriptUri,
		(script): script is BeforeInstallHook => typeof script === "function",
		`Script at "${scriptUri}" must export a \`beforeInstall\` hook function.`,
	);
	const variables = { ...options.variables };
	let files = [...options.files];

	const ctx: InstallHookContext = {
		...runtime,
		itemId: options.itemId,
		...(options.variantId ? { variantId: options.variantId } : {}),
		conditions: options.conditions,
		variables,
		payload: options.payload,
		files,
	};

	const result: BeforeInstallHookResult | undefined = await hook(ctx);
	if (result) {
		if (result.variables) Object.assign(variables, result.variables);
		if (result.files) files = result.files;
	}

	return { files, variables };
}

/**
 * Run one compiled `afterInstall` script.
 * @param catalogLocation - Absolute local path to registry.json.
 * @param scriptUri - Catalog script URI.
 * @param runtime - Shared handler runtime.
 * @param options - Item identity, payload, and install state.
 */
export async function runAfterInstallHook(
	catalogLocation: string,
	scriptUri: string,
	runtime: HandlerRuntime,
	options: RunInstallHookOptions,
): Promise<void> {
	const hook = await loadScriptModule(
		catalogLocation,
		scriptUri,
		(script): script is AfterInstallHook => typeof script === "function",
		`Script at "${scriptUri}" must export an afterInstall hook function.`,
	);
	const ctx: InstallHookContext = {
		...runtime,
		itemId: options.itemId,
		...(options.variantId ? { variantId: options.variantId } : {}),
		conditions: options.conditions,
		variables: { ...options.variables },
		payload: options.payload,
		files: options.files,
	};
	await hook(ctx);
}

/**
 * Join a project-relative or absolute path against the install root.
 * @param projectDir - Absolute project root.
 * @param filePath - Project-relative or absolute path.
 * @returns Absolute path.
 */
function projectFilePath(projectDir: string, filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
}

/**
 * Build the shared runtime helpers injected into every install script.
 * @param projectDir - Absolute project root.
 * @param prompts - Prompt host implementation.
 * @param helpers - Filesystem and process helpers.
 * @returns Handler runtime object.
 */
export function createHandlerRuntime(
	projectDir: string,
	prompts: PromptHost,
	helpers: {
		isFile: (filePath: string) => Promise<boolean>;
		readFile: (filePath: string) => Promise<string>;
		run: (command: string) => Promise<string>;
	},
): HandlerRuntime {
	return {
		projectDir,
		prompts,
		isFile: (filePath) => helpers.isFile(projectFilePath(projectDir, filePath)),
		readFile: (filePath) =>
			helpers.readFile(projectFilePath(projectDir, filePath)),
		run: helpers.run,
	};
}

/**
 * Infer a prompt default for one required condition when it declares a handler.
 * @param catalogLocation - Absolute local path to registry.json.
 * @param condition - Required condition from the install plan.
 * @param runtime - Shared handler runtime.
 * @param context - Condition values already captured.
 * @returns Suggested default when confident, otherwise undefined.
 */
export async function inferConditionDefault(
	catalogLocation: string,
	condition: RequiredCondition,
	runtime: HandlerRuntime,
	context: RegistryContext,
): Promise<RegistryContextValue | undefined> {
	if (!condition.handler) return undefined;

	// Dynamically import the condition handler module and validate its export shape.
	const handler = await loadScriptModule(
		catalogLocation,
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
		...(condition.values.length > 0 ? { values: condition.values } : {}),
		conditions: context,
	};

	const inferred = await handler.infer(ctx);
	if (inferred === undefined || inferred === "") return undefined;

	return policyForConditionKind(condition.kind).normalizeInferred(
		inferred,
		condition.values,
	);
}
