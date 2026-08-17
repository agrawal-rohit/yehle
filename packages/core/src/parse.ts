import { type ZodType, z } from "zod";
import { primaryText } from "./labels";
import {
	catalogItemSchema,
	type Registry,
	type RegistryCondition,
	RegistryConditionInference,
	type RegistryItem,
	type RegistryItemTypeDefinition,
	registryConditionSchema,
	registryDocumentFieldsSchema,
	registryItemTypeSchema,
} from "./schema";

/**
 * Append a Zod issue path to a parse label.
 * @param label - Base error context.
 * @param path - Zod issue path segments.
 * @returns Label with dotted/index segments appended.
 */
function formatIssuePath(label: string, path: PropertyKey[]): string {
	if (path.length === 0) return label;

	const isQuotedEntity =
		label.startsWith('Registry type "') ||
		label.startsWith('Registry condition "');

	let formatted = label;
	for (let index = 0; index < path.length; index++) {
		const segment = path[index];
		if (typeof segment === "number") formatted += `[${segment}]`;
		else if (index === 0 && isQuotedEntity) formatted += ` ${String(segment)}`;
		else formatted += `.${String(segment)}`;
	}
	return formatted;
}

/**
 * Map the first Zod issue onto the registry parse error phrasing.
 * @param error - Zod validation error.
 * @param label - Base error context.
 * @returns Error with a user-facing message.
 */
function mapZodError(error: z.ZodError, label: string): Error {
	// Registry parsing stops at the first Zod issue, so we only phrase that one.
	const issue = error.issues[0];
	if (!issue) return error;

	const fieldLabel = formatIssuePath(label, issue.path);
	const lastSegment = String(issue.path.at(-1) ?? "");

	// Custom schema checks encode their kind in the message prefix (see schema superRefine).
	const prefix =
		[
			"duplicate_variant:",
			"duplicate:",
			"invalid_inference:",
			"invalid_id:",
			"missing_files_or_variants",
			"missing_source_or_variants",
			"source_with_variants",
		].find((candidate) => issue.message.startsWith(candidate)) ?? "";
	const customValue =
		prefix === "missing_files_or_variants" ||
		prefix === "missing_source_or_variants" ||
		prefix === "source_with_variants"
			? ""
			: issue.message.slice(prefix.length);

	// Narrow issue fields up front so the lookup tables below stay flat.
	const keys = issue.code === "unrecognized_keys" ? issue.keys : [];
	const expected = issue.code === "invalid_type" ? issue.expected : "";
	const origin = issue.code === "too_small" ? issue.origin : "";
	const kind = keys.length > 1 ? "unknown keys" : "an unknown key";

	const customMessages: Record<string, string> = {
		"duplicate:": `${label} has duplicate value "${customValue}".`,
		"duplicate_variant:": `${label} has duplicate variant id "${customValue}".`,
		"invalid_inference:": `${label} has invalid inference "${customValue}" (expected one of: ${Object.values(RegistryConditionInference).join(", ")}).`,
		"invalid_id:": String.raw`${primaryText(fieldLabel)} must be a single path segment (no "/", "\", or "..").`,
		missing_files_or_variants: `${label} must declare files or at least one variant.`,
		missing_source_or_variants: `${label} must declare source or at least one variant.`,
		source_with_variants: `${label} cannot declare source together with variants.`,
	};

	// Object and record both surface as "must be an object"; primaryText highlights field names.
	const invalidTypeMessages: Record<string, string> = {
		object: `${primaryText(fieldLabel)} must be an object.`,
		array: `${fieldLabel} must be an array.`,
		record: `${primaryText(fieldLabel)} must be an object.`,
	};

	// too_small on arrays is path-specific; the message depends on which list was empty.
	const arrayTooSmall: Record<string, string> = {
		files: `${fieldLabel} must declare at least one file.`,
	};

	// Condition values use the condition label, not a dotted path, when the issue is on `.values`.
	if (label.startsWith('Registry condition "') && issue.path.length === 1)
		arrayTooSmall.values = `${label} must declare at least one value.`;
	const tooSmallMessages: Record<string, string | undefined> = {
		string: `${primaryText(fieldLabel)} must be a non-empty string.`,
		array: arrayTooSmall[lastSegment],
	};

	// Dispatch by issue code; unmapped codes fall through to the generic non-empty-string default.
	const messages: Record<string, string | undefined> = {
		unrecognized_keys: `${fieldLabel} has ${kind}: ${keys.join(", ")}.`,
		custom:
			customMessages[prefix] ?? customMessages[issue.message] ?? issue.message,
		invalid_type: invalidTypeMessages[expected],
		too_small: tooSmallMessages[origin],
	};

	return new Error(
		messages[issue.code] ??
			`${primaryText(fieldLabel)} must be a non-empty string.`,
	);
}

/**
 * Parse raw input with a Zod schema and map failures to labeled errors.
 * @param schema - Zod schema to validate against.
 * @param raw - Raw input value.
 * @param label - Error context prefix.
 * @returns Parsed and normalized value.
 * @throws Error when validation fails.
 */
export function parseWithSchema<T>(
	schema: ZodType<T>,
	raw: unknown,
	label: string,
): T {
	try {
		return schema.parse(raw);
	} catch (error) {
		if (error instanceof z.ZodError) throw mapZodError(error, label);
		throw error;
	}
}

/**
 * Parse shared condition definitions from a registry document.
 * @param raw - Raw conditions object.
 * @returns Normalized conditions map, or undefined when absent/empty.
 * @throws Error when a condition entry is malformed.
 */
export function parseRegistryConditions(
	raw: unknown,
): Record<string, RegistryCondition> | undefined {
	if (raw === undefined || raw === null) return undefined;

	const source = parseWithSchema(
		z.record(z.string(), z.unknown()),
		raw,
		"Registry conditions",
	);
	const conditions: Record<string, RegistryCondition> = {};

	for (const [key, rawCondition] of Object.entries(source)) {
		conditions[key] = parseWithSchema(
			registryConditionSchema,
			rawCondition,
			`Registry condition "${key}"`,
		);
	}

	return Object.keys(conditions).length > 0 ? conditions : undefined;
}

/**
 * Validate a single `when` map against declared conditions.
 * @param itemId - Registry item id for error messages.
 * @param when - Condition matcher to validate.
 * @param conditions - Shared condition definitions.
 * @param variantId - Variant id when validating a variant; omit for item-level `when`.
 * @throws Error when a condition key or value is undeclared.
 */
function validateWhenEntries(
	itemId: string,
	when: Record<string, string> | undefined,
	conditions: Record<string, RegistryCondition> | undefined,
	variantId?: string,
): void {
	const subject =
		variantId === undefined
			? `Registry item "${itemId}"`
			: `Registry item "${itemId}" variant "${variantId}"`;

	for (const [key, value] of Object.entries(when ?? {})) {
		const condition = conditions?.[key];
		if (!condition)
			throw new Error(`${subject} references unknown when key "${key}".`);
		if (!condition.values.some((entry) => entry.value === value))
			throw new Error(
				`${subject} uses undeclared when value "${value}" for key "${key}".`,
			);
	}
}

/**
 * Ensure every item and variant `when` key/value is declared in the conditions map.
 * @param items - Registry items to validate.
 * @param conditions - Shared condition definitions.
 * @throws Error when a condition key or value is undeclared.
 */
function crossValidateWhen(
	items: Record<string, RegistryItem>,
	conditions: Record<string, RegistryCondition> | undefined,
): void {
	for (const [itemId, item] of Object.entries(items)) {
		validateWhenEntries(itemId, item.when, conditions);
		for (const variant of item.variants ?? []) {
			validateWhenEntries(itemId, variant.when, conditions, variant.id);
		}
	}
}

/**
 * Parse item type display metadata from a registry document.
 * @param raw - Raw types object.
 * @returns Normalized types map.
 * @throws Error when types are absent, empty, or a type entry is malformed.
 */
export function parseRegistryItemTypes(
	raw: unknown,
): Record<string, RegistryItemTypeDefinition> {
	if (raw === undefined || raw === null)
		throw new Error("Registry types must be declared.");

	const source = parseWithSchema(
		z.record(z.string(), z.unknown()),
		raw,
		"Registry types",
	);
	const types: Record<string, RegistryItemTypeDefinition> = {};

	for (const [key, rawType] of Object.entries(source)) {
		types[key] = parseWithSchema(
			registryItemTypeSchema,
			rawType,
			`Registry type "${key}"`,
		);
	}

	if (Object.keys(types).length === 0)
		throw new Error("Registry types must declare at least one type.");

	return types;
}

/**
 * Ensure every item type is declared in the types map.
 * @param items - Registry items to validate.
 * @param types - Shared type definitions.
 * @throws Error when an item type is undeclared.
 */
function crossValidateItemTypes(
	items: Record<string, RegistryItem>,
	types: Record<string, RegistryItemTypeDefinition>,
): void {
	for (const [itemId, item] of Object.entries(items)) {
		if (!(item.type in types))
			throw new Error(
				`Registry item "${itemId}" has undeclared type "${item.type}".`,
			);
	}
}

/**
 * Parse and validate a registry document.
 * @param raw - Raw JSON value loaded from registry.json.
 * @returns Normalized registry document.
 * @throws Error when the document shape is invalid or contains unknown keys.
 */
export function parseRegistryDocument(raw: unknown): Registry {
	const source = parseWithSchema(registryDocumentFieldsSchema, raw, "Registry");

	const items: Record<string, RegistryItem> = {};
	for (const [key, item] of Object.entries(source.items)) {
		items[key] = parseWithSchema(
			catalogItemSchema,
			item,
			`Registry items["${key}"]`,
		);
	}

	const conditions = parseRegistryConditions(source.conditions);
	crossValidateWhen(items, conditions);

	const types = parseRegistryItemTypes(source.types);
	crossValidateItemTypes(items, types);

	return {
		...(conditions ? { conditions } : {}),
		types,
		items,
	};
}
