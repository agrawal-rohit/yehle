import {
	confirm,
	groupMultiselect,
	isCancel,
	multiselect,
	select,
	text,
} from "@clack/prompts";
import { OperationCanceledError } from "./errors";

/** One option in a select/multiselect prompt (matches Clack’s unexported `Option<string>`). */
type SelectOption = NonNullable<
	Parameters<typeof select<string>>[0]["options"]
>[number];

/** One option in a grouped multiselect (matches Clack’s unexported `Option<string>`). */
type GroupedSelectOption = NonNullable<
	Parameters<typeof groupMultiselect<string>>[0]["options"]
>[string][number];

/**
 * Throw {@link OperationCanceledError} when Clack reports a cancel symbol.
 * @param value - Prompt result that may be a cancel symbol.
 * @throws {OperationCanceledError} When the user canceled.
 */
function throwIfCanceled<T>(value: T): asserts value is Exclude<T, symbol> {
	if (isCancel(value)) throw new OperationCanceledError();
}

/**
 * Collect option values from a flat select list.
 * @param options - Select options.
 * @returns Distinct option values.
 */
function selectOptionValues(options: readonly SelectOption[]): Set<string> {
	return new Set(options.map((option) => option.value));
}

/**
 * Collect option values from a grouped multiselect map.
 * @param options - Options keyed by group label.
 * @returns Distinct option values across every group.
 */
function groupedOptionValues(
	options: Record<string, GroupedSelectOption[]>,
): Set<string> {
	return new Set(
		Object.values(options)
			.flat()
			.map((option) => option.value),
	);
}

/**
 * Fail when a select or multiselect has nothing to choose from.
 * @param message - Prompt message, included in the error.
 * @param values - Distinct option values.
 * @throws Error when `values` is empty.
 */
function assertSelectHasOptions(message: string, values: Set<string>): void {
	if (values.size === 0)
		throw new Error(`Select prompt "${message}" has no options.`);
}

/**
 * Fail when a default is not one of the offered option values.
 * @param message - Prompt message, included in the error.
 * @param defaultValue - Default the caller asked to preselect.
 * @param allowed - Offered option values.
 * @throws Error when `defaultValue` is not in `allowed`.
 */
function assertDefaultIsOffered(
	message: string,
	defaultValue: string,
	allowed: Set<string>,
): void {
	if (!allowed.has(defaultValue))
		throw new Error(
			`Select prompt "${message}" has an unexpected default value.`,
		);
}

/**
 * Narrow a select result to an offered option value.
 * @param message - Prompt message, included in the error.
 * @param value - Prompt result after cancel handling.
 * @param allowed - Offered option values.
 * @returns `value` when it is an offered option.
 * @throws Error when `value` is not an offered option.
 */
function offeredSelectValue<Value extends string>(
	message: string,
	value: unknown,
	allowed: Set<string>,
): Value {
	if (typeof value !== "string" || !allowed.has(value))
		throw new Error(`Select prompt "${message}" returned an unexpected value.`);
	return value as Value;
}

/**
 * Narrow a multiselect result to offered option values.
 * @param message - Prompt message, included in the error.
 * @param values - Prompt result after cancel handling.
 * @param allowed - Offered option values.
 * @returns `values` when every entry is an offered option.
 * @throws Error when the result is not an array of offered options.
 */
function offeredMultiselectValues(
	message: string,
	values: unknown,
	allowed: Set<string>,
): string[] {
	if (
		!Array.isArray(values) ||
		values.some((value) => typeof value !== "string" || !allowed.has(value))
	)
		throw new Error(
			`Multiselect prompt "${message}" returned an unexpected value.`,
		);
	return values;
}

/**
 * Prompt for a text input with optional validation and default.
 * @param message - Prompt message to display.
 * @param opts - Optional prompt configuration, including `required`.
 * @param defaultValue - Optional default value.
 * @returns Trimmed user input.
 * @throws {OperationCanceledError} When the user cancels.
 */
export async function textInput(
	message: string,
	opts: { placeholder?: string; required?: boolean } = {},
	defaultValue?: string,
): Promise<string> {
	const raw = await text({
		message,
		...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
		...(defaultValue !== undefined && {
			initialValue: defaultValue,
			defaultValue,
		}),
		...(opts.required && {
			validate: (value) => (!value?.trim() ? "A value is required" : undefined),
		}),
	});

	throwIfCanceled(raw);
	if (typeof raw !== "string")
		throw new Error(`Text prompt "${message}" returned a non-string value.`);
	return raw.trim();
}

/**
 * Prompt for a single selection from a list of options.
 * @param message - Prompt message to display.
 * @param opts - Select prompt configuration. `options` must be non-empty.
 * @param defaultValue - Optional default selected value; must be one of `options`.
 * @returns Selected value.
 * @throws {OperationCanceledError} When the user cancels.
 * @throws Error when `options` is empty, the default is not offered, or the result is not an offered value.
 */
export async function selectInput<Value extends string>(
	message: string,
	opts: { options: SelectOption[] },
	defaultValue?: Value,
): Promise<Value> {
	const allowed = selectOptionValues(opts.options);
	assertSelectHasOptions(message, allowed);
	if (defaultValue !== undefined)
		assertDefaultIsOffered(message, defaultValue, allowed);

	const value = await select({
		message,
		options: opts.options,
		...(defaultValue !== undefined ? { initialValue: defaultValue } : {}),
	});

	throwIfCanceled(value);
	return offeredSelectValue<Value>(message, value, allowed);
}

/**
 * Prompt for multiple selections.
 * @param message - Prompt message to display.
 * @param opts - Multiselect prompt configuration. `options` must be non-empty.
 * @param defaultValues - Optional default selected values; each must be one of `options`.
 * @returns Selected values.
 * @throws {OperationCanceledError} When the user cancels.
 * @throws Error when `options` is empty, a default is not offered, or a result is not an offered value.
 */
export async function multiselectInput(
	message: string,
	opts: { options: SelectOption[] },
	defaultValues?: string[],
): Promise<string[]> {
	const allowed = selectOptionValues(opts.options);
	assertSelectHasOptions(message, allowed);
	for (const defaultValue of defaultValues ?? [])
		assertDefaultIsOffered(message, defaultValue, allowed);

	const values = await multiselect({
		message,
		options: opts.options,
		...(defaultValues !== undefined ? { initialValues: defaultValues } : {}),
	});

	throwIfCanceled(values);
	return offeredMultiselectValues(message, values, allowed);
}

/**
 * Prompt for multiple selections arranged under group labels.
 * @param message - Prompt message to display.
 * @param options - Options keyed by group label. At least one option is required.
 * @returns Selected values.
 * @throws {OperationCanceledError} When the user cancels.
 * @throws Error when no options are offered, or a result is not an offered value.
 */
export async function groupedMultiselectInput(
	message: string,
	options: Record<string, GroupedSelectOption[]>,
): Promise<string[]> {
	const allowed = groupedOptionValues(options);
	assertSelectHasOptions(message, allowed);

	const values = await groupMultiselect({
		message,
		options,
	});

	throwIfCanceled(values);
	return offeredMultiselectValues(message, values, allowed);
}

/**
 * Prompt for a boolean confirmation.
 * @param message - Prompt message to display.
 * @param opts - Optional confirm prompt configuration.
 * @param defaultValue - Optional default boolean value.
 * @returns User confirmation result.
 * @throws {OperationCanceledError} When the user cancels.
 * @throws Error when the prompt result is not a boolean.
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

	throwIfCanceled(res);
	if (typeof res !== "boolean")
		throw new Error(
			`Confirm prompt "${message}" returned a non-boolean value.`,
		);
	return res;
}
