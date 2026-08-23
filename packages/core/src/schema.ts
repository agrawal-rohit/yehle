import { z } from "zod";
import {
	policyForConditionKind,
	RegistryConditionKind,
} from "./condition-kind";

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
 * Make keys whose value may be `undefined` optional, matching {@link omitUndefined}.
 */
type OmitUndefinedKeys<T> = {
	[K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
	[K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
		T[K],
		undefined
	>;
};

/**
 * Drop keys whose values are `undefined` so optional fields stay omitted.
 * @param value - Object that may contain undefined optional fields.
 * @returns Shallow copy without undefined values.
 */
function omitUndefined<T extends Record<string, unknown>>(
	value: T,
): OmitUndefinedKeys<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, field]) => field !== undefined),
	) as OmitUndefinedKeys<T>;
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
 * Optional string that drops blank strings from the parsed object.
 * @returns Zod schema for optional non-empty string fields.
 */
function optionalNonEmptyString() {
	return z
		.string()
		.optional()
		.transform((value) =>
			typeof value === "string" && value.length > 0 ? value : undefined,
		);
}

/** Relative path to a colocated script or compiled script URI under the catalog. */
const registryScriptPathSchema = nonEmptyString.superRefine(
	(value, context) => {
		if (
			value.startsWith("/") ||
			value.includes("\\") ||
			value.split("/").includes("..") ||
			/^https?:\/\//i.test(value)
		)
			context.addIssue({
				code: "custom",
				message: `invalid_script:${value}`,
			});
	},
);

/**
 * Optional install-phase field accepting one script path or a non-empty list.
 * Every entry is a colocated or compiled script — never a registry item id.
 * @returns Zod schema normalised to a string array or undefined.
 */
function optionalInstallPhaseList() {
	return z
		.union([registryScriptPathSchema, z.array(registryScriptPathSchema).min(1)])
		.optional()
		.transform((value) => {
			if (value === undefined) return undefined;
			return Array.isArray(value) ? value : [value];
		});
}

/** Install lifecycle phase field names on catalog and authored items. */
export enum InstallPhase {
	BeforeInstall = "beforeInstall",
	AfterInstall = "afterInstall",
}

/** File metadata in an authoring `registry-item.json`. */
export const registryFileSchema = z.strictObject({
	/** Path to the file in the item folder. */
	source: nonEmptyString,
	/** Destination path in the consuming project. */
	target: nonEmptyString,
});
export type RegistryFile = z.infer<typeof registryFileSchema>;

/**
 * File entry inside an install payload.
 * Content is inlined at build time from the authoring source file.
 */
export const registryPayloadFileSchema = z.strictObject({
	/** Destination path in the consuming project. */
	target: nonEmptyString,
	/** Raw template text inlined at build time. */
	content: nonEmptyString,
});
export type RegistryPayloadFile = z.infer<typeof registryPayloadFileSchema>;

/** Supported package ecosystems declared on registry payloads. Add variants here when introducing new ecosystems. */
export enum RegistryEcosystem {
	NPM = "npm",
}

/** Dependency list keys on {@link RegistryDependencySet}. */
export enum RegistryDependencyKind {
	RUNTIME = "runtime",
	DEV = "dev",
}

const registryDependencySetShape = {
	[RegistryDependencyKind.RUNTIME]: optionalNonEmptyStringArray(),
	[RegistryDependencyKind.DEV]: optionalNonEmptyStringArray(),
};

/** Runtime and dev package names for one ecosystem. */
export const registryDependencySetSchema = z
	.strictObject(registryDependencySetShape)
	.transform(omitUndefined);
export type RegistryDependencySet = z.infer<typeof registryDependencySetSchema>;

/** Ecosystem keys accepted on registry dependency maps. Add a key here when introducing a new ecosystem. */
const registryEcosystemDependenciesShape = {
	[RegistryEcosystem.NPM]: registryDependencySetSchema.optional(),
} satisfies Record<
	RegistryEcosystem,
	z.ZodOptional<typeof registryDependencySetSchema>
>;

/** Ecosystem packages to install, keyed by ecosystem. Add a key here when introducing a new ecosystem. */
export const registryEcosystemDependenciesSchema = z
	.strictObject(registryEcosystemDependenciesShape)
	.transform((value) => {
		const merged: Partial<Record<RegistryEcosystem, RegistryDependencySet>> =
			{};
		for (const ecosystem of Object.keys(
			registryEcosystemDependenciesShape,
		) as RegistryEcosystem[]) {
			const dependencySet = value[ecosystem];
			if (
				dependencySet &&
				((dependencySet[RegistryDependencyKind.RUNTIME]?.length ?? 0) > 0 ||
					(dependencySet[RegistryDependencyKind.DEV]?.length ?? 0) > 0)
			)
				merged[ecosystem] = dependencySet;
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	});
export type RegistryEcosystemDependencies = NonNullable<
	z.infer<typeof registryEcosystemDependenciesSchema>
>;

/** Install payload for one item or variant (templates, not rendered output). */
export const registryPayloadSchema = z
	.strictObject({
		/** Files to install (item-level files first when folded into a variant). May be empty when an install script generates every file at install time. */
		files: z.array(registryPayloadFileSchema).default([]),
		/** Ecosystem packages to install, keyed by ecosystem. */
		dependencies: registryEcosystemDependenciesSchema.optional(),
	})
	.transform(omitUndefined);
export type RegistryPayload = z.infer<typeof registryPayloadSchema>;

/** Condition matcher shared by items and variants. */
const registryWhenSchema = z
	.record(z.string(), nonEmptyString)
	.optional()
	.transform((value) => {
		if (!value || Object.keys(value).length === 0) return undefined;
		return value;
	});

/** A labelled value for a shared condition. */
export const registryConditionValueSchema = z
	.strictObject({
		/** Matcher value referenced by variant `when` entries. */
		value: nonEmptyString,
		/** Display label for this value. */
		label: nonEmptyString,
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
		description: optionalNonEmptyString(),
		/** Type of condition to prompt for. */
		kind: z.enum(RegistryConditionKind).optional(),
		/** Handler path: authoring-relative for conditions/conditions.json, or compiled `r/_handlers/{key}.handler.js` URI in the catalog. */
		handler: registryScriptPathSchema.optional(),
		/** Allowed labelled values for select and multiselect conditions. */
		values: z.array(registryConditionValueSchema).min(1).optional(),
	})
	.superRefine((data, context) => {
		const { kind, requiresValues } = policyForConditionKind(data.kind);
		if (requiresValues) {
			if (!data.values || data.values.length === 0) {
				context.addIssue({
					code: "custom",
					message: "select_requires_values",
				});
				return;
			}

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
			return;
		}

		// Free-form and yes/no conditions must not declare select values.
		if (data.values && data.values.length > 0)
			context.addIssue({
				code: "custom",
				message:
					kind === RegistryConditionKind.TEXT
						? "text_with_values"
						: "boolean_with_values",
			});
	})
	.transform((condition) =>
		omitUndefined({
			label: condition.label,
			kind: condition.kind,
			handler: condition.handler,
			values: condition.values,
			description: condition.description,
		}),
	);
export type RegistryCondition = z.infer<typeof registryConditionSchema>;

/** Display metadata for a registry item type. */
export const registryItemTypeSchema = z
	.strictObject({
		/** Display label for this item type. */
		label: nonEmptyString,
		/** Optional longer description shown in the CLI. */
		description: optionalNonEmptyString(),
	})
	.transform(omitUndefined);
export type RegistryItemTypeDefinition = z.infer<typeof registryItemTypeSchema>;

/**
 * Reject duplicate variant ids on an authored or catalog item.
 * @param variants - Variant list that may contain duplicate ids.
 * @param context - Zod refinement context.
 */
function rejectDuplicateVariantIds(
	variants: Array<{ id: string }> | undefined,
	context: z.RefinementCtx,
): void {
	const seenVariantIds = new Set<string>();
	for (const variant of variants ?? []) {
		if (seenVariantIds.has(variant.id)) {
			context.addIssue({
				code: "custom",
				message: `duplicate_variant:${variant.id}`,
			});
			return;
		}
		seenVariantIds.add(variant.id);
	}
}

/**
 * Reject duplicate entries inside one named list.
 * @param entries - List that may contain duplicate strings.
 * @param listName - Field name used in the error code.
 * @param context - Zod refinement context.
 */
function rejectDuplicateListEntries(
	entries: string[] | undefined,
	listName: string,
	context: z.RefinementCtx,
): void {
	if (!entries) return;
	const seen = new Set<string>();
	for (const entry of entries) {
		if (seen.has(entry)) {
			context.addIssue({
				code: "custom",
				message: `duplicate_hook:${listName}:${entry}`,
			});
			return;
		}
		seen.add(entry);
	}
}

/**
 * Reject duplicate scripts and registry dependency ids on an item or variant.
 * @param item - Parsed item or variant candidate.
 * @param context - Zod refinement context.
 */
function rejectInstallPhaseConflicts(
	item: {
		registryDependencies?: string[];
		beforeInstall?: string[];
		afterInstall?: string[];
	},
	context: z.RefinementCtx,
): void {
	rejectDuplicateListEntries(item.beforeInstall, "beforeInstall", context);
	rejectDuplicateListEntries(item.afterInstall, "afterInstall", context);
	rejectDuplicateListEntries(
		item.registryDependencies,
		"registryDependencies",
		context,
	);
}

/** Shared fields for authored and catalog variants. */
const variantSharedFields = {
	/** Unique variant id within the item. */
	id: safePathSegment,
	/** Display title. */
	title: nonEmptyString,
	/** Condition matcher that selects this variant. */
	when: registryWhenSchema,
	/** Other registry items this variant depends on. */
	registryDependencies: optionalNonEmptyStringArray(),
	/** Colocated scripts to run before this variant's files are written. */
	beforeInstall: optionalInstallPhaseList(),
	/** Colocated scripts to run after this variant's files are written. */
	afterInstall: optionalInstallPhaseList(),
};

/** Variant from an authoring `registry-item.json`. */
export const registryVariantSchema = z
	.strictObject({
		...variantSharedFields,
		/** Short description of this installable slice. */
		description: nonEmptyString,
		/** Files copied when this variant is selected. */
		files: z.array(registryFileSchema).min(1),
		/** Ecosystem packages added with this variant, keyed by ecosystem. */
		dependencies: registryEcosystemDependenciesSchema.optional(),
	})
	.superRefine((variant, context) => {
		rejectInstallPhaseConflicts(variant, context);
	})
	.transform(omitUndefined);
export type AuthoredRegistryVariant = z.infer<typeof registryVariantSchema>;

/** Variant index entry in compiled `registry.json`. */
export const catalogVariantSchema = z
	.strictObject({
		...variantSharedFields,
		/** Payload URI joined against the catalog location. */
		source: nonEmptyString,
	})
	.superRefine((variant, context) => {
		rejectInstallPhaseConflicts(variant, context);
	})
	.transform(omitUndefined);
export type CatalogVariant = z.infer<typeof catalogVariantSchema>;

/** Optional variants list that collapses empty arrays to undefined. */
const optionalVariants = <T extends z.ZodType>(variantSchema: T) =>
	z
		.array(variantSchema)
		.optional()
		.transform((value) => (value && value.length > 0 ? value : undefined));

/** Shared fields for authored and catalog items (excluding id / install source). */
const itemSharedFields = {
	/** Display title. */
	title: nonEmptyString,
	/** Short description of the item. */
	description: nonEmptyString,
	/** Item type key declared in `types`. */
	type: nonEmptyString,
	/** Shared condition keys this item consumes. */
	uses: optionalNonEmptyStringArray(),
	/** Other registry items this item depends on. */
	registryDependencies: optionalNonEmptyStringArray(),
	/** Colocated scripts to run before this item's files are written. */
	beforeInstall: optionalInstallPhaseList(),
	/** Colocated scripts to run after this item's files are written. */
	afterInstall: optionalInstallPhaseList(),
};

/**
 * Shared item refinements: require an installable shape and unique variant ids.
 * @param item - Parsed item candidate.
 * @param context - Zod refinement context.
 * @param options - Whether the item uses authored files or catalog source.
 */
function refineRegistryItem(
	item: {
		variants?: Array<{ id: string }>;
		beforeInstall?: string[];
		afterInstall?: string[];
		files?: unknown[];
		source?: string;
	},
	context: z.RefinementCtx,
	options: { authored: boolean },
): void {
	const hasVariants = (item.variants?.length ?? 0) > 0;
	const hasInstallPhases =
		(item.beforeInstall?.length ?? 0) > 0 ||
		(item.afterInstall?.length ?? 0) > 0;
	const hasInstallSource = options.authored
		? (item.files?.length ?? 0) > 0
		: Boolean(item.source);

	// Script-only or composer-only items need no static files when phases or variants exist.
	if (!hasVariants && !hasInstallSource && !hasInstallPhases) {
		context.addIssue({
			code: "custom",
			message: options.authored
				? "missing_files_or_variants"
				: "missing_source_or_variants",
		});
		return;
	}

	if (!options.authored && hasVariants && item.source) {
		context.addIssue({
			code: "custom",
			message: "source_with_variants",
		});
		return;
	}

	rejectDuplicateVariantIds(item.variants, context);
}

/** Item from an authoring `registry-item.json`. */
export const registryItemSchema = z
	.strictObject({
		...itemSharedFields,
		/** Unique item id. */
		id: safePathSegment,
		/** Install files for a variant-less item, or files shared by every variant. */
		files: z.array(registryFileSchema).min(1).optional(),
		/** Ecosystem packages added with this item, keyed by ecosystem. */
		dependencies: registryEcosystemDependenciesSchema.optional(),
		/** Installable slices of this item; omit for a single top-level configuration. */
		variants: optionalVariants(registryVariantSchema),
	})
	.superRefine((item, context) => {
		refineRegistryItem(item, context, { authored: true });
		rejectInstallPhaseConflicts(item, context);
	})
	.transform(omitUndefined);
export type AuthoredRegistryItem = z.infer<typeof registryItemSchema>;

/** Item index entry in compiled `registry.json`. Identity is the `items` map key. */
export const catalogItemSchema = z
	.strictObject({
		...itemSharedFields,
		/** Payload URI for a variant-less item, joined against the catalog location. */
		source: nonEmptyString.optional(),
		/** Installable slices of this item; omit for a single top-level configuration. */
		variants: optionalVariants(catalogVariantSchema),
	})
	.superRefine((item, context) => {
		refineRegistryItem(item, context, { authored: false });
		rejectInstallPhaseConflicts(item, context);
	})
	.transform(omitUndefined);
export type CatalogItem = z.infer<typeof catalogItemSchema>;

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
	items: Record<string, CatalogItem>;
}
