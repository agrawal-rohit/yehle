import consola, {
	type ConfirmPromptOptions,
	type MultiSelectOptions,
	type SelectPromptOptions,
	type TextPromptOptions,
} from "consola";
import logger from "./logger";

/**
 * Handles cancellation when the prompt is canceled.
 * Checks if the provided value is the cancel symbol and logs the cancellation message.
 * @param value - The value returned from the prompt to check for cancellation.
 */
function handleCancel(value: unknown): void {
	if (typeof value === "symbol" && value === Symbol.for("cancel")) {
		logger.end("Operation canceled");
	}
}

/** Prompt for a text input (with optional validation and default).
 * @param message - The prompt message to display.
 * @param opts - Optional configuration options for the prompt, including validation.
 * @param defaultValue - Optional default value for the input.
 */
export async function textInput(
	message: string,
	opts: Omit<TextPromptOptions, "text"> & { required?: boolean } = {},
	defaultValue?: string,
): Promise<string> {
	const raw = await consola.prompt(message, {
		type: "text",
		initial: defaultValue,
		cancel: "symbol",
		...opts,
	});

	if (opts.required && !raw) logger.error("Package name is required");

	handleCancel(raw);

	return raw.trim();
}

/**
 * Prompt for a single selection from a list of options.
 * User may type the number (1..n) or the exact value.
 * @param message - The prompt message to display.
 * @param opts - Optional configuration options for the select prompt.
 * @param defaultValue - Optional default selected value.
 */
export async function selectInput<Value extends string>(
	message: string,
	opts?: Omit<SelectPromptOptions, "type">,
	defaultValue?: Value,
): Promise<Value> {
	opts = opts ?? { options: [] };
	const value: unknown = await consola.prompt(message, {
		type: "select",
		initial: defaultValue,
		cancel: "symbol",
		...opts,
	});

	handleCancel(value);

	return value as Value;
}

/** Prompt for multiple selections (comma-separated indices or values).
 * @param message - The prompt message to display.
 * @param opts - Optional configuration options for the multiselect prompt.
 * @param defaultValues - Optional array of default selected values.
 */
export async function multiselectInput(
	message: string,
	opts?: Omit<MultiSelectOptions, "type">,
	defaultValues?: string[],
): Promise<string[]> {
	opts = opts ?? { options: [] };
	const values = await consola.prompt(message, {
		type: "multiselect",
		initial: defaultValues,
		cancel: "symbol",
		...opts,
	});

	handleCancel(values);

	return values as string[];
}

/** Prompt for a boolean confirmation (yes/no).
 * @param message - The prompt message to display.
 * @param opts - Optional configuration options for the confirm prompt.
 * @param defaultValue - Optional default boolean value.
 */
export async function confirmInput(
	message: string,
	opts?: Omit<ConfirmPromptOptions, "type">,
	defaultValue?: boolean,
): Promise<boolean> {
	opts = opts ?? {};
	const res = await consola.prompt(message, {
		type: "confirm",
		initial: defaultValue,
		cancel: "symbol",
		...opts,
	});

	handleCancel(res);

	return Boolean(res);
}

const prompts = {
	textInput,
	selectInput,
	multiselectInput,
	confirmInput,
};

export default prompts;
