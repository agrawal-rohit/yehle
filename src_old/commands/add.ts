import path from "node:path";
import chalk from "chalk";
import { primaryText } from "../cli/logger";
import prompts from "../cli/prompts";
import tasks from "../cli/tasks";
import { writeInstructionToFile } from "../core/ide-formats";
import { installRegistryPackages } from "../core/pkg-manager";
import {
	collectInputsForSelection,
	parseCliInputValues,
	resolveInstallContext,
} from "../registry/inputs";
import {
	type FileConflictAction,
	installRegistryItem,
	type OnFileConflictFn,
} from "../registry/install";
import { loadRegistry } from "../registry/loader";
import {
	itemHasFrameworkTarget,
	type RegistryInstallContext,
	selectRegistryVariant,
	variantMatchesContext,
} from "../registry/schema";
import {
	promptRegistryInput,
	resolveRegistryAddItems,
} from "../registry/select";

export type AddCommandOptions = {
	items?: string[];
	/** Pre-parsed values (tests / advanced). Prefer `cliOptions` from the CLI layer. */
	cliValues?: Partial<RegistryInstallContext>;
	/** Raw CAC options; parsed against the selected items' inputs. */
	cliOptions?: Record<string, unknown>;
};

/**
 * Add one or more registry items into the current project.
 * @param options - CLI options including item names and registry input values.
 */
export async function addCommand(
	options: AddCommandOptions = {},
): Promise<void> {
	const registry = await loadRegistry();
	const itemNames = await resolveRegistryAddItems(options.items);

	const cliValues =
		options.cliValues ??
		parseCliInputValues(
			options.cliOptions ?? {},
			collectInputsForSelection(
				itemNames,
				registry.items,
				registry.commandInputs?.add,
			),
		);

	const context = await resolveInstallContext({
		rootItemNames: itemNames,
		index: registry.items,
		commandInputs: registry.commandInputs?.add,
		cliValues,
		resolveInput: promptRegistryInput,
		command: "add",
	});

	for (const itemName of itemNames) {
		if (typeof context.framework !== "string") continue;

		const id = itemName.includes("@") ? itemName.split("@")[0] : itemName;
		const pinnedVariant = itemName.includes("@")
			? itemName.slice(itemName.indexOf("@") + 1)
			: undefined;
		const item = registry.items.get(id);
		if (!item || !itemHasFrameworkTarget(item)) continue;

		const variant = selectRegistryVariant(item, pinnedVariant, context);
		if (!variantMatchesContext(variant.targets, context))
			throw new Error(
				`Registry item "${itemName}" does not match framework "${context.framework}".`,
			);
	}

	const cwd = process.cwd();
	const writtenPaths: string[] = [];
	const collectedDependencies = new Set<string>();
	const collectedDevDependencies = new Set<string>();
	let applyOverwriteToAll: FileConflictAction | null = null;

	const onFileConflict: OnFileConflictFn = async (targetPath) => {
		if (applyOverwriteToAll) return applyOverwriteToAll;

		const relativePath = path.relative(cwd, targetPath);
		const overwrite = await prompts.confirmInput(
			`"${relativePath}" already exists. Overwrite?`,
			undefined,
			false,
		);
		const action: FileConflictAction = overwrite ? "overwrite" : "skip";

		const applyToAll = await prompts.confirmInput(
			"Apply this choice to all remaining conflicts?",
			undefined,
			false,
		);
		if (applyToAll) applyOverwriteToAll = action;

		return action;
	};

	for (const itemName of itemNames) {
		await tasks.runWithTasks(`Installing ${itemName}`, async () => {
			const result = await installRegistryItem({
				targetDir: cwd,
				itemName,
				context,
				resolveInput: promptRegistryInput,
				writeInstruction: writeInstructionToFile,
				onFileConflict,
			});
			writtenPaths.push(...result.writtenPaths);
			for (const dep of result.dependencies) collectedDependencies.add(dep);
			for (const dep of result.devDependencies)
				collectedDevDependencies.add(dep);
		});
	}

	if (collectedDependencies.size > 0 || collectedDevDependencies.size > 0) {
		await tasks.runWithTasks("Installing registry packages", async () => {
			await installRegistryPackages(
				cwd,
				Array.from(collectedDependencies),
				Array.from(collectedDevDependencies),
			);
		});
	}

	console.log();
	console.log(
		chalk.bold(
			itemNames.length === 1
				? "Registry item installed successfully!"
				: `${itemNames.length} registry items installed successfully!`,
		),
	);
	console.log();
	for (const outputPath of writtenPaths)
		console.log(`  ${primaryText(path.relative(cwd, outputPath))}`);
	console.log();
}

export default addCommand;
