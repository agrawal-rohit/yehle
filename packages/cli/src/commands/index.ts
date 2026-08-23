import type { CAC } from "cac";
import { animatedIntro } from "../cli/animated-intro";
import { runCliCommand } from "../cli/errors";
import { getBooleanOption, pickStringOptions } from "../cli/options";
import type { LoadedRegistry } from "../registry/load";
import { addCommand } from "./add";
import {
	configGetCommand,
	configSetCommand,
	configUnsetCommand,
} from "./config";
import { listCommand } from "./list";

/**
 * Register CLI commands. Registry-dependent commands load the registry lazily
 * in their action so config commands never need one.
 * @param app - CAC application instance.
 * @param loadRegistry - Loader used by commands that need registry data.
 */
export function registerCommandsCli(
	app: CAC,
	loadRegistry: () => Promise<LoadedRegistry>,
): void {
	app.usage("<command> [options]");

	const addCmd = app.command(
		"add [items...]",
		"Add registry items to the current working directory",
	);
	addCmd.option("--overwrite", "Overwrite existing files");
	addCmd.action(
		async (
			items: string[] | undefined,
			commandOptions: Record<string, unknown>,
		) => {
			await runCliCommand(async () => {
				const { registry, catalogLocation } = await loadRegistry();
				await animatedIntro("adding registry items");
				await addCommand(registry, catalogLocation, {
					items: (items ?? []).map((item) => item.trim()).filter(Boolean),
					overwrite: getBooleanOption(commandOptions, "overwrite"),
				});
			});
		},
	);

	// Create the list command
	const listCmd = app.command("list", "List available registry items");
	listCmd.option(
		"--type <types>",
		"Filter by type: all, or comma-separated types. Lists all types when omitted",
	);
	listCmd.action(async (commandOptions: Record<string, unknown>) => {
		await runCliCommand(async () => {
			const { registry } = await loadRegistry();
			await animatedIntro("here's the menu");
			listCommand(registry, pickStringOptions(commandOptions, ["type"]).type);
		});
	});

	// Register the config commands
	const configCmd = app.command(
		"config",
		"Get, set, or unset the default registry source",
	);
	configCmd.action(async () => {
		/* v8 ignore next 5 — runCliCommand success path is unreachable because the action always throws */
		await runCliCommand(async () => {
			throw new Error(
				"Missing config action. Usage: tuckshop config <get|set|unset> [source]",
			);
		});
	});

	app
		.command("config get", "Print the active registry source")
		.action(async () => {
			await runCliCommand(async () => {
				await animatedIntro("fetching the configuration");
				await configGetCommand();
			});
		});

	app
		.command(
			"config set [source]",
			"Set the default registry HTTPS URL or local path (prompts if omitted)",
		)
		.example((bin) => `$ ${bin} config set <url-or-path>`)
		.action(async (source?: string) => {
			await runCliCommand(async () => {
				await animatedIntro("updating the configuration");
				await configSetCommand(source);
			});
		});

	app
		.command("config unset", "Clear the saved registry and use the default")
		.action(async () => {
			await runCliCommand(async () => {
				await animatedIntro("clearing the configuration");
				await configUnsetCommand();
			});
		});
}
