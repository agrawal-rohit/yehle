import {
	policyForConditionKind,
	RegistryConditionKind,
	type RegistryContext,
	type RegistryContextValue,
} from "./condition-kind";
import {
	type CatalogItem,
	type CatalogVariant,
	InstallPhase,
	type RegistryCondition,
	type RegistryConditionValue,
} from "./schema";

/**
 * Check whether a captured context value satisfies a `when` expectation.
 * @param actual - Captured context value for the condition key.
 * @param expected - Value from the item/variant `when` map.
 * @returns True when the expectation is satisfied.
 */
function contextValueMatchesWhen(
	actual: RegistryContextValue | undefined,
	expected: string,
): boolean {
	if (actual === undefined) return false;
	if (Array.isArray(actual)) return actual.includes(expected);
	if (typeof actual === "boolean") return actual === (expected === "true");
	return actual === expected;
}

/** Parsed item id, optionally with a pinned variant (`button` or `button@react`). */
export interface ParsedItemId {
	/** Registry item id. */
	id: string;
	/** Optional pinned variant id from `id@variant`. */
	variantId?: string;
}

/** A catalog item with its selected payload source URI. */
export interface InstallNode {
	/** Registry item id (catalog map key). */
	itemId: string;
	/** Selected variant id when the item declares variants. */
	variantId?: string;
	/** Payload URI from the catalog entry, joined against the catalog location when fetched. */
	source?: string;
	/** Compiled `beforeInstall` script URIs for this item. */
	beforeInstallScripts?: string[];
	/** Compiled `afterInstall` script URIs for this item. */
	afterInstallScripts?: string[];
}

/** Result of selecting an installable source (and optional variant) for one catalog item. */
export type RegistryItemSelection = Omit<InstallNode, "itemId">;

/** Catalog item id paired with its document for graph walks. */
export interface CatalogEntry {
	/** Registry item id. */
	itemId: string;
	/** Catalog item document. */
	item: CatalogItem;
}

/**
 * A condition the CLI still needs to capture before install can proceed.
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
	/** Prompt kind; defaults to select. */
	kind: RegistryConditionKind;
	/** Prompt options limited to values present on the install plan (select only). */
	values: RegistryConditionValue[];
	/** Compiled condition handler URI when the catalog declares one. */
	handler?: string;
}

/**
 * Check whether a `when` map matches the runtime context.
 * @param when - Condition matcher from a catalog item or variant.
 * @param context - Condition values already captured for this install.
 * @returns True when every `when` key equals the context value.
 */
export function whenMatchesContext(
	when: Record<string, string> | undefined,
	context: RegistryContext,
): boolean {
	if (!when) return true;

	for (const [key, expected] of Object.entries(when)) {
		if (!contextValueMatchesWhen(context[key], expected)) return false;
	}
	return true;
}

/** Item list fields merged from item-level and selected-variant declarations. */
type ItemListField = InstallPhase | "registryDependencies";

/**
 * Collect item-level and selected-variant values for one list field.
 * @param item - Catalog or authored item with optional variants.
 * @param variantId - Selected variant id when variants exist.
 * @param field - List field to read (`beforeInstall`, `afterInstall`, or `registryDependencies`).
 * @returns Combined entry list.
 */
function collectItemField<K extends ItemListField>(
	item: Pick<CatalogItem, K | "variants">,
	variantId: string | undefined,
	field: K,
): string[] {
	const variant = item.variants?.find((entry) => entry.id === variantId);
	// Item-level entries apply to every variant; variant lists add on top.
	return [...(item[field] ?? []), ...(variant?.[field] ?? [])];
}

/**
 * Attach compiled install script URIs to a selection result when present.
 * @param item - Catalog item that may declare lifecycle scripts.
 * @param selection - Selected variant id and/or payload source.
 * @param variantId - Selected variant id used to collect phase entries.
 * @returns Selection including script URIs when declared.
 */
function withItemScripts(
	item: CatalogItem,
	selection: { variantId?: string; source?: string },
	variantId?: string,
): RegistryItemSelection {
	const selectedVariantId = variantId ?? selection.variantId;
	const beforeInstall = collectItemField(
		item,
		selectedVariantId,
		InstallPhase.BeforeInstall,
	);
	const afterInstall = collectItemField(
		item,
		selectedVariantId,
		InstallPhase.AfterInstall,
	);
	return {
		...selection,
		...(beforeInstall.length > 0
			? { beforeInstallScripts: beforeInstall }
			: {}),
		...(afterInstall.length > 0 ? { afterInstallScripts: afterInstall } : {}),
	};
}

/**
 * Select install source for a variant-less catalog item.
 * @param itemId - Registry item id for error messages.
 * @param item - Catalog item without variants.
 * @param pinnedVariantId - Must be undefined for variant-less items.
 * @returns Payload source and/or install script URIs.
 * @throws Error when a variant is pinned or the item has no installable source or phase entries.
 */
function selectVariantLessItem(
	itemId: string,
	item: CatalogItem,
	pinnedVariantId?: string,
): RegistryItemSelection {
	if (pinnedVariantId !== undefined)
		throw new Error(`Registry item "${itemId}" has no variants.`);
	const hasInstallPhases =
		collectItemField(item, undefined, InstallPhase.BeforeInstall).length > 0 ||
		collectItemField(item, undefined, InstallPhase.AfterInstall).length > 0;
	// Scripts-only items (no payload source) are still installable.
	if (!item.source && !hasInstallPhases)
		throw new Error(
			`Registry item "${itemId}" is missing a payload source or install phase.`,
		);
	const selection = {
		...(item.source ? { source: item.source } : {}),
	};
	return withItemScripts(item, selection);
}

/**
 * Select an explicitly pinned variant.
 * @param itemId - Registry item id for error messages.
 * @param item - Catalog item whose variant is pinned.
 * @param variants - Item variants.
 * @param pinnedVariantId - Variant id from `id@variant`.
 * @returns Pinned variant selection.
 * @throws Error when the pinned variant id is missing.
 */
function selectPinnedVariant(
	itemId: string,
	item: CatalogItem,
	variants: CatalogVariant[],
	pinnedVariantId: string,
): RegistryItemSelection {
	const pinned = variants.find((variant) => variant.id === pinnedVariantId);
	if (!pinned)
		throw new Error(
			`Registry item "${itemId}" has no variant "${pinnedVariantId}".`,
		);
	return withItemScripts(
		item,
		{
			variantId: pinned.id,
			source: pinned.source,
		},
		pinned.id,
	);
}

/**
 * Select the best context-matching variant, or an unconditional fallback.
 * @param itemId - Registry item id for error messages.
 * @param item - Catalog item whose variant is pinned.
 * @param variants - Item variants.
 * @param context - Condition values already captured for this install.
 * @returns Matching or fallback variant selection.
 * @throws Error when no variant matches and no unconditional fallback exists.
 */
function selectMatchingOrFallbackVariant(
	itemId: string,
	item: CatalogItem,
	variants: CatalogVariant[],
	context: RegistryContext,
): RegistryItemSelection {
	const matching = variants.filter((variant) =>
		whenMatchesContext(variant.when, context),
	);
	if (matching.length === 0)
		throw new Error(
			`Registry item "${itemId}" has no variant matching the current context and no unconditional fallback.`,
		);

	// Prefer the most specific matcher when several variants match.
	matching.sort((a, b) => whenKeyCount(b) - whenKeyCount(a));
	const selected = matching[0];
	return withItemScripts(
		item,
		{
			variantId: selected.id,
			source: selected.source,
		},
		selected.id,
	);
}

/**
 * Count keys on a variant `when` map (missing maps count as zero).
 * @param variant - Variant whose matcher specificity is measured.
 * @returns Number of `when` keys.
 */
function whenKeyCount(variant: CatalogVariant): number {
	return variant.when ? Object.keys(variant.when).length : 0;
}

/**
 * Select the best-matching variant for a catalog item under a runtime context.
 * @param itemId - Registry item id for error messages.
 * @param item - Catalog item whose variants are considered.
 * @param context - Condition values already captured for this install.
 * @param pinnedVariantId - Optional explicit variant id (from `id@variant`).
 * @returns Selected variant id, optional payload source URI, and optional install script URIs.
 * @throws Error when selection fails or the item has no installable source or phase entries.
 */
export function selectRegistryVariant(
	itemId: string,
	item: CatalogItem,
	context: RegistryContext,
	pinnedVariantId?: string,
): RegistryItemSelection {
	const variants = item.variants ?? [];
	if (variants.length === 0)
		return selectVariantLessItem(itemId, item, pinnedVariantId);
	if (pinnedVariantId !== undefined)
		return selectPinnedVariant(itemId, item, variants, pinnedVariantId);
	return selectMatchingOrFallbackVariant(itemId, item, variants, context);
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

	for (const { item } of entries)
		for (const variant of item.variants ?? []) addWhen(variant.when);

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
 * Collect every dependency and hook id referenced by an item or any of its variants.
 * @param item - Catalog item to scan.
 * @returns Unique referenced item ids.
 */
function collectAllReferencedItemIds(item: CatalogItem): string[] {
	const referencedIds = new Set<string>();
	const addDeps = (entries: string[] | undefined): void => {
		for (const entry of entries ?? []) referencedIds.add(parseItemId(entry).id);
	};

	addDeps(item.registryDependencies);
	// Item-level deps are not re-added per variant.
	for (const variant of item.variants ?? [])
		addDeps(variant.registryDependencies);
	return [...referencedIds];
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
	catalogItems: Record<string, CatalogItem>,
): CatalogEntry[] {
	const visited = new Set<string>();
	const ordered: CatalogEntry[] = [];

	const visit = (itemId: string): void => {
		if (visited.has(itemId)) return;
		const item = catalogItems[itemId];
		if (!item) throw new Error(`Registry item not found: "${itemId}".`);

		visited.add(itemId);
		ordered.push({ itemId, item });
		for (const dependencyId of collectAllReferencedItemIds(item))
			visit(dependencyId);
	};

	for (const item of items) visit(parseItemId(item).id);

	return ordered;
}

/**
 * Ensure a re-visit of an already-planned item does not pin a different variant.
 * @param id - Registry item id.
 * @param pinnedVariantId - Variant pin from this edge, if any.
 * @param selectedVariants - Variants chosen on the first visit of each id.
 * @throws Error when the pin conflicts with the earlier selection.
 */
function assertCompatibleRevisit(
	id: string,
	pinnedVariantId: string | undefined,
	selectedVariants: Map<string, string | undefined>,
): void {
	if (pinnedVariantId === undefined) return;
	if (selectedVariants.get(id) === pinnedVariantId) return;
	throw new Error(`Registry item "${id}" selected conflicting variants.`);
}

/**
 * Build a prompt-ready required condition entry.
 * @param key - Condition key.
 * @param condition - Shared condition definition.
 * @param kind - Effective prompt kind.
 * @param values - Prompt options (empty for text/boolean).
 * @returns Required condition for the CLI.
 */
function buildRequiredCondition(
	key: string,
	condition: RegistryCondition,
	kind: RegistryConditionKind,
	values: RegistryConditionValue[],
): RequiredCondition {
	const requiredCondition: RequiredCondition = {
		key,
		label: condition.label,
		kind,
		values,
	};
	if (condition.description)
		requiredCondition.description = condition.description;
	if (condition.handler) requiredCondition.handler = condition.handler;
	return requiredCondition;
}

/**
 * Prompt options for a required select condition, narrowed to values present on the install set.
 * @param key - Condition key.
 * @param condition - Shared condition definition.
 * @param presentWhenValues - Distinct `when` values present on the install set.
 * @returns Selectable condition values for the CLI prompt.
 * @throws Error when no selectable values remain.
 */
function selectableValuesForCondition(
	key: string,
	condition: RegistryCondition,
	presentWhenValues: Map<string, Set<string>>,
): RegistryConditionValue[] {
	const present = presentWhenValues.get(key);
	const declaredValues = condition.values ?? [];
	const values = present
		? declaredValues.filter((entry) => present.has(entry.value))
		: declaredValues;
	if (values.length === 0)
		throw new Error(
			`Condition "${key}" has no selectable values for the current install set.`,
		);
	return values;
}

/**
 * Collect conditions still missing from the context, with prompt-ready options.
 * Includes keys from variant `when` and from item-level `uses` lists.
 * @param entries - Catalog entries in the install set.
 * @param conditions - Shared condition definitions from the registry.
 * @param context - Condition values already captured.
 * @returns Required conditions the CLI should prompt for, sorted by key.
 */
export function collectRequiredConditions(
	entries: CatalogEntry[],
	conditions: Record<string, RegistryCondition> | undefined,
	context: RegistryContext,
): RequiredCondition[] {
	const presentWhenValues = collectPresentWhenValues(entries);
	const requiredKeys = new Set<string>(presentWhenValues.keys());
	for (const { item } of entries) {
		for (const key of item.uses ?? []) requiredKeys.add(key);
	}

	const required: RequiredCondition[] = [];

	for (const key of [...requiredKeys].sort((a, b) => a.localeCompare(b))) {
		if (context[key] !== undefined) continue;

		const condition = conditions?.[key];
		if (!condition)
			throw new Error(`Install plan references undeclared condition "${key}".`);

		const { kind, requiresValues } = policyForConditionKind(condition.kind);
		const values = requiresValues
			? selectableValuesForCondition(key, condition, presentWhenValues)
			: [];
		required.push(buildRequiredCondition(key, condition, kind, values));
	}

	return required;
}

/**
 * Seed context from pinned variant `when` maps on selected items.
 * @param items - Selected items (`id` or `id@variant`).
 * @param catalogItems - Catalog items keyed by id.
 * @param conditions - Shared condition definitions used to coerce seeded values.
 * @returns Partial context derived from pinned variant conditions.
 */
export function assumeContextFromSelectedItems(
	items: string[],
	catalogItems: Record<string, CatalogItem>,
	conditions?: Record<string, RegistryCondition>,
): RegistryContext {
	const context: RegistryContext = {};
	for (const item of items) {
		const { id, variantId } = parseItemId(item);
		if (variantId === undefined) continue;

		const catalogItem = catalogItems[id];
		if (!catalogItem) throw new Error(`Registry item not found: "${id}".`);

		const when = catalogItem.variants?.find(
			(entry) => entry.id === variantId,
		)?.when;
		if (!when) continue;

		for (const [key, value] of Object.entries(when)) {
			const condition = conditions?.[key];
			if (!condition)
				throw new Error(
					`Pinned variant "${id}@${variantId}" references undeclared condition "${key}".`,
				);
			policyForConditionKind(
				condition.kind ?? RegistryConditionKind.SELECT,
			).seedContext(context, key, value);
		}
	}

	return context;
}

/**
 * Build an ordered install plan from selected items and transitive registryDependencies.
 * @param items - Selected registry items (`id` or `id@variant`).
 * @param catalogItems - Catalog items keyed by id.
 * @param context - Install context for variant selection.
 * @returns Ordered install nodes with one variant per item id.
 * @throws Error when an item is missing, a cycle is detected, or variants conflict.
 */
export function buildInstallPlan(
	items: string[],
	catalogItems: Record<string, CatalogItem>,
	context: RegistryContext,
): InstallNode[] {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const ordered: InstallNode[] = [];
	const selectedVariants = new Map<string, string | undefined>();

	// Visit a node in the dependency graph and add it to the install plan.
	const visit = (parsed: ParsedItemId): void => {
		const { id, variantId: pinnedVariantId } = parsed;

		// If the item has already been visited, check if the variant pin is compatible.
		if (visited.has(id)) {
			assertCompatibleRevisit(id, pinnedVariantId, selectedVariants);
			return;
		}

		// If the item is already being visited, throw an error.
		if (visiting.has(id))
			throw new Error(`Registry dependency cycle detected at "${id}".`);

		const catalogItem = catalogItems[id];
		if (!catalogItem) throw new Error(`Registry item not found: "${id}".`);

		// Mark the item as visiting and select the variant.
		visiting.add(id);
		const selection = selectRegistryVariant(
			id,
			catalogItem,
			context,
			pinnedVariantId,
		);

		// Visit each registry dependency of the item.
		for (const dependency of collectItemField(
			catalogItem,
			selection.variantId,
			"registryDependencies",
		))
			visit(parseItemId(dependency));

		// Mark the item as visited and add it to the selected variants map.
		visiting.delete(id);
		visited.add(id);
		selectedVariants.set(id, selection.variantId);

		// Add the item to the install plan.
		ordered.push({
			itemId: id,
			...(selection.variantId ? { variantId: selection.variantId } : {}),
			...(selection.source ? { source: selection.source } : {}),
			...(selection.beforeInstallScripts
				? { beforeInstallScripts: selection.beforeInstallScripts }
				: {}),
			...(selection.afterInstallScripts
				? { afterInstallScripts: selection.afterInstallScripts }
				: {}),
		});
	};

	// Visit each item in the install plan.
	for (const item of items) visit(parseItemId(item));

	return ordered;
}
