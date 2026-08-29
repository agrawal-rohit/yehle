import type {
	IndexItem,
	Registry,
	RegistryItemTypeDefinition,
} from "@tuckshop/core";
import chalk from "chalk";
import { defaultText, primaryText } from "../cli/labels";

/**
 * Flatten CAC `--type` values into trimmed tokens.
 * @param typeOption - A string, or `string[]` when the flag is repeated.
 * @returns Individual type tokens from comma-separated entries.
 */
function normalizeTypeTokens(
	typeOption: string | string[] | undefined,
): string[] {
	const parts =
		typeof typeOption === "string" ? [typeOption] : (typeOption ?? []);
	return parts.flatMap((part) =>
		part
			.split(",")
			.map((token) => token.trim())
			.filter(Boolean),
	);
}

/**
 * Ensure every requested type exists in the registry.
 * @param concreteTypes - Explicit type tokens (excluding `all`).
 * @param availableTypes - Types present in the registry.
 * @throws When a requested type is unsupported.
 */
function assertConcreteTypesSupported(
	concreteTypes: string[],
	availableTypes: string[],
): void {
	for (const type of concreteTypes) {
		if (!availableTypes.includes(type))
			throw new Error(
				`Unsupported registry type "${type}" (available: ${availableTypes.join(", ")}).`,
			);
	}
}

/**
 * Parse which item types to include from `--type`.
 * @param typeOption - CAC `--type` value: a string, or `string[]` when the flag is repeated.
 * @param availableTypes - Types present in the registry.
 * @returns Allowed item types.
 */
function parseTypeFilter(
	typeOption: string | string[] | undefined,
	availableTypes: string[],
): Set<string> {
	if (availableTypes.length === 0)
		throw new Error("No registry item types found.");

	const tokens = normalizeTypeTokens(typeOption);
	if (tokens.length === 0) return new Set(availableTypes);

	const wantsAll = tokens.includes("all");
	const concreteTypes = tokens.filter((token) => token !== "all");

	if (wantsAll && concreteTypes.length > 0)
		throw new Error('Cannot combine type "all" with specific --type values.');

	if (wantsAll) return new Set(availableTypes);

	assertConcreteTypesSupported(concreteTypes, availableTypes);
	return new Set(concreteTypes);
}

/**
 * Group registry items by their type value.
 * @param matches - Items to group.
 * @returns Items keyed by type.
 */
function groupItemsByType(matches: IndexItem[]): Map<string, IndexItem[]> {
	const byType = new Map<string, IndexItem[]>();

	for (const item of matches) {
		const group = byType.get(item.type) ?? [];
		group.push(item);
		byType.set(item.type, group);
	}

	return byType;
}

/**
 * Format pack titles as a cyan suffix for list output.
 * @param item - Registry item whose packs should be shown.
 * @returns Pack suffix, or an empty string when the item has no packs.
 */
function formatPackSuffix(item: IndexItem): string {
	const packLabels = (item.packs ?? []).map((pack) => pack.title);
	return packLabels.length > 0 ? chalk.cyan(` [${packLabels.join(", ")}]`) : "";
}

/**
 * Print one type section with its items sorted by title.
 * @param type - Raw type value used when metadata has no label.
 * @param group - Items belonging to this type.
 * @param meta - Display metadata for the type.
 */
function printTypeGroup(
	type: string,
	group: IndexItem[],
	meta: RegistryItemTypeDefinition,
): void {
	console.log(primaryText(meta.label ?? type));
	if (meta.description) console.log(meta.description);
	console.log();

	const sorted = [...group].sort((a, b) => a.title.localeCompare(b.title));
	const indexWidth = String(sorted.length).length;

	for (const [index, item] of sorted.entries()) {
		const packs = formatPackSuffix(item);
		const number = defaultText(`${String(index + 1).padStart(indexWidth)}.`);

		console.log(
			`  ${number} ${chalk.bold(item.title)}${packs}: ${item.description}`,
		);
	}

	console.log();
}

/**
 * Print matching registry items grouped by type.
 * @param matches - Items to print.
 * @param typeOrder - Section order for types.
 * @param typeMeta - Display metadata keyed by type value.
 */
function printItemsByType(
	matches: IndexItem[],
	typeOrder: string[],
	typeMeta: Record<string, RegistryItemTypeDefinition>,
): void {
	const byType = groupItemsByType(matches);

	for (const type of typeOrder) {
		const group = byType.get(type);
		if (!group) continue;

		printTypeGroup(type, group, typeMeta[type]);
	}
}

/**
 * List registry items, optionally filtered by `--type`.
 * @param registry - Registry loaded at CLI registration time.
 * @param type - Optional CAC `--type` value (`string`, or `string[]` when repeated).
 */
export function listCommand(
	registry: Registry,
	type?: string | string[],
): void {
	const itemTypes = Object.keys(registry.types);
	const allowedTypes = parseTypeFilter(type, itemTypes);
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
