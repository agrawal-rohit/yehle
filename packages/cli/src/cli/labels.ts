import chalk from "chalk";

/**
 * Primary brand color for CLI labels and accents.
 * @param message - Text to format.
 * @returns Styled string with brand hex color.
 */
export const primaryText = (message: string): string =>
	chalk.hex("#DFAD8D")(message);

/**
 * Muted secondary text for CLI output.
 * @param message - Text to format.
 * @returns Styled string with grey text.
 */
export const defaultText = (message: string): string => chalk.grey(message);

/**
 * Red background highlight for error/end prefixes.
 * @param message - Text to format.
 * @returns Styled string with red background.
 */
export const dangerHighlight = (message: string): string =>
	chalk.bgRed(message);
