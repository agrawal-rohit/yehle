import chalk from "chalk";
import { parseMultiValueOption } from "../cli/options";
import prompts from "../cli/prompts";
import {
	type Registry,
	type RegistryItem,
	RegistryItemType,
} from "../registry/schema";

/** Options accepted by the list command. */
export type ListCommandOptions = {
	/** Comma-separated registry item types, or `all`. */
	type?: string;
};

/**
 * Format a registry item type for terminal display.
 * @param type - Registry item type value from registry.json.
 * @returns Human-readable section label.
 */
function formatRegistryItemType(type: RegistryItemType): string {
	switch (type) {
		case RegistryItemType.BLOCK:
			return "Blocks";
		case RegistryItemType.COMPONENT:
			return "Components";
		case RegistryItemType.CONVENTION:
			return "Conventions";
		case RegistryItemType.AGENT_INSTRUCTION:
			return "Agent Instructions";
		case RegistryItemType.AGENT_SKILL:
			return "Agent Skills";
		case RegistryItemType.SUBAGENT:
			return "Subagents";
		case RegistryItemType.TEMPLATE:
			return "Templates";
		case RegistryItemType.THEME:
			return "Themes";
		default: {
			const _exhaustive: never = type;
			return _exhaustive;
		}
	}
}

/**
 * Resolve which item types to include from `--type`.
 * @param typeOption - Raw `--type` value from the CLI.
 * @param availableTypes - Types present in the registry.
 * @returns Allowed item types.
 */
async function resolveFilterTypes(
	typeOption: string | undefined,
	availableTypes: string[],
): Promise<Set<string>> {
	if (availableTypes.length === 0)
		throw new Error("No registry item types found.");

	const tokens = typeOption ? parseMultiValueOption(typeOption) : [];

	// If no types are requested, prompt the user for selection
	if (tokens.length === 0) {
		// If there is only one type, return it
		if (availableTypes.length === 1) return new Set(availableTypes);

		// Prompt the user for selection
		const chosen = await prompts.multiselectInput(
			"Which registry types would you like to list?",
			{
				options: availableTypes.map((type) => ({
					label: formatRegistryItemType(type as RegistryItemType),
					value: type,
				})),
			},
			availableTypes,
		);

		if (chosen.length === 0)
			throw new Error("Select at least one registry type to list.");

		return new Set(chosen);
	}

	const wantsAll = tokens.includes("all");
	const concreteTypes = tokens.filter((token) => token !== "all");

	// Validate the requested filter combination
	if (wantsAll && concreteTypes.length > 0)
		throw new Error(
			'Cannot combine type "all" with specific --type values.',
		);

	// If all types are requested, return all available types
	if (wantsAll) return new Set(availableTypes);

	// Validate the requested types
	for (const type of concreteTypes) {
		if (!availableTypes.includes(type))
			throw new Error(
				`Unsupported registry type "${type}" (available: ${availableTypes.join(", ")}).`,
			);
	}

	return new Set(concreteTypes);
}

/**
 * Print matching registry items grouped by type.
 * @param matches - Items to print.
 * @param typeOrder - Section order for types.
 */
function printItemsByType(
	matches: { id: string; item: RegistryItem }[],
	typeOrder: string[],
): void {
	const byType = new Map<string, { id: string; item: RegistryItem }[]>();

	for (const match of matches) {
		const group = byType.get(match.item.type) ?? [];
		group.push(match);
		byType.set(match.item.type, group);
	}

	for (const type of typeOrder) {
		const group = byType.get(type);
		if (!group) continue;

		console.log(
			`  ${chalk.bold(formatRegistryItemType(type as RegistryItemType))}`,
		);

		for (const { id, item } of [...group].sort((a, b) =>
			a.item.title.localeCompare(b.item.title),
		)) {
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
 * List registry items.
 * @param registry - Registry loaded at CLI registration time.
 * @param itemTypes - Item types present in the registry.
 * @param options - Optional list command options.
 */
export async function listCommand(
	registry: Registry,
	itemTypes: string[],
	options: ListCommandOptions = {},
): Promise<void> {
	const allowedTypes = await resolveFilterTypes(options.type, itemTypes);
	const matches = Object.entries(registry.items)
		.filter(([, item]) => allowedTypes.has(item.type))
		.map(([id, item]) => ({ id, item }));

	if (matches.length === 0) {
		console.log(chalk.dim("No registry items match the requested types."));
		console.log();
		return;
	}

	const typeOrder = itemTypes.filter((type) => allowedTypes.has(type));
	printItemsByType(matches, typeOrder);
	console.log(chalk.dim(`${matches.length} item(s)`));
	console.log();
}

export default listCommand;
