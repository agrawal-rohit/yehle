import { type ZodType, z } from "zod";
import { policyForConditionKind } from "./condition-kind";
import {
	type CatalogItem,
	catalogItemSchema,
	type Registry,
	type RegistryCondition,
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
 * Phrase a custom schema issue (superRefine prefixes).
 * @param issue - Zod custom issue.
 * @param label - Base error context.
 * @param fieldLabel - Label with issue path appended.
 * @returns User-facing message, or undefined when the custom code is unmapped.
 */
function messageForCustomIssue(
	issue: z.core.$ZodIssueCustom,
	label: string,
	fieldLabel: string,
): string | undefined {
	const customMessages: Record<string, (value: string) => string> = {
		"duplicate:": (value) => `${label} has duplicate value "${value}".`,
		"duplicate_variant:": (value) =>
			`${label} has duplicate variant id "${value}".`,
		"duplicate_hook:": (value) => {
			const [listName, entry] = value.split(":");
			return `${label} lists "${entry}" more than once in ${listName}.`;
		},
		"invalid_id:": () =>
			String.raw`${fieldLabel} must be a single path segment (no "/", "\", or "..").`,
		"invalid_script:": () =>
			`${fieldLabel} must be a relative path under the registry (no absolute paths, URLs, or "..").`,
		missing_files_or_variants: () =>
			`${label} must declare files, an install script (beforeInstall/afterInstall), or at least one variant.`,
		missing_source_or_variants: () =>
			`${label} must declare source, an install script (beforeInstall/afterInstall), or at least one variant.`,
		source_with_variants: () =>
			`${label} cannot declare source together with variants.`,
		select_requires_values: () => `${label} must declare at least one value.`,
		text_with_values: () => `${label} of kind "text" cannot declare values.`,
		boolean_with_values: () =>
			`${label} of kind "boolean" cannot declare values.`,
	};

	const prefix =
		Object.keys(customMessages).find((candidate) =>
			issue.message.startsWith(candidate),
		) ?? "";
	const mapper = customMessages[prefix] ?? customMessages[issue.message];
	if (!mapper) return undefined;

	const value =
		prefix.endsWith(":") && prefix.length > 0
			? issue.message.slice(prefix.length)
			: "";
	return mapper(value);
}

/**
 * Phrase an unrecognized_keys Zod issue.
 * @param issue - Zod unrecognized_keys issue.
 * @param fieldLabel - Label with issue path appended.
 * @returns User-facing message.
 */
function messageForUnrecognizedKeys(
	issue: z.core.$ZodIssueUnrecognizedKeys,
	fieldLabel: string,
): string {
	const kind = issue.keys.length > 1 ? "unknown keys" : "an unknown key";
	return `${fieldLabel} has ${kind}: ${issue.keys.join(", ")}.`;
}

/**
 * Phrase an invalid_type Zod issue for common registry shapes.
 * @param issue - Zod invalid_type issue.
 * @param fieldLabel - Label with issue path appended.
 * @returns User-facing message, or undefined when the expected type is unmapped.
 */
function messageForInvalidType(
	issue: z.core.$ZodIssueInvalidType,
	fieldLabel: string,
): string | undefined {
	const byExpected: Record<string, string> = {
		object: `${fieldLabel} must be an object.`,
		record: `${fieldLabel} must be an object.`,
		array: `${fieldLabel} must be an array.`,
		string: `${fieldLabel} must be a non-empty string.`,
	};
	return byExpected[issue.expected];
}

/**
 * Phrase a too_small Zod issue for strings and known arrays.
 * @param issue - Zod too_small issue.
 * @param label - Base error context.
 * @param fieldLabel - Label with issue path appended.
 * @returns User-facing message, or undefined when unmapped.
 */
function messageForTooSmall(
	issue: z.core.$ZodIssueTooSmall,
	label: string,
	fieldLabel: string,
): string | undefined {
	if (issue.origin === "string")
		return `${fieldLabel} must be a non-empty string.`;
	if (issue.origin !== "array") return undefined;

	const lastSegment = String(issue.path.at(-1) ?? "");
	if (lastSegment === "files")
		return `${fieldLabel} must declare at least one file.`;
	if (label.startsWith('Registry condition "') && issue.path.length === 1)
		return `${label} must declare at least one value.`;
	return undefined;
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

	let message: string | undefined;
	switch (issue.code) {
		case "custom":
			message = messageForCustomIssue(issue, label, fieldLabel);
			break;
		case "unrecognized_keys":
			message = messageForUnrecognizedKeys(issue, fieldLabel);
			break;
		case "invalid_type":
			message = messageForInvalidType(issue, fieldLabel);
			break;
		case "too_small":
			message = messageForTooSmall(issue, label, fieldLabel);
			break;
		default:
			message = undefined;
			break;
	}

	return new Error(message ?? `${fieldLabel}: ${issue.message}`);
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
 * Parse a string-keyed record of entries with a labeled schema per key.
 * @param schema - Schema applied to each entry value.
 * @param raw - Raw record value.
 * @param recordLabel - Error context for the record itself.
 * @param entryLabel - Builds the error label for one key.
 * @param required - When set, absent or empty records throw these messages.
 * @returns Parsed map, or undefined when the record is absent/empty and `required` is omitted.
 * @throws Error when `required` is set and the record is absent or empty, or an entry fails validation.
 */
export function parseKeyedRecord<T>(
	schema: ZodType<T>,
	raw: unknown,
	recordLabel: string,
	entryLabel: (key: string) => string,
	required?: { absent: string; empty: string },
): Record<string, T> | undefined {
	if (raw === undefined || raw === null) {
		if (!required) return undefined;
		throw new Error(required.absent);
	}

	const source = parseWithSchema(
		z.record(z.string(), z.unknown()),
		raw,
		recordLabel,
	);
	const parsed: Record<string, T> = {};
	for (const [key, rawEntry] of Object.entries(source)) {
		parsed[key] = parseWithSchema(schema, rawEntry, entryLabel(key));
	}

	if (Object.keys(parsed).length === 0) {
		if (!required) return undefined;
		throw new Error(required.empty);
	}

	return parsed;
}

/**
 * Remap a condition-policy assertion failure into a registry-facing error.
 * @param error - Error thrown by `assertWhenValue`.
 * @param subject - Item/variant label for the message.
 * @param key - Condition key from the `when` map.
 * @param value - Condition value from the `when` map.
 * @throws Error with a user-facing message, or rethrows unrecognized errors.
 */
function remapWhenAssertionError(
	error: unknown,
	subject: string,
	key: string,
	value: string,
): never {
	const code = error instanceof Error ? error.message : String(error);
	if (code === "text_in_when")
		throw new Error(
			`${subject} references text condition "${key}" in when (text conditions cannot be used in when).`,
		);
	if (code.startsWith("boolean:"))
		throw new Error(
			`${subject} uses invalid when value "${value}" for boolean key "${key}" (expected "true" or "false").`,
		);
	if (code.startsWith("undeclared:"))
		throw new Error(
			`${subject} uses undeclared when value "${value}" for key "${key}".`,
		);
	throw error;
}

/**
 * Validate a single `when` map against declared conditions.
 * @param itemId - Registry item id for error messages.
 * @param when - Condition matcher to validate.
 * @param conditions - Shared condition definitions.
 * @param variantId - Variant id being validated.
 * @throws Error when a condition key or value is undeclared.
 */
function validateWhenEntries(
	itemId: string,
	when: Record<string, string> | undefined,
	conditions: Record<string, RegistryCondition> | undefined,
	variantId: string,
): void {
	const subject = `Registry item "${itemId}" variant "${variantId}"`;

	for (const [key, value] of Object.entries(when ?? {})) {
		const condition = conditions?.[key];
		if (!condition)
			throw new Error(`${subject} references unknown when key "${key}".`);

		try {
			policyForConditionKind(condition.kind).assertWhenValue(
				value,
				condition.values,
			);
		} catch (error) {
			remapWhenAssertionError(error, subject, key, value);
		}
	}
}

/**
 * Ensure every variant `when` key/value is declared in the conditions map,
 * and that item-level `uses` keys exist.
 * @param items - Registry items to validate.
 * @param conditions - Shared condition definitions.
 * @throws Error when a condition key or value is undeclared.
 */
function crossValidateWhen(
	items: Record<string, CatalogItem>,
	conditions: Record<string, RegistryCondition> | undefined,
): void {
	for (const [itemId, item] of Object.entries(items)) {
		for (const variant of item.variants ?? []) {
			validateWhenEntries(itemId, variant.when, conditions, variant.id);
		}
		for (const key of item.uses ?? []) {
			if (!conditions?.[key])
				throw new Error(
					`Registry item "${itemId}" uses unknown condition "${key}".`,
				);
		}
	}
}

/**
 * Ensure every item type is declared in the types map.
 * @param items - Registry items to validate.
 * @param types - Shared type definitions.
 * @throws Error when an item type is undeclared.
 */
function crossValidateItemTypes(
	items: Record<string, CatalogItem>,
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

	const items: Record<string, CatalogItem> = {};
	for (const [key, item] of Object.entries(source.items)) {
		items[key] = parseWithSchema(
			catalogItemSchema,
			item,
			`Registry items["${key}"]`,
		);
	}

	const conditions = parseKeyedRecord(
		registryConditionSchema,
		source.conditions,
		"Registry conditions",
		(key) => `Registry condition "${key}"`,
	);
	crossValidateWhen(items, conditions);

	const types = parseKeyedRecord(
		registryItemTypeSchema,
		source.types,
		"Registry types",
		(key) => `Registry type "${key}"`,
		{
			absent: "Registry types must be declared.",
			empty: "Registry types must declare at least one type.",
		},
	) as Record<string, RegistryItemTypeDefinition>;
	crossValidateItemTypes(items, types);

	return {
		...(conditions ? { conditions } : {}),
		types,
		items,
	};
}
