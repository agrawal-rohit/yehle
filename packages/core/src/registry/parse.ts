/**
 * Assert a value is a plain object.
 * @param value - Value to narrow.
 * @param label - Error context.
 * @returns Plain object record.
 * @throws Error when the value is not an object.
 */
export function asRecord(
	value: unknown,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

/**
 * Assert a value is a non-empty string.
 * @param value - Value to check.
 * @param label - Error context.
 * @throws Error when the value is not a non-empty string.
 */
export function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${label} must be a non-empty string.`);
}

/**
 * Parse an optional string array.
 * @param raw - Raw array value.
 * @param label - Error context.
 * @returns Normalized string array, or undefined when empty/absent.
 * @throws Error when the array is malformed.
 */
export function parseStringArray(
	raw: unknown,
	label: string,
): string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!Array.isArray(raw)) throw new Error(`${label} must be an array.`);

	const values: string[] = [];
	for (const [index, entry] of raw.entries()) {
		assertNonEmptyString(entry, `${label}[${index}]`);
		values.push(entry);
	}

	return values.length > 0 ? values : undefined;
}

/**
 * Parse an optional `when` matcher object.
 * @param raw - Raw matcher value.
 * @param label - Error context.
 * @returns Normalized matcher map, or undefined when absent/empty.
 * @throws Error when the matcher is malformed.
 */
export function parseWhen(
	raw: unknown,
	label: string,
): Record<string, string> | undefined {
	if (raw === undefined || raw === null) return undefined;
	const source = asRecord(raw, `${label} when`);
	const when: Record<string, string> = {};

	for (const [key, value] of Object.entries(source)) {
		assertNonEmptyString(key, `${label} when key`);
		assertNonEmptyString(value, `${label} when["${key}"]`);
		when[key] = value;
	}

	return Object.keys(when).length > 0 ? when : undefined;
}
