import type {
	CatalogItem,
	Registry,
	RegistryItemTypeDefinition,
} from "@tuckshop/core";
import chalk from "chalk";
import { defaultText, primaryText } from "../cli/labels";
import { parseMultiValueOption } from "../cli/options";

/** Options accepted by the list command. */
interface ListCommandOptions {
	/** Comma-separated registry item types, or `all`. */
	type?: string;
}

/**
 * Resolve which item types to include from `--type`.
 * Defaults to every available type when `--type` is omitted.
 * @param typeOption - Raw `--type` value from the CLI.
 * @param availableTypes - Types present in the registry.
 * @returns Allowed item types.
 */
function resolveFilterTypes(
	typeOption: string | undefined,
	availableTypes: string[],
): Set<string> {
	if (availableTypes.length === 0)
		throw new Error("No registry item types found.");

	const tokens = typeOption ? parseMultiValueOption(typeOption) : [];

	// No explicit filter means list everything
	if (tokens.length === 0) return new Set(availableTypes);

	const wantsAll = tokens.includes("all");
	const concreteTypes = tokens.filter((token) => token !== "all");

	// Validate the requested filter combination
	if (wantsAll && concreteTypes.length > 0)
		throw new Error('Cannot combine type "all" with specific --type values.');

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
 * @param typeMeta - Display metadata keyed by type value.
 */
function printItemsByType(
	matches: CatalogItem[],
	typeOrder: string[],
	typeMeta: Record<string, RegistryItemTypeDefinition>,
): void {
	const byType = new Map<string, CatalogItem[]>();

	for (const item of matches) {
		const group = byType.get(item.type) ?? [];
		group.push(item);
		byType.set(item.type, group);
	}

	for (const type of typeOrder) {
		const group = byType.get(type);
		if (!group) continue;

		const meta = typeMeta[type];
		console.log(primaryText(meta.label ?? type));
		if (meta.description) console.log(meta.description);
		console.log();

		const sorted = [...group].sort((a, b) => a.title.localeCompare(b.title));
		const indexWidth = String(sorted.length).length;

		for (const [index, item] of sorted.entries()) {
			const variantLabels = (item.variants ?? []).map(
				(variant) => variant.title,
			);
			const variants =
				variantLabels.length > 0
					? chalk.cyan(` [${variantLabels.join(", ")}]`)
					: "";
			const number = defaultText(`${String(index + 1).padStart(indexWidth)}.`);

			console.log(
				`  ${number} ${chalk.bold(item.title)}${variants}: ${item.description}`,
			);
		}

		console.log();
	}
}

/**
 * List registry items, optionally filtered by `--type`.
 * @param registry - Registry loaded at CLI registration time.
 * @param options - Optional list command options.
 */
export function listCommand(
	registry: Registry,
	options: ListCommandOptions = {},
): void {
	const itemTypes = Object.keys(registry.types);
	const allowedTypes = resolveFilterTypes(options.type, itemTypes);
	const matches = Object.values(registry.items).filter((item) =>
		allowedTypes.has(item.type),
	);

	if (matches.length === 0) {
		console.log();
		console.log(defaultText("─".repeat(40)));
		console.log();
		console.log(defaultText("No registry items match the requested types."));
		console.log();
		return;
	}

	console.log();
	console.log(defaultText("─".repeat(40)));
	console.log();
	printItemsByType(matches, itemTypes, registry.types);
	console.log(defaultText(`${matches.length} item(s)`));
	console.log();
}
