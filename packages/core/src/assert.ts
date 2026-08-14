import { primaryText } from "@tuckshop/common";

/**
 * Assert a value is a plain object.
 * @param value - Value to narrow.
 * @param label - Error context.
 * @returns Plain object record.
 * @throws Error when the value is not an object.
 */
export function assertRecord(
	value: unknown,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${primaryText(label)} must be an object.`);
	return value as Record<string, unknown>;
}

/**
 * Assert an object declares no keys outside the allowed set.
 * @param source - Object record to inspect.
 * @param allowed - Allowed key names.
 * @param label - Error context.
 * @throws Error listing each unrecognized key (typo detection, Biome-style).
 */
export function assertNoUnknownKeys(
	source: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(source).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0)
		throw new Error(`${label} has unknown key(s): ${unknown.join(", ")}.`);
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
		throw new Error(`${primaryText(label)} must be a non-empty string.`);
}
