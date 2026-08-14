import { z } from "zod";

/** Non-empty string field. */
const nonEmptyString = z.string().min(1);

/**
 * Optional string list that collapses absent or empty arrays to `undefined`.
 * @returns Zod schema for optional dependency-style string arrays.
 */
function optionalNonEmptyStringArray() {
	return z
		.array(nonEmptyString)
		.optional()
		.transform((value) => (value && value.length > 0 ? value : undefined));
}

/**
 * Optional description that drops blank strings from the parsed object.
 * @returns Zod schema for optional description fields.
 */
function optionalDescription() {
	return z
		.string()
		.optional()
		.transform((value) =>
			typeof value === "string" && value.length > 0 ? value : undefined,
		);
}

/** Built registry file metadata (content fetched at install time). */
export const registryFileSchema = z.strictObject({
	source: nonEmptyString,
	target: nonEmptyString,
});
export type RegistryFile = z.infer<typeof registryFileSchema>;

/** Supported condition inference modes. */
export enum RegistryConditionInference {
	FILES = "files",
}

const inferenceModes = Object.values(RegistryConditionInference) as [
	RegistryConditionInference,
	...RegistryConditionInference[],
];

/** A labelled value for a shared condition. */
export const registryConditionValueSchema = z
	.strictObject({
		value: nonEmptyString,
		label: nonEmptyString,
		files: optionalNonEmptyStringArray(),
	})
	.transform((entry) => ({
		value: entry.value,
		label: entry.label,
		...(entry.files ? { files: entry.files } : {}),
	}));
export type RegistryConditionValue = z.infer<
	typeof registryConditionValueSchema
>;

/** Shared condition definition in the registry. */
export const registryConditionSchema = z
	.strictObject({
		label: nonEmptyString,
		description: optionalDescription(),
		inference: z
			.string()
			.optional()
			.superRefine((value, context) => {
				if (value === undefined) return;
				if (!inferenceModes.includes(value as RegistryConditionInference)) {
					context.addIssue({
						code: "custom",
						message: `invalid_inference:${value}`,
					});
				}
			}),
		values: z.array(registryConditionValueSchema).min(1),
	})
	.superRefine((data, context) => {
		const seenValues = new Set<string>();
		for (const entry of data.values) {
			if (seenValues.has(entry.value)) {
				context.addIssue({
					code: "custom",
					message: `duplicate:${entry.value}`,
				});
				return;
			}
			seenValues.add(entry.value);
		}
	})
	.transform((condition) => ({
		label: condition.label,
		values: condition.values,
		...(condition.description ? { description: condition.description } : {}),
		...(condition.inference
			? { inference: condition.inference as RegistryConditionInference }
			: {}),
	}));
export type RegistryCondition = z.infer<typeof registryConditionSchema>;

/** Display metadata for a registry item type. */
export const registryItemTypeSchema = z
	.strictObject({
		label: nonEmptyString,
		description: optionalDescription(),
	})
	.transform((entry) => ({
		label: entry.label,
		...(entry.description ? { description: entry.description } : {}),
	}));
export type RegistryItemTypeDefinition = z.infer<typeof registryItemTypeSchema>;

/**
 * Optional `when` matcher map that collapses empty objects to `undefined`.
 * @returns Zod schema for variant `when` fields.
 */
function optionalWhenRecord() {
	return z
		.record(z.string(), nonEmptyString)
		.optional()
		.transform((value) => {
			if (!value || Object.keys(value).length === 0) return undefined;
			return value;
		});
}

/** Built registry variant (installable slice). */
export const registryVariantSchema = z
	.strictObject({
		id: nonEmptyString,
		title: nonEmptyString,
		description: nonEmptyString,
		files: z.array(registryFileSchema).min(1),
		when: optionalWhenRecord(),
		dependencies: optionalNonEmptyStringArray(),
		devDependencies: optionalNonEmptyStringArray(),
		registryDependencies: optionalNonEmptyStringArray(),
	})
	.transform((variant) => ({
		id: variant.id,
		title: variant.title,
		description: variant.description,
		files: variant.files,
		...(variant.when ? { when: variant.when } : {}),
		...(variant.dependencies ? { dependencies: variant.dependencies } : {}),
		...(variant.devDependencies
			? { devDependencies: variant.devDependencies }
			: {}),
		...(variant.registryDependencies
			? { registryDependencies: variant.registryDependencies }
			: {}),
	}));
export type RegistryVariant = z.infer<typeof registryVariantSchema>;

/** Registry item metadata from registry.json. */
export const registryItemSchema = z
	.strictObject({
		id: nonEmptyString,
		title: nonEmptyString,
		description: nonEmptyString,
		type: nonEmptyString,
		files: z.array(registryFileSchema).min(1).optional(),
		dependencies: optionalNonEmptyStringArray(),
		devDependencies: optionalNonEmptyStringArray(),
		variants: z.array(registryVariantSchema).min(1),
		registryDependencies: optionalNonEmptyStringArray(),
	})
	.transform((item) => ({
		id: item.id,
		title: item.title,
		description: item.description,
		type: item.type,
		variants: item.variants,
		...(item.files ? { files: item.files } : {}),
		...(item.dependencies ? { dependencies: item.dependencies } : {}),
		...(item.devDependencies ? { devDependencies: item.devDependencies } : {}),
		...(item.registryDependencies
			? { registryDependencies: item.registryDependencies }
			: {}),
	}));
export type RegistryItem = z.infer<typeof registryItemSchema>;

/** Registry content base URL with trailing slashes stripped. */
const contentBaseUrlSchema = nonEmptyString.transform((value) => {
	let normalized = value;
	while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
	return normalized;
});

/**
 * Top-level registry document fields validated before nested parsing.
 * Nested maps stay `unknown` so callers can parse each entry with a labeled schema.
 */
export const registryDocumentFieldsSchema = z.strictObject({
	contentBaseUrl: contentBaseUrlSchema,
	conditions: z.record(z.string(), z.unknown()).optional(),
	types: z.unknown().optional(),
	items: z.record(z.string(), z.unknown()),
});

/** Fully parsed registry document written to registry.json. */
const registrySchema = z.strictObject({
	contentBaseUrl: contentBaseUrlSchema,
	conditions: z.record(z.string(), registryConditionSchema).optional(),
	types: z.record(z.string(), registryItemTypeSchema),
	items: z.record(z.string(), registryItemSchema),
});
export type Registry = z.infer<typeof registrySchema>;
