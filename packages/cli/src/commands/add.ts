import path from "node:path";
import {
	assumeContextFromSelectedItems,
	resolveInstallPlan as buildInstallPlan,
	buildPackageInstallCommands,
	collectRegistryDependencies,
	collectRequiredConditions,
	defaultText,
	ecosystemManagers,
	inferPackageManagerFromLockfile,
	isFileAsync,
	parseWithSchema,
	primaryText,
	type Registry,
	type RegistryContext,
	RegistryEcosystem,
	type RegistryPackageManager,
	type RegistryPackages,
	type RegistryPayload,
	type ResolvedRegistryItem,
	registryPayloadSchema,
	runAsync,
	writeFileAsync,
} from "@tuckshop/core";
import chalk from "chalk";
import {
	confirmInput,
	groupedMultiselectInput,
	selectInput,
} from "../cli/prompts";
import tasks from "../cli/tasks";
import { loadRegistryPayloads } from "../registry/load";

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
 * Build an absolute path for a payload target under the project root.
 * @param projectDir - Absolute project root.
 * @param target - Destination path from the payload.
 * @returns Absolute destination path.
 * @throws Error when the target escapes the project directory.
 */
function absoluteProjectTarget(projectDir: string, target: string): string {
	const trimmed = target.trim();
	if (!trimmed) throw new Error("Payload file target must not be empty.");

	// Reject absolute paths, backslashes, and parent directory traversals.
	if (
		path.isAbsolute(trimmed) ||
		trimmed.includes("\\") ||
		trimmed.split("/").includes("..")
	)
		throw new Error(
			`Payload file target "${target}" must be a relative path under the project directory.`,
		);

	// Reject targets that escape the project directory.
	const absolutePath = path.resolve(projectDir, trimmed);
	const relative = path.relative(projectDir, absolutePath);
	if (relative.startsWith("..") || path.isAbsolute(relative))
		throw new Error(
			`Payload file target "${target}" escapes the project directory.`,
		);

	return absolutePath;
}

/**
 * Detect a single package manager from lockfiles in the project root.
 * @param projectDir - Absolute project root.
 * @param ecosystem - Registry ecosystem to detect for.
 * @returns Matching manager and lockfile name, or undefined when none/ambiguous.
 */
async function detectLockfileManager(
	projectDir: string,
	ecosystem: RegistryEcosystem,
): Promise<{ manager: RegistryPackageManager; lockfile: string } | undefined> {
	const matches: { manager: RegistryPackageManager; lockfile: string }[] = [];
	for (const spec of ecosystemManagers[ecosystem]) {
		let lockfile: string | undefined;
		for (const name of spec.lockfiles) {
			if (await isFileAsync(path.join(projectDir, name))) {
				lockfile = name;
				break;
			}
		}
		if (lockfile) matches.push({ manager: spec.manager, lockfile });
	}
	if (matches.length !== 1) return undefined;
	return matches[0];
}

/**
 * Select the package manager to use for an ecosystem.
 * Confirms a lockfile match when one is detected; otherwise prompts to choose.
 * @param ecosystem - Registry ecosystem with packages to install.
 * @param projectDir - Absolute project root.
 * @returns Selected or confirmed manager.
 */
async function selectPackageManager(
	ecosystem: RegistryEcosystem,
	projectDir: string,
): Promise<RegistryPackageManager> {
	const managers = ecosystemManagers[ecosystem].map((spec) => spec.manager);
	const detection = await detectLockfileManager(projectDir, ecosystem);
	if (detection) {
		const confirmed = await confirmInput(
			`${primaryText(detection.lockfile)} detected. Would you like to use ${primaryText(detection.manager)} to install the dependencies?`,
			{},
			true,
		);
		if (confirmed) return detection.manager;
	} else if (managers.length === 1) return managers[0];

	return selectInput(
		`Which package manager should install these ${ecosystem} packages?`,
		{
			options: managers.map((manager) => ({
				label: manager,
				value: manager,
			})),
		},
	);
}

/**
 * Pick a best-effort manager for next-step commands when the user skips installation.
 * @param ecosystem - Registry ecosystem with packages to install.
 * @param projectDir - Absolute project root.
 * @returns Inferred manager, or the ecosystem default.
 */
function fallbackPackageManager(
	ecosystem: RegistryEcosystem,
	projectDir: string,
): RegistryPackageManager {
	return (
		inferPackageManagerFromLockfile(projectDir, ecosystem) ??
		ecosystemManagers[ecosystem][0].manager
	);
}

/**
 * Return the package manager for an ecosystem, caching the choice for later payloads.
 * @param ecosystem - Registry ecosystem with packages to install.
 * @param projectDir - Absolute project root.
 * @param shouldInstall - When true, select a manager for a live install; otherwise use a fallback.
 * @param selectedManagers - Managers already chosen for this install run.
 * @returns Selected or fallback manager for the ecosystem.
 */
async function cachedPackageManager(
	ecosystem: RegistryEcosystem,
	projectDir: string,
	shouldInstall: boolean,
	selectedManagers: Map<RegistryEcosystem, RegistryPackageManager>,
): Promise<RegistryPackageManager> {
	const cached = selectedManagers.get(ecosystem);
	if (cached) return cached;

	const manager = shouldInstall
		? await selectPackageManager(ecosystem, projectDir)
		: fallbackPackageManager(ecosystem, projectDir);
	selectedManagers.set(ecosystem, manager);
	return manager;
}

/**
 * Build install commands for package declarations from each installed payload.
 * Selects a package manager once per ecosystem when `shouldInstall` is true.
 * @param packageDeclarations - Per-payload package maps from the install plan.
 * @param projectDir - Absolute project root.
 * @param shouldInstall - When true, select a manager and return runnable commands.
 * @returns Commands to run now and commands to suggest as next steps.
 */
async function collectPackageInstallCommands(
	packageDeclarations: RegistryPackages[],
	projectDir: string,
	shouldInstall: boolean,
): Promise<{ installCommands: string[]; pendingCommands: string[] }> {
	const installCommands: string[] = [];
	const pendingCommands: string[] = [];
	const selectedManagers = new Map<RegistryEcosystem, RegistryPackageManager>();
	const commands = shouldInstall ? installCommands : pendingCommands;

	for (const packages of packageDeclarations) {
		for (const ecosystem of Object.values(RegistryEcosystem)) {
			const packageSet = packages[ecosystem];
			if (!packageSet) continue;

			const manager = await cachedPackageManager(
				ecosystem,
				projectDir,
				shouldInstall,
				selectedManagers,
			);
			commands.push(
				...buildPackageInstallCommands(ecosystem, manager, packageSet),
			);
		}
	}

	return { installCommands, pendingCommands };
}

/**
 * Prompt for registry items in one list grouped by type when none were provided on the command line.
 * @param registry - Loaded registry catalog.
 * @returns Selected item ids.
 */
async function promptForItems(registry: Registry): Promise<string[]> {
	const items = Object.entries(registry.items);
	if (items.length === 0) throw new Error("No registry items are available.");

	// Build one multiselect section per catalog type, preserving type declaration order.
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
 * Capture required conditions by prompting for shared conditions.
 * @param registry - Loaded registry catalog.
 * @param items - Selected items (`id` or `id@variant`).
 * @returns Captured condition context for variant selection.
 */
async function captureRequiredConditions(
	registry: Registry,
	items: string[],
): Promise<RegistryContext> {
	// Assume context from selected items: pinned variant `when`, or item-level `when` when there are no variants.
	const context: RegistryContext = assumeContextFromSelectedItems(
		items,
		registry.items,
	);

	// Walk dependencies too so prompts only cover conditions needed by the full install plan.
	const dependencies = collectRegistryDependencies(items, registry.items);
	const required = collectRequiredConditions(
		dependencies,
		registry.conditions,
		context,
	);

	// Prompt only when a condition has more than one installable choice.
	for (const condition of required) {
		const soleOption =
			condition.values.length === 1 ? condition.values[0] : undefined;
		if (soleOption) {
			context[condition.key] = soleOption.value;
			continue;
		}

		const value = await selectInput<string>(
			condition.description ?? condition.label,
			{
				options: condition.values.map((entry) => ({
					label: entry.label,
					value: entry.value,
				})),
			},
		);
		context[condition.key] = value;
	}

	return context;
}

/**
 * Prompt before overwriting payload targets that already exist on disk.
 * @param projectDir - Absolute project root.
 * @param payloads - Parsed install payloads whose files may collide with existing paths.
 * @param overwrite - Skip overwrite prompts when true.
 * @throws Error when the user declines an overwrite or two payloads share a target.
 */
async function confirmFileOverwrites(
	projectDir: string,
	payloads: RegistryPayload[],
	overwrite: boolean,
): Promise<void> {
	if (overwrite) return;

	const seenTargets = new Set<string>();
	const existingTargets: string[] = [];
	for (const payload of payloads) {
		for (const file of payload.files) {
			const destination = absoluteProjectTarget(projectDir, file.target);

			// Absolute paths catch collisions even when payloads use different relative spellings.
			if (seenTargets.has(destination))
				throw new Error(
					`Multiple registry payloads write to the same target "${primaryText(file.target)}".`,
				);
			seenTargets.add(destination);

			if (await isFileAsync(destination)) existingTargets.push(file.target);
		}
	}

	if (existingTargets.length === 0) return;

	// Blank lines keep Clack prompts from colliding with Listr output on either side.
	console.log();
	for (const target of existingTargets) {
		const shouldOverwrite = await confirmInput(
			`Overwrite existing file ${primaryText(target)}?`,
			{},
			false,
		);
		if (!shouldOverwrite)
			throw new Error(
				`Installation canceled before overwriting ${primaryText(target)}.`,
			);
	}
	console.log();
}

/**
 * Write payload files to disk. Callers must resolve overwrite conflicts first.
 * @param projectDir - Absolute project root.
 * @param payload - Parsed install payload.
 * @param writtenTargets - Targets already written during this install.
 * @throws Error when two payloads in this run share a destination.
 */
async function writePayloadFiles(
	projectDir: string,
	payload: RegistryPayload,
	writtenTargets: Set<string>,
): Promise<void> {
	for (const file of payload.files) {
		const destination = absoluteProjectTarget(projectDir, file.target);

		// Absolute paths catch collisions even when payloads use different relative spellings.
		if (writtenTargets.has(destination))
			throw new Error(
				`Multiple registry payloads write to the same target "${primaryText(file.target)}".`,
			);

		await writeFileAsync(destination, file.content);
		writtenTargets.add(destination);
	}
}

/**
 * Print a compact install outro. Item names are already shown by the task list.
 * @param installedCount - Number of registry items written.
 * @param pendingInstallCommands - Install commands the user can run manually.
 */
function printInstallSummary(
	installedCount: number,
	pendingInstallCommands: string[] = [],
): void {
	const itemWord = installedCount === 1 ? "item" : "items";
	console.log();
	console.log(defaultText(`Installed ${installedCount} ${itemWord}.`));

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

/**
 * Parse fetched payload documents into labeled install units.
 * @param planItems - Ordered install nodes from the resolved plan.
 * @param registry - Loaded registry catalog for display titles.
 * @param payloadDocuments - Raw payload documents keyed by source URI.
 * @returns Prepared items ready for overwrite checks and file writes.
 * @throws Error when a planned source is missing from the fetched documents.
 */
function prepareInstallItems(
	planItems: ResolvedRegistryItem[],
	registry: Registry,
	payloadDocuments: Map<string, unknown>,
): PreparedInstallItem[] {
	return planItems.map((node) => {
		const rawPayload = payloadDocuments.get(node.source);
		if (rawPayload === undefined)
			throw new Error(
				`Missing payload for registry item "${node.itemId}" (${node.source}).`,
			);

		return {
			label: registry.items[node.itemId]?.title ?? node.itemId,
			payload: parseWithSchema(
				registryPayloadSchema,
				rawPayload,
				`Registry payload for "${node.itemId}"`,
			),
		};
	});
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
): Promise<RegistryPackages[]> {
	const writtenTargets = new Set<string>();
	const packageDeclarations: RegistryPackages[] = [];

	// One top-level task per item so names stay visible after Listr collapses.
	for (const { label, payload } of preparedItems) {
		await tasks.runWithTasks(`Installing "${label}"`, async () => {
			if (payload.packages) packageDeclarations.push(payload.packages);
			await writePayloadFiles(projectDir, payload, writtenTargets);
		});
	}

	return packageDeclarations;
}

/**
 * Prompt for and optionally run package install commands from payload declarations.
 * @param packageDeclarations - Per-payload package maps collected during writes.
 * @param projectDir - Absolute project root.
 * @returns Commands still left for the user when installation was skipped.
 */
async function installDeclaredPackages(
	packageDeclarations: RegistryPackages[],
	projectDir: string,
): Promise<string[]> {
	if (packageDeclarations.length === 0) return [];

	console.log();
	const shouldInstall = await confirmInput(
		"Would you like to install the required dependencies?",
		{},
		true,
	);
	const { installCommands, pendingCommands } =
		await collectPackageInstallCommands(
			packageDeclarations,
			projectDir,
			shouldInstall,
		);

	if (installCommands.length === 0) return pendingCommands;

	console.log();
	for (const command of installCommands) {
		await tasks.runWithTasks(command, async () => {
			await runAsync(command, { cwd: projectDir, stdio: "inherit" });
		});
	}

	// Successful installs replace manual next steps for the same packages.
	return [];
}

/**
 * Install registry items into the current project directory.
 * @param registry - Loaded registry catalog.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param options - Add command options.
 */
async function addCommand(
	registry: Registry,
	catalogLocation: string,
	options: AddCommandOptions = {},
): Promise<void> {
	const projectDir = process.cwd();
	const items =
		options.items && options.items.length > 0
			? options.items
			: await promptForItems(registry);

	const conditions = await captureRequiredConditions(registry, items);
	const plan = buildInstallPlan(items, registry.items, conditions);
	if (plan.items.length === 0)
		throw new Error("No registry items were selected for installation.");

	console.log();

	// Fetch first; overwrite prompts must not run under Listr or Clack stays invisible.
	let payloadDocuments = new Map<string, unknown>();
	await tasks.runWithTasks("Pre-flight checks", async () => {
		payloadDocuments = await loadRegistryPayloads(
			catalogLocation,
			plan.items.map((node) => node.source),
		);
	});

	const preparedItems = prepareInstallItems(
		plan.items,
		registry,
		payloadDocuments,
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
	printInstallSummary(preparedItems.length, pendingInstallCommands);
}

export default addCommand;
