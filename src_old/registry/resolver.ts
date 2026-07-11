import type {
	RegistryDependency,
	RegistryDependencyRef,
	RegistryInput,
	RegistryInstallContext,
	RegistryItem,
	RegistryVariant,
} from "./schema";
import {
	evaluateRegistryCondition,
	parseRegistryDependencyRef,
	selectRegistryVariant,
	variantMatchesContext,
} from "./schema";

/** A registry item with a concrete variant selected for install. */
export type ResolvedRegistryItem = {
	item: RegistryItem;
	variant: RegistryVariant;
};

export type ResolvedRegistryPlan = {
	items: ResolvedRegistryItem[];
	dependencies: string[];
	devDependencies: string[];
};

export type RegistryIndex = Map<string, RegistryItem>;

/**
 * Normalize a registry dependency entry to a ref and optional condition.
 * @param dependency - Dependency string or object from manifest.
 * @returns Normalized dependency descriptor with parsed id/@variant.
 */
export function normalizeRegistryDependency(dependency: RegistryDependency): {
	ref: RegistryDependencyRef;
	when?: string;
} {
	if (typeof dependency === "string")
		return { ref: parseRegistryDependencyRef(dependency) };
	return {
		ref: parseRegistryDependencyRef(dependency.name),
		when: dependency.when,
	};
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
): RegistryDependency[] {
	return [
		...(item.registryDependencies ?? []),
		...(variant.registryDependencies ?? []),
	];
}

/**
 * Resolve a registry item and its dependency graph into a flat install plan.
 * Dependencies are deduplicated by item id; later items override earlier file targets.
 * @param rootRef - Root registry item id, optionally `id@variant`.
 * @param index - Registry index keyed by item id.
 * @param context - Install context for conditional edges and variant selection.
 * @returns Resolved plan with ordered items and merged package dependencies.
 * @throws Error when an item is missing, a cycle is detected, or variant selection fails.
 */
export function resolveRegistryPlan(
	rootRef: string,
	index: RegistryIndex,
	context: RegistryInstallContext,
): ResolvedRegistryPlan {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const ordered: ResolvedRegistryItem[] = [];
	const seenItems = new Set<string>();

	const visit = (ref: RegistryDependencyRef): void => {
		const { id, variantId } = ref;
		if (visited.has(id)) return;
		if (visiting.has(id))
			throw new Error(`Registry dependency cycle detected at "${id}".`);

		const item = index.get(id);
		if (!item) throw new Error(`Registry item not found: "${id}".`);

		visiting.add(id);
		const variant = selectRegistryVariant(item, variantId, context);

		for (const dependency of collectItemDependencies(item, variant)) {
			const normalized = normalizeRegistryDependency(dependency);
			if (!evaluateRegistryCondition(normalized.when, context)) continue;
			visit(normalized.ref);
		}

		visiting.delete(id);
		visited.add(id);

		if (!seenItems.has(id)) {
			ordered.push({ item, variant });
			seenItems.add(id);
		}
	};

	visit(parseRegistryDependencyRef(rootRef));

	const dependencies = new Set<string>();
	const devDependencies = new Set<string>();

	for (const { variant } of ordered) {
		for (const dep of variant.dependencies ?? []) dependencies.add(dep);
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
 * Collect the declared inputs across a set of resolved items, deduplicated by
 * name (first occurrence wins) and preserving install order.
 * @param items - Resolved registry items in install order.
 * @returns Deduplicated input declarations.
 */
export function collectRegistryInputs(
	items: ResolvedRegistryItem[],
): RegistryInput[] {
	const seen = new Set<string>();
	const inputs: RegistryInput[] = [];

	for (const { item } of items) {
		for (const input of item.inputs ?? []) {
			if (seen.has(input.name)) continue;
			seen.add(input.name);
			inputs.push(input);
		}
	}

	return inputs;
}

/** Filterable metadata fields derived from registry items / variants. */
export const REGISTRY_FACET_KEYS = [
	"type",
	"language",
	"framework",
	"tool",
	"ecosystem",
	"tag",
	"projectSpec",
] as const;

export type RegistryFacetKey = (typeof REGISTRY_FACET_KEYS)[number];

/** Unique values present in the registry for each filterable field. */
export type RegistryFacets = Record<RegistryFacetKey, string[]>;

/**
 * Filters accepted by `listRegistryItems`.
 * `type` / `tag` may be a single value or an array (match any).
 */
export type RegistryItemFilters = {
	type?: string | string[];
	tag?: string | string[];
	language?: string;
	framework?: string;
	tool?: string;
	ecosystem?: string;
	projectSpec?: string;
};

/**
 * Collect unique filter values present in the registry for each facet.
 * @param index - Registry index keyed by item id.
 * @returns Sorted unique values per facet.
 */
export function collectRegistryFacets(index: RegistryIndex): RegistryFacets {
	const buckets: Record<RegistryFacetKey, Set<string>> = {
		type: new Set(),
		language: new Set(),
		framework: new Set(),
		tool: new Set(),
		ecosystem: new Set(),
		tag: new Set(),
		projectSpec: new Set(),
	};

	for (const item of index.values()) {
		buckets.type.add(item.type);
		if (item.projectSpec) buckets.projectSpec.add(item.projectSpec);
		for (const tag of item.tags ?? []) buckets.tag.add(tag);
		for (const variant of item.variants) {
			if (variant.targets?.language)
				buckets.language.add(variant.targets.language);
			if (variant.targets?.framework)
				buckets.framework.add(variant.targets.framework);
			if (variant.targets?.tool) buckets.tool.add(variant.targets.tool);
			if (variant.targets?.ecosystem)
				buckets.ecosystem.add(variant.targets.ecosystem);
		}
	}

	const facets = {} as RegistryFacets;
	for (const key of REGISTRY_FACET_KEYS) {
		facets[key] = Array.from(buckets[key]).sort((a, b) => a.localeCompare(b));
	}
	return facets;
}

/**
 * Convert a facet key to a kebab-case CLI flag segment.
 * @param key - Registry facet key.
 * @returns Kebab-case flag segment (e.g. `projectSpec` → `project-spec`).
 */
export function registryFacetToKebab(key: RegistryFacetKey): string {
	return key.replaceAll(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/**
 * Map a kebab-case CLI flag segment back to a facet key.
 * @param kebab - Kebab-case segment (e.g. `project-spec`).
 * @returns Matching facet key, or undefined when unknown.
 */
export function registryFacetFromKebab(
	kebab: string,
): RegistryFacetKey | undefined {
	return REGISTRY_FACET_KEYS.find((key) => registryFacetToKebab(key) === kebab);
}

/**
 * Whether an item matches optional list filters.
 * Target filters match when any variant is compatible (agnostic variants match).
 * @param item - Registry item.
 * @param filters - Optional facet filters.
 * @returns True when the item matches.
 */
function itemMatchesFilters(
	item: RegistryItem,
	filters: RegistryItemFilters,
): boolean {
	if (filters.type) {
		const expected = filters.type;
		if (Array.isArray(expected)) {
			if (!expected.includes(item.type)) return false;
		} else if (item.type !== expected) return false;
	}

	if (filters.tag) {
		const tags = item.tags ?? [];
		const expected = filters.tag;
		if (Array.isArray(expected)) {
			if (!expected.some((tag) => tags.includes(tag))) return false;
		} else if (!tags.includes(expected)) return false;
	}

	if (filters.projectSpec && item.projectSpec !== filters.projectSpec)
		return false;

	const targetContext: RegistryInstallContext = {
		public: true,
		includeInstructions: true,
		framework: filters.framework,
		lang: filters.language,
		tool: filters.tool,
		ecosystem: filters.ecosystem,
	};

	if (
		filters.language ||
		filters.framework ||
		filters.tool ||
		filters.ecosystem
	) {
		const anyMatch = item.variants.some((variant) =>
			variantMatchesContext(variant.targets, targetContext),
		);
		if (!anyMatch) return false;
	}

	return true;
}

/**
 * List registry items matching optional filters.
 * @param index - Registry index keyed by item id.
 * @param filters - Optional facet filters.
 * @returns Sorted array of matching item ids.
 */
export function listRegistryItems(
	index: RegistryIndex,
	filters: RegistryItemFilters = {},
): string[] {
	const ids: string[] = [];

	for (const [id, item] of index) {
		if (itemMatchesFilters(item, filters)) ids.push(id);
	}

	return ids.sort((a, b) => a.localeCompare(b));
}
