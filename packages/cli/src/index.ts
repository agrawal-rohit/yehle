import type { Registry } from "@tuckshop/core";
import cac from "cac";
import { readConfig } from "./cli/config";
import { registerCommandsCli } from "./commands";
import { loadRuntimeRegistry } from "./registry-remote";

/** Minimal registry used when the invoked command does not need one. */
const PLACEHOLDER_REGISTRY: Registry = {
	contentBaseUrl: "",
	types: {},
	items: {},
};

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

/**
 * Whether argv targets `config` (which only reads/writes local preferences).
 * @param argv - Full process argv including node and script path.
 * @returns True when the first positional command is `config`.
 */
function isConfigCommand(argv: string[]): boolean {
	const args = argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg || arg === "--") break;
		if (arg === "config") return true;
		if (arg === "--registry") {
			i += 1;
			continue;
		}
		if (arg.startsWith("--registry=") || arg === "--help" || arg === "-h")
			continue;
		if (arg.startsWith("-")) continue;
		return false;
	}
	return false;
}

/**
 * Run the tuckshop CLI.
 */
export default async function run(): Promise<void> {
	const app = cac("tuckshop");
	app.option("--registry <source>", "Use a custom registry URL");

	// Parse the arguments without running the command
	const { options } = app.parse(process.argv, { run: false });
	const registryOverride = readRegistryOverride(options.registry);

	// Config commands only touch local preferences — skip remote registry load so
	// a broken saved URL cannot block get/set/unset.
	const registry = isConfigCommand(process.argv)
		? PLACEHOLDER_REGISTRY
		: await loadRuntimeRegistry(
				registryOverride,
				(await readConfig()).registry,
			);

	await registerCommandsCli(app, registry);

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
