import cac from "cac";
import { readConfig } from "./cli/config";
import { registerCommandsCli } from "./commands";
import { loadRuntimeRegistry } from "./utils/registry";

export { printError } from "./cli/errors";

/** Run the tuckshop CLI. */
export default async function run(): Promise<void> {
	const app = cac("tuckshop");
	app.option("--registry <source>", "Use a custom registry URL");

	/**
	 * Load the runtime registry from the parsed `--registry` flag or saved config.
	 * Config commands never call this; add/list load the registry on demand.
	 * @returns Parsed registry and the index location it was loaded from.
	 */
	async function loadRegistry() {
		const saved = await readConfig();
		const flag = app.options.registry;
		const override =
			typeof flag === "string" && flag.length > 0 ? flag : undefined;
		return loadRuntimeRegistry(override, saved.registry);
	}

	registerCommandsCli(app, loadRegistry);
	app.help();

	// Parse first so async actions can be awaited.
	app.parse(process.argv, { run: false });
	await app.runMatchedCommand();

	// CAC already printed `--help` and then unset the matched command.
	if (!app.matchedCommand && !app.options.help) app.outputHelp();
}
