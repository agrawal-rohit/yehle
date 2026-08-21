import type {
	RegistryCondition,
	RegistryConditionValue,
	RegistryItem,
} from "./schema";

export type { RegistryCondition, RegistryConditionValue };

/** Runtime resolved condition values keyed by condition name. */
export type RegistryContext = Record<string, string | undefined>;

/** Parsed item id, optionally with a pinned variant (`button` or `button@react`). */
export interface ParsedItemId {
	/** Registry item id. */
	id: string;
	/** Optional pinned variant id from `id@variant`. */
	variantId?: string;
}

/** A catalog item with its selected payload source URI. */
export interface ResolvedRegistryItem {
	/** Registry item id (catalog map key). */
	itemId: string;
	/** Selected variant id when the item declares variants. */
	variantId?: string;
	/** Payload URI from the catalog entry, resolved later against the catalog location. */
	source: string;
}

/** Flat install plan produced by resolving selected items and their dependency graph. */
export interface ResolvedRegistryPlan {
	/** Ordered install nodes with one variant per item id. */
	items: ResolvedRegistryItem[];
}

/** Catalog item id paired with its document for graph walks. */
export interface CatalogEntry {
	/** Registry item id. */
	itemId: string;
	/** Catalog item document. */
	item: RegistryItem;
}

/**
 * A condition the CLI still needs to resolve before install can proceed.
 * Options are the intersection of declared condition values and values present
 * across the plan's variants, so prompts never offer uninstallable choices.
 */
export interface RequiredCondition {
	/** Condition key used by variant `when` entries. */
	key: string;
	/** Display label for prompts. */
	label: string;
	/** Optional longer description shown in the CLI. */
	description?: string;
	/** Prompt options limited to values present on the install plan. */
	values: RegistryConditionValue[];
}

/**
 * Check whether a `when` map matches the runtime context.
 * @param when - Condition matcher from a catalog item or variant.
 * @param context - Runtime resolved condition values.
 * @returns True when every `when` key equals the context value.
 */
export function whenMatchesContext(
	when: Record<string, string> | undefined,
	context: RegistryContext,
): boolean {
	if (!when) return true;

	for (const [key, expected] of Object.entries(when)) {
		if (context[key] !== expected) return false;
	}
	return true;
}

/**
 * Select the best-matching variant for a catalog item under a runtime context.
 * @param itemId - Registry item id for error messages.
 * @param item - Catalog item whose variants are considered.
 * @param context - Runtime resolved condition values.
 * @param pinnedVariantId - Optional explicit variant id (from `id@variant`).
 * @returns Selected variant id and payload source URI.
 * @throws Error when selection fails or the item has no installable source.
 */
export function selectRegistryVariant(
	itemId: string,
	item: RegistryItem,
	context: RegistryContext,
	pinnedVariantId?: string,
): { variantId?: string; source: string } {
	const variants = item.variants ?? [];
	const hasVariants = variants.length > 0;

	if (!hasVariants) {
		if (pinnedVariantId !== undefined)
			throw new Error(`Registry item "${itemId}" has no variants.`);
		if (!item.source)
			throw new Error(`Registry item "${itemId}" is missing a payload source.`);
		if (!whenMatchesContext(item.when, context))
			throw new Error(
				`Registry item "${itemId}" does not match the current context.`,
			);
		return { source: item.source };
	}

	if (pinnedVariantId !== undefined) {
		const pinned = variants.find((variant) => variant.id === pinnedVariantId);
		if (!pinned)
			throw new Error(
				`Registry item "${itemId}" has no variant "${pinnedVariantId}".`,
			);
		return { variantId: pinned.id, source: pinned.source };
	}

	const matching = variants.filter((variant) =>
		whenMatchesContext(variant.when, context),
	);

	if (matching.length > 0) {
		matching.sort(
			(a, b) =>
				Object.keys(b.when ?? {}).length - Object.keys(a.when ?? {}).length,
		);
		const selected = matching[0];
		return { variantId: selected.id, source: selected.source };
	}

	const fallback = variants.find((variant) => !variant.when);
	if (fallback) return { variantId: fallback.id, source: fallback.source };

	throw new Error(
		`Registry item "${itemId}" has no variant matching the current context and no unconditional fallback.`,
	);
}

/**
 * Collect distinct `when` values present on catalog entries, keyed by condition name.
 * Used to narrow prompt options to choices that appear on the install set.
 * @param entries - Catalog entries in the install set.
 * @returns Map of condition key → distinct `when` values present on those entries.
 */
function collectPresentWhenValues(
	entries: CatalogEntry[],
): Map<string, Set<string>> {
	const present = new Map<string, Set<string>>();

	const addWhen = (when: Record<string, string> | undefined): void => {
		if (!when) return;
		for (const [key, value] of Object.entries(when)) {
			let values = present.get(key);
			if (!values) {
				values = new Set();
				present.set(key, values);
			}
			values.add(value);
		}
	};

	for (const { item } of entries) {
		addWhen(item.when);
		for (const variant of item.variants ?? []) addWhen(variant.when);
	}

	return present;
}

/**
 * Parse an item id string into an id and optional variant pin.
 * @param value - `id` or `id@variantId`.
 * @returns Parsed item id.
 * @throws Error when the value is empty or malformed.
 */
export function parseItemId(value: string): ParsedItemId {
	if (value.length === 0)
		throw new Error("Registry item id must be non-empty.");

	const separatorIndex = value.indexOf("@");
	if (separatorIndex === -1) return { id: value };
	if (separatorIndex === 0 || separatorIndex === value.length - 1)
		throw new Error(
			`Invalid registry item id "${value}" (expected id or id@variant).`,
		);

	return {
		id: value.slice(0, separatorIndex),
		variantId: value.slice(separatorIndex + 1),
	};
}

/**
 * Collect item-level and selected-variant registryDependencies.
 * @param item - Catalog item.
 * @param variantId - Selected variant id when variants exist.
 * @returns Combined dependency list.
 */
function collectItemDependencies(
	item: RegistryItem,
	variantId?: string,
): string[] {
	const variant = item.variants?.find((entry) => entry.id === variantId);
	return [
		...(item.registryDependencies ?? []),
		...(variant?.registryDependencies ?? []),
	];
}

/**
 * Collect every dependency id referenced by an item or any of its variants.
 * @param item - Catalog item to scan.
 * @returns Unique dependency item ids.
 */
function collectAllDependencyIds(item: RegistryItem): string[] {
	const dependencyIds = new Set<string>();
	for (const dependency of item.registryDependencies ?? [])
		dependencyIds.add(parseItemId(dependency).id);
	for (const variant of item.variants ?? []) {
		for (const dependency of variant.registryDependencies ?? [])
			dependencyIds.add(parseItemId(dependency).id);
	}
	return [...dependencyIds];
}

/**
 * Collect selected items and every transitive `registryDependencies` entry.
 * Variant `when` is ignored so condition prompts cover the full dependency graph.
 * @param items - Selected items (`id` or `id@variant`).
 * @param catalogItems - Catalog items keyed by id.
 * @returns Unique catalog entries in discovery order (selected items first).
 * @throws Error when a listed item is missing from the catalog.
 */
export function collectRegistryDependencies(
	items: string[],
	catalogItems: Record<string, RegistryItem>,
): CatalogEntry[] {
	const visited = new Set<string>();
	const ordered: CatalogEntry[] = [];

	const visit = (itemId: string): void => {
		if (visited.has(itemId)) return;
		const item = catalogItems[itemId];
		if (!item) throw new Error(`Registry item not found: "${itemId}".`);

		visited.add(itemId);
		ordered.push({ itemId, item });
		for (const dependencyId of collectAllDependencyIds(item))
			visit(dependencyId);
	};

	for (const item of items) visit(parseItemId(item).id);

	return ordered;
}

/**
 * Resolve selected items and their transitive registryDependencies into one ordered install plan.
 * Walks the dependency graph once from every selection, so shared dependencies are visited only once.
 * @param items - Selected registry items (`id` or `id@variant`).
 * @param catalogItems - Catalog items keyed by id.
 * @param context - Install context for variant selection.
 * @returns Ordered install nodes with one variant per item id.
 * @throws Error when an item is missing, a cycle is detected, or variants conflict across selections.
 */
export function resolveInstallPlan(
	items: string[],
	catalogItems: Record<string, RegistryItem>,
	context: RegistryContext,
): ResolvedRegistryPlan {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const selectedVariants = new Map<string, string | undefined>();
	const ordered: ResolvedRegistryItem[] = [];

	const visit = (parsed: ParsedItemId): void => {
		const { id, variantId: pinnedVariantId } = parsed;

		if (visited.has(id)) {
			if (
				pinnedVariantId !== undefined &&
				selectedVariants.get(id) !== pinnedVariantId
			)
				throw new Error(
					`Registry item "${id}" resolved to conflicting variants.`,
				);
			return;
		}
		if (visiting.has(id))
			throw new Error(`Registry dependency cycle detected at "${id}".`);

		const catalogItem = catalogItems[id];
		if (!catalogItem) throw new Error(`Registry item not found: "${id}".`);

		visiting.add(id);
		const selection = selectRegistryVariant(
			id,
			catalogItem,
			context,
			pinnedVariantId,
		);

		for (const dependency of collectItemDependencies(
			catalogItem,
			selection.variantId,
		))
			visit(parseItemId(dependency));

		visiting.delete(id);
		visited.add(id);
		selectedVariants.set(id, selection.variantId);
		ordered.push({
			itemId: id,
			...(selection.variantId ? { variantId: selection.variantId } : {}),
			source: selection.source,
		});
	};

	for (const item of items) visit(parseItemId(item));

	return { items: ordered };
}

/**
 * Collect conditions still unresolved in the context, with prompt-ready options.
 * @param entries - Catalog entries in the install set.
 * @param conditions - Shared condition definitions from the registry.
 * @param context - Already-resolved context values.
 * @returns Required conditions the CLI should prompt for, sorted by key.
 */
export function collectRequiredConditions(
	entries: CatalogEntry[],
	conditions: Record<string, RegistryCondition> | undefined,
	context: RegistryContext,
): RequiredCondition[] {
	const presentWhenValues = collectPresentWhenValues(entries);
	const required: RequiredCondition[] = [];

	for (const key of presentWhenValues.keys()) {
		if (context[key] !== undefined) continue;

		const condition = conditions?.[key];
		const present = presentWhenValues.get(key);
		if (!condition || !present) continue;

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

/**
 * Seed context from selected items: pinned variant `when`, or item-level `when` when there are no variants.
 * @param items - Selected items (`id` or `id@variant`).
 * @param catalogItems - Catalog items keyed by id.
 * @returns Partial context derived from selected item or variant conditions.
 */
export function assumeContextFromSelectedItems(
	items: string[],
	catalogItems: Record<string, RegistryItem>,
): RegistryContext {
	const context: RegistryContext = {};
	for (const item of items) {
		const { id, variantId } = parseItemId(item);
		const catalogItem = catalogItems[id];
		if (!catalogItem) continue;

		// Pinned variants contribute their `when`; variant-less items contribute item-level `when`.
		let when: Record<string, string> | undefined;
		if (variantId !== undefined)
			when = catalogItem.variants?.find(
				(entry) => entry.id === variantId,
			)?.when;
		else if (!catalogItem.variants) when = catalogItem.when;
		if (!when) continue;

		for (const [key, value] of Object.entries(when)) context[key] = value;
	}

	return context;
}
