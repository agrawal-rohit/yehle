import cac from "cac";
import { registerResourcesCli } from "./resources";

export default function run(): void {
	const app = cac("yehle");

	// Register all commands defined in resources
	registerResourcesCli(app);

	app.help();

	// Slice off 'node' and the script path, then filter out null/empty args (e.g. from extra spaces).
	const args = process.argv.slice(2).filter(Boolean);

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
