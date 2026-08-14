import { dangerHighlight } from "@tuckshop/core";
import animatedIntro from "./animated-intro";

/** Logger utilities for the CLI. */
class Logger {
	/**
	 * Prints an introductory message.
	 * @param message - The introductory message to display.
	 */
	async intro(message: string): Promise<void> {
		await animatedIntro(message);
	}

	/**
	 * Prints an error message with a red background prefix and exits the process with code 1.
	 * @param message - The error message to display.
	 */
	error(message: string) {
		console.log();
		console.error(`${dangerHighlight(" error ")} ${message}`);
		console.log();
		process.exit(1);
	}
}

const logger = new Logger();
export default logger;
