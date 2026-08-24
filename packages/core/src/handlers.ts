import { createRequire } from "node:module";
import path from "node:path";
import {
	policyForConditionKind,
	type RegistryContext,
	type RegistryContextValue,
} from "./condition-kind";
import {
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
} from "./packages";
import type { RequiredCondition } from "./plan";
import type {
	RegistryConditionValue,
	RegistryEcosystemCommands,
	RegistryEcosystemDependencies,
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

/** Shared filesystem and process helpers available to install and infer scripts. */
export interface HandlerRuntime {
	/** Absolute project root receiving the install. */
	projectDir: string;
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
	packIds?: string[];
	conditions: RegistryContext;
	bindings?: Record<string, string>;
	payload: RegistryPayload;
}

/** Context passed to install lifecycle scripts. */
export interface InstallHookContext extends HandlerRuntime {
	/** Registry item id being installed. */
	itemId: string;
	/** Selected pack ids layered onto this item. */
	packIds?: string[];
	/** Condition values captured from the install plan. */
	conditions: RegistryContext;
	/** Bindings collected from earlier install scripts in this run. */
	bindings: Record<string, string>;
	/** Working install payload (files may be empty before scripts run). */
	payload: RegistryPayload;
}

/** Optional result from a `beforeInstall` script. */
export interface BeforeInstallHookResult {
	/** Files to upsert into the working payload by `target`. */
	files?: RegistryPayloadFile[];
	/** Target paths to remove from the working payload. */
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
 * @param upserts - Files returned from a beforeInstall hook.
 * @returns Updated file list.
 */
function upsertPayloadFiles(
	files: RegistryPayloadFile[],
	upserts: RegistryPayloadFile[],
): RegistryPayloadFile[] {
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
function removePayloadFiles(
	files: RegistryPayloadFile[],
	removeFiles: string[],
): RegistryPayloadFile[] {
	const removed = new Set(removeFiles);
	return files.filter((file) => !removed.has(file.target));
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
	// Delete the script from the require cache so rebuilt scripts are picked up in long-lived processes.
	Reflect.deleteProperty(requireScript.cache, absolutePath);
	const imported = requireScript(absolutePath) as Record<string, unknown>;
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
 * Apply a beforeInstall hook result onto the working install state.
 * @param state - Current files, bindings, and optional payload fields.
 * @param result - Hook return value.
 * @returns Updated install state.
 */
function applyBeforeInstallResult(
	state: {
		files: RegistryPayloadFile[];
		bindings: Record<string, string>;
		commands?: RegistryEcosystemCommands;
		dependencies?: RegistryEcosystemDependencies;
		secrets?: string[];
	},
	result: BeforeInstallHookResult,
): {
	files: RegistryPayloadFile[];
	bindings: Record<string, string>;
	commands?: RegistryEcosystemCommands;
	dependencies?: RegistryEcosystemDependencies;
	secrets?: string[];
} {
	const bindings = { ...state.bindings, ...result.bindings };
	let files = state.files;
	if (result.removeFiles) files = removePayloadFiles(files, result.removeFiles);
	if (result.files) files = upsertPayloadFiles(files, result.files);

	return {
		files,
		bindings,
		commands:
			result.commands !== undefined
				? (mergeEcosystemMaps(
						mergeCommandSet,
						state.commands,
						result.commands,
					) as RegistryEcosystemCommands | undefined)
				: state.commands,
		dependencies:
			result.dependencies !== undefined
				? (mergeEcosystemMaps(
						mergeDependencySet,
						state.dependencies,
						result.dependencies,
					) as RegistryEcosystemDependencies | undefined)
				: state.dependencies,
		secrets:
			result.secrets !== undefined
				? mergeSecretNames(state.secrets, result.secrets)
				: state.secrets,
	};
}

/**
 * Run one compiled `beforeInstall` script.
 * @param catalogLocation - Absolute local path to registry.json.
 * @param scriptUri - Catalog script URI.
 * @param runtime - Shared handler runtime.
 * @param options - Item identity, payload, and install state.
 * @returns Updated files, bindings, and merged payload fields.
 */
export async function runBeforeInstallHook(
	catalogLocation: string,
	scriptUri: string,
	runtime: HandlerRuntime,
	options: RunInstallHookOptions,
): Promise<{
	files: RegistryPayloadFile[];
	bindings: Record<string, string>;
	commands?: RegistryEcosystemCommands;
	dependencies?: RegistryEcosystemDependencies;
	secrets?: string[];
}> {
	const hook = await loadScriptModule(
		catalogLocation,
		scriptUri,
		(script): script is BeforeInstallHook => typeof script === "function",
		`Script at "${scriptUri}" must export a \`beforeInstall\` hook function.`,
	);
	let state: {
		files: RegistryPayloadFile[];
		bindings: Record<string, string>;
		commands?: RegistryEcosystemCommands;
		dependencies?: RegistryEcosystemDependencies;
		secrets?: string[];
	} = {
		files: [...options.payload.files],
		bindings: { ...options.bindings },
		commands: options.payload.commands,
		dependencies: options.payload.dependencies,
		secrets: options.payload.secrets,
	};

	const ctx: InstallHookContext = {
		...runtime,
		itemId: options.itemId,
		...(options.packIds ? { packIds: options.packIds } : {}),
		conditions: options.conditions,
		bindings: state.bindings,
		payload: { ...options.payload, files: state.files },
	};

	const result: BeforeInstallHookResult | undefined = await hook(ctx);
	if (result) state = applyBeforeInstallResult(state, result);

	return {
		files: state.files,
		bindings: state.bindings,
		...(state.commands ? { commands: state.commands } : {}),
		...(state.dependencies ? { dependencies: state.dependencies } : {}),
		...(state.secrets ? { secrets: state.secrets } : {}),
	};
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
		...(options.packIds ? { packIds: options.packIds } : {}),
		conditions: options.conditions,
		bindings: { ...options.bindings },
		payload: options.payload,
	};
	await hook(ctx);
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
		readFile: (filePath: string) => Promise<string>;
		run: (command: string) => Promise<string>;
	},
): HandlerRuntime {
	const absolutePath = (filePath: string) =>
		path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);

	return {
		projectDir,
		isFile: (filePath) => helpers.isFile(absolutePath(filePath)),
		readFile: (filePath) => helpers.readFile(absolutePath(filePath)),
		run: helpers.run,
	};
}

/**
 * Infer a prompt default for one required condition.
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
	if (condition.handler) {
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
		if (inferred !== undefined && inferred !== "") {
			const normalized = policyForConditionKind(
				condition.kind,
			).normalizeInferred(inferred, condition.values);
			if (normalized !== undefined) return normalized;
		}
	}

	if (condition.default === undefined) return undefined;

	return policyForConditionKind(condition.kind).normalizeInferred(
		condition.default,
		condition.values,
	);
}
