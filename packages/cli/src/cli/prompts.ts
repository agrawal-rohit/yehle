import {
	confirm,
	groupMultiselect,
	isCancel,
	multiselect,
	select,
	text,
} from "@clack/prompts";
import logger from "./logger";

/** One option in a select/multiselect prompt (matches Clack’s unexported `Option<string>`). */
type SelectOption = NonNullable<
	Parameters<typeof select<string>>[0]["options"]
>[number];

/** One option in a grouped multiselect (matches Clack’s unexported `Option<string>`). */
type GroupedSelectOption = NonNullable<
	Parameters<typeof groupMultiselect<string>>[0]["options"]
>[string][number];

/**
 * Prompt for a text input with optional validation and default.
 * @param message - Prompt message to display.
 * @param opts - Optional prompt configuration, including `required`.
 * @param defaultValue - Optional default value.
 * @returns Trimmed user input.
 */
export async function textInput(
	message: string,
	opts: { placeholder?: string; required?: boolean } = {},
	defaultValue?: string,
): Promise<string> {
	const raw = await text({
		message,
		...(opts.placeholder !== undefined
			? { placeholder: opts.placeholder }
			: {}),
		...(defaultValue !== undefined
			? { initialValue: defaultValue, defaultValue }
			: {}),
		...(opts.required
			? {
					validate: (value) =>
						!value?.trim() ? "A value is required" : undefined,
				}
			: {}),
	});

	if (isCancel(raw)) logger.end("Operation canceled");

	return String(raw).trim();
}

/**
 * Prompt for a single selection from a list of options.
 * @param message - Prompt message to display.
 * @param opts - Optional select prompt configuration.
 * @param defaultValue - Optional default selected value.
 * @returns Selected value.
 */
export async function selectInput<Value extends string>(
	message: string,
	opts?: { options: SelectOption[] },
	defaultValue?: Value,
): Promise<Value> {
	const value = await select({
		message,
		options: opts?.options ?? [],
		...(defaultValue !== undefined ? { initialValue: defaultValue } : {}),
	});

	if (isCancel(value)) logger.end("Operation canceled");

	return value as Value;
}

/**
 * Prompt for multiple selections.
 * @param message - Prompt message to display.
 * @param opts - Optional multiselect prompt configuration.
 * @param defaultValues - Optional default selected values.
 * @returns Selected values.
 */
export async function multiselectInput(
	message: string,
	opts?: { options: SelectOption[] },
	defaultValues?: string[],
): Promise<string[]> {
	const values = await multiselect({
		message,
		options: opts?.options ?? [],
		...(defaultValues !== undefined ? { initialValues: defaultValues } : {}),
	});

	if (isCancel(values)) logger.end("Operation canceled");

	return values as string[];
}

/**
 * Prompt for multiple selections arranged under group labels.
 * @param message - Prompt message to display.
 * @param options - Options keyed by group label.
 * @returns Selected values.
 */
export async function groupedMultiselectInput(
	message: string,
	options: Record<string, GroupedSelectOption[]>,
): Promise<string[]> {
	const values = await groupMultiselect({
		message,
		options,
	});

	if (isCancel(values)) logger.end("Operation canceled");

	return values as string[];
}

/**
 * Prompt for a boolean confirmation.
 * @param message - Prompt message to display.
 * @param opts - Optional confirm prompt configuration.
 * @param defaultValue - Optional default boolean value.
 * @returns User confirmation result.
 */
export async function confirmInput(
	message: string,
	opts: { active?: string; inactive?: string } = {},
	defaultValue?: boolean,
): Promise<boolean> {
	const res = await confirm({
		message,
		...opts,
		...(defaultValue !== undefined ? { initialValue: defaultValue } : {}),
	});

	if (isCancel(res)) logger.end("Operation canceled");

	return res as boolean;
}

const prompts = {
	textInput,
	selectInput,
	multiselectInput,
	groupedMultiselectInput,
	confirmInput,
};

export default prompts;
