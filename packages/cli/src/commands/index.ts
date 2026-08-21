import type { Registry } from "@tuckshop/core";
import type { CAC } from "cac";
import { readConfig } from "../cli/config";
import logger from "../cli/logger";
import { getBooleanOption, pickStringOptions } from "../cli/options";
import { textInput } from "../cli/prompts";
import addCommand from "./add";
import {
	configGetCommand,
	configSetCommand,
	configUnsetCommand,
} from "./config";
import listCommand from "./list";

/** Supported `tuckshop config` sub-actions. */
enum ConfigAction {
	GET = "get",
	SET = "set",
	UNSET = "unset",
}

/**
 * Register CLI commands. Registry-dependent commands load the registry lazily
 * in their action so config commands never need one.
 * @param app - CAC application instance.
 * @param loadRegistry - Loader used by commands that need registry data.
 */
export async function registerCommandsCli(
	app: CAC,
	loadRegistry: () => Promise<{ registry: Registry; catalogLocation: string }>,
): Promise<void> {
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
			try {
				const { registry, catalogLocation } = await loadRegistry();
				await logger.intro("adding registry items");
				await addCommand(registry, catalogLocation, {
					items: (items ?? []).filter(Boolean),
					overwrite: getBooleanOption(commandOptions, "overwrite"),
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(msg);
			}
		},
	);

	// Create the list command
	const listCmd = app.command("list", "List available registry items");
	listCmd.option(
		"--type <types>",
		"Filter by type: all, or comma-separated types. Lists all types when omitted",
	);
	listCmd.action(async (commandOptions: Record<string, unknown>) => {
		try {
			const { registry } = await loadRegistry();
			const itemTypes = Object.keys(registry.types);

			await logger.intro("here's the menu");
			await listCommand(
				registry,
				itemTypes,
				pickStringOptions(commandOptions, ["type"]),
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(msg);
		}
	});

	// Register the config commands
	const configCmd = app.command(
		"config <action> [source]",
		"Get, set, or unset the default registry source",
	);
	configCmd.example((bin) => `$ ${bin} config get`);
	configCmd.example((bin) => `$ ${bin} config set <url-or-path>`);
	configCmd.example((bin) => `$ ${bin} config unset`);
	configCmd.action(async (action?: string, source?: string) => {
		try {
			if (!action)
				throw new Error(
					"Missing config action. Usage: tuckshop config <get|set|unset> [source]",
				);

			switch (action) {
				// Get the config
				case ConfigAction.GET:
					await logger.intro("fetching the configuration");
					await configGetCommand();
					break;

				// Set the config
				case ConfigAction.SET: {
					await logger.intro("updating the configuration");

					// Prompt when the positional source was omitted
					let resolved = source?.trim() ?? "";
					if (!resolved) {
						resolved = await textInput("Registry URL or local path", {
							placeholder: "https://example.com/registry.json",
							required: true,
						});
					}
					if (!resolved) throw new Error("Registry source must not be empty.");

					await configSetCommand(resolved);
					break;
				}

				// Unset the config
				case ConfigAction.UNSET: {
					const hadSaved = Boolean((await readConfig()).registry);
					await logger.intro(
						hadSaved
							? "clearing the configuration (restored the default registry)"
							: "clearing the configuration (already using the default registry)",
					);
					await configUnsetCommand();
					break;
				}
				default:
					throw new Error(
						`Unknown config action "${action}". Use get, set, or unset.`,
					);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(msg);
		}
	});

	// Enrich `tuckshop config --help` with action/source docs (CAC only honors the
	// global help callback, so this must run via app.help rather than per-command).
	app.help((sections) => {
		const usage = sections.find((section) => section.title === "Usage");
		if (!usage?.body.includes("config <action>")) return sections;

		const usageIndex = sections.indexOf(usage);
		sections.splice(usageIndex + 1, 0, {
			title: "Arguments",
			body: [
				"  action               get | set | unset",
				"  source               Registry HTTPS URL or local path (prompts if omitted for set)",
			].join("\n"),
		});
		return sections;
	});
}
