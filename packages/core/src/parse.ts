import { type ZodType, z } from "zod";
import {
	policyForConditionKind,
	type RegistryWhenValue,
} from "./condition-kind";
import { isNpmPackageManager, PACKAGE_MANAGER_KEY } from "./packages";
import {
	assertConditionMapBindingKeys,
	type IndexItem,
	indexItemSchema,
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
		"duplicate_pack:": (value) => `${label} has duplicate pack id "${value}".`,
		"duplicate_hook:": (value) => {
			const [listName, entry] = value.split(":");
			return `${label} lists "${entry}" more than once in ${listName}.`;
		},
		"invalid_id:": () =>
			String.raw`${fieldLabel} must be a single path segment (no "/", "\", or "..").`,
		"invalid_script:": () =>
			`${fieldLabel} must be a relative path under the registry (no absolute paths, URLs, or "..").`,
		missing_files_or_packs: () =>
			`${label} must declare files, an install script (beforeInstall/afterInstall), or at least one pack.`,
		missing_source_or_packs: () =>
			`${label} must declare source, an install script (beforeInstall/afterInstall), or at least one pack.`,
		select_requires_values: () => `${label} must declare at least one value.`,
		text_with_values: () => `${label} of kind "text" cannot declare values.`,
		boolean_with_values: () =>
			`${label} of kind "boolean" cannot declare values.`,
		empty_bindings: () => `${fieldLabel} must declare at least one binding.`,
		bindings_on_multiselect: () =>
			`${label} of kind "multiselect" cannot declare option bindings.`,
		"binding_parent_key:": (value) =>
			`Registry condition "${value}" option bindings cannot reuse the condition key "${value}".`,
		"requires_and_local:": (value) =>
			`${label} lists "${value}" in both requires and local conditions.`,
		min_on_non_multiselect: () =>
			`${label} can only declare min for kind "multiselect".`,
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
 * @param subject - Item/pack label for the message.
 * @param key - Condition key from the `when` map.
 * @param value - Condition value from the `when` map.
 * @throws Error with a user-facing message, or rethrows unrecognized errors.
 */
function remapWhenAssertionError(
	error: unknown,
	subject: string,
	key: string,
	value: unknown,
): never {
	const code = error instanceof Error ? error.message : String(error);
	if (code === "text_in_when")
		throw new Error(
			`${subject} references text condition "${key}" in when (text conditions cannot be used in when).`,
		);
	if (code.startsWith("boolean:"))
		throw new Error(
			`${subject} uses invalid when value "${String(value)}" for boolean key "${key}" (expected true or false).`,
		);
	if (code.startsWith("undeclared:"))
		throw new Error(
			`${subject} uses undeclared when value "${code.slice("undeclared:".length)}" for key "${key}".`,
		);
	throw error;
}

/**
 * Validate a pack `when.packageManager` value against known npm managers.
 * @param subject - Error label naming the item or pack.
 * @param value - Matcher value from the `when` map.
 * @throws Error when the value is not a supported manager id.
 */
function validatePackageManagerWhenValue(
	subject: string,
	value: RegistryWhenValue,
): void {
	const entries = Array.isArray(value) ? value : [value];
	for (const entry of entries) {
		if (typeof entry !== "string" || !isNpmPackageManager(entry))
			throw new Error(
				`${subject} uses undeclared when value "${String(entry)}" for key "${PACKAGE_MANAGER_KEY}".`,
			);
	}
}

/**
 * Validate a single `when` map against declared conditions and the package-manager matcher.
 * @param subject - Error label naming the item or pack.
 * @param when - Condition matcher to validate.
 * @param conditions - Shared and item-local condition definitions in scope.
 * @throws Error when a condition key or value is undeclared.
 */
function validateWhenEntries(
	subject: string,
	when: RegistryCondition["when"] | undefined,
	conditions: Record<string, RegistryCondition> | undefined,
): void {
	for (const [key, value] of Object.entries(when ?? {})) {
		if (key === PACKAGE_MANAGER_KEY) {
			validatePackageManagerWhenValue(subject, value);
			continue;
		}

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
 * Reject requires / local-condition collisions for one item.
 * @param itemId - Registry item id.
 * @param item - Catalog item.
 * @param conditions - Shared condition definitions.
 * @param localOwners - Map of local condition key → declaring item id.
 * @throws Error when a key is unknown, collides with shared, or is claimed twice.
 */
function assertItemConditionOwnership(
	itemId: string,
	item: IndexItem,
	conditions: Record<string, RegistryCondition> | undefined,
	localOwners: Map<string, string>,
): void {
	for (const key of item.requires ?? []) {
		if (!conditions?.[key])
			throw new Error(
				`Registry item "${itemId}" requires unknown condition "${key}".`,
			);
	}

	for (const key of Object.keys(item.conditions ?? {})) {
		if (conditions?.[key])
			throw new Error(
				`Registry item "${itemId}" condition "${key}" collides with a shared condition.`,
			);

		const owner = localOwners.get(key);
		if (owner !== undefined && owner !== itemId)
			throw new Error(
				`Item-level condition "${key}" is declared by both "${owner}" and "${itemId}".`,
			);
		localOwners.set(key, itemId);
	}
}

/**
 * Ensure pack `when`, item `requires`, and item-level conditions are consistent.
 * @param items - Registry items to validate.
 * @param conditions - Shared condition definitions.
 * @throws Error when a condition key or value is undeclared or collides.
 */
function crossValidateWhen(
	items: Record<string, IndexItem>,
	conditions: Record<string, RegistryCondition> | undefined,
): void {
	const localOwners = new Map<string, string>();

	for (const [itemId, item] of Object.entries(items)) {
		// Pack and local-condition `when` may reference shared or this item's conditions.
		const inScope: Record<string, RegistryCondition> = {
			...conditions,
			...item.conditions,
		};

		for (const pack of item.packs ?? []) {
			validateWhenEntries(
				`Registry item "${itemId}" pack "${pack.id}"`,
				pack.when,
				inScope,
			);
		}
		for (const [key, condition] of Object.entries(item.conditions ?? {})) {
			validateWhenEntries(
				`Registry item "${itemId}" condition "${key}"`,
				condition.when,
				inScope,
			);
		}
		assertItemConditionOwnership(itemId, item, conditions, localOwners);
	}
}

/**
 * Ensure every item type is declared in the types map.
 * @param items - Registry items to validate.
 * @param types - Shared type definitions.
 * @throws Error when an item type is undeclared.
 */
function crossValidateItemTypes(
	items: Record<string, IndexItem>,
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

	const items: Record<string, IndexItem> = {};
	for (const [key, item] of Object.entries(source.items)) {
		items[key] = parseWithSchema(
			indexItemSchema,
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
	assertConditionMapBindingKeys(conditions);
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
