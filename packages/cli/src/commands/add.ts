import {
	buildInstallPlan,
	buildInterpolationContext,
	type HandlerRuntime,
	type InstallNode,
	interpolatePayload,
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
	parseWithSchema,
	type Registry,
	type RegistryConditionValue,
	type RegistryContext,
	type RegistryEcosystemDependencies,
	type RegistryPayload,
	type RegistryPayloadFile,
	registryPayloadSchema,
	runAfterInstallHook,
	runBeforeInstallHook,
} from "@tuckshop/core";
import chalk from "chalk";
import { defaultText, primaryText } from "../cli/labels";
import { groupedMultiselectInput } from "../cli/prompts";
import { runWithTasks } from "../cli/tasks";
import {
	captureItemLocalConditionsForPlan,
	captureRequiredConditions,
	createProjectHandlerRuntime,
} from "../utils/conditions";
import { confirmFileOverwrites, writePayloadFiles } from "../utils/files";
import {
	installDeclaredPackages,
	mergeProjectCommands,
} from "../utils/packages";
import { loadRegistryPayloads } from "../utils/registry";

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
	/** Validated install payload. */
	payload: RegistryPayload;
}

/** Prepared install item paired with its install-plan node. */
interface InstallPlanItem extends PreparedInstallItem {
	/** Install node from the plan. */
	node: InstallNode;
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
 * Fail when two payload files share the same install target.
 * @param itemId - Registry item id for the error message.
 * @param files - Combined file list from base and pack payloads.
 * @throws Error when a target appears more than once.
 */
function assertUniquePayloadTargets(
	itemId: string,
	files: RegistryPayloadFile[],
): void {
	const seen = new Set<string>();
	for (const file of files) {
		if (seen.has(file.target))
			throw new Error(
				`Registry item "${itemId}" has duplicate payload target "${file.target}".`,
			);
		seen.add(file.target);
	}
}

/**
 * Merge one or more catalog payloads for a single install node.
 * @param itemId - Registry item id for error messages.
 * @param sources - Payload URIs selected for this node.
 * @param payloadDocuments - Raw payload documents keyed by source URI.
 * @returns Merged payload (files concatenated; deps/commands/secrets folded).
 * @throws Error when a planned source is missing or targets collide.
 */
function mergePayloadSources(
	itemId: string,
	sources: string[],
	payloadDocuments: Map<string, unknown>,
): RegistryPayload {
	const payloads: RegistryPayload[] = [];

	for (const source of sources) {
		const rawPayload = payloadDocuments.get(source);
		if (rawPayload === undefined)
			throw new Error(
				`Missing payload for registry item "${itemId}" (${source}).`,
			);
		payloads.push(
			parseWithSchema(
				registryPayloadSchema,
				rawPayload,
				`Registry payload for "${itemId}"`,
			),
		);
	}

	const files = payloads.flatMap((payload) => payload.files);
	assertUniquePayloadTargets(itemId, files);

	const dependencies = mergeEcosystemMaps(
		mergeDependencySet,
		...payloads.map((payload) => payload.dependencies),
	);
	const commands = mergeEcosystemMaps(
		mergeCommandSet,
		...payloads.map((payload) => payload.commands),
	);
	const secrets = mergeSecretNames(
		...payloads.map((payload) => payload.secrets),
	);

	return {
		files,
		...(dependencies ? { dependencies } : {}),
		...(commands ? { commands } : {}),
		...(secrets ? { secrets } : {}),
	};
}

/**
 * Parse fetched payload documents into labeled install units.
 * @param planItems - Ordered install nodes from the install plan.
 * @param registry - Loaded registry catalog for display titles.
 * @param payloadDocuments - Raw payload documents keyed by source URI.
 * @returns Prepared items ready for lifecycle scripts, overwrite checks, and writes.
 * @throws Error when a planned source is missing from the fetched documents.
 */
function prepareInstallItems(
	planItems: InstallNode[],
	registry: Registry,
	payloadDocuments: Map<string, unknown>,
): InstallPlanItem[] {
	return planItems.map((node) => {
		const label = registry.items[node.itemId]?.title ?? node.itemId;
		const sources = node.sources ?? [];

		if (sources.length === 0)
			return {
				label,
				node,
				payload: { files: [] },
			};

		return {
			label,
			node,
			payload: mergePayloadSources(node.itemId, sources, payloadDocuments),
		};
	});
}

/**
 * Apply one `beforeInstall` hook result to a payload and shared bindings.
 * @param payload - Payload accumulated for the current item.
 * @param hookResult - Hook output to merge.
 * @param bindings - Shared bindings map mutated in place.
 * @returns Payload with hook file and manifest updates applied.
 */
function applyBeforeInstallHookResult(
	payload: RegistryPayload,
	hookResult: Awaited<ReturnType<typeof runBeforeInstallHook>>,
	bindings: Record<string, string>,
): RegistryPayload {
	Object.assign(bindings, hookResult.bindings);
	return {
		...payload,
		files: hookResult.files,
		commands: hookResult.commands,
		dependencies: hookResult.dependencies,
		secrets: hookResult.secrets,
	};
}

/**
 * Run `beforeInstall` scripts for install items in plan order.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param runtime - Shared handler runtime.
 * @param conditions - Resolved condition context.
 * @param installItems - Prepared install items with plan nodes.
 * @returns Updated items and merged bindings.
 */
async function runBeforeInstallScripts(
	catalogLocation: string,
	runtime: HandlerRuntime,
	conditions: RegistryContext,
	installItems: InstallPlanItem[],
): Promise<{ items: InstallPlanItem[]; bindings: Record<string, string> }> {
	const bindings: Record<string, string> = {};
	const result: InstallPlanItem[] = [];

	for (const item of installItems) {
		let payload = item.payload;
		for (const scriptUri of item.node.beforeInstallScripts ?? []) {
			payload = applyBeforeInstallHookResult(
				payload,
				await runBeforeInstallHook(catalogLocation, scriptUri, runtime, {
					itemId: item.node.itemId,
					...(item.node.packIds ? { packIds: item.node.packIds } : {}),
					conditions,
					bindings,
					payload,
				}),
				bindings,
			);
		}

		result.push({ ...item, payload });
	}

	return { items: result, bindings };
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
 * Collect select option lists from shared and item-local conditions on the plan.
 * @param registry - Loaded registry catalog.
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

	let conditions = await captureRequiredConditions(
		registry,
		catalogLocation,
		projectDir,
		items,
		runtime,
	);

	let plan = buildInstallPlan(items, registry.items, conditions);
	if (plan.length === 0)
		throw new Error("No registry items were selected for installation.");

	({ context: conditions, plan } = await captureItemLocalConditionsForPlan(
		registry,
		catalogLocation,
		items,
		plan,
		conditions,
		runtime,
	));

	console.log();

	let payloadDocuments = new Map<string, unknown>();
	const payloadSources = [
		...new Set(plan.flatMap((node) => node.sources ?? []).filter(Boolean)),
	];

	if (payloadSources.length > 0)
		await runWithTasks("Fetching payloads", async () => {
			payloadDocuments = await loadRegistryPayloads(
				catalogLocation,
				payloadSources,
			);
		});

	const preparedItems = prepareInstallItems(plan, registry, payloadDocuments);

	const { items: afterHooks, bindings } = await runBeforeInstallScripts(
		catalogLocation,
		runtime,
		conditions,
		preparedItems,
	);

	const interpolationValues = buildInterpolationContext(
		conditions,
		bindings,
		interpolationOptionValues(registry, plan),
	);
	const installItems = afterHooks.map((item) => ({
		...item,
		payload: interpolatePayload(item.payload, interpolationValues),
	}));

	await confirmFileOverwrites(
		projectDir,
		installItems.map((item) => item.payload),
		options.overwrite === true,
	);

	const packageDeclarations = await writePreparedItems(
		projectDir,
		installItems,
	);

	await mergeProjectCommands(
		projectDir,
		installItems.map((item) => item.payload),
	);

	for (const item of installItems) {
		for (const scriptUri of item.node.afterInstallScripts ?? []) {
			await runAfterInstallHook(catalogLocation, scriptUri, runtime, {
				itemId: item.node.itemId,
				...(item.node.packIds ? { packIds: item.node.packIds } : {}),
				conditions,
				bindings,
				payload: item.payload,
			});
		}
	}

	const pendingInstallCommands = await installDeclaredPackages(
		packageDeclarations,
		projectDir,
		conditions,
	);

	const itemWord = installItems.length === 1 ? "item" : "items";
	console.log();
	console.log(defaultText(`Installed ${installItems.length} ${itemWord}.`));

	const secrets =
		mergeSecretNames(...installItems.map((item) => item.payload.secrets)) ?? [];
	printInstallNextSteps(pendingInstallCommands, secrets);

	console.log();
}
