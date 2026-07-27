import cac from "cac";
import { registerCommandsCli } from "./commands";
import { loadRuntimeRegistry } from "./registry-remote";

/**
 * Read a global `--registry` option before command registration.
 * @param argv - Raw CLI args excluding the node executable and script path.
 * @returns Explicit registry override, or undefined when absent.
 */
function readRegistryOverride(argv: string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--registry") return argv[index + 1];
		if (token.startsWith("--registry="))
			return token.slice("--registry=".length);
	}

	return undefined;
}

/**
 * Bootstrap the tuckshop CLI: register commands, then parse argv or show help.
 * Registration is async because command flags are derived from the registry.
 */
export default async function run(): Promise<void> {
	const app = cac("tuckshop");
	app.option(
		"--registry <source>",
		"Use an alternate registry URL or local registry.json path",
	);

	const args = process.argv.slice(2).filter(Boolean);
	const registryOverride = readRegistryOverride(args);
	const registry = await loadRuntimeRegistry(registryOverride);

	await registerCommandsCli(app, registry);

	app.help();

	// Show global help when just the root command is called
	if (args.length === 0) {
		app.outputHelp();
		return;
	}

	try {
		// Run the command
		app.parse(process.argv);
	} catch {
		// If the command failed (due to incorrect arguments, missing commands, etc)
		// Attempt to show help for the command by appending --help to the original args
		try {
			app.parse([...process.argv, "--help"]);
		} catch {
			// Final fallback: show top-level help
			app.outputHelp();
		}
	}
}
