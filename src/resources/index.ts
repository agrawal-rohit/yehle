import type { CAC } from "cac";
import logger from "../cli/logger";
import generateInstructions from "./instructions/command";
import type { GenerateInstructionsOptions } from "./instructions/config";
import { IDE_FORMATS } from "./instructions/ide-formats";
import generatePackage from "./package/command";
import type { GeneratePackageConfiguration } from "./package/config";

export async function registerResourcesCli(app: CAC) {
	app.usage("<resource> [options]");

	app
		.command("instructions", "Add agent instructions to an existing project")
		.option(
			"--ide-format <format>",
			`Target IDE format (${IDE_FORMATS.map((f) => f.value).join(", ")})`,
		)
		.action(async (options: Partial<GenerateInstructionsOptions>) => {
			try {
				await generateInstructions({
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
				const publicFlag = options.public ? Boolean(options.public) : undefined;
				const includeInstructionsFlag = options.includeInstructions
					? Boolean(options.includeInstructions)
					: undefined;

				await generatePackage({
					lang: options.lang,
					name: options.name,
					template: options.template,
					public: publicFlag,
					includeInstructions: includeInstructionsFlag,
					instructionsIdeFormat: options.instructionsIdeFormat,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		});
}
