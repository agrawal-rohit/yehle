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
export interface AddCommandOptions {
	/** Registry items (`id` or `id@variant`) from positional arguments. */
	items?: string[];
	/** Overwrite existing files without prompting. */
	overwrite?: boolean;
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
 * Write payload files to disk, prompting before overwriting existing targets.
 * @param projectDir - Absolute project root.
 * @param payload - Parsed install payload.
 * @param writtenTargets - Targets already written during this install.
 * @param overwrite - Skip overwrite prompts when true.
 */
async function writePayloadFiles(
	projectDir: string,
	payload: RegistryPayload,
	writtenTargets: Set<string>,
	overwrite: boolean,
): Promise<void> {
	for (const file of payload.files) {
		const destination = absoluteProjectTarget(projectDir, file.target);

		// Absolute paths catch collisions even when payloads use different relative spellings.
		if (writtenTargets.has(destination))
			throw new Error(
				`Multiple registry payloads write to the same target "${primaryText(file.target)}".`,
			);

		// Prompt to overwrite existing files if the user didn't specify to overwrite.
		if (!overwrite && (await isFileAsync(destination))) {
			const shouldOverwrite = await confirmInput(
				`Overwrite existing file ${primaryText(file.target)}?`,
				{},
				false,
			);
			if (!shouldOverwrite)
				throw new Error(
					`Installation canceled before overwriting ${primaryText(file.target)}.`,
				);
		}

		await writeFileAsync(destination, file.content);
		writtenTargets.add(destination);
	}
}

/**
 * Print install results and optional follow-up steps after task execution.
 * @param installedLabels - Installed registry item labels.
 * @param pendingInstallCommands - Install commands the user can run manually.
 */
function printInstallSummary(
	installedLabels: string[],
	pendingInstallCommands: string[] = [],
): void {
	console.log();
	console.log(chalk.bold("Registry items installed successfully!"));
	console.log();
	for (const label of installedLabels) console.log(defaultText(`  ✓ ${label}`));
	console.log();
	console.log(defaultText(`${installedLabels.length} item(s) installed`));

	if (pendingInstallCommands.length > 0) {
		console.log();
		console.log(chalk.bold("Next steps:"));
		console.log();
		pendingInstallCommands.forEach((command, index) => {
			console.log(
				`  ${index + 1}. Install dependencies with ${primaryText(command)}`,
			);
		});
	}

	console.log();
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

	const writtenTargets = new Set<string>();
	const packageDeclarations: RegistryPackages[] = [];
	const installedLabels: string[] = [];
	let payloadDocuments = new Map<string, unknown>();

	console.log();

	// Fetch all required registry payloads and install each planned item sequentially.
	await tasks.runWithTasks("Installing registry items", undefined, [
		{
			title: "Fetch registry payloads",
			task: async () => {
				payloadDocuments = await loadRegistryPayloads(
					catalogLocation,
					plan.items.map((node) => node.source),
				);
			},
		},
		...plan.items.map((node) => {
			const label = registry.items[node.itemId]?.title ?? node.itemId;

			return {
				title: label,
				task: async () => {
					const rawPayload = payloadDocuments.get(node.source);
					if (rawPayload === undefined)
						throw new Error(
							`Missing payload for registry item "${node.itemId}" (${node.source}).`,
						);

					const payload = parseWithSchema(
						registryPayloadSchema,
						rawPayload,
						`Registry payload for "${node.itemId}"`,
					);
					if (payload.packages) packageDeclarations.push(payload.packages);

					await writePayloadFiles(
						projectDir,
						payload,
						writtenTargets,
						options.overwrite === true,
					);
					installedLabels.push(label);
				},
			};
		}),
	]);

	let installCommands: string[] = [];
	let pendingInstallCommands: string[] = [];
	if (packageDeclarations.length > 0) {
		const shouldInstall = await confirmInput(
			"Would you like to install the required dependencies?",
			{},
			true,
		);
		const packageInstalls = await collectPackageInstallCommands(
			packageDeclarations,
			projectDir,
			shouldInstall,
		);
		installCommands = packageInstalls.installCommands;
		pendingInstallCommands = packageInstalls.pendingCommands;
	}

	if (installCommands.length > 0) {
		console.log();
		await tasks.runWithTasks("Finishing up", undefined, [
			...installCommands.map((command) => ({
				title: command,
				task: async () => {
					await runAsync(command, { cwd: projectDir, stdio: "inherit" });
				},
			})),
		]);
		// Successful installs replace manual next steps for the same packages.
		pendingInstallCommands = [];
	}

	printInstallSummary(installedLabels, pendingInstallCommands);
}

export default addCommand;
