import type { CAC } from "cac";
import logger from "../cli/logger";
import generateInstructions from "./instructions/command";
import type { GenerateInstructionsConfiguration } from "./instructions/config";
import generatePackage from "./package/command";
import type { GeneratePackageConfiguration } from "./package/config";

export async function registerResourcesCli(app: CAC) {
	// Top-level description
	app.usage("<resource> [options]");

	// Register the `instructions` command (add agent instructions to existing project)
	app
		.command("instructions", "Add agent instructions to an existing project")
		.option(
			"--instruction <name>",
			"Instruction template name (e.g. react-vite)",
		)
		.option(
			"--ide-format <format>",
			"Target IDE format (cursor, windsurf, cline, claude, copilot, gemini)",
		)
		.action(async (options: Partial<GenerateInstructionsConfiguration>) => {
			try {
				await generateInstructions({
					instruction: options.instruction,
					ideFormat: options.ideFormat,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		});

	// Register the `package` command
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
					public: options.public ? Boolean(options.public) : undefined,
					includeInstructions: options.includeInstructions,
					instructionsIdeFormat: options.instructionsIdeFormat,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		});
}
