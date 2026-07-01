import type { CAC } from "cac";
import logger from "../cli/logger";
import {
	collectInputsForSelection,
	registryInputToCliFlag,
} from "../registry/inputs";
import { loadRegistry } from "../registry/loader";
import {
	collectRegistryFacets,
	REGISTRY_FACET_KEYS,
	type RegistryFacetKey,
	type RegistryFacets,
	registryFacetToKebab,
} from "../registry/resolver";
import addCommand from "./add";
import createCommand from "./create";
import listCommand, { type ListCommandOptions } from "./list";

/**
 * Parse CAC options into list-command options.
 * @param options - Raw CAC options.
 * @param facets - Facets present in the registry (defines which flags exist).
 * @returns Parsed list options (`all`, `type`, non-type filters, `--values`).
 */
function parseListCliOptions(
	options: Record<string, unknown>,
	facets: RegistryFacets,
): {
	all?: boolean;
	type?: string;
	values?: string | boolean;
	filters: Partial<Record<Exclude<RegistryFacetKey, "type">, string>>;
} {
	const filters: Partial<Record<Exclude<RegistryFacetKey, "type">, string>> =
		{};
	for (const key of REGISTRY_FACET_KEYS) {
		if (key === "type") continue;
		if (facets[key].length === 0) continue;
		const value = options[key];
		if (typeof value === "string") filters[key] = value;
	}

	const typeOption = options.type;
	const type = typeof typeOption === "string" ? typeOption : undefined;

	const all = options.all === true ? true : undefined;

	const valuesOption = options.values;
	let values: string | boolean | undefined;
	if (valuesOption === true) values = true;
	else if (typeof valuesOption === "string") values = valuesOption;

	return { all, type, values, filters };
}

/**
 * Peek positional arguments for a CLI command from argv, ignoring flags.
 * @param argv - Process argv (typically `process.argv.slice(2)`).
 * @param command - Command name to match.
 * @returns Positional arguments after the command, or an empty array.
 */
function peekCommandPositionals(argv: string[], command: string): string[] {
	const commandIndex = argv.indexOf(command);
	if (commandIndex === -1) return [];

	const positionals: string[] = [];
	for (const arg of argv.slice(commandIndex + 1)) {
		if (arg.startsWith("-")) break;
		positionals.push(arg);
	}
	return positionals;
}

export async function registerCommandsCli(app: CAC): Promise<void> {
	app.usage("<command> [options]");

	const registry = await loadRegistry();
	const argv = process.argv.slice(2);

	const createCmd = app.command(
		"create [template]",
		"Create a new project from a registry template item",
	);
	const peekedTemplate = peekCommandPositionals(argv, "create")[0];
	const createInputs = peekedTemplate
		? collectInputsForSelection(
				[peekedTemplate],
				registry.items,
				registry.commandInputs?.create,
			)
		: [];
	for (const input of createInputs) {
		const { flag, description } = registryInputToCliFlag(input);
		createCmd.option(flag, description);
	}
	createCmd.action(
		async (template: string | undefined, options: Record<string, unknown>) => {
			try {
				await logger.intro("fresh order coming up");
				await createCommand({
					template,
					cliOptions: options,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		},
	);

	const addCmd = app.command(
		"add [...items]",
		"Add one or more registry items to the current project",
	);
	const peekedItems = peekCommandPositionals(argv, "add");
	const addInputs =
		peekedItems.length > 0
			? collectInputsForSelection(
					peekedItems,
					registry.items,
					registry.commandInputs?.add,
				)
			: [];
	for (const input of addInputs) {
		const { flag, description } = registryInputToCliFlag(input);
		addCmd.option(flag, description);
	}
	addCmd.action(
		async (
			items: string[] | string | undefined,
			options: Record<string, unknown>,
		) => {
			try {
				await logger.intro("adding to the bag");

				let normalizedItems: string[];
				if (Array.isArray(items)) normalizedItems = items;
				else if (items) normalizedItems = [items];
				else normalizedItems = [];

				await addCommand({
					items: normalizedItems,
					cliOptions: options,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		},
	);

	const facets = collectRegistryFacets(registry.items);
	const listCmd = app.command("list", "List available registry items");
	listCmd.option("--all", "List items of every registry type");
	if (facets.type.length > 0) {
		listCmd.option(
			"--type <types>",
			`Filter by type: all, or comma-separated types (${facets.type.join(", ")}). Prompted when omitted`,
		);
	}
	for (const key of REGISTRY_FACET_KEYS) {
		if (key === "type") continue;
		if (facets[key].length === 0) continue;
		const kebab = registryFacetToKebab(key);
		listCmd.option(
			`--${kebab} <${kebab}>`,
			`Filter by ${kebab.replaceAll("-", " ")} (${facets[key].join(", ")})`,
		);
	}
	listCmd
		.option(
			"--values [facet]",
			`List available filter values (${REGISTRY_FACET_KEYS.map(registryFacetToKebab).join(", ")})`,
		)
		.action(async (options: Record<string, unknown>) => {
			try {
				await logger.intro("here's the menu");
				const { all, type, values, filters } = parseListCliOptions(
					options,
					facets,
				);
				const listOptions: ListCommandOptions = { ...filters };
				if (all) listOptions.all = all;
				if (type) listOptions.type = type;
				if (typeof values === "boolean" || typeof values === "string")
					listOptions.values = values;

				await listCommand(listOptions);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		});
}
