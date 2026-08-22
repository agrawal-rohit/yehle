import {
	buildPackageInstallCommands,
	detectPackageManagerFromLockfile,
	ecosystemManagers,
	mergeEcosystemDependencies,
	RegistryEcosystem,
	type RegistryEcosystemDependencies,
	type RegistryPackageManager,
	runAsync,
} from "@tuckshop/core";
import { primaryText } from "../cli/labels";
import { confirmInput, selectInput } from "../cli/prompts";
import { runWithTasks } from "../cli/tasks";

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
	const detection = detectPackageManagerFromLockfile(projectDir, ecosystem);
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
 * Build install commands for merged package declarations.
 * @param packageDeclarations - Per-payload package maps from the install plan.
 * @param projectDir - Absolute project root.
 * @param shouldInstall - When true, select a manager and return runnable commands.
 * @returns Commands to run now and commands to suggest as next steps.
 */
async function collectPackageInstallCommands(
	packageDeclarations: RegistryEcosystemDependencies[],
	projectDir: string,
	shouldInstall: boolean,
): Promise<{ installCommands: string[]; pendingCommands: string[] }> {
	const merged = mergeEcosystemDependencies(...packageDeclarations);
	const installCommands: string[] = [];
	const pendingCommands: string[] = [];
	if (!merged) return { installCommands, pendingCommands };

	const commands = shouldInstall ? installCommands : pendingCommands;

	for (const ecosystem of Object.values(RegistryEcosystem)) {
		const packageSet = merged[ecosystem];
		if (!packageSet) continue;

		const manager = shouldInstall
			? await selectPackageManager(ecosystem, projectDir)
			: (detectPackageManagerFromLockfile(projectDir, ecosystem)?.manager ??
				ecosystemManagers[ecosystem][0].manager);

		commands.push(
			...buildPackageInstallCommands(ecosystem, manager, packageSet),
		);
	}

	return { installCommands, pendingCommands };
}

/**
 * Prompt for and optionally run package install commands from payload declarations.
 * @param packageDeclarations - Per-payload package maps collected during writes.
 * @param projectDir - Absolute project root.
 * @returns Commands still left for the user when installation was skipped.
 */
export async function installDeclaredPackages(
	packageDeclarations: RegistryEcosystemDependencies[],
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
		await runWithTasks(command, async () => {
			await runAsync(command, { cwd: projectDir, stdio: "inherit" });
		});
	}

	return [];
}
