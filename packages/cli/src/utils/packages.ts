import fs from "node:fs";
import path from "node:path";
import {
	buildPackageInstallCommands,
	type CompiledItem,
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	RegistryEcosystem,
	type RegistryEcosystemDependencies,
	type RegistryPackageManager,
	readFileAsync,
	runAsync,
	writeFileAsync,
} from "@tuckshop/core";
import { confirmInput } from "../cli/prompts";
import { runWithTasks } from "../cli/tasks";

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

	const merged = mergeEcosystemMaps(mergeDependencySet, ...packageDeclarations);
	const npmPackages = merged?.[RegistryEcosystem.NPM];
	if (!npmPackages) return [];

	const packageNames = [
		...new Set([...(npmPackages.runtime ?? []), ...(npmPackages.dev ?? [])]),
	].sort((a, b) => a.localeCompare(b));
	if (packageNames.length === 0) return [];

	console.log();
	console.log("Packages to install:");
	for (const name of packageNames) console.log(`  - ${name}`);

	const shouldInstall = await confirmInput(
		"Would you like to install the required dependencies?",
		{},
		true,
	);
	const commands = buildPackageInstallCommands(
		RegistryEcosystem.NPM,
		packageManager,
		npmPackages,
	);

	if (!shouldInstall) return commands;

	console.log();
	for (const command of commands) {
		await runWithTasks(command, async () => {
			await runAsync(command, { cwd: projectDir, stdio: "inherit" });
		});
	}

	return [];
}

/**
 * Merge payload `commands` into the project's package.json scripts.
 * @param projectDir - Absolute project root.
 * @param payloads - Compiled items whose commands may be merged.
 * @throws Error when commands are declared but package.json is missing.
 */
export async function mergeProjectCommands(
	projectDir: string,
	compiledItems: CompiledItem[],
): Promise<void> {
	const commands = mergeEcosystemMaps(
		mergeCommandSet,
		...compiledItems.map((p) => p.commands),
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
