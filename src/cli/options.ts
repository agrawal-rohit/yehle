/** Raw options object passed to CAC command actions. */
export type CliOptions = Record<string, unknown>;

/**
 * Read a trimmed string option from CAC options.
 * @param options - Raw CAC options.
 * @param key - Option key.
 * @returns Trimmed non-empty string, or undefined when missing or blank.
 */
export function getStringOption(
	options: CliOptions,
	key: string,
): string | undefined {
	const value = options[key];
	if (typeof value !== "string") return undefined;

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read a boolean flag from CAC options.
 * @param options - Raw CAC options.
 * @param key - Option key.
 * @returns True when the flag is explicitly set, false otherwise.
 */
export function getBooleanOption(options: CliOptions, key: string): boolean {
	return options[key] === true;
}

/**
 * Pick trimmed string options by key from CAC options.
 * @param options - Raw CAC options.
 * @param keys - Option keys to read.
 * @returns Object containing only keys that were present and non-empty.
 */
export function pickStringOptions<const T extends string>(
	options: CliOptions,
	keys: readonly T[],
): Partial<Record<T, string>> {
	const parsed: Partial<Record<T, string>> = {};

	for (const key of keys) {
		const value = getStringOption(options, key);
		if (value !== undefined) parsed[key] = value;
	}

	return parsed;
}

/**
 * Split a comma-separated CLI value into trimmed tokens.
 * @param value - Raw multivalue option string.
 * @returns Trimmed non-empty tokens.
 */
export function parseMultiValueOption(value: string): string[] {
	return value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}
