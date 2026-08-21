import cac from "cac";
import { readConfig } from "./cli/config";
import { registerCommandsCli } from "./commands";
import { loadRuntimeRegistry } from "./registry/load";

export { printError } from "./cli/errors";

/**
 * Read a validated `--registry` override from parsed CAC options.
 * @param value - Raw option value from CAC.
 * @returns Registry source string, or undefined when the flag was omitted.
 * @throws Error when the flag is present without a usable string value.
 */
function readRegistryOverride(value: unknown): string | undefined {
	if (value === undefined) return undefined;

	// Throw an error if the value is true or an empty string
	if (value === true || value === "")
		throw new Error(
			"option `--registry <source>` value is missing. Provide a registry URL or local path.",
		);

	// Throw an error if the value is not a string
	if (typeof value !== "string")
		throw new TypeError(
			`option \`--registry <source>\` received an unexpected value (${typeof value}).`,
		);

	return value;
}

/** Run the tuckshop CLI. */
export default async function run(): Promise<void> {
	const app = cac("tuckshop");
	app.option("--registry <source>", "Use a custom registry URL");

	// Parse the arguments without running the command
	const { options } = app.parse(process.argv, { run: false });
	const registryOverride = readRegistryOverride(options.registry);

	// List loads the registry on demand so config commands can run even if it fails
	async function loadRegistry() {
		const saved = await readConfig();
		return loadRuntimeRegistry(registryOverride, saved.registry);
	}

	registerCommandsCli(app, loadRegistry);

	const args = process.argv.slice(2).filter(Boolean);
	if (args.length === 0) {
		app.outputHelp();
		return;
	}

	try {
		app.parse(process.argv);
	} catch {
		try {
			app.parse([...process.argv, "--help"]);
		} catch {
			app.outputHelp();
		}
		return;
	}

	// CAC exits quietly when argv matches no registered command. Skip when
	// `--help` already printed (cac unsets matchedCommandName after help).
	if (!app.matchedCommandName && !app.options.help) app.outputHelp();
}
