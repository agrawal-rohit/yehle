import chalk from "chalk";
import animatedIntro from "./animated-intro";

// Log colors
export const primaryText = (message: string) => chalk.hex("#FEA624")(message);
export const defaultText = (message: string) => chalk.grey(message);
export const dangerHighlight = (message: string) => chalk.bgRed(message);

/** Logger utilities for the CLI. */
export class Logger {
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

	/**
	 * Prints an end message with a red background prefix and exits the process with code 0.
	 * @param message - The end message to display.
	 */
	end(message: string) {
		console.log();
		console.error(`${dangerHighlight(" end ")} ${message}`);
		console.log();
		process.exit(0);
	}
}

const logger = new Logger();
export default logger;
