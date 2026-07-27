/** Registry item types */
export enum RegistryItemType {
	TEMPLATE = "template",
	COMPONENT = "component",
	THEME = "theme",
	CONVENTION = "convention",
	AGENT_INSTRUCTION = "agent-instruction",
	AGENT_SKILL = "agent-skill",
	SUBAGENT = "subagent",
}

/** Schema version supported by this build of `@tuckshop/core`. */
export const SCHEMA_VERSION = 1;

/** Registry items may use built-in types or custom author-defined strings. */
export type RegistryItemTypeValue = RegistryItemType | (string & {});

/** Supported condition inference modes. */
export enum RegistryConditionInference {
	FILES = "files",
}

/** Built registry file metadata (content fetched at install time). */
export type RegistryFile = {
	source: string;
	target: string;
};

/** A labelled value for a shared condition. */
export type RegistryConditionValue = {
	value: string;
	label: string;
	files?: string[];
};

/** Shared condition definition in the registry. */
export type RegistryCondition = {
	label: string;
	description?: string;
	inference?: RegistryConditionInference;
	values: RegistryConditionValue[];
};

/** A runtime context of condition key-value pairs. */
export type RegistryContext = Record<string, string | undefined>;

/** Built registry variant (installable slice). */
export type RegistryVariant = {
	id: string;
	title: string;
	description: string;
	files: RegistryFile[];
	when?: Record<string, string>;
	dependencies?: string[];
	devDependencies?: string[];
	registryDependencies?: Array<string | { name: string }>;
};

/** The built registry document written to registry.json. */
export type Registry = {
	/** Version of the registry content package that produced this document. */
	version: string;
	/** Schema version used to validate and interpret the document. */
	schemaVersion: number;
	/** Base URL for fetching file content (`${contentBaseUrl}/${source}`). */
	contentBaseUrl: string;
	/** Shared condition definitions keyed by condition key. */
	conditions?: Record<string, RegistryCondition>;
	/** Registry items keyed by id. */
	items: Record<string, RegistryItem>;
};

/** Registry item metadata from registry.json. */
export type RegistryItem = {
	id: string;
	title: string;
	description: string;
	type: RegistryItemTypeValue;
	files?: RegistryFile[];
	dependencies?: string[];
	devDependencies?: string[];
	variants: RegistryVariant[];
	registryDependencies?: Array<string | { name: string }>;
};

/**
 * Collect the unique item types declared across a registry.
 * @param registry - Loaded registry document.
 * @returns Sorted unique type values.
 */
export function getRegistryItemTypes(registry: Registry): string[] {
	const types = new Set<string>();
	for (const item of Object.values(registry.items)) types.add(item.type);
	return Array.from(types).sort((a, b) => a.localeCompare(b));
}

/**
 * Check whether a variant applies under the given runtime context.
 * A variant with no `when` always matches. Otherwise every listed key must equal
 * the corresponding context value (a missing context value fails the match).
 * @param variant - Variant to test.
 * @param context - Runtime resolved condition values.
 * @returns True when the variant applies.
 */
export function variantMatchesContext(
	variant: RegistryVariant,
	context: RegistryContext,
): boolean {
	if (!variant.when) return true;

	for (const [key, expected] of Object.entries(variant.when)) {
		if (context[key] !== expected) return false;
	}
	return true;
}

/**
 * Select the best-matching variant for an item under a runtime context.
 * Prefers the most specific matching variant (most `when` keys). Falls back to
 * the first unconditional variant (no `when`) when nothing matches. When
 * `pinnedVariantId` is set, returns that variant if present (regardless of
 * `when`) or throws.
 * @param item - Registry item whose variants are considered.
 * @param context - Runtime resolved condition values.
 * @param pinnedVariantId - Optional explicit variant id (from `id@variant`).
 * @returns The selected variant.
 * @throws Error when the item has no variants, the pinned id is missing, or no variant matches and no unconditional fallback exists.
 */
export function selectRegistryVariant(
	item: RegistryItem,
	context: RegistryContext,
	pinnedVariantId?: string,
): RegistryVariant {
	if (item.variants.length === 0)
		throw new Error(`Registry item "${item.id}" has no variants.`);

	if (pinnedVariantId !== undefined) {
		const pinned = item.variants.find((v) => v.id === pinnedVariantId);
		if (!pinned)
			throw new Error(
				`Registry item "${item.id}" has no variant "${pinnedVariantId}".`,
			);
		return pinned;
	}

	const matching = item.variants.filter((v) =>
		variantMatchesContext(v, context),
	);

	if (matching.length > 0) {
		matching.sort(
			(a, b) =>
				Object.keys(b.when ?? {}).length - Object.keys(a.when ?? {}).length,
		);
		return matching[0];
	}

	const fallback = item.variants.find((v) => !v.when);
	if (fallback) return fallback;

	throw new Error(
		`Registry item "${item.id}" has no variant matching the current context and no unconditional fallback.`,
	);
}

/**
 * Collect the union of `when` keys used across the given items' variants.
 * @param items - Registry items to scan.
 * @returns Sorted unique condition keys.
 */
export function collectConditionKeys(items: RegistryItem[]): string[] {
	const keys = new Set<string>();
	for (const item of items)
		for (const variant of item.variants)
			if (variant.when)
				for (const key of Object.keys(variant.when)) keys.add(key);

	return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

/**
 * Collect the distinct values a condition key takes across the given items' variants.
 * @param items - Registry items to scan.
 * @param key - Condition key whose values to collect.
 * @returns Sorted unique values for the key.
 */
export function collectConditionValues(
	items: RegistryItem[],
	key: string,
): string[] {
	const values = new Set<string>();
	for (const item of items)
		for (const variant of item.variants) {
			const value = variant.when?.[key];
			if (value !== undefined) values.add(value);
		}

	return Array.from(values).sort((a, b) => a.localeCompare(b));
}

/** Parsed dependency reference (`button` or `button@react`). */
export type RegistryDependencyRef = {
	id: string;
	variantId?: string;
};

/** A registry item with a concrete variant selected for install. */
export type ResolvedRegistryItem = {
	item: RegistryItem;
	variant: RegistryVariant;
	/** Merged item-level shared files followed by variant files. */
	files: RegistryFile[];
};

/** Flat install plan produced by resolving a root item and its graph. */
export type ResolvedRegistryPlan = {
	items: ResolvedRegistryItem[];
	dependencies: string[];
	devDependencies: string[];
};

/** Registry index keyed by item id. */
export type RegistryIndex = Map<string, RegistryItem>;

/**
 * A condition the CLI still needs to resolve before install can proceed.
 * Options are the intersection of declared condition values and values present
 * across the plan's variants, so prompts never offer uninstallable choices.
 */
export type RequiredCondition = {
	key: string;
	label: string;
	description?: string;
	values: RegistryConditionValue[];
};

/**
 * Parse a dependency reference string into item id and optional variant pin.
 * @param ref - `id` or `id@variantId`.
 * @returns Parsed dependency reference.
 * @throws Error when the reference is empty or malformed.
 */
export function parseRegistryDependencyRef(ref: string): RegistryDependencyRef {
	if (ref.length === 0)
		throw new Error("Registry dependency reference must be non-empty.");

	const separatorIndex = ref.indexOf("@");
	if (separatorIndex === -1) return { id: ref };
	if (separatorIndex === 0 || separatorIndex === ref.length - 1)
		throw new Error(
			`Invalid registry dependency reference "${ref}" (expected id or id@variant).`,
		);

	return {
		id: ref.slice(0, separatorIndex),
		variantId: ref.slice(separatorIndex + 1),
	};
}

/**
 * Normalize a registry dependency entry to a ref.
 * @param dependency - Dependency string or object from the manifest.
 * @returns Parsed dependency reference.
 */
function normalizeDependency(
	dependency: string | { name: string },
): RegistryDependencyRef {
	if (typeof dependency === "string")
		return parseRegistryDependencyRef(dependency);
	return parseRegistryDependencyRef(dependency.name);
}

/**
 * Collect item-level and selected-variant registryDependencies.
 * @param item - Registry item.
 * @param variant - Selected variant.
 * @returns Combined dependency list.
 */
function collectItemDependencies(
	item: RegistryItem,
	variant: RegistryVariant,
): Array<string | { name: string }> {
	return [
		...(item.registryDependencies ?? []),
		...(variant.registryDependencies ?? []),
	];
}

/**
 * Resolve a registry item and its dependency graph into a flat install plan.
 * Dependencies are visited depth-first, cycle-checked, and deduplicated by item id.
 * @param rootRef - Root registry item id, optionally `id@variant`.
 * @param index - Registry index keyed by item id.
 * @param context - Install context for variant selection.
 * @returns Resolved plan with ordered items and merged package dependencies.
 * @throws Error when an item is missing, a cycle is detected, or variant selection fails.
 */
export function resolveRegistryPlan(
	rootRef: string,
	index: RegistryIndex,
	context: RegistryContext,
): ResolvedRegistryPlan {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const ordered: ResolvedRegistryItem[] = [];

	const visit = (ref: RegistryDependencyRef): void => {
		const { id, variantId } = ref;
		if (visited.has(id)) return;
		if (visiting.has(id))
			throw new Error(`Registry dependency cycle detected at "${id}".`);

		const item = index.get(id);
		if (!item) throw new Error(`Registry item not found: "${id}".`);

		visiting.add(id);
		const variant = selectRegistryVariant(item, context, variantId);

		for (const dependency of collectItemDependencies(item, variant))
			visit(normalizeDependency(dependency));

		visiting.delete(id);
		visited.add(id);

		ordered.push({
			item,
			variant,
			files: [...(item.files ?? []), ...variant.files],
		});
	};

	visit(parseRegistryDependencyRef(rootRef));

	const dependencies = new Set<string>();
	const devDependencies = new Set<string>();
	for (const { item, variant } of ordered) {
		for (const dep of item.dependencies ?? []) dependencies.add(dep);
		for (const dep of variant.dependencies ?? []) dependencies.add(dep);
		for (const dep of item.devDependencies ?? []) devDependencies.add(dep);
		for (const dep of variant.devDependencies ?? []) devDependencies.add(dep);
	}

	return {
		items: ordered,
		dependencies: Array.from(dependencies).sort((a, b) => a.localeCompare(b)),
		devDependencies: Array.from(devDependencies).sort((a, b) =>
			a.localeCompare(b),
		),
	};
}

/**
 * Collect conditions still unresolved in the context, with prompt-ready options.
 * Options are the intersection of each condition's declared values and the values
 * actually present across the plan items' variants.
 * @param items - Resolved plan items (or any registry items in the install set).
 * @param conditions - Shared condition definitions from the registry.
 * @param context - Already-resolved context values (auto-detected or previously answered).
 * @returns Required conditions the CLI should prompt for, sorted by key.
 * @throws Error when a used when key has no condition definition.
 */
export function collectRequiredConditions(
	items: Array<RegistryItem | ResolvedRegistryItem>,
	conditions: Record<string, RegistryCondition> | undefined,
	context: RegistryContext,
): RequiredCondition[] {
	const registryItems = items.map((entry) =>
		"item" in entry ? entry.item : entry,
	);
	const keys = collectConditionKeys(registryItems);
	const required: RequiredCondition[] = [];

	for (const key of keys) {
		if (context[key] !== undefined) continue;

		const condition = conditions?.[key];
		if (!condition)
			throw new Error(
				`Condition key "${key}" is used by registry items but is not defined in registry conditions.`,
			);

		const present = new Set(collectConditionValues(registryItems, key));
		const values = condition.values.filter((entry) => present.has(entry.value));
		if (values.length === 0) continue;

		const requiredCondition: RequiredCondition = {
			key,
			label: condition.label,
			values,
		};
		if (condition.description)
			requiredCondition.description = condition.description;
		required.push(requiredCondition);
	}

	return required;
}
