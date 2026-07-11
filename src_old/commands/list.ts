import chalk from "chalk";
import prompts from "../cli/prompts";
import { loadRegistryIndex } from "../registry/loader";
import {
	collectRegistryFacets,
	listRegistryItems,
	REGISTRY_FACET_KEYS,
	type RegistryFacetKey,
	type RegistryFacets,
	type RegistryItemFilters,
	registryFacetFromKebab,
	registryFacetToKebab,
} from "../registry/resolver";

/** Sentinel value meaning every registry type. */
const ALL_TYPES_SENTINEL = "all";

export type ListCommandOptions = Omit<RegistryItemFilters, "type" | "tag"> & {
	/** When true, list every registry type (no prompt). */
	all?: boolean;
	/** Comma-separated types, or the `all` sentinel. When omitted (and `all` is not set), the user is prompted. */
	type?: string | string[];
	/** Comma-separated tags. */
	tag?: string | string[];
	/** When set, print available facet values instead of items. */
	values?: string | boolean;
};

/**
 * Format a registry type for terminal display.
 * @param type - Registry item type value.
 * @returns Human-readable section label.
 */
function formatRegistryItemType(type: string): string {
	switch (type) {
		case "block":
			return "Blocks";
		case "component":
			return "Components";
		case "convention":
			return "Conventions";
		case "agent-instruction":
			return "Agent Instructions";
		case "agent-skill":
			return "Agent Skills";
		case "subagent":
			return "Subagents";
		case "template":
			return "Templates";
		case "theme":
			return "Themes";
		default:
			return type.charAt(0).toUpperCase() + type.slice(1);
	}
}

/**
 * Format available values for a facet as a comma-separated list.
 * @param values - Sorted facet values.
 * @returns Display string, or "(none)" when empty.
 */
function formatFacetValues(values: string[]): string {
	return values.length > 0 ? values.join(", ") : "(none)";
}

/**
 * Print available values for one or all registry facets.
 * @param facets - Facets collected from the registry.
 * @param facetKey - Optional single facet to print; prints all when omitted.
 */
function printRegistryFacetValues(
	facets: RegistryFacets,
	facetKey?: RegistryFacetKey,
): void {
	const keys = facetKey ? [facetKey] : [...REGISTRY_FACET_KEYS];

	for (const key of keys) {
		const label = registryFacetToKebab(key);
		console.log(
			`  ${chalk.bold(label)}${chalk.dim(`: ${formatFacetValues(facets[key])}`)}`,
		);
	}

	console.log();
}

/**
 * Parse a multi-value CLI option into individual tokens.
 * @param option - Raw option value (string, array, or undefined).
 * @returns Trimmed non-empty tokens.
 */
function parseMultiTokens(option: string | string[] | undefined): string[] {
	if (option === undefined) return [];
	const parts = Array.isArray(option) ? option : option.split(",");
	return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Validate concrete type tokens against values present in the registry.
 * @param tokens - Type tokens (must not include the `all` sentinel).
 * @param availableTypes - Types present in the registry.
 * @throws Error when a token is not a known registry type.
 */
function validateConcreteTypes(
	tokens: string[],
	availableTypes: string[],
): void {
	for (const token of tokens) {
		if (!availableTypes.includes(token))
			throw new Error(
				`Unsupported registry type "${token}" (available: ${formatFacetValues(availableTypes)}).`,
			);
	}
}

/**
 * Resolve which registry types to list from flags or an interactive prompt.
 * @param options - List command options (`all`, `type`).
 * @param availableTypes - Sorted types present in the registry.
 * @returns Selected types (always a non-empty subset of `availableTypes`).
 */
async function resolveListTypes(
	options: Pick<ListCommandOptions, "all" | "type">,
	availableTypes: string[],
): Promise<string[]> {
	if (availableTypes.length === 0)
		throw new Error("No registry item types found.");

	const tokens = parseMultiTokens(options.type);
	const hasAllSentinel = tokens.includes(ALL_TYPES_SENTINEL);
	const concreteTokens = tokens.filter(
		(token) => token !== ALL_TYPES_SENTINEL,
	);

	if (options.all && concreteTokens.length > 0)
		throw new Error("Cannot combine --all with specific --type values.");

	if (hasAllSentinel && concreteTokens.length > 0)
		throw new Error(
			'Cannot combine type "all" with specific --type values.',
		);

	if (options.all || hasAllSentinel) return [...availableTypes];

	if (concreteTokens.length > 0) {
		validateConcreteTypes(concreteTokens, availableTypes);
		return concreteTokens;
	}

	if (availableTypes.length === 1) {
		console.log(
			`(Only one registry type is available, using "${availableTypes[0]}".)`,
		);
		return [...availableTypes];
	}

	const chosen = await prompts.multiselectInput(
		"Which registry types would you like to list?",
		{
			options: availableTypes.map((type) => ({
				label: formatRegistryItemType(type),
				value: type,
			})),
		},
		availableTypes,
	);

	if (chosen.length === 0)
		throw new Error("Select at least one registry type to list.");

	validateConcreteTypes(chosen, availableTypes);
	return chosen;
}

/**
 * Resolve and validate non-type facet filters against values present in the registry.
 * @param options - Raw filter options from the CLI.
 * @param facets - Available facet values from the registry.
 * @returns Validated filters (without `type`).
 */
function resolveNonTypeFilters(
	options: ListCommandOptions,
	facets: RegistryFacets,
): Omit<RegistryItemFilters, "type"> {
	const filters: Omit<RegistryItemFilters, "type"> = {};

	const tagTokens = parseMultiTokens(options.tag);
	if (tagTokens.length > 0) {
		for (const tag of tagTokens) {
			if (!facets.tag.includes(tag))
				throw new Error(
					`Unsupported registry tag "${tag}" (available: ${formatFacetValues(facets.tag)}).`,
				);
		}
		filters.tag = tagTokens.length === 1 ? tagTokens[0] : tagTokens;
	}

	for (const key of REGISTRY_FACET_KEYS) {
		if (key === "type" || key === "tag") continue;
		const value = options[key as keyof ListCommandOptions];
		if (typeof value !== "string") continue;

		if (!facets[key].includes(value))
			throw new Error(
				`Unsupported registry ${registryFacetToKebab(key)} "${value}" (available: ${formatFacetValues(facets[key])}).`,
			);

		filters[key] = value;
	}

	return filters;
}

/**
 * Print matching registry items grouped by type.
 * @param ids - Matching item ids (sorted).
 * @param index - Registry index keyed by item id.
 * @param typeOrder - Preferred type section order.
 */
function printItemsGroupedByType(
	ids: string[],
	index: Awaited<ReturnType<typeof loadRegistryIndex>>,
	typeOrder: string[],
): void {
	const groups = new Map<string, string[]>();

	for (const id of ids) {
		const item = index.get(id);
		if (!item) continue;
		const group = groups.get(item.type) ?? [];
		group.push(id);
		groups.set(item.type, group);
	}

	const orderedTypes = typeOrder.filter((type) => groups.has(type));
	for (const type of groups.keys()) {
		if (!orderedTypes.includes(type)) orderedTypes.push(type);
	}

	for (const type of orderedTypes) {
		const groupIds = groups.get(type);
		if (!groupIds) continue;

		console.log(`  ${chalk.bold(formatRegistryItemType(type))}`);
		for (const id of groupIds) {
			const item = index.get(id);
			if (!item) continue;

			const variantLabels = item.variants
				.filter((variant) => variant.id !== "default")
				.map((variant) => variant.id);
			const suffix =
				variantLabels.length > 0
					? chalk.dim(` [${variantLabels.join(", ")}]`)
					: "";

			console.log(`    ${chalk.bold(item.title)}${suffix}`);
			console.log(`    ${chalk.dim(item.description)}`);
			console.log(`    ${chalk.dim(id)}`);
		}
		console.log();
	}
}

/**
 * List registry items matching optional filters, or print available facet values.
 * @param options - Optional facet filters, `--all`, and/or `--values` mode.
 */
export async function listCommand(
	options: ListCommandOptions = {},
): Promise<void> {
	const index = await loadRegistryIndex();
	const facets = collectRegistryFacets(index);

	if (options.values !== undefined && options.values !== false) {
		let facetKey: RegistryFacetKey | undefined;
		if (typeof options.values === "string") {
			facetKey =
				registryFacetFromKebab(options.values) ??
				(REGISTRY_FACET_KEYS.includes(options.values as RegistryFacetKey)
					? (options.values as RegistryFacetKey)
					: undefined);
			if (!facetKey)
				throw new Error(
					`Unknown facet "${options.values}" (available: ${REGISTRY_FACET_KEYS.map(registryFacetToKebab).join(", ")}).`,
				);
		}
		printRegistryFacetValues(facets, facetKey);
		return;
	}

	const types = await resolveListTypes(options, facets.type);
	const filters: RegistryItemFilters = {
		...resolveNonTypeFilters(options, facets),
		type: types,
	};
	const ids = listRegistryItems(index, filters);

	if (ids.length === 0) {
		console.log(chalk.dim("No registry items match the requested filters."));
		console.log();
		console.log(chalk.dim("Available filters:"));
		printRegistryFacetValues(facets);
		return;
	}

	printItemsGroupedByType(ids, index, facets.type);

	console.log(chalk.dim(`${ids.length} item(s)`));
	console.log();
}

export default listCommand;
