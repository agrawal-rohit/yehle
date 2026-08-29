import type { CAC } from "cac";
import { animatedIntro } from "../cli/animated-intro";
import { runCliCommand } from "../cli/errors";
import type { LoadedRegistry } from "../utils/registry";
import { addCommand } from "./add";
import {
	configGetCommand,
	configSetCommand,
	configUnsetCommand,
} from "./config";
import { listCommand } from "./list";

/** Subcommands of `tuckshop config`, dispatched from one CAC command. */
enum ConfigAction {
	GET = "get",
	SET = "set",
	UNSET = "unset",
}

/**
 * Parse the CAC `<action>` argument into a known config subcommand.
 * @param action - Raw positional action from CAC.
 * @returns A known `ConfigAction`.
 * @throws Error when the action is not get, set, or unset.
 */
function parseConfigAction(action: string): ConfigAction {
	switch (action) {
		case ConfigAction.GET:
		case ConfigAction.SET:
		case ConfigAction.UNSET:
			return action;
		default:
			throw new Error(
				`Unknown config action "${action}". Usage: tuckshop config <get|set|unset> [source]`,
			);
	}
}

/**
 * Register CLI commands and their options.
 * @param app - CAC application instance.
 * @param loadRegistry - Loader used by commands that need registry data.
 */
export function registerCommandsCli(
	app: CAC,
	loadRegistry: () => Promise<LoadedRegistry>,
): void {
	const addCmd = app.command(
		"add [...items]",
		"Add registry items to the current working directory",
	);
	addCmd.option("--overwrite", "Overwrite existing files");
	addCmd.action(async (items: string[], options: { overwrite?: boolean }) => {
		await runCliCommand(async () => {
			const { registry, indexLocation } = await loadRegistry();
			await animatedIntro("adding registry items");
			await addCommand(registry, indexLocation, {
				items,
				overwrite: options.overwrite,
			});
		});
	});

	const listCmd = app.command("list", "List available registry items");
	listCmd.option(
		"--type <types>",
		"Filter by type: all, or comma-separated types. Lists all types when omitted",
	);
	listCmd.action(async (options: { type?: string | string[] }) => {
		await runCliCommand(async () => {
			const { registry } = await loadRegistry();
			await animatedIntro("here's the menu");
			listCommand(registry, options.type);
		});
	});

	const configCmd = app.command(
		"config <action> [source]",
		"Get, set, or unset the default registry source",
	);
	configCmd.usage("config <get|set|unset> [source]");
	configCmd.action(async (action: string, source?: string) => {
		await runCliCommand(async () => {
			const parsedAction = parseConfigAction(action);
			switch (parsedAction) {
				case ConfigAction.GET:
					await animatedIntro("fetching the configuration");
					await configGetCommand();
					return;
				case ConfigAction.SET:
					await animatedIntro("updating the configuration");
					await configSetCommand(source);
					return;
				case ConfigAction.UNSET:
					await animatedIntro("clearing the configuration");
					await configUnsetCommand();
					return;
				/* v8 ignore start */
				// Stryker disable all: unreachable exhaustive default
				default: {
					const _never: never = parsedAction;
					throw new Error(`Unhandled config action: ${_never}`);
				}
				// Stryker restore all
				/* v8 ignore stop */
			}
		});
	});
}
