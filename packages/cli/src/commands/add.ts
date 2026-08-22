import {
	type HandlerRuntime,
	parseWithSchema,
	type Registry,
	type RegistryContext,
	type RegistryEcosystemDependencies,
	type RegistryPayload,
	type ResolvedRegistryItem,
	registryPayloadSchema,
	resolveInstallPlan,
	runItemHandler,
} from "@tuckshop/core";
import chalk from "chalk";
import { defaultText, primaryText } from "../cli/labels";
import { groupedMultiselectInput } from "../cli/prompts";
import { runWithTasks } from "../cli/tasks";
import { loadRegistryPayloads } from "../registry/load";
import {
	captureRequiredConditions,
	createProjectHandlerRuntime,
} from "./add-conditions";
import { confirmFileOverwrites, writePayloadFiles } from "./add-files";
import { installDeclaredPackages } from "./add-packages";

/** Options accepted by the add command. */
interface AddCommandOptions {
	/** Registry items (`id` or `id@variant`) from positional arguments. */
	items?: string[];
	/** Overwrite existing files without prompting. */
	overwrite?: boolean;
}

/** Parsed payload paired with the display label used in install progress. */
interface PreparedInstallItem {
	/** Human-readable item title for task output. */
	label: string;
	/** Validated install payload. */
	payload: RegistryPayload;
}

/**
 * Prompt for registry items in one list grouped by type when none were provided on the command line.
 * @param registry - Loaded registry catalog.
 * @returns Selected item ids.
 */
async function promptForItems(registry: Registry): Promise<string[]> {
	const items = Object.entries(registry.items);
	if (items.length === 0) throw new Error("No registry items are available.");

	const options = Object.fromEntries(
		Object.keys(registry.types).flatMap((type) => {
			const group = items
				.filter(([, item]) => item.type === type)
				.sort(([, a], [, b]) => a.title.localeCompare(b.title))
				.map(([id, item]) => ({
					label: item.title,
					value: id,
					hint: item.description,
				}));
			return group.length > 0
				? [[registry.types[type].label, group] as const]
				: [];
		}),
	);

	const selected = await groupedMultiselectInput(
		"Which registry items should be added?",
		options,
	);

	if (selected.length === 0)
		throw new Error("Select at least one registry item to add.");

	return selected;
}

/**
 * Parse fetched payload documents into labeled install units.
 * @param planItems - Ordered install nodes from the resolved plan.
 * @param registry - Loaded registry catalog for display titles.
 * @param payloadDocuments - Raw payload documents keyed by source URI.
 * @returns Prepared items ready for handler hooks, overwrite checks, and writes.
 * @throws Error when a planned source is missing from the fetched documents.
 */
function prepareInstallItems(
	planItems: ResolvedRegistryItem[],
	registry: Registry,
	payloadDocuments: Map<string, unknown>,
): Array<PreparedInstallItem & { node: ResolvedRegistryItem }> {
	return planItems.map((node) => {
		const label = registry.items[node.itemId]?.title ?? node.itemId;

		if (!node.source)
			return {
				label,
				node,
				payload: { files: [] },
			};

		const rawPayload = payloadDocuments.get(node.source);
		if (rawPayload === undefined)
			throw new Error(
				`Missing payload for registry item "${node.itemId}" (${node.source}).`,
			);

		return {
			label,
			node,
			payload: parseWithSchema(
				registryPayloadSchema,
				rawPayload,
				`Registry payload for "${node.itemId}"`,
			),
		};
	});
}

/**
 * Run item handlers to transform payloads before overwrite checks.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param runtime - Shared handler runtime.
 * @param conditions - Resolved condition context.
 * @param preparedItems - Parsed payloads with plan nodes.
 * @returns Prepared items with post-handler file lists.
 */
async function applyItemHandlers(
	catalogLocation: string,
	runtime: HandlerRuntime,
	conditions: RegistryContext,
	preparedItems: Array<PreparedInstallItem & { node: ResolvedRegistryItem }>,
): Promise<PreparedInstallItem[]> {
	const variables: Record<string, string> = {};
	const result: PreparedInstallItem[] = [];

	for (const item of preparedItems) {
		if (!item.node.handler) {
			result.push({ label: item.label, payload: item.payload });
			continue;
		}

		const handled = await runItemHandler(
			catalogLocation,
			item.node.handler,
			runtime,
			{
				itemId: item.node.itemId,
				...(item.node.variantId ? { variantId: item.node.variantId } : {}),
				conditions,
				variables,
				payload: item.payload,
			},
		);

		Object.assign(variables, handled.variables);
		result.push({
			label: item.label,
			payload: {
				...item.payload,
				files: handled.files,
			},
		});
	}

	return result;
}

/**
 * Write prepared payloads to disk and collect any declared package maps.
 * @param projectDir - Absolute project root.
 * @param preparedItems - Parsed payloads with display labels.
 * @returns Package declarations found on the written payloads.
 */
async function writePreparedItems(
	projectDir: string,
	preparedItems: PreparedInstallItem[],
): Promise<RegistryEcosystemDependencies[]> {
	const writtenTargets = new Set<string>();
	const packageDeclarations: RegistryEcosystemDependencies[] = [];

	for (const { label, payload } of preparedItems) {
		await runWithTasks(`Installing ${primaryText(label)}`, async () => {
			if (payload.dependencies) packageDeclarations.push(payload.dependencies);
			await writePayloadFiles(projectDir, payload, writtenTargets);
		});
	}

	return packageDeclarations;
}

/**
 * Install registry items into the current project directory.
 * @param registry - Loaded registry catalog.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param options - Add command options.
 */
export async function addCommand(
	registry: Registry,
	catalogLocation: string,
	options: AddCommandOptions = {},
): Promise<void> {
	const projectDir = process.cwd();
	const items =
		options.items && options.items.length > 0
			? options.items
			: await promptForItems(registry);

	const runtime = createProjectHandlerRuntime(projectDir);
	const conditions = await captureRequiredConditions(
		registry,
		catalogLocation,
		projectDir,
		items,
		runtime,
	);
	const plan = resolveInstallPlan(items, registry.items, conditions);
	if (plan.items.length === 0)
		throw new Error("No registry items were selected for installation.");

	console.log();

	let payloadDocuments = new Map<string, unknown>();
	const payloadSources = plan.items
		.map((node) => node.source)
		.filter((source): source is string => Boolean(source));

	if (payloadSources.length > 0)
		await runWithTasks("Fetching payloads", async () => {
			payloadDocuments = await loadRegistryPayloads(
				catalogLocation,
				payloadSources,
			);
		});

	const preparedWithNodes = prepareInstallItems(
		plan.items,
		registry,
		payloadDocuments,
	);
	const preparedItems = await applyItemHandlers(
		catalogLocation,
		runtime,
		conditions,
		preparedWithNodes,
	);
	await confirmFileOverwrites(
		projectDir,
		preparedItems.map((item) => item.payload),
		options.overwrite === true,
	);

	const packageDeclarations = await writePreparedItems(
		projectDir,
		preparedItems,
	);
	const pendingInstallCommands = await installDeclaredPackages(
		packageDeclarations,
		projectDir,
	);

	// Print install summary
	const itemWord = preparedItems.length === 1 ? "item" : "items";
	console.log();
	console.log(defaultText(`Installed ${preparedItems.length} ${itemWord}.`));

	if (pendingInstallCommands.length > 0) {
		console.log();
		console.log(chalk.bold("Next steps"));
		pendingInstallCommands.forEach((command, index) => {
			console.log(
				`  ${index + 1}. Install dependencies with ${primaryText(command)}`,
			);
		});
	}

	console.log();
}
