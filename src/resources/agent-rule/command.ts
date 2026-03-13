import path from "node:path";
import chalk from "chalk";
import logger, { primaryText } from "../../cli/logger";
import tasks from "../../cli/tasks";
import {
	fetchAgentRuleContent,
	type GenerateAgentRuleConfiguration,
	getGenerateAgentRuleConfiguration,
} from "./config";
import { writeAgentRuleToFile } from "./ide-formats";

export async function generateAgentRule(
	options: Partial<GenerateAgentRuleConfiguration> = {},
): Promise<void> {
	await logger.intro("generating agent rule...");

	const config = await getGenerateAgentRuleConfiguration({
		rule: options.rule,
		ideFormat: options.ideFormat,
	});

	const cwd = process.cwd();
	let outputPath = "";

	await tasks.runWithTasks("Generating agent rule", undefined, [
		{
			title: "Fetch and write rule",
			task: async () => {
				const content = await fetchAgentRuleContent(config.rule);
				outputPath = await writeAgentRuleToFile(
					cwd,
					config.rule,
					content,
					config.ideFormat,
				);
			},
		},
	]);

	console.log();
	console.log(chalk.bold("Agent rule generated successfully!"));
	console.log();
	console.log(
		`  Rule written to ${primaryText(path.relative(cwd, outputPath))}`,
	);
	console.log();
}

export default generateAgentRule;
