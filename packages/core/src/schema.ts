import { z } from "zod";

/** Non-empty string field. */
const nonEmptyString = z.string().min(1);

/** Item / variant ids must be a single path segment so default payload paths cannot escape `r/`. */
const safePathSegment = nonEmptyString.superRefine((id, context) => {
	if (id === "." || id === ".." || id.includes("/") || id.includes("\\"))
		context.addIssue({
			code: "custom",
			message: `invalid_id:${id}`,
		});
});

/**
 * Drop keys whose values are `undefined` so optional fields stay omitted.
 * @param value - Object that may contain undefined optional fields.
 * @returns Shallow copy without undefined values.
 */
function omitUndefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, field]) => field !== undefined),
	) as T;
}

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

/** Authoring / catalog file metadata (path + install target). */
export const registryFileSchema = z.strictObject({
	/** Path to the file in the registry package, relative to the item folder. */
	source: nonEmptyString,
	/** Destination path in the consuming project. */
	target: nonEmptyString,
});
export type RegistryFile = z.infer<typeof registryFileSchema>;

/**
 * File entry inside an install payload.
 * Content is inlined at build time from the authoring source file.
 */
export const registryPayloadFileSchema = registryFileSchema.extend({
	/** Raw template text inlined at build time. */
	content: nonEmptyString,
});
export type RegistryPayloadFile = z.infer<typeof registryPayloadFileSchema>;

/** Install payload for one item variant (templates, not rendered output). */
export const registryPayloadSchema = z.strictObject({
	/** Registry item id. */
	id: safePathSegment,
	/** Variant id within the item. */
	variantId: safePathSegment,
	/** Files to install for this variant (item-level files first). */
	files: z.array(registryPayloadFileSchema).min(1),
});
export type RegistryPayload = z.infer<typeof registryPayloadSchema>;

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
		/** Matcher value referenced by variant `when` entries. */
		value: nonEmptyString,
		/** Display label for this value. */
		label: nonEmptyString,
		/** Files used to infer this value when inference is `files`. */
		files: optionalNonEmptyStringArray(),
	})
	.transform(omitUndefined);
export type RegistryConditionValue = z.infer<
	typeof registryConditionValueSchema
>;

/** Shared condition definition in the registry. */
export const registryConditionSchema = z
	.strictObject({
		/** Display label for this condition. */
		label: nonEmptyString,
		/** Optional longer description shown in the CLI. */
		description: optionalDescription(),
		/** How to infer this condition when it is not set explicitly. */
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
		/** Allowed labelled values for this condition. */
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
	.transform((condition) =>
		omitUndefined({
			label: condition.label,
			values: condition.values,
			description: condition.description,
			inference: condition.inference as RegistryConditionInference | undefined,
		}),
	);
export type RegistryCondition = z.infer<typeof registryConditionSchema>;

/** Display metadata for a registry item type. */
export const registryItemTypeSchema = z
	.strictObject({
		/** Display label for this item type. */
		label: nonEmptyString,
		/** Optional longer description shown in the CLI. */
		description: optionalDescription(),
	})
	.transform(omitUndefined);
export type RegistryItemTypeDefinition = z.infer<typeof registryItemTypeSchema>;

/** Shared variant shape before the catalog `payload` URI is added. */
const registryVariantObject = z.strictObject({
	/** Unique variant id within the item. */
	id: safePathSegment,
	/** Display title. */
	title: nonEmptyString,
	/** Short description of this installable slice. */
	description: nonEmptyString,
	/** Files copied when this variant is selected. */
	files: z.array(registryFileSchema).min(1),
	/** Condition matcher that selects this variant. */
	when: z
		.record(z.string(), nonEmptyString)
		.optional()
		.transform((value) => {
			if (!value || Object.keys(value).length === 0) return undefined;
			return value;
		}),
	/** npm dependencies added with this variant. */
	dependencies: optionalNonEmptyStringArray(),
	/** npm devDependencies added with this variant. */
	devDependencies: optionalNonEmptyStringArray(),
	/** Other registry items this variant depends on. */
	registryDependencies: optionalNonEmptyStringArray(),
});

/** Authoring variant from `registry-item.json` (no payload URI). */
export const authoredRegistryVariantSchema =
	registryVariantObject.transform(omitUndefined);
export type AuthoredRegistryVariant = z.infer<
	typeof authoredRegistryVariantSchema
>;

/** Catalog variant from `registry.json` (requires a payload URI). */
export const registryVariantSchema = registryVariantObject
	.extend({
		/** Opaque URI reference to the install payload for this variant. */
		payload: nonEmptyString,
	})
	.transform(omitUndefined);
export type RegistryVariant = z.infer<typeof registryVariantSchema>;

/**
 * Item schema parameterized only by the nested variant shape.
 * @param variantSchema - Authored variants (no payload) or catalog variants (payload required).
 * @returns Zod schema for a registry item.
 */
function registryItemSchemaFor<TVariant extends z.ZodType<{ id: string }>>(
	variantSchema: TVariant,
) {
	return z
		.strictObject({
			/** Unique item id. */
			id: safePathSegment,
			/** Display title. */
			title: nonEmptyString,
			/** Short description of the item. */
			description: nonEmptyString,
			/** Item type key declared in `types`. */
			type: nonEmptyString,
			/** Files shared by every variant. */
			files: z.array(registryFileSchema).min(1).optional(),
			/** npm dependencies added with this item. */
			dependencies: optionalNonEmptyStringArray(),
			/** npm devDependencies added with this item. */
			devDependencies: optionalNonEmptyStringArray(),
			/** Other registry items this item depends on. */
			registryDependencies: optionalNonEmptyStringArray(),
			/** Installable slices of this item. */
			variants: z.array(variantSchema).min(1),
		})
		.superRefine((item, context) => {
			const seenVariantIds = new Set<string>();
			for (const variant of item.variants) {
				if (seenVariantIds.has(variant.id)) {
					context.addIssue({
						code: "custom",
						message: `duplicate_variant:${variant.id}`,
					});
					return;
				}
				seenVariantIds.add(variant.id);
			}
		})
		.transform(omitUndefined);
}

/** Authoring item from `registry-item.json` (variants have no payload). */
export const authoredRegistryItemSchema = registryItemSchemaFor(
	authoredRegistryVariantSchema,
);
export type AuthoredRegistryItem = z.infer<typeof authoredRegistryItemSchema>;

/** Catalog item from `registry.json` (variants require a payload URI). */
export const registryItemSchema = registryItemSchemaFor(registryVariantSchema);
export type RegistryItem = z.infer<typeof registryItemSchema>;

/**
 * Top-level registry document fields validated before nested parsing.
 * Nested maps stay `unknown` so callers can parse each entry with a labeled schema.
 */
export const registryDocumentFieldsSchema = z.strictObject({
	/** Shared condition definitions keyed by condition key. */
	conditions: z.record(z.string(), z.unknown()).optional(),
	/** Item type display metadata keyed by type value. */
	types: z.unknown().optional(),
	/** Registry items keyed by id. */
	items: z.record(z.string(), z.unknown()),
});

/** Fully parsed catalog document written to registry.json. */
export interface Registry {
	/** Shared condition definitions keyed by condition key. */
	conditions?: Record<string, RegistryCondition>;
	/** Item type display metadata keyed by type value. */
	types: Record<string, RegistryItemTypeDefinition>;
	/** Registry items keyed by id. */
	items: Record<string, RegistryItem>;
}
