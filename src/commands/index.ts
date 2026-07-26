import type { CAC } from "cac";
import logger from "../cli/logger";
import { pickStringOptions } from "../cli/options";
import { loadRegistry } from "../registry/loader";
import { getRegistryItemTypes } from "../registry/schema";
import listCommand from "./list";

export async function registerCommandsCli(app: CAC): Promise<void> {
	app.usage("<command> [options]");

	// Collect registry items and create the list command
	const registry = await loadRegistry();
	const itemTypes = getRegistryItemTypes(registry);

	// Create the list command
	const listCmd = app.command("list", "List available registry items");
	listCmd.option(
		"--type <types>",
		`Filter by type: all, or comma-separated types (${itemTypes.join(", ")}). Lists all types when omitted`,
	);
	listCmd.action(async (options: Record<string, unknown>) => {
		try {
			await logger.intro("here's the menu");
			await listCommand(
				registry,
				itemTypes,
				pickStringOptions(options, ["type"]),
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(msg);
		}
	});
}
