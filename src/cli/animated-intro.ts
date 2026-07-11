import readline from "node:readline";
import chalk from "chalk";
import { sleep, truncate } from "../core/utils";
import { primaryText } from "./logger";

type Message = string | Promise<string>;

export type AnimatedIntroOptions = {
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

export async function animatedIntro(
	msg: Message | Message[] = [],
	{
		title = "Yehle",
		stdout = process.stdout,
		frameDelayMs = 150,
	}: AnimatedIntroOptions = {},
) {
	const messages = Array.isArray(msg) ? msg : [msg];

	// minimal TTY wiring (ESC to end, Ctrl+C to abort)
	const rl = readline.createInterface({
		input: process.stdin,
		escapeCodeTimeout: 50,
	});
	readline.emitKeypressEvents(process.stdin, rl);
	if (process.stdin.isTTY) process.stdin.setRawMode(true);

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

	const cleanup = () => {
		if (process.stdin.isTTY) process.stdin.setRawMode(false);
		process.stdin.off("keypress", onKeypress);
		rl.close();
		renderer.finish();
	};

	/* ---------------- layout constants ---------------- */
	const label = chalk.bold(primaryText(`${title}`));

	// fixed-height renderer
	const renderer = createFixedHeightRenderer(stdout, 3);

	for (const message of messages) {
		const resolvedMessage = Array.isArray(message)
			? await Promise.all(message)
			: await message;
		const words = Array.isArray(resolvedMessage)
			? resolvedMessage
			: String(resolvedMessage).split(" ");
		const finalMsg = words.join(" ");

		const columns = Math.max(40, stdout.columns || 80);
		const rightTitle = truncate(label, columns);
		const rightMsgFinal = truncate(finalMsg, columns);

		const spoken: string[] = [];

		for (const word of ["", ...words]) {
			if (word) spoken.push(word);

			const msgNow = truncate(spoken.join(" "), columns);
			const lines = ["", rightTitle, msgNow];
			renderer.paint(lines);

			await sleep(frameDelayMs);
		}

		// final calm frame: simple, balanced layout
		const lines = ["", rightTitle, rightMsgFinal];
		renderer.paint(lines);
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
