import type { RegistryContext } from "./condition-kind";
import type {
	RegistryConditionValue,
	RegistryPayload,
	RegistryPayloadFile,
} from "./schema";

/** One option offered by a select prompt. */
export interface HandlerSelectOption extends RegistryConditionValue {
	/** Optional hint shown beside the option. */
	hint?: string;
}

/**
 * Prompt host injected into handlers so they never import the CLI.
 * Implementations typically wrap Clack prompts.
 */
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

/** Shared filesystem and process helpers available to handlers. */
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

/** Context passed to item handler hooks. */
export interface ItemHandlerContext extends HandlerRuntime {
	/** Registry item id being installed. */
	itemId: string;
	/** Selected variant id when the item has variants. */
	variantId?: string;
	/**
	 * Resolved condition context for the install.
	 * Includes keys from variant `when` matchers and from the item's `uses` list.
	 */
	conditions: RegistryContext;
	/** Variables collected from earlier `prompts` hooks (and prior installs). */
	variables: Record<string, string>;
	/** Parsed install payload (may have empty files before generation). */
	payload: RegistryPayload;
	/** Working file list (payload files plus any generated so far). */
	files: RegistryPayloadFile[];
}

/** Context passed to condition `infer` hooks. */
export interface ConditionHandlerContext extends HandlerRuntime {
	/** Condition key being resolved. */
	key: string;
	/** Display label for the condition. */
	label: string;
	/** Optional description for the condition. */
	description?: string;
	/** Declared select/multiselect values when the condition has fixed options. */
	values?: RegistryConditionValue[];
	/** Already-resolved condition context. */
	conditions: RegistryContext;
}

/** Install-time hooks for a registry item. */
export interface ItemHandler {
	/**
	 * Collect extra variables before files are written.
	 * @param ctx - Item handler context.
	 * @returns Variables merged into the install context.
	 */
	prompts?: (
		ctx: ItemHandlerContext,
	) => Promise<Record<string, string> | undefined>;

	/**
	 * Generate additional files to append to the payload.
	 * @param ctx - Item handler context (includes variables from `prompts`).
	 * @returns Files to append, or undefined when none.
	 */
	files?: (
		ctx: ItemHandlerContext,
	) => Promise<RegistryPayloadFile[] | undefined>;

	/**
	 * Rewrite or drop the combined file list before overwrite checks and writes.
	 * @param ctx - Item handler context with the combined file list.
	 * @returns Final files to install.
	 */
	transform?: (
		ctx: ItemHandlerContext,
	) => Promise<RegistryPayloadFile[] | undefined>;
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
