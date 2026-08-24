import { z } from "zod";
import {
	policyForConditionKind,
	RegistryConditionKind,
} from "./condition-kind";

/** Non-empty string field. */
const nonEmptyString = z.string().min(1);

/** Item / pack ids must be a single path segment so default payload paths cannot escape `r/`. */
const safePathSegment = nonEmptyString.superRefine((id, context) => {
	if (id === "." || id === ".." || id.includes("/") || id.includes("\\"))
		context.addIssue({
			code: "custom",
			message: `invalid_id:${id}`,
		});
});

/** Make keys whose value may be `undefined` optional, matching {@link omitUndefined}. */
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

/** Relative path to a colocated script or compiled script URI under the index. */
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

/** Install lifecycle phase field names on catalog and raw items. */
export enum InstallPhase {
	/** Mutate the install plan before files are written. */
	PREPARE = "prepare",
	/** Run side effects after files and packages are applied. */
	FINALIZE = "finalize",
}

/** File metadata in an raw `registry-item.json`. */
export const registryFileSchema = z.strictObject({
	/** Path to the file in the item folder. */
	source: nonEmptyString,
	/** Destination path in the consuming project. */
	target: nonEmptyString,
});
export type RegistryFile = z.infer<typeof registryFileSchema>;

/**
 * File entry inside an compiled item.
 * Content is inlined at build time from the registry source source file.
 */
export const compiledItemFileSchema = z.strictObject({
	/** Destination path in the consuming project. */
	target: nonEmptyString,
	/** Raw template text inlined at build time. */
	content: nonEmptyString,
});
export type CompiledItemFile = z.infer<typeof compiledItemFileSchema>;

/** Supported package ecosystems declared on compiled items. Add ecosystems here when introducing new ones. */
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

/**
 * Strip empty per-ecosystem entries from a strict ecosystem map schema.
 * @param shape - Ecosystem field definitions.
 * @param isNonEmpty - Predicate that keeps an ecosystem entry.
 * @returns Zod schema that omits the whole map when every ecosystem is empty.
 */
function stripEmptyEcosystemEntries<T>(
	shape: Record<RegistryEcosystem, z.ZodOptional<z.ZodType<T>>>,
	isNonEmpty: (value: T) => boolean,
) {
	return z.strictObject(shape).transform((value) => {
		const merged: Partial<Record<RegistryEcosystem, T>> = {};
		for (const ecosystem of Object.keys(shape) as RegistryEcosystem[]) {
			const entry = value[ecosystem];
			if (entry && isNonEmpty(entry)) merged[ecosystem] = entry;
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	});
}

/** Ecosystem packages to install, keyed by ecosystem. Add a key here when introducing a new ecosystem. */
export const registryEcosystemDependenciesSchema = stripEmptyEcosystemEntries(
	registryEcosystemDependenciesShape,
	(dependencySet) =>
		(dependencySet[RegistryDependencyKind.RUNTIME]?.length ?? 0) > 0 ||
		(dependencySet[RegistryDependencyKind.DEV]?.length ?? 0) > 0,
);
export type RegistryEcosystemDependencies = NonNullable<
	z.infer<typeof registryEcosystemDependenciesSchema>
>;

/** Named project commands for one ecosystem (e.g. `package.json` scripts for npm). */
const registryCommandSetSchema = z.record(nonEmptyString, nonEmptyString);
export type RegistryCommandSet = z.infer<typeof registryCommandSetSchema>;

/** Ecosystem keys accepted on registry command maps. */
const registryEcosystemCommandsShape = {
	[RegistryEcosystem.NPM]: registryCommandSetSchema.optional(),
} satisfies Record<
	RegistryEcosystem,
	z.ZodOptional<typeof registryCommandSetSchema>
>;

/** Ecosystem commands to merge into the project manifest, keyed by ecosystem. */
const registryEcosystemCommandsSchema = stripEmptyEcosystemEntries(
	registryEcosystemCommandsShape,
	(commands) => Object.keys(commands).length > 0,
);
export type RegistryEcosystemCommands = NonNullable<
	z.infer<typeof registryEcosystemCommandsSchema>
>;

/** Compiled item for one item or pack (templates, not rendered output). */
export const compiledItemSchema = z
	.strictObject({
		/** Files to install (item-level files first when folded into a pack). May be empty when an install script generates every file at install time. */
		files: z.array(compiledItemFileSchema).default([]),
		/** Ecosystem packages to install, keyed by ecosystem. */
		dependencies: registryEcosystemDependenciesSchema.optional(),
		/** Ecosystem commands to merge into the project manifest, keyed by ecosystem. */
		commands: registryEcosystemCommandsSchema.optional(),
		/** Repository secret names the consumer must configure manually (e.g. in GitHub) */
		secrets: optionalNonEmptyStringArray(),
	})
	.transform(omitUndefined);
export type CompiledItem = z.infer<typeof compiledItemSchema>;

/** Typed matcher value shared by conditions and packs. */
export const registryWhenValueSchema = z.union([
	nonEmptyString,
	z.array(nonEmptyString).min(1),
	z.boolean(),
]);
/** Condition matcher shared by conditions and packs. */
export const registryWhenSchema = z
	.record(z.string(), registryWhenValueSchema)
	.optional()
	.transform((value) => {
		if (!value || Object.keys(value).length === 0) return undefined;
		return value;
	});
export type RegistryWhen = NonNullable<z.infer<typeof registryWhenSchema>>;

/** A labelled value for a shared condition. */
export const registryConditionValueSchema = z
	.strictObject({
		/** Matcher value referenced by pack and condition `when` entries. */
		value: nonEmptyString,
		/** Display label for this value. */
		label: nonEmptyString,
		/** Extra interpolation keys merged when this select option is chosen. */
		bindings: z.record(nonEmptyString, nonEmptyString).optional(),
	})
	.superRefine((entry, context) => {
		if (
			entry.bindings !== undefined &&
			Object.keys(entry.bindings).length === 0
		)
			context.addIssue({
				code: "custom",
				message: "empty_bindings",
				path: ["bindings"],
			});
	})
	.transform(omitUndefined);
export type RegistryConditionValue = z.infer<
	typeof registryConditionValueSchema
>;

/** Shared or item-level condition definition in the registry. */
interface RegistryConditionSchemaInput {
	label: string;
	description?: string;
	kind: RegistryConditionKind;
	optional?: boolean;
	when?: RegistryWhen;
	min?: number;
	default?: string;
	handler?: string;
	values?: RegistryConditionValue[];
}

/**
 * Add one custom validation issue for a registry condition.
 * @param context - Zod refinement context collecting validation issues.
 * @param message - Stable error code describing the failed rule.
 */
function addConditionIssue(context: z.RefinementCtx, message: string): void {
	context.addIssue({
		code: "custom",
		message,
	});
}

/**
 * Validate the multiselect-only `min` field on a registry condition.
 * @param condition - Parsed registry condition candidate.
 * @param kind - Effective condition kind.
 * @param context - Zod refinement context collecting validation issues.
 * @returns True when validation should stop early.
 */
function rejectInvalidConditionMin(
	condition: RegistryConditionSchemaInput,
	kind: RegistryConditionKind,
	context: z.RefinementCtx,
): boolean {
	if (
		condition.min !== undefined &&
		kind !== RegistryConditionKind.MULTISELECT
	) {
		addConditionIssue(context, "min_on_non_multiselect");
		return true;
	}
	return false;
}

/**
 * Validate select-like conditions that require labelled values.
 * @param condition - Parsed registry condition candidate.
 * @param kind - Effective condition kind.
 * @param context - Zod refinement context collecting validation issues.
 * @returns True when validation should stop early.
 */
function rejectInvalidSelectableCondition(
	condition: RegistryConditionSchemaInput,
	kind: RegistryConditionKind,
	context: z.RefinementCtx,
): boolean {
	if (!condition.values || condition.values.length === 0) {
		addConditionIssue(context, "select_requires_values");
		return true;
	}

	const seenValues = new Set<string>();
	for (const entry of condition.values) {
		if (seenValues.has(entry.value)) {
			addConditionIssue(context, `duplicate:${entry.value}`);
			return true;
		}
		seenValues.add(entry.value);

		if (
			kind === RegistryConditionKind.MULTISELECT &&
			entry.bindings !== undefined
		) {
			addConditionIssue(context, "bindings_on_multiselect");
			return true;
		}
	}

	return false;
}

/**
 * Validate non-select conditions that must not declare labelled values.
 * @param condition - Parsed registry condition candidate.
 * @param kind - Effective condition kind.
 * @param context - Zod refinement context collecting validation issues.
 */
function rejectInvalidNonSelectableCondition(
	condition: RegistryConditionSchemaInput,
	kind: RegistryConditionKind,
	context: z.RefinementCtx,
): void {
	if (!condition.values || condition.values.length === 0) return;
	addConditionIssue(
		context,
		kind === RegistryConditionKind.TEXT
			? "text_with_values"
			: "boolean_with_values",
	);
}

export const registryConditionSchema = z
	.strictObject({
		/** Display label for this condition. */
		label: nonEmptyString,
		/** Optional longer description shown in the CLI. */
		description: optionalNonEmptyString(),
		/** Type of condition to prompt for. */
		kind: z.enum(RegistryConditionKind),
		/** When true, allow skipping the condition value. */
		optional: z.boolean().optional(),
		/** Prompt this condition only when the current context matches. */
		when: registryWhenSchema,
		/** Minimum number of selected values required for multiselect conditions. */
		min: z.number().int().min(1).optional(),
		/** Default prompt value when no infer handler is declared. */
		default: nonEmptyString.optional(),
		/** Handler path: authoring-relative, or compiled `r/_handlers/{key}.handler.js` / `r/_handlers/items/{itemId}/{key}.handler.js` URI. */
		handler: registryScriptPathSchema.optional(),
		/** Allowed labelled values for select and multiselect conditions. */
		values: z.array(registryConditionValueSchema).min(1).optional(),
	})
	.superRefine((data, context) => {
		const { kind, requiresValues } = policyForConditionKind(data.kind);
		if (rejectInvalidConditionMin(data, kind, context)) return;
		if (requiresValues) {
			rejectInvalidSelectableCondition(data, kind, context);
			return;
		}
		rejectInvalidNonSelectableCondition(data, kind, context);
	})
	.transform((condition) =>
		omitUndefined({
			label: condition.label,
			kind: condition.kind,
			handler: condition.handler,
			default: condition.default,
			values: condition.values,
			description: condition.description,
			when: condition.when,
			min: condition.min,
			optional: condition.optional === true ? true : undefined,
		}),
	);
export type RegistryCondition = z.infer<typeof registryConditionSchema>;

/**
 * Throw when any option `bindings` key equals its parent condition key.
 * @param conditions - Parsed condition map keyed by condition name.
 * @throws Error when a binding reuses the condition key.
 */
export function assertConditionMapBindingKeys(
	conditions: Record<string, RegistryCondition> | undefined,
): void {
	if (!conditions) return;
	for (const [key, condition] of Object.entries(conditions)) {
		for (const entry of condition.values ?? []) {
			if (!entry.bindings || !Object.hasOwn(entry.bindings, key)) continue;
			throw new Error(
				`Registry condition "${key}" value "${entry.value}" cannot declare bindings.${key} (collides with the condition key).`,
			);
		}
	}
}

/**
 * Reject option `bindings` keys that collide with the parent condition key.
 * @param conditions - Parsed condition map keyed by condition name.
 * @param context - Zod refinement context.
 */
function rejectBindingParentKeyCollisions(
	conditions: Record<string, RegistryCondition>,
	context: z.RefinementCtx,
): void {
	for (const [key, condition] of Object.entries(conditions)) {
		for (const [index, entry] of (condition.values ?? []).entries()) {
			if (!entry.bindings || !Object.hasOwn(entry.bindings, key)) continue;
			context.addIssue({
				code: "custom",
				message: `binding_parent_key:${key}`,
				path: [key, "values", index, "bindings", key],
			});
		}
	}
}

/** Optional condition map that collapses absent or empty records to `undefined`. */
const optionalConditionMap = z
	.record(z.string(), registryConditionSchema)
	.superRefine((conditions, context) => {
		rejectBindingParentKeyCollisions(conditions, context);
	})
	.optional()
	.transform((value) =>
		value && Object.keys(value).length > 0 ? value : undefined,
	);

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
 * Reject duplicate pack ids on an authored or index item.
 * @param packs - Pack list that may contain duplicate ids.
 * @param context - Zod refinement context.
 */
function rejectDuplicatePackIds(
	packs: Array<{ id: string }> | undefined,
	context: z.RefinementCtx,
): void {
	const seenPackIds = new Set<string>();
	for (const pack of packs ?? []) {
		if (seenPackIds.has(pack.id)) {
			context.addIssue({
				code: "custom",
				message: `duplicate_pack:${pack.id}`,
			});
			return;
		}
		seenPackIds.add(pack.id);
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
 * Reject duplicate scripts and dependency ids on an item or pack.
 * @param item - Parsed item or pack candidate.
 * @param context - Zod refinement context.
 */
function rejectInstallPhaseConflicts(
	item: {
		dependsOn?: string[];
		prepare?: string[];
		finalize?: string[];
	},
	context: z.RefinementCtx,
): void {
	rejectDuplicateListEntries(item.prepare, "prepare", context);
	rejectDuplicateListEntries(item.finalize, "finalize", context);
	rejectDuplicateListEntries(item.dependsOn, "dependsOn", context);
}

/** Shared fields for authored and index packs. */
const packSharedFields = {
	/** Unique pack id within the item. */
	id: safePathSegment,
	/** Display title. */
	title: nonEmptyString,
	/** Condition matcher that includes this pack when it matches. */
	when: registryWhenSchema,
	/** Other registry items this pack depends on. */
	dependsOn: optionalNonEmptyStringArray(),
	/** Colocated scripts that mutate the install plan before files are written. */
	prepare: optionalInstallPhaseList(),
	/** Colocated scripts that run side effects after files and packages are applied. */
	finalize: optionalInstallPhaseList(),
};

/** Pack from an raw `registry-item.json`. */
export const registryPackSchema = z
	.strictObject({
		...packSharedFields,
		/** Files copied when this pack is included. */
		files: z.array(registryFileSchema).min(1).optional(),
		/** Ecosystem packages added with this pack, keyed by ecosystem. */
		dependencies: registryEcosystemDependenciesSchema.optional(),
		/** Ecosystem commands added with this pack, keyed by ecosystem. */
		commands: registryEcosystemCommandsSchema.optional(),
		/** Repository secret names to remind about after install (never prompted). */
		secrets: optionalNonEmptyStringArray(),
	})
	.superRefine((pack, context) => {
		rejectInstallPhaseConflicts(pack, context);
	})
	.transform(omitUndefined);
export type RawRegistryPack = z.infer<typeof registryPackSchema>;

/** Pack index entry in compiled `registry.json`. */
export const indexPackSchema = z
	.strictObject({
		...packSharedFields,
		/** Compiled item URI joined against the index location. */
		source: nonEmptyString,
	})
	.superRefine((pack, context) => {
		rejectInstallPhaseConflicts(pack, context);
	})
	.transform(omitUndefined);
export type IndexPack = z.infer<typeof indexPackSchema>;

/** Optional packs list that collapses empty arrays to undefined. */
const optionalPacks = <T extends z.ZodType>(packSchema: T) =>
	z
		.array(packSchema)
		.optional()
		.transform((value) => (value && value.length > 0 ? value : undefined));

/** Shared fields for authored and index items (excluding id / install source). */
const itemSharedFields = {
	/** Display title. */
	title: nonEmptyString,
	/** Short description of the item. */
	description: nonEmptyString,
	/** Item type key declared in `types`. */
	type: nonEmptyString,
	/** Shared condition keys this item consumes. */
	requires: optionalNonEmptyStringArray(),
	/** Local conditions used by this item only. */
	conditions: optionalConditionMap,
	/** Other registry items this item depends on. */
	dependsOn: optionalNonEmptyStringArray(),
	/** Colocated scripts that mutate the install plan before files are written. */
	prepare: optionalInstallPhaseList(),
	/** Colocated scripts that run side effects after files and packages are applied. */
	finalize: optionalInstallPhaseList(),
};

/**
 * Whether a list field is present and non-empty.
 * @param value - Optional array field from a parsed item.
 * @returns True when the array has at least one entry.
 */
function hasEntries(value: readonly unknown[] | undefined): boolean {
	return Array.isArray(value) && value.length > 0;
}

/**
 * Whether an item declares at least one install-phase script.
 * @param item - Parsed item candidate.
 * @returns True when prepare or finalize is non-empty.
 */
function hasInstallPhaseScripts(item: {
	prepare?: string[];
	finalize?: string[];
}): boolean {
	return hasEntries(item.prepare) || hasEntries(item.finalize);
}

/**
 * Raw-item refinements: require files, scripts, or packs, and unique pack ids.
 * @param item - Parsed raw item candidate.
 * @param context - Zod refinement context.
 */
function refineRawRegistryItem(
	item: {
		packs?: Array<{ id: string }>;
		prepare?: string[];
		finalize?: string[];
		files?: unknown[];
		requires?: string[];
		conditions?: Record<string, unknown>;
	},
	context: z.RefinementCtx,
): void {
	if (
		!hasEntries(item.packs) &&
		!hasEntries(item.files) &&
		!hasInstallPhaseScripts(item)
	) {
		context.addIssue({
			code: "custom",
			message: "missing_files_or_packs",
		});
		return;
	}

	rejectDuplicatePackIds(item.packs, context);
	rejectRequiresAndLocalConditionOverlap(item, context);
}

/**
 * Index-item refinements: require source, scripts, or packs.
 * @param item - Parsed index item candidate.
 * @param context - Zod refinement context.
 */
function refineIndexItem(
	item: {
		packs?: Array<{ id: string }>;
		prepare?: string[];
		finalize?: string[];
		source?: string;
		requires?: string[];
		conditions?: Record<string, unknown>;
	},
	context: z.RefinementCtx,
): void {
	if (
		!hasEntries(item.packs) &&
		!item.source &&
		!hasInstallPhaseScripts(item)
	) {
		context.addIssue({
			code: "custom",
			message: "missing_source_or_packs",
		});
		return;
	}

	rejectDuplicatePackIds(item.packs, context);
	rejectRequiresAndLocalConditionOverlap(item, context);
}

/**
 * Fail when the same key appears in both `requires` (shared) and item-level `conditions`.
 * @param item - Item with optional requires and local conditions.
 * @param context - Zod refinement context.
 */
function rejectRequiresAndLocalConditionOverlap(
	item: { requires?: string[]; conditions?: Record<string, unknown> },
	context: z.RefinementCtx,
): void {
	if (!item.conditions) return;
	for (const key of item.requires ?? []) {
		if (Object.hasOwn(item.conditions, key))
			context.addIssue({
				code: "custom",
				message: `requires_and_local:${key}`,
			});
	}
}

/** Item from an raw `registry-item.json`. */
export const registryItemSchema = z
	.strictObject({
		...itemSharedFields,
		/** Unique item id. */
		id: safePathSegment,
		/** Install files for a pack-less item, or files shared by every pack. */
		files: z.array(registryFileSchema).min(1).optional(),
		/** Ecosystem packages added with this item, keyed by ecosystem. */
		dependencies: registryEcosystemDependenciesSchema.optional(),
		/** Ecosystem commands added with this item, keyed by ecosystem. */
		commands: registryEcosystemCommandsSchema.optional(),
		/** Repository secret names to remind about after install (never prompted). */
		secrets: optionalNonEmptyStringArray(),
		/** Optional included packs for conditional subsets of this item. */
		packs: optionalPacks(registryPackSchema),
	})
	.superRefine((item, context) => {
		refineRawRegistryItem(item, context);
		rejectInstallPhaseConflicts(item, context);
	})
	.transform(omitUndefined);
export type RawRegistryItem = z.infer<typeof registryItemSchema>;

/** Item index entry in compiled `registry.json`. Identity is the `items` map key. */
export const indexItemSchema = z
	.strictObject({
		...itemSharedFields,
		/** Compiled item URI for item-level files, joined against the index location. */
		source: nonEmptyString.optional(),
		/** Optional included packs compiled as additional payloads. */
		packs: optionalPacks(indexPackSchema),
	})
	.superRefine((item, context) => {
		refineIndexItem(item, context);
		rejectInstallPhaseConflicts(item, context);
	})
	.transform(omitUndefined);
export type IndexItem = z.infer<typeof indexItemSchema>;

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
	/** sha256 integrity digests for compiled script URIs (`sha256-<base64>`). */
	scriptIntegrity: z.record(z.string(), z.string()).optional(),
	/** sha256 integrity digests for compiled item `source` URIs (`sha256-<base64>`). */
	itemIntegrity: z.record(z.string(), z.string()).optional(),
});

/** Fully parsed index document written to registry.json. */
export interface Registry {
	/** Shared condition definitions keyed by condition key. */
	conditions?: Record<string, RegistryCondition>;
	/** Item type display metadata keyed by type value. */
	types: Record<string, RegistryItemTypeDefinition>;
	/** Registry items keyed by id. */
	items: Record<string, IndexItem>;
	/** sha256 integrity digests for compiled script URIs (`sha256-<base64>`). */
	scriptIntegrity?: Record<string, string>;
	/** sha256 integrity digests for compiled item `source` URIs (`sha256-<base64>`). */
	itemIntegrity?: Record<string, string>;
}
