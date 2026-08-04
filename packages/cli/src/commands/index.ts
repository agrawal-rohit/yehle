import type { Registry } from "@tuckshop/core";
import type { CAC } from "cac";
import logger from "../cli/logger";
import { pickStringOptions } from "../cli/options";
import {
	configGetCommand,
	configSetCommand,
	configUnsetCommand,
} from "./config";
import listCommand from "./list";

/** Invocation context passed into command registration. */
export interface RegisterCommandsOptions {
	/** Explicit `--registry` flag for this invocation. */
	registryFlag?: string;
}

/**
 * Register CLI commands against the loaded registry.
 * @param app - CAC application instance.
 * @param registry - Registry loaded for this invocation.
 * @param options - Optional invocation context used by config get.
 */
export async function registerCommandsCli(
	app: CAC,
	registry: Registry,
	options: RegisterCommandsOptions = {},
): Promise<void> {
	app.usage("<command> [options]");

	// Get the declared item types from the registry.
	const itemTypes = Object.keys(registry.types);

	// Create the list command
	const listCmd = app.command("list", "List available registry items");
	listCmd.option(
		"--type <types>",
		`Filter by type: all, or comma-separated types (${itemTypes.join(", ")}). Lists all types when omitted`,
	);
	listCmd.action(async (commandOptions: Record<string, unknown>) => {
		try {
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

	// Create the config commands
	const configGet = app.command(
		"config get",
		"Show the configured registry source",
	);
	configGet.action(async () => {
		try {
			await logger.intro("checking the shelves");
			await configGetCommand({
				flag: options.registryFlag,
				envRegistry: process.env.TUCKSHOP_REGISTRY,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(msg);
		}
	});

	const configSet = app.command(
		"config set <source>",
		"Persist a default registry source",
	);
	configSet.action(async (source: string) => {
		try {
			await logger.intro("stocking the shelves");
			await configSetCommand(source);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(msg);
		}
	});

	const configUnset = app.command(
		"config unset",
		"Clear the saved registry source",
	);
	configUnset.action(async () => {
		try {
			await logger.intro("clearing the shelves");
			await configUnsetCommand();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(msg);
		}
	});
}
