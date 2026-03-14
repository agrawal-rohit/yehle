import type { CAC } from "cac";
import logger from "../cli/logger";
import generateInstructions from "./instructions/command";
import {
	type GenerateInstructionsOptions,
	IDE_FORMAT_OPTION_DESCRIPTION,
	INSTRUCTION_CATEGORY_OPTION_DESCRIPTION,
} from "./instructions/config";
import generatePackage from "./package/command";
import type { GeneratePackageConfiguration } from "./package/config";

export async function registerResourcesCli(app: CAC) {
	app.usage("<resource> [options]");

	app
		.command("instructions", "Add agent instructions to an existing project")
		.option("--category <type>", INSTRUCTION_CATEGORY_OPTION_DESCRIPTION)
		.option(
			"--instruction <name>",
			`Instruction template name (e.g. "code-quality-standards", "react-component-styles")`,
		)
		.option("--ide-format <format>", IDE_FORMAT_OPTION_DESCRIPTION)
		.action(async (options: Partial<GenerateInstructionsOptions>) => {
			try {
				await generateInstructions({
					category: options.category,
					instruction: options.instruction,
					ideFormat: options.ideFormat,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		});

	app
		.command("package", "Generate a package")
		.option("--name <name>", "Package name")
		.option("--lang <lang>", "Target language (e.g., typescript)")
		.option(
			"--public",
			"Public package (will setup for publishing to a package registry)",
		)
		.option("--template <template>", "Starter template for the package")
		.action(async (options: Partial<GeneratePackageConfiguration>) => {
			try {
				await generatePackage({
					lang: options.lang,
					name: options.name,
					template: options.template,
					public: options.public,
					includeInstructions: options.includeInstructions,
					instructionsIdeFormat: options.instructionsIdeFormat,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		});
}
