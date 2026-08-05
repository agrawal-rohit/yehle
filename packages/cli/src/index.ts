import cac from "cac";
import { readConfig } from "./cli/config";
import { registerCommandsCli } from "./commands";
import { loadRuntimeRegistry } from "./registry-remote";

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

export default async function run(): Promise<void> {
	const app = cac("tuckshop");
	app.option("--registry <source>", "Use a custom registry URL");

	// Parse the arguments without running the command
	const { options } = app.parse(process.argv, { run: false });
	const registryOverride = readRegistryOverride(options.registry);

	// Read the saved global config
	const savedConfig = await readConfig();
	const registry = await loadRuntimeRegistry(
		registryOverride,
		savedConfig.registry,
	);

	await registerCommandsCli(app, registry, {
		registryFlag: registryOverride,
	});

	app.help();

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
	}
}
