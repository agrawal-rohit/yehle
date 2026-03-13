import type { CAC } from "cac";
import logger from "../cli/logger";
import generateAgentRule from "./agent-rule/command";
import type { GenerateAgentRuleConfiguration } from "./agent-rule/config";
import generatePackage from "./package/command";
import type { GeneratePackageConfiguration } from "./package/config";

export async function registerResourcesCli(app: CAC) {
	// Top-level description
	app.usage("<resource> [options]");

	// Register the `agent-rule` command
	app
		.command("agent-rule", "Summon an agent rule template for your IDE")
		.option("--rule <rule>", "Agent rule template name")
		.option(
			"--ide-format <format>",
			"Target IDE format (cursor, windsurf, cline, claude, copilot, gemini)",
		)
		.action(async (options: Partial<GenerateAgentRuleConfiguration>) => {
			try {
				await generateAgentRule({
					rule: options.rule,
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
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		});
}
