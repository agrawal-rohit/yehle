import {
	policyForConditionKind,
	type RegistryConditionKind,
	type RegistryContext,
	type RegistryContextValue,
	type RegistryWhenValue,
} from "./condition-kind";
import { PACKAGE_MANAGER_KEY, type RegistryPackageManager } from "./packages";
import {
	type IndexItem,
	InstallPhase,
	type RegistryCondition,
	type RegistryConditionValue,
} from "./schema";

/**
 * Check whether a captured context value satisfies a `when` expectation.
 * @param actual - Captured context value for the condition key.
 * @param expected - Value from the item/pack `when` map.
 * @returns True when the expectation is satisfied.
 */
function contextValueMatchesWhen(
	actual: RegistryContextValue | undefined,
	expected: RegistryWhenValue,
): boolean {
	if (actual === undefined) return false;
	if (typeof expected === "boolean") return actual === expected;
	if (Array.isArray(actual)) {
		if (Array.isArray(expected))
			return expected.some((entry) => actual.includes(entry));
		return actual.includes(expected);
	}
	if (typeof actual === "boolean") return false;
	return Array.isArray(expected)
		? expected.includes(actual)
		: actual === expected;
}

/** Parsed item id, optionally with a pinned pack (`button` or `button@react`). */
export interface ParsedItemId {
	/** Registry item id. */
	id: string;
	/** Optional pinned pack id from `id@pack`. */
	packId?: string;
}

/** An index item with its selected compiled item source URIs. */
export interface InstallNode {
	/** Registry item id (index map key). */
	itemId: string;
	/** Selected pack ids whose compiled items should be layered on top of the base item. */
	packIds?: string[];
	/** Compiled item URIs from the index entry, joined against the index location when fetched. */
	sources?: string[];
	/** Compiled `beforeInstall` script URIs for this item. */
	beforeInstallScripts?: string[];
	/** Compiled `afterInstall` script URIs for this item. */
	afterInstallScripts?: string[];
}

/** Result of selecting installable sources (base and optional packs) for one index item. */
export type RegistryItemSelection = Omit<InstallNode, "itemId">;

/** Index item id paired with its document for graph walks. */
export interface IndexEntry {
	/** Registry item id. */
	itemId: string;
	/** Index item document. */
	item: IndexItem;
}

/**
 * A condition the CLI still needs to capture before install can proceed.
 * Options are the intersection of declared condition values and values present
 * across the plan's packs, so prompts never offer uninstallable choices.
 */
export interface RequiredCondition {
	/** Condition key used by pack `when` entries. */
	key: string;
	/** Display label for prompts. */
	label: string;
	/** Optional longer description shown in the CLI. */
	description?: string;
	/** Prompt kind; defaults to select. */
	kind: RegistryConditionKind;
	/** Prompt options limited to values present on the install plan (select only). */
	values: RegistryConditionValue[];
	/** Compiled condition handler URI when the index declares one. */
	handler?: string;
	/** Default prompt value when the index declares one and no handler runs. */
	default?: string;
	/** When true, allow skipping the condition value. */
	optional?: boolean;
}

/**
 * Check whether a `when` map matches the runtime context.
 * @param when - Condition matcher from a index item, pack, or condition.
 * @param context - Condition values already captured for this install.
 * @param packageManager - Selected npm package manager for `when.packageManager`.
 * @returns True when every `when` key equals the context value.
 */
export function whenMatchesContext(
	when: Record<string, RegistryWhenValue> | undefined,
	context: RegistryContext,
	packageManager?: RegistryPackageManager,
): boolean {
	if (!when) return true;

	for (const [key, expected] of Object.entries(when)) {
		const actual = key === PACKAGE_MANAGER_KEY ? packageManager : context[key];
		if (!contextValueMatchesWhen(actual, expected)) return false;
	}
	return true;
}

/** Item list fields merged from item-level and selected-pack declarations. */
type ItemListField = InstallPhase | "dependsOn";

/**
 * Collect item-level and selected-pack values for one list field.
 * @param item - Index item with optional packs.
 * @param packIds - Selected pack ids when packs exist.
 * @param field - List field to read (`beforeInstall`, `afterInstall`, or `dependsOn`).
 * @returns Combined entry list.
 */
function collectItemField<K extends ItemListField>(
	item: Pick<IndexItem, K | "packs">,
	packIds: string[],
	field: K,
): string[] {
	const selectedPacks =
		item.packs?.filter((entry) => packIds.includes(entry.id)) ?? [];
	return [
		...(item[field] ?? []),
		...selectedPacks.flatMap((entry) => entry[field] ?? []),
	];
}

/**
 * Attach compiled install script URIs to a selection result when present.
 * @param item - Index item that may declare lifecycle scripts.
 * @param selection - Selected pack ids and/or compiled item sources.
 * @returns Selection including script URIs when declared.
 */
function withItemScripts(
	item: IndexItem,
	selection: { packIds?: string[]; sources?: string[] },
): RegistryItemSelection {
	const beforeInstall = collectItemField(
		item,
		selection.packIds ?? [],
		InstallPhase.BeforeInstall,
	);
	const afterInstall = collectItemField(
		item,
		selection.packIds ?? [],
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
 * Select install sources for a pack-less index item.
 * @param itemId - Registry item id for error messages.
 * @param item - Index item without packs.
 * @param pinnedPackId - Must be undefined for pack-less items.
 * @returns Payload source and/or install script URIs.
 * @throws Error when a pack is pinned or the item has no installable source or phase entries.
 */
function selectPackLessItem(
	itemId: string,
	item: IndexItem,
	pinnedPackId?: string,
): RegistryItemSelection {
	if (pinnedPackId !== undefined)
		throw new Error(`Registry item "${itemId}" has no packs.`);
	const hasInstallPhases =
		collectItemField(item, [], InstallPhase.BeforeInstall).length > 0 ||
		collectItemField(item, [], InstallPhase.AfterInstall).length > 0;
	// Scripts-only items (no compiled item source) are still installable.
	if (!item.source && !hasInstallPhases)
		throw new Error(
			`Registry item "${itemId}" is missing a compiled item source or install phase.`,
		);
	const selection = {
		...(item.source ? { sources: [item.source] } : {}),
	};
	return withItemScripts(item, selection);
}

/**
 * Select matching and/or pinned packs for one index item.
 * @param itemId - Registry item id for error messages.
 * @param item - Index item whose packs are being considered.
 * @param packs - Non-empty pack list from the index item.
 * @param context - Condition values already captured for this install.
 * @param pinnedPackId - Optional pack id from `id@pack`.
 * @param packageManager - Selected npm package manager for pack `when`.
 * @returns Base source plus every matching/pinned pack source.
 * @throws Error when a pinned pack id is missing.
 */
function selectMatchingPacks(
	itemId: string,
	item: IndexItem,
	packs: NonNullable<IndexItem["packs"]>,
	context: RegistryContext,
	pinnedPackId: string | undefined,
	packageManager: RegistryPackageManager | undefined,
): RegistryItemSelection {
	const matchingPacks = packs.filter(
		(pack) =>
			pinnedPackId === pack.id ||
			whenMatchesContext(pack.when, context, packageManager),
	);
	if (
		pinnedPackId !== undefined &&
		!matchingPacks.some((pack) => pack.id === pinnedPackId)
	)
		throw new Error(`Registry item "${itemId}" has no pack "${pinnedPackId}".`);
	return withItemScripts(item, {
		...(matchingPacks.length > 0
			? { packIds: matchingPacks.map((pack) => pack.id) }
			: {}),
		sources: [
			...(item.source ? [item.source] : []),
			...matchingPacks.map((pack) => pack.source),
		],
	});
}

/**
 * Select the matching packs for a index item under a runtime context.
 * @param itemId - Registry item id for error messages.
 * @param item - Index item whose packs are considered.
 * @param context - Condition values already captured for this install.
 * @param pinnedPackId - Optional explicit pack id (from `id@pack`).
 * @param packageManager - Selected npm package manager for pack `when`.
 * @returns Selected pack ids, compiled item source URIs, and optional install script URIs.
 */
export function selectRegistryPacks(
	itemId: string,
	item: IndexItem,
	context: RegistryContext,
	pinnedPackId?: string,
	packageManager?: RegistryPackageManager,
): RegistryItemSelection {
	const packs = item.packs ?? [];
	if (packs.length === 0) return selectPackLessItem(itemId, item, pinnedPackId);
	return selectMatchingPacks(
		itemId,
		item,
		packs,
		context,
		pinnedPackId,
		packageManager,
	);
}

/**
 * Collect distinct string `when` values present on index entries, keyed by condition name.
 * Used to narrow prompt options to choices that appear on the install set.
 * @param entries - Catalog entries in the install set.
 * @returns Map of condition key → distinct `when` values present on those entries.
 */
function collectPresentWhenValues(
	entries: IndexEntry[],
): Map<string, Set<string>> {
	const present = new Map<string, Set<string>>();

	const addWhen = (
		when: Record<string, RegistryWhenValue> | undefined,
	): void => {
		if (!when) return;
		for (const [key, value] of Object.entries(when)) {
			let normalized: string[] = [];
			if (Array.isArray(value)) normalized = value;
			else if (typeof value === "string") normalized = [value];
			let values = present.get(key);
			if (!values) {
				values = new Set();
				present.set(key, values);
			}
			for (const entry of normalized) values.add(entry);
		}
	};

	for (const { item } of entries)
		for (const pack of item.packs ?? []) addWhen(pack.when);

	return present;
}

/**
 * Parse an item id string into an id and optional pack pin.
 * @param value - `id` or `id@packId`.
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
			`Invalid registry item id "${value}" (expected id or id@pack).`,
		);

	return {
		id: value.slice(0, separatorIndex),
		packId: value.slice(separatorIndex + 1),
	};
}

/**
 * Collect every dependency id referenced by an item or any of its packs.
 * @param item - Index item to scan.
 * @returns Unique referenced item ids.
 */
function collectAllReferencedItemIds(item: IndexItem): string[] {
	const referencedIds = new Set<string>();
	const addDeps = (entries: string[] | undefined): void => {
		for (const entry of entries ?? []) referencedIds.add(parseItemId(entry).id);
	};

	addDeps(item.dependsOn);
	for (const pack of item.packs ?? []) addDeps(pack.dependsOn);
	return [...referencedIds];
}

/**
 * Collect selected items and every transitive `dependsOn` entry.
 * Pack `when` is ignored so condition prompts cover the full dependency graph.
 * @param items - Selected items (`id` or `id@pack`).
 * @param indexItems - Index items keyed by id.
 * @returns Unique index entries in discovery order (selected items first).
 * @throws Error when a listed item is missing from the index.
 */
export function collectRegistryDependencies(
	items: string[],
	indexItems: Record<string, IndexItem>,
): IndexEntry[] {
	const visited = new Set<string>();
	const ordered: IndexEntry[] = [];

	const visit = (itemId: string): void => {
		if (visited.has(itemId)) return;
		const item = indexItems[itemId];
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
 * Ensure a re-visit of an already-planned item does not pin a different pack.
 * @param id - Registry item id.
 * @param pinnedPackId - Pack pin from this edge, if any.
 * @param selectedPacks - Packs chosen on the first visit of each id.
 * @throws Error when the pin conflicts with the earlier selection.
 */
function assertCompatibleRevisit(
	id: string,
	pinnedPackId: string | undefined,
	selectedPacks: Map<string, string[] | undefined>,
): void {
	if (pinnedPackId === undefined) return;
	if (selectedPacks.get(id)?.includes(pinnedPackId)) return;
	throw new Error(`Registry item "${id}" selected conflicting packs.`);
}

/** Mutable state shared while walking the install dependency graph. */
interface InstallPlanState {
	visiting: Set<string>;
	visited: Set<string>;
	ordered: InstallNode[];
	selectedPacks: Map<string, string[] | undefined>;
}

/**
 * Build one install node from a pack/source selection.
 * @param id - Registry item id.
 * @param selection - Selected compiled item sources and install scripts.
 * @returns Install node with optional fields omitted when unset.
 */
function installNodeFromSelection(
	id: string,
	selection: RegistryItemSelection,
): InstallNode {
	return {
		itemId: id,
		...(selection.packIds ? { packIds: selection.packIds } : {}),
		...(selection.sources ? { sources: selection.sources } : {}),
		...(selection.beforeInstallScripts
			? { beforeInstallScripts: selection.beforeInstallScripts }
			: {}),
		...(selection.afterInstallScripts
			? { afterInstallScripts: selection.afterInstallScripts }
			: {}),
	};
}

/**
 * Visit one item in the install dependency graph and append it to the plan.
 * @param parsed - Parsed item id, optionally pinned to one pack.
 * @param indexItems - Index items keyed by id.
 * @param context - Install context for pack selection.
 * @param packageManager - Selected npm package manager for pack `when`.
 * @param state - Shared visit state for cycle detection and ordering.
 * @throws Error when an item is missing, a cycle is detected, or pack pins conflict.
 */
function visitInstallNode(
	parsed: ParsedItemId,
	indexItems: Record<string, IndexItem>,
	context: RegistryContext,
	packageManager: RegistryPackageManager | undefined,
	state: InstallPlanState,
): void {
	const { id, packId: pinnedPackId } = parsed;

	if (state.visited.has(id)) {
		assertCompatibleRevisit(id, pinnedPackId, state.selectedPacks);
		return;
	}

	if (state.visiting.has(id))
		throw new Error(`Registry dependency cycle detected at "${id}".`);

	const catalogItem = indexItems[id];
	if (!catalogItem) throw new Error(`Registry item not found: "${id}".`);

	state.visiting.add(id);
	const selection = selectRegistryPacks(
		id,
		catalogItem,
		context,
		pinnedPackId,
		packageManager,
	);

	for (const dependency of collectItemField(
		catalogItem,
		selection.packIds ?? [],
		"dependsOn",
	))
		visitInstallNode(
			parseItemId(dependency),
			indexItems,
			context,
			packageManager,
			state,
		);

	state.visiting.delete(id);
	state.visited.add(id);
	state.selectedPacks.set(id, selection.packIds);
	state.ordered.push(installNodeFromSelection(id, selection));
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
	if (condition.default) requiredCondition.default = condition.default;
	if (condition.optional === true) requiredCondition.optional = true;
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
 * Includes keys from pack `when` and from item-level `requires` lists.
 * Skips `packageManager`, which is selected by core at install time.
 * @param entries - Catalog entries in the install set.
 * @param conditions - Shared condition definitions from the registry.
 * @param context - Condition values already captured.
 * @param packageManager - Selected npm package manager for condition `when` clauses.
 * @returns Required conditions the CLI should prompt for, sorted by key.
 */
export function collectRequiredConditions(
	entries: IndexEntry[],
	conditions: Record<string, RegistryCondition> | undefined,
	context: RegistryContext,
	packageManager?: RegistryPackageManager,
): RequiredCondition[] {
	const presentWhenValues = collectPresentWhenValues(entries);
	const requiredKeys = new Set<string>(presentWhenValues.keys());
	for (const { item } of entries) {
		for (const key of item.requires ?? []) requiredKeys.add(key);
	}

	const required: RequiredCondition[] = [];

	for (const key of [...requiredKeys].sort((a, b) => a.localeCompare(b))) {
		if (context[key] !== undefined) continue;
		// Runtime matcher owned by core — not a registry condition to prompt.
		if (key === PACKAGE_MANAGER_KEY) continue;

		const condition = conditions?.[key];
		if (!condition)
			throw new Error(`Install plan references undeclared condition "${key}".`);

		// Prompt only when the condition's own `when` is absent or already satisfied.
		if (!whenMatchesContext(condition.when, context, packageManager)) continue;

		const { kind, requiresValues } = policyForConditionKind(condition.kind);
		const values = requiresValues
			? selectableValuesForCondition(key, condition, presentWhenValues)
			: [];
		required.push(buildRequiredCondition(key, condition, kind, values));
	}

	return required;
}

/**
 * Collect item-level conditions still missing from context.
 * @param entries - Planned index entries (install set).
 * @param context - Condition values already captured (shared + prior items).
 * @param packageManager - Selected npm package manager for condition `when` clauses.
 * @returns Conditions to prompt for, sorted by key.
 * @throws Error when a local condition key collides with a shared condition.
 */
export function collectItemLocalConditions(
	entries: IndexEntry[],
	context: RegistryContext,
	packageManager?: RegistryPackageManager,
): RequiredCondition[] {
	const pending = new Map<string, RegistryCondition>();

	for (const { item } of entries) {
		const local = item.conditions;
		if (!local) continue;

		for (const [key, condition] of Object.entries(local)) {
			if (context[key] !== undefined) continue;
			// Prompt only when the condition's own `when` is absent or already satisfied.
			if (!whenMatchesContext(condition.when, context, packageManager))
				continue;
			pending.set(key, condition);
		}
	}

	return [...pending.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, condition]) => {
			const { kind, requiresValues } = policyForConditionKind(condition.kind);
			const values = requiresValues ? (condition.values ?? []) : [];
			if (requiresValues && values.length === 0)
				throw new Error(
					`Item-level condition "${key}" has no selectable values.`,
				);

			return buildRequiredCondition(key, condition, kind, values);
		});
}

/**
 * Seed context from pinned pack `when` maps on selected items.
 * Does not seed `packageManager` — that value is selected by core at install time.
 * @param items - Selected items (`id` or `id@pack`).
 * @param indexItems - Index items keyed by id.
 * @param conditions - Shared condition definitions used to coerce seeded values.
 * @returns Partial context derived from pinned pack conditions.
 */
export function assumeContextFromSelectedItems(
	items: string[],
	indexItems: Record<string, IndexItem>,
	conditions?: Record<string, RegistryCondition>,
): RegistryContext {
	const context: RegistryContext = {};
	for (const item of items) {
		const { id, packId } = parseItemId(item);
		if (packId === undefined) continue;

		const catalogItem = indexItems[id];
		if (!catalogItem) throw new Error(`Registry item not found: "${id}".`);

		const when = catalogItem.packs?.find((entry) => entry.id === packId)?.when;
		if (!when) continue;

		const pinLabel = `${id}@${packId}`;
		for (const [key, value] of Object.entries(when)) {
			if (key === PACKAGE_MANAGER_KEY) continue;

			const condition = conditions?.[key];
			if (!condition)
				throw new Error(
					`Pinned pack "${pinLabel}" references undeclared condition "${key}".`,
				);
			policyForConditionKind(condition.kind).seedContext(context, key, value);
		}
	}

	return context;
}

/**
 * Build an ordered install plan from selected items and transitive dependsOn.
 * @param items - Selected registry items (`id` or `id@pack`).
 * @param indexItems - Index items keyed by id.
 * @param context - Install context for pack selection.
 * @param packageManager - Selected npm package manager for pack `when`.
 * @returns Ordered install nodes with base and matching pack sources per item id.
 * @throws Error when an item is missing, a cycle is detected, or pack pins conflict.
 */
export function buildInstallPlan(
	items: string[],
	indexItems: Record<string, IndexItem>,
	context: RegistryContext,
	packageManager?: RegistryPackageManager,
): InstallNode[] {
	const state: InstallPlanState = {
		visiting: new Set<string>(),
		visited: new Set<string>(),
		ordered: [],
		selectedPacks: new Map<string, string[] | undefined>(),
	};

	for (const item of items)
		visitInstallNode(
			parseItemId(item),
			indexItems,
			context,
			packageManager,
			state,
		);

	return state.ordered;
}
