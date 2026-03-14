import path from "node:path";
import chalk from "chalk";
import logger, { primaryText } from "../../cli/logger";
import tasks from "../../cli/tasks";
import {
	fetchInstructionContent,
	type GenerateInstructionsOptions,
	getGenerateInstructionsConfiguration,
} from "./config";
import { writeInstructionToFile } from "./ide-formats";

/**
 * Add agent instructions to the current project (standalone flow).
 * Resolves configuration via CLI flags or prompts, then fetches and writes each selected instruction.
 * @param options - Optional CLI-style options (category, instruction, ideFormat).
 * @returns Promise that resolves when all instructions have been written.
 */
export async function generateInstructions(
	options: Partial<GenerateInstructionsOptions> = {},
): Promise<void> {
	await logger.intro("adding agent instructions...");

	const config = await getGenerateInstructionsConfiguration(options);

	const cwd = process.cwd();
	const outputPaths: string[] = [];

	await tasks.runWithTasks(
		"Adding instructions",
		undefined,
		config.selections.map((sel) => ({
			title: `Fetch and write ${sel.category}/${sel.instruction}`,
			task: async () => {
				const content = await fetchInstructionContent(
					sel.category,
					sel.instruction,
					sel.context,
				);
				const outputPath = await writeInstructionToFile(
					cwd,
					sel.instruction,
					content,
					config.ideFormat,
					sel.category,
					sel.metadata,
				);
				outputPaths.push(outputPath);
			},
		})),
	);

	console.log();
	console.log(chalk.bold("Agent instructions added successfully!"));
	console.log();
	for (const p of outputPaths)
		console.log(`  ${primaryText(path.relative(cwd, p))}`);
	console.log();
}

export default generateInstructions;
