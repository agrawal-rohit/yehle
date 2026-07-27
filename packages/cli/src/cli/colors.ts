import chalk from "chalk";

/** Primary brand color for CLI labels and accents. */
export const primaryText = (message: string) => chalk.hex("#DFAD8D")(message);

/** Muted secondary text for CLI output. */
export const defaultText = (message: string) => chalk.grey(message);

/** Red background highlight for error/end prefixes. */
export const dangerHighlight = (message: string) => chalk.bgRed(message);
