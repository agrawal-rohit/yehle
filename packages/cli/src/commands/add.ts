import {
	buildInstallPlan,
	buildInterpolationContext,
	type CompiledItem,
	type CompiledItemFile,
	compiledItemSchema,
	type HandlerRuntime,
	type InstallNode,
	interpolateCompiledItem,
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
	PACKAGE_MANAGER_KEY,
	packageManagerBindings,
	parseWithSchema,
	type Registry,
	type RegistryConditionValue,
	type RegistryContext,
	type RegistryEcosystemDependencies,
	type RegistryPackageManager,
	runFinalizeInstallHook,
	runPrepareInstallHook,
	selectNpmPackageManager,
	setScriptExecutor,
} from "@tuckshop/core";
import chalk from "chalk";
import { defaultText, primaryText } from "../cli/labels";
import { groupedMultiselectInput, selectInput } from "../cli/prompts";
import { runWithTasks } from "../cli/tasks";
import {
	captureItemLocalConditionsForPlan,
	captureRequiredConditions,
	createProjectHandlerRuntime,
} from "../utils/conditions";
import { confirmFileOverwrites, writeCompiledItemFiles } from "../utils/files";
import {
	installDeclaredPackages,
	mergeProjectCommands,
} from "../utils/packages";
import { loadCompiledItems } from "../utils/registry";
import { confirmHookMutations, prepareScriptExecution } from "../utils/scripts";

/** Options accepted by the add command. */
interface AddCommandOptions {
	/** Registry items (`id` or `id@pack`) from positional arguments. */
	items?: string[];
	/** Overwrite existing files without prompting. */
	overwrite?: boolean;
}

/** Parsed payload paired with the display label used in install progress. */
interface PreparedInstallItem {
	/** Human-readable item title for task output. */
	label: string;
	/** Validated compiled item. */
	compiledItem: CompiledItem;
}

/** Prepared install item paired with its install-plan node. */
interface InstallPlanItem extends PreparedInstallItem {
	/** Install node from the plan. */
	node: InstallNode;
}

/**
 * Prompt for registry items in one list grouped by type when none were provided on the command line.
 * @param registry - Loaded registry.
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
 * Fail when two compiled item files share the same install target.
 * @param itemId - Registry item id for the error message.
 * @param files - Combined file list from base and pack compiled items.
 * @throws Error when a target appears more than once.
 */
function assertUniqueCompiledItemTargets(
	itemId: string,
	files: CompiledItemFile[],
): void {
	const seen = new Set<string>();
	for (const file of files) {
		if (seen.has(file.target))
			throw new Error(
				`Registry item "${itemId}" has duplicate compiled item target "${file.target}".`,
			);
		seen.add(file.target);
	}
}

/**
 * Merge one or more compiled items for a single install node.
 * @param itemId - Registry item id for error messages.
 * @param sources - Compiled item URIs selected for this node.
 * @param compiledItemDocuments - Raw compiled item documents keyed by source URI.
 * @returns Merged payload (files concatenated; deps/commands/secrets folded).
 * @throws Error when a planned source is missing or targets collide.
 */
function mergeCompiledItemSources(
	itemId: string,
	sources: string[],
	compiledItemDocuments: Map<string, unknown>,
): CompiledItem {
	const compiledItems: CompiledItem[] = [];

	for (const source of sources) {
		const rawCompiledItem = compiledItemDocuments.get(source);
		if (rawCompiledItem === undefined)
			throw new Error(
				`Missing compiled item for registry item "${itemId}" (${source}).`,
			);
		compiledItems.push(
			parseWithSchema(
				compiledItemSchema,
				rawCompiledItem,
				`Compiled item for "${itemId}"`,
			),
		);
	}

	const files = compiledItems.flatMap((compiledItem) => compiledItem.files);
	assertUniqueCompiledItemTargets(itemId, files);

	const dependencies = mergeEcosystemMaps(
		mergeDependencySet,
		...compiledItems.map((compiledItem) => compiledItem.dependencies),
	);
	const commands = mergeEcosystemMaps(
		mergeCommandSet,
		...compiledItems.map((compiledItem) => compiledItem.commands),
	);
	const secrets = mergeSecretNames(
		...compiledItems.map((compiledItem) => compiledItem.secrets),
	);

	return {
		files,
		...(dependencies ? { dependencies } : {}),
		...(commands ? { commands } : {}),
		...(secrets ? { secrets } : {}),
	};
}

/**
 * Parse fetched compiled item documents into labeled install units.
 * @param planItems - Ordered install nodes from the install plan.
 * @param registry - Loaded registry for display titles.
 * @param compiledItemDocuments - Raw compiled item documents keyed by source URI.
 * @returns Prepared items ready for lifecycle scripts, overwrite checks, and writes.
 * @throws Error when a planned source is missing from the fetched documents.
 */
function prepareInstallItems(
	planItems: InstallNode[],
	registry: Registry,
	compiledItemDocuments: Map<string, unknown>,
): InstallPlanItem[] {
	return planItems.map((node) => {
		const label = registry.items[node.itemId]?.title ?? node.itemId;
		const sources = node.sources ?? [];

		if (sources.length === 0)
			return {
				label,
				node,
				compiledItem: { files: [] },
			};

		return {
			label,
			node,
			compiledItem: mergeCompiledItemSources(
				node.itemId,
				sources,
				compiledItemDocuments,
			),
		};
	});
}

/**
 * Apply one `prepare` hook result to a payload and shared bindings.
 * @param payload - Payload accumulated for the current item.
 * @param hookResult - Hook output to merge.
 * @param bindings - Shared bindings map mutated in place.
 * @returns Payload with hook file and manifest updates applied.
 */
function applyPrepareInstallHookResult(
	compiledItem: CompiledItem,
	hookResult: Awaited<ReturnType<typeof runPrepareInstallHook>>,
	bindings: Record<string, string>,
): CompiledItem {
	Object.assign(bindings, hookResult.bindings);
	return {
		...compiledItem,
		files: hookResult.files,
		commands: hookResult.commands,
		dependencies: hookResult.dependencies,
		secrets: hookResult.secrets,
	};
}

/**
 * Run `prepare` scripts for install items in plan order.
 * @param indexLocation - Absolute path or HTTPS URL of the index document.
 * @param runtime - Shared handler runtime.
 * @param conditions - Resolved condition context.
 * @param installItems - Prepared install items with plan nodes.
 * @returns Updated items and merged bindings.
 */
async function runPrepareInstallScripts(
	indexLocation: string,
	runtime: HandlerRuntime,
	conditions: RegistryContext,
	packageManager: RegistryPackageManager,
	installItems: InstallPlanItem[],
): Promise<{ items: InstallPlanItem[]; bindings: Record<string, string> }> {
	const bindings: Record<string, string> = {};
	const result: InstallPlanItem[] = [];

	for (const item of installItems) {
		let compiledItem = item.compiledItem;
		for (const scriptUri of item.node.prepareScripts ?? []) {
			compiledItem = applyPrepareInstallHookResult(
				compiledItem,
				await runPrepareInstallHook(indexLocation, scriptUri, runtime, {
					itemId: item.node.itemId,
					...(item.node.packIds ? { packIds: item.node.packIds } : {}),
					conditions,
					packageManager,
					bindings,
					compiledItem,
				}),
				bindings,
			);
		}

		result.push({ ...item, compiledItem });
	}

	return { items: result, bindings };
}

/**
 * Write prepared payloads to disk and collect any declared package maps.
 * @param projectDir - Absolute project root.
 * @param preparedItems - Parsed payloads with display labels.
 * @returns Package declarations found on the written compiledItems.
 */
async function writePreparedItems(
	projectDir: string,
	preparedItems: PreparedInstallItem[],
): Promise<RegistryEcosystemDependencies[]> {
	const writtenTargets = new Set<string>();
	const packageDeclarations: RegistryEcosystemDependencies[] = [];

	for (const { label, compiledItem } of preparedItems) {
		await runWithTasks(`Installing ${primaryText(label)}`, async () => {
			if (compiledItem.dependencies)
				packageDeclarations.push(compiledItem.dependencies);
			await writeCompiledItemFiles(projectDir, compiledItem, writtenTargets);
		});
	}

	return packageDeclarations;
}

/**
 * Collect select option lists from shared and item-local conditions on the plan.
 * @param registry - Loaded registry.
 * @param plan - Ordered install nodes.
 * @returns Options keyed by condition name.
 */
function interpolationOptionValues(
	registry: Registry,
	plan: InstallNode[],
): Record<string, RegistryConditionValue[]> {
	const options: Record<string, RegistryConditionValue[]> = {};
	for (const [key, condition] of Object.entries(registry.conditions ?? {})) {
		if (condition.values) options[key] = condition.values;
	}
	for (const node of plan) {
		const item = registry.items[node.itemId];
		for (const [key, condition] of Object.entries(item?.conditions ?? {})) {
			if (condition.values) options[key] = condition.values;
		}
	}
	return options;
}

/**
 * Print numbered Next steps for pending installs and repository secrets.
 * @param pendingInstallCommands - Package install commands still left for the user.
 * @param secrets - Repository secret names to configure manually.
 */
function printInstallNextSteps(
	pendingInstallCommands: string[],
	secrets: string[],
): void {
	if (pendingInstallCommands.length === 0 && secrets.length === 0) return;

	console.log();
	console.log(chalk.bold("Next steps"));
	let step = 1;
	for (const command of pendingInstallCommands) {
		console.log(`  ${step}. Install dependencies with ${primaryText(command)}`);
		step += 1;
	}
	if (secrets.length > 0) {
		console.log(
			`  ${step}. Configure the following repository secrets on GitHub:`,
		);
		for (const name of secrets) console.log(`     - ${primaryText(name)}`);
	}
}

/**
 * Install registry items into the current project directory.
 * @param registry - Loaded registry.
 * @param indexLocation - Absolute path or HTTPS URL of the index document.
 * @param options - Add command options.
 */
export async function addCommand(
	registry: Registry,
	indexLocation: string,
	options: AddCommandOptions = {},
): Promise<void> {
	const projectDir = process.cwd();
	const items =
		options.items && options.items.length > 0
			? options.items
			: await promptForItems(registry);

	await prepareScriptExecution({
		indexLocation,
		registry,
		itemIds: items,
		projectDir,
	});

	try {
		const runtime = createProjectHandlerRuntime(projectDir);

		const packageManager = await selectNpmPackageManager(projectDir, {
			select: selectInput,
		});
		const pmBindings = {
			[PACKAGE_MANAGER_KEY]: packageManager,
			...packageManagerBindings(packageManager),
		};

		let conditions = await captureRequiredConditions(
			registry,
			indexLocation,
			projectDir,
			items,
			runtime,
			packageManager,
		);

		let plan = buildInstallPlan(
			items,
			registry.items,
			conditions,
			packageManager,
		);
		if (plan.length === 0)
			throw new Error("No registry items were selected for installation.");

		({ context: conditions, plan } = await captureItemLocalConditionsForPlan(
			registry,
			indexLocation,
			items,
			plan,
			conditions,
			runtime,
			packageManager,
		));

		console.log();

		let compiledItemDocuments = new Map<string, unknown>();
		const compiledItemSources = plan.flatMap((node) => node.sources ?? []);

		if (compiledItemSources.length > 0)
			await runWithTasks("Fetching compiled items", async () => {
				compiledItemDocuments = await loadCompiledItems(
					indexLocation,
					compiledItemSources,
					registry.itemIntegrity,
				);
			});

		const preparedItems = prepareInstallItems(
			plan,
			registry,
			compiledItemDocuments,
		);

		const { items: afterHooks, bindings } = await runPrepareInstallScripts(
			indexLocation,
			runtime,
			conditions,
			packageManager,
			preparedItems,
		);

		const ranPrepareHooks = afterHooks.some(
			(item) => (item.node.prepareScripts ?? []).length > 0,
		);
		if (ranPrepareHooks && !(await confirmHookMutations(afterHooks))) {
			throw new Error(
				"Install cancelled: script-proposed changes were declined.",
			);
		}

		const interpolationValues = buildInterpolationContext(
			conditions,
			{ ...pmBindings, ...bindings },
			interpolationOptionValues(registry, plan),
		);
		const installItems = afterHooks.map((item) => ({
			...item,
			compiledItem: interpolateCompiledItem(
				item.compiledItem,
				interpolationValues,
			),
		}));

		await confirmFileOverwrites(
			projectDir,
			installItems.map((item) => item.compiledItem),
			options.overwrite === true,
		);

		const packageDeclarations = await writePreparedItems(
			projectDir,
			installItems,
		);

		await mergeProjectCommands(
			projectDir,
			installItems.map((item) => item.compiledItem),
		);

		for (const item of installItems) {
			for (const scriptUri of item.node.finalizeScripts ?? []) {
				await runFinalizeInstallHook(indexLocation, scriptUri, runtime, {
					itemId: item.node.itemId,
					...(item.node.packIds ? { packIds: item.node.packIds } : {}),
					conditions,
					packageManager,
					bindings,
					compiledItem: item.compiledItem,
				});
			}
		}

		const pendingInstallCommands = await installDeclaredPackages(
			packageDeclarations,
			projectDir,
			packageManager,
		);

		const itemWord = installItems.length === 1 ? "item" : "items";
		console.log();
		console.log(defaultText(`Installed ${installItems.length} ${itemWord}.`));

		const secrets =
			mergeSecretNames(
				...installItems.map((item) => item.compiledItem.secrets),
			) ?? [];
		printInstallNextSteps(pendingInstallCommands, secrets);

		console.log();
	} finally {
		setScriptExecutor(undefined);
	}
}
