import path from "node:path";
import chalk from "chalk";
import logger, { primaryText } from "../../cli/logger";
import tasks from "../../cli/tasks";
import {
	fetchInstructionContent,
	type GenerateInstructionsConfiguration,
	getGenerateInstructionsConfiguration,
} from "./config";
import { writeInstructionToFile } from "./ide-formats";

export async function generateInstructions(
	options: Partial<GenerateInstructionsConfiguration> = {},
): Promise<void> {
	await logger.intro("adding agent instructions...");

	const config = await getGenerateInstructionsConfiguration({
		instruction: options.instruction,
		ideFormat: options.ideFormat,
	});

	const cwd = process.cwd();
	let outputPath = "";

	await tasks.runWithTasks("Adding instructions", undefined, [
		{
			title: "Fetch and write instruction",
			task: async () => {
				const content = await fetchInstructionContent(
					config.category,
					config.instruction,
				);
				outputPath = await writeInstructionToFile(
					cwd,
					config.instruction,
					content,
					config.ideFormat,
					config.category,
					config.metadata,
				);
			},
		},
	]);

	console.log();
	console.log(chalk.bold("Agent instructions added successfully!"));
	console.log();
	console.log(
		`  Instructions written to ${primaryText(path.relative(cwd, outputPath))}`,
	);
	console.log();
}

export default generateInstructions;
