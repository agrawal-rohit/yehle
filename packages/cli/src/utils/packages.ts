import fs from "node:fs";
import path from "node:path";
import {
	buildPackageInstallCommands,
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	RegistryEcosystem,
	type RegistryEcosystemDependencies,
	type RegistryPackageManager,
	type RegistryPayload,
	readFileAsync,
	runAsync,
	writeFileAsync,
} from "@tuckshop/core";
import { confirmInput } from "../cli/prompts";
import { runWithTasks } from "../cli/tasks";

/**
 * Build install commands for merged package declarations.
 * @param packageDeclarations - Per-payload package maps from the install plan.
 * @param packageManager - Selected npm package manager.
 * @param shouldInstall - When true, return runnable commands; otherwise next-step suggestions.
 * @returns Commands to run now and commands to suggest as next steps.
 */
async function collectPackageInstallCommands(
	packageDeclarations: RegistryEcosystemDependencies[],
	packageManager: RegistryPackageManager,
	shouldInstall: boolean,
): Promise<{ installCommands: string[]; pendingCommands: string[] }> {
	const merged = mergeEcosystemMaps(mergeDependencySet, ...packageDeclarations);
	const installCommands: string[] = [];
	const pendingCommands: string[] = [];
	if (!merged) return { installCommands, pendingCommands };

	const commands = shouldInstall ? installCommands : pendingCommands;
	const npmPackages = merged[RegistryEcosystem.NPM];
	if (npmPackages) {
		commands.push(
			...buildPackageInstallCommands(
				RegistryEcosystem.NPM,
				packageManager,
				npmPackages,
			),
		);
	}

	return { installCommands, pendingCommands };
}

/**
 * Optionally run package install commands from payload declarations.
 * @param packageDeclarations - Per-payload package maps collected during writes.
 * @param projectDir - Absolute project root.
 * @param packageManager - Selected npm package manager.
 * @returns Commands still left for the user when installation was skipped.
 */
export async function installDeclaredPackages(
	packageDeclarations: RegistryEcosystemDependencies[],
	projectDir: string,
	packageManager: RegistryPackageManager,
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
			packageManager,
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

/**
 * Merge payload `commands` into the project's package.json scripts.
 * @param projectDir - Absolute project root.
 * @param payloads - Install payloads whose commands may be merged.
 * @throws Error when commands are declared but package.json is missing.
 */
export async function mergeProjectCommands(
	projectDir: string,
	payloads: RegistryPayload[],
): Promise<void> {
	const commands = mergeEcosystemMaps(
		mergeCommandSet,
		...payloads.map((p) => p.commands),
	);
	const npmCommands = commands?.[RegistryEcosystem.NPM];
	if (!npmCommands || Object.keys(npmCommands).length === 0) return;

	const packageJsonPath = path.join(projectDir, "package.json");
	if (!fs.existsSync(packageJsonPath))
		throw new Error(
			"Cannot merge package.json scripts: package.json was not found in the project root.",
		);

	const raw = await readFileAsync(packageJsonPath);
	const packageJson = JSON.parse(raw) as {
		scripts?: Record<string, string>;
		[key: string]: unknown;
	};
	const scripts = { ...packageJson.scripts };

	for (const [name, command] of Object.entries(npmCommands)) {
		const existing = scripts[name];
		if (existing === command) continue;
		if (existing !== undefined) {
			const overwrite = await confirmInput(
				`package.json script "${name}" already exists. Overwrite with "${command}"?`,
				{},
				false,
			);
			if (!overwrite) continue;
		}
		scripts[name] = command;
	}

	packageJson.scripts = scripts;
	await writeFileAsync(
		packageJsonPath,
		`${JSON.stringify(packageJson, null, 2)}\n`,
	);
}
