import {
	assertScriptsAllowed,
	classifyRegistryTrust,
	collectDeclaredScriptUris,
	createScriptExecutor,
	localScriptPath,
	type Registry,
	type RegistryTrust,
	resolveSandboxRunnerPath,
	setScriptExecutor,
} from "@tuckshop/core";
import { confirmInput } from "../cli/prompts";
import { bundledRegistryPath } from "./registry";

/**
 * Resolve trust, prompt when needed, and install the sandboxed script executor.
 * @param options - Index location, registry, selected items, and project dir.
 * @returns Trust snapshot and whether scripts may run.
 */
export async function prepareScriptExecution(options: {
	indexLocation: string;
	registry: Registry;
	itemIds: readonly string[];
	projectDir: string;
}): Promise<{
	trust: RegistryTrust;
	scriptsAllowed: boolean;
}> {
	const trust = classifyRegistryTrust(
		options.indexLocation,
		bundledRegistryPath(),
	);
	const scriptUris = collectDeclaredScriptUris(
		options.registry,
		options.itemIds,
	);

	const scriptsAllowed = await assertScriptsAllowed(
		trust,
		scriptUris,
		(message) => confirmInput(message, {}, false),
	);

	if (scriptsAllowed) {
		setScriptExecutor(
			createScriptExecutor({
				resolveScriptPath: localScriptPath,
				scriptIntegrity: options.registry.scriptIntegrity,
				mode: "sandbox",
				projectDir: options.projectDir,
				runnerPath: resolveSandboxRunnerPath(),
			}),
		);
	} else {
		setScriptExecutor(undefined);
	}

	return { trust, scriptsAllowed };
}

/**
 * Prompt the user to review mutations returned by prepare hooks.
 * @param items - Prepared install items after prepare hooks.
 * @returns False when the user cancels the install.
 */
export async function confirmHookMutations(
	items: Array<{
		compiledItem: {
			files?: Array<{ target: string }>;
			dependencies?: {
				npm?: { runtime?: string[]; dev?: string[] };
			};
			commands?: {
				npm?: Record<string, string>;
			};
		};
	}>,
): Promise<boolean> {
	const fileTargets = [
		...new Set(
			items.flatMap((item) =>
				(item.compiledItem.files ?? []).map((file) => file.target),
			),
		),
	].sort((a, b) => a.localeCompare(b));
	const packages = [
		...new Set(
			items.flatMap((item) => {
				const deps = item.compiledItem.dependencies?.npm;
				if (!deps) return [];
				return [...(deps.runtime ?? []), ...(deps.dev ?? [])];
			}),
		),
	].sort((a, b) => a.localeCompare(b));
	const commands = [
		...new Set(
			items.flatMap((item) =>
				Object.keys(item.compiledItem.commands?.npm ?? {}),
			),
		),
	].sort((a, b) => a.localeCompare(b));

	if (
		fileTargets.length === 0 &&
		packages.length === 0 &&
		commands.length === 0
	)
		return true;

	console.log();
	console.log("Install scripts proposed the following changes:");
	if (fileTargets.length > 0) {
		console.log("  Files:");
		for (const target of fileTargets) console.log(`    - ${target}`);
	}
	if (packages.length > 0) {
		console.log("  Packages:");
		for (const name of packages) console.log(`    - ${name}`);
	}
	if (commands.length > 0) {
		console.log("  package.json scripts:");
		for (const name of commands) console.log(`    - ${name}`);
	}

	return confirmInput("Continue with these script-proposed changes?", {}, true);
}
