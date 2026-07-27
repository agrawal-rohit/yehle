import readline from "node:readline";
import chalk from "chalk";
import { stripAnsi } from "consola/utils";
import { primaryText } from "./colors";

type Message = string | Promise<string>;

/** Frame-cycled candy glyph shown beside the title during the intro. */
const LOGO_FRAMES = ["●", "◔", "◕", "◑", "◒", "◓", "◐", "○"] as const;
const LOGO_REST_FRAME = LOGO_FRAMES[0];

type AnimatedIntroOptions = {
	title?: string;
	stdout?: NodeJS.WriteStream;

	/** Animation speed (ms per frame). Default: 150 */
	frameDelayMs?: number;

	// legacy (ignored)
	clear?: boolean;
	ascii?: boolean;
	stdin?: NodeJS.ReadStream;
	hat?: string;
	ribbon?: string;
};

/**
 * Sleep for the specified number of milliseconds.
 * @param ms - The number of milliseconds to sleep.
 * @returns Promise that resolves after the given delay.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a string to a maximum visible length, respecting ANSI sequences.
 * If truncated, appends "...". ANSI styling is not preserved in the truncated section.
 * @param s - The input string to truncate.
 * @param max - The maximum visible length.
 * @returns The truncated string (with "..." if truncated).
 */
function truncate(s: string, max: number): string {
	const raw = stripAnsi(s);
	if (raw.length <= max) return s;
	return `${raw.slice(0, Math.max(0, max - 3))}...`;
}

/**
 * Format the intro title line with an optional animated logo prefix.
 * @param logoFrame - Logo frame to render, or undefined for plain title (non-TTY).
 * @param title - Intro title text.
 * @returns Formatted title line.
 */
function formatTitleLine(logoFrame: string | undefined, title: string): string {
	const titleLabel = chalk.bold(primaryText(title));
	if (!logoFrame) return titleLabel;
	return `${primaryText(logoFrame)} ${titleLabel}`;
}

/**
 * Print the intro once without animation (CI, piped stdout).
 * @param messages - Intro messages to display.
 * @param title - Intro title.
 * @param stdout - Output stream.
 */
async function printIntroPlain(
	messages: Message[],
	title: string,
	stdout: NodeJS.WriteStream,
): Promise<void> {
	const columns = Math.max(40, stdout.columns || 80);
	const titleLine = truncate(formatTitleLine(undefined, title), columns);

	for (const message of messages) {
		const resolvedMessage = Array.isArray(message)
			? await Promise.all(message)
			: await message;
		const words = Array.isArray(resolvedMessage)
			? resolvedMessage
			: String(resolvedMessage).split(" ");
		const finalMsg = truncate(words.join(" "), columns);
		stdout.write(`\n${titleLine}\n${finalMsg}\n`);
	}
}

async function animatedIntro(
	msg: Message | Message[] = [],
	{
		title = "tuckshop",
		stdout = process.stdout,
		frameDelayMs = 150,
	}: AnimatedIntroOptions = {},
) {
	const messages = Array.isArray(msg) ? msg : [msg];

	if (!stdout.isTTY) {
		await printIntroPlain(messages, title, stdout);
		return;
	}

	// minimal TTY wiring (ESC to end, Ctrl+C to abort)
	const rl = readline.createInterface({
		input: process.stdin,
		escapeCodeTimeout: 50,
	});
	readline.emitKeypressEvents(process.stdin, rl);
	if (process.stdin.isTTY) process.stdin.setRawMode(true);

	let logoFrameIndex = 0;
	const nextLogoFrame = (): string => {
		const frame = LOGO_FRAMES[logoFrameIndex % LOGO_FRAMES.length];
		logoFrameIndex += 1;
		return frame;
	};

	// fixed-height renderer
	const renderer = createFixedHeightRenderer(stdout, 3);

	const cleanup = () => {
		if (process.stdin.isTTY) process.stdin.setRawMode(false);
		process.stdin.off("keypress", onKeypress);
		rl.close();
		renderer.finish();
	};

	const onKeypress = (_: string, key: readline.Key) => {
		if (key?.ctrl && key?.name === "c") {
			cleanup();
			process.exit(0);
		}
		if (key?.name === "escape") {
			cleanup();
		}
	};
	process.stdin.on("keypress", onKeypress);

	const columns = Math.max(40, stdout.columns || 80);

	for (const message of messages) {
		const resolvedMessage = Array.isArray(message)
			? await Promise.all(message)
			: await message;
		const words = Array.isArray(resolvedMessage)
			? resolvedMessage
			: String(resolvedMessage).split(" ");
		const finalMsg = words.join(" ");

		const spoken: string[] = [];

		for (const word of ["", ...words]) {
			if (word) spoken.push(word);

			const msgNow = truncate(spoken.join(" "), columns);
			const titleLine = truncate(
				formatTitleLine(nextLogoFrame(), title),
				columns,
			);
			renderer.paint(["", titleLine, msgNow]);

			await sleep(frameDelayMs);
		}

		const titleLine = truncate(
			formatTitleLine(LOGO_REST_FRAME, title),
			columns,
		);
		renderer.paint(["", titleLine, truncate(finalMsg, columns)]);
		await sleep(200);
	}

	cleanup();
}

/* ---------------- fixed-height renderer ---------------- */
function createFixedHeightRenderer(out: NodeJS.WriteStream, height: number) {
	let initialized = false;
	return {
		paint(lines: string[]) {
			if (!initialized) {
				for (let i = 0; i < height; i++) {
					if (i) out.write("\n");
					out.write(lines[i]);
				}
				initialized = true;
				return;
			}

			out.write(`\x1b[${height - 1}F`);
			for (let i = 0; i < height; i++) {
				out.write("\x1b[2K");
				out.write(lines[i]);
				if (i < height - 1) out.write("\n");
			}
		},
		finish() {
			if (initialized) out.write("\n");
			initialized = false;
		},
	};
}

export default animatedIntro;
