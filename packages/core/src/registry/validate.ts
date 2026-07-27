import {
	asRecord,
	assertNonEmptyString,
	parseStringArray,
	parseWhen,
} from "./parse";
import {
	type Registry,
	type RegistryCondition,
	RegistryConditionInference,
	type RegistryConditionValue,
	type RegistryFile,
	type RegistryItem,
	type RegistryVariant,
	SCHEMA_VERSION,
} from "./schema";

/**
 * Parse file metadata entries from a built registry document.
 * @param raw - Raw file array.
 * @param label - Error context.
 * @returns Normalized file metadata.
 * @throws Error when an entry is malformed.
 */
function parseRegistryFiles(raw: unknown, label: string): RegistryFile[] {
	if (!Array.isArray(raw) || raw.length === 0)
		throw new Error(`${label} must declare at least one file.`);

	return raw.map((entry, index) => {
		const file = asRecord(entry, `${label}[${index}]`);
		assertNonEmptyString(file.source, `${label}[${index}].source`);
		assertNonEmptyString(file.target, `${label}[${index}].target`);
		return {
			source: file.source,
			target: file.target,
		};
	});
}

/**
 * Parse dependency references declared in registry metadata.
 * @param raw - Raw dependency entries.
 * @param label - Error context.
 * @returns Normalized entries, or undefined when absent/empty.
 * @throws Error when an entry is malformed.
 */
function parseRegistryDependencyEntries(
	raw: unknown,
	label: string,
): Array<string | { name: string }> | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!Array.isArray(raw)) throw new Error(`${label} must be an array.`);

	const dependencies: Array<string | { name: string }> = [];
	for (const [index, entry] of raw.entries()) {
		if (typeof entry === "string") {
			assertNonEmptyString(entry, `${label}[${index}]`);
			dependencies.push(entry);
			continue;
		}

		const objectEntry = asRecord(entry, `${label}[${index}]`);
		assertNonEmptyString(objectEntry.name, `${label}[${index}].name`);
		dependencies.push({ name: objectEntry.name });
	}

	return dependencies.length > 0 ? dependencies : undefined;
}

/**
 * Parse a built registry variant object.
 * @param raw - Raw variant metadata.
 * @param label - Error context.
 * @returns Normalized registry variant.
 * @throws Error when the variant is malformed.
 */
function parseRegistryVariant(raw: unknown, label: string): RegistryVariant {
	const variant = asRecord(raw, label);
	assertNonEmptyString(variant.id, `${label}.id`);
	assertNonEmptyString(variant.title, `${label}.title`);
	assertNonEmptyString(variant.description, `${label}.description`);

	const files = parseRegistryFiles(variant.files, `${label}.files`);
	const when = parseWhen(variant.when, label);
	const dependencies = parseStringArray(
		variant.dependencies,
		`${label}.dependencies`,
	);
	const devDependencies = parseStringArray(
		variant.devDependencies,
		`${label}.devDependencies`,
	);
	const registryDependencies = parseRegistryDependencyEntries(
		variant.registryDependencies,
		`${label}.registryDependencies`,
	);

	return {
		id: variant.id,
		title: variant.title,
		description: variant.description,
		files,
		...(when ? { when } : {}),
		...(dependencies ? { dependencies } : {}),
		...(devDependencies ? { devDependencies } : {}),
		...(registryDependencies ? { registryDependencies } : {}),
	};
}

/**
 * Validate a built registry item object.
 * @param raw - Raw item metadata from a registry document.
 * @param label - Error context.
 * @returns Normalized registry item.
 * @throws Error when the item is malformed.
 */
export function validateRegistryItem(
	raw: unknown,
	label: string = "Registry item",
): RegistryItem {
	const item = asRecord(raw, label);
	assertNonEmptyString(item.id, `${label}.id`);
	assertNonEmptyString(item.title, `${label}.title`);
	assertNonEmptyString(item.description, `${label}.description`);
	assertNonEmptyString(item.type, `${label}.type`);

	if (!Array.isArray(item.variants) || item.variants.length === 0)
		throw new Error(`${label}.variants must declare at least one variant.`);

	const variants = item.variants.map((entry, index) =>
		parseRegistryVariant(entry, `${label}.variants[${index}]`),
	);
	const files =
		item.files === undefined
			? undefined
			: parseRegistryFiles(item.files, `${label}.files`);
	const dependencies = parseStringArray(
		item.dependencies,
		`${label}.dependencies`,
	);
	const devDependencies = parseStringArray(
		item.devDependencies,
		`${label}.devDependencies`,
	);
	const registryDependencies = parseRegistryDependencyEntries(
		item.registryDependencies,
		`${label}.registryDependencies`,
	);

	return {
		id: item.id,
		title: item.title,
		description: item.description,
		type: item.type,
		...(files ? { files } : {}),
		...(dependencies ? { dependencies } : {}),
		...(devDependencies ? { devDependencies } : {}),
		variants,
		...(registryDependencies ? { registryDependencies } : {}),
	};
}

/**
 * Parse a single shared condition value entry.
 * @param rawValue - Raw value object from conditions.json.
 * @param key - Condition key for error context.
 * @param index - Value index for error context.
 * @param seenValues - Values already declared for this condition.
 * @returns Normalized condition value.
 * @throws Error when the value entry is malformed or duplicated.
 */
function parseConditionValueEntry(
	rawValue: unknown,
	key: string,
	index: number,
	seenValues: Set<string>,
): RegistryConditionValue {
	const valueEntry = asRecord(
		rawValue,
		`Registry condition "${key}" values[${index}]`,
	);
	assertNonEmptyString(
		valueEntry.value,
		`Registry condition "${key}" values[${index}].value`,
	);
	assertNonEmptyString(
		valueEntry.label,
		`Registry condition "${key}" values[${index}].label`,
	);
	if (seenValues.has(valueEntry.value))
		throw new Error(
			`Registry condition "${key}" has duplicate value "${valueEntry.value}".`,
		);
	seenValues.add(valueEntry.value);

	const files = parseStringArray(
		valueEntry.files,
		`Registry condition "${key}" values[${index}].files`,
	);
	return {
		value: valueEntry.value,
		label: valueEntry.label,
		...(files ? { files } : {}),
	};
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
	const source = asRecord(raw, "Registry conditions");
	const conditions: Record<string, RegistryCondition> = {};

	for (const [key, rawCondition] of Object.entries(source)) {
		const entry = asRecord(rawCondition, `Registry condition "${key}"`);
		assertNonEmptyString(entry.label, `Registry condition "${key}" label`);

		let inference: RegistryConditionInference | undefined;
		if (entry.inference !== undefined) {
			assertNonEmptyString(
				entry.inference,
				`Registry condition "${key}" inference`,
			);
			const modes = new Set<string>(Object.values(RegistryConditionInference));
			if (!modes.has(entry.inference))
				throw new Error(
					`Registry condition "${key}" has invalid inference "${entry.inference}" (expected one of: ${Object.values(RegistryConditionInference).join(", ")}).`,
				);
			inference = entry.inference as RegistryConditionInference;
		}

		if (!Array.isArray(entry.values) || entry.values.length === 0)
			throw new Error(
				`Registry condition "${key}" must declare at least one value.`,
			);

		const seenValues = new Set<string>();
		const values = entry.values.map((rawValue, index) =>
			parseConditionValueEntry(rawValue, key, index, seenValues),
		);

		conditions[key] = {
			label: entry.label,
			...(typeof entry.description === "string" && entry.description.length > 0
				? { description: entry.description }
				: {}),
			...(inference ? { inference } : {}),
			values,
		};
	}

	return Object.keys(conditions).length > 0 ? conditions : undefined;
}

/**
 * Ensure every variant `when` key/value is declared in the conditions map.
 * @param items - Registry items to validate.
 * @param conditions - Shared condition definitions.
 * @throws Error when a condition key or value is undeclared.
 */
export function crossValidateWhen(
	items: Record<string, RegistryItem>,
	conditions: Record<string, RegistryCondition> | undefined,
): void {
	for (const item of Object.values(items)) {
		for (const variant of item.variants) {
			if (!variant.when) continue;

			for (const [key, value] of Object.entries(variant.when)) {
				const condition = conditions?.[key];
				if (!condition)
					throw new Error(
						`Registry item "${item.id}" variant "${variant.id}" references unknown when key "${key}".`,
					);
				if (!condition.values.some((entry) => entry.value === value))
					throw new Error(
						`Registry item "${item.id}" variant "${variant.id}" uses undeclared when value "${value}" for key "${key}".`,
					);
			}
		}
	}
}

/**
 * Parse and validate a registry document.
 * @param raw - Raw JSON value loaded from registry.json.
 * @returns Normalized registry document.
 * @throws Error when the document shape or schema version is invalid.
 */
export function parseRegistryDocument(raw: unknown): Registry {
	const source = asRecord(raw, "Registry");
	assertNonEmptyString(source.version, "Registry version");

	if (
		typeof source.schemaVersion !== "number" ||
		!Number.isInteger(source.schemaVersion)
	)
		throw new Error("Registry schemaVersion must be an integer.");
	if (source.schemaVersion > SCHEMA_VERSION)
		throw new Error(
			`Registry schema version ${source.schemaVersion} is newer than this CLI supports (${SCHEMA_VERSION}). Upgrade tuckshop.`,
		);

	assertNonEmptyString(source.contentBaseUrl, "Registry contentBaseUrl");
	const itemsRecord = asRecord(source.items, "Registry items");
	const items: Record<string, RegistryItem> = {};

	for (const [key, item] of Object.entries(itemsRecord)) {
		const parsed = validateRegistryItem(item, `Registry items["${key}"]`);
		items[key] = parsed;
	}

	const conditions = parseRegistryConditions(source.conditions);
	crossValidateWhen(items, conditions);

	return {
		version: source.version,
		schemaVersion: source.schemaVersion,
		contentBaseUrl: source.contentBaseUrl.replace(/\/+$/, ""),
		...(conditions ? { conditions } : {}),
		items,
	};
}
