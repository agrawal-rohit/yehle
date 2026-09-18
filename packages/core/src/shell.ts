import { spawn } from "node:child_process";

/** Options for running a subprocess. */
export interface RunOptions {
	/** Working directory to run the command in. */
	cwd?: string;
	/** How to handle stdio (`pipe` captures stdout; `inherit` streams to the parent; `ignore` discards both). */
	stdio?: "inherit" | "pipe" | "ignore";
	/** Environment variables merged over `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** Optional timeout in milliseconds for the command. */
	timeoutMs?: number;
}

/**
 * Process one character during command parsing, handling quotes and whitespace.
 * @param char - Current character from the command string.
 * @param state - Parser state tracking accumulator, active quote, and token status.
 * @param flush - Callback to push completed token.
 */
function consumeCommandChar(
	char: string,
	state: {
		current: string;
		quote: '"' | "'" | undefined;
		tokenStarted: boolean;
	},
	flush: () => void,
): void {
	if (state.quote) {
		if (char === state.quote) state.quote = undefined;
		else state.current += char;
		state.tokenStarted = true;
	} else if (char === '"' || char === "'") {
		state.quote = char;
		state.tokenStarted = true;
	} else if (/\s/u.test(char)) {
		flush();
	} else {
		state.current += char;
		state.tokenStarted = true;
	}
}

/**
 * Tokenize a command string into individual word tokens.
 * @param cmd - Raw command string.
 * @returns Parsed command and argument tokens.
 * @throws Error when an unterminated quote is detected or command is empty.
 */
function parseCommandTokens(cmd: string): string[] {
	const tokens: string[] = [];
	const state: {
		current: string;
		quote: '"' | "'" | undefined;
		tokenStarted: boolean;
	} = {
		current: "",
		quote: undefined,
		tokenStarted: false,
	};

	const flush = (): void => {
		if (state.tokenStarted) {
			tokens.push(state.current);
			state.current = "";
			state.tokenStarted = false;
		}
	};

	for (const char of cmd) {
		consumeCommandChar(char, state, flush);
	}

	if (state.quote) {
		const quoteName = state.quote === '"' ? "double" : "single";
		throw new Error(`Unterminated ${quoteName} quote in command`);
	}
	flush();

	if (tokens.length === 0) throw new Error("Command cannot be empty");
	return tokens;
}

/**
 * Parse a command string into a command name and argument list.
 * Supports single- and double-quoted arguments, whitespace separators, and rejects empty commands or unterminated quotes.
 * @param cmd - The command string to parse.
 * @returns Parsed command and arguments without invoking a shell.
 * @throws Error when the command is empty or contains an unterminated quote.
 */
function parseCommand(cmd: string): { command: string; args: string[] } {
	const [command, ...args] = parseCommandTokens(cmd);
	return { command, args };
}

/**
 * Build a failure error that includes captured stderr when available.
 * @param cmd - Original command string.
 * @param code - Process exit code.
 * @param signal - Signal that terminated the process, if any.
 * @param stderr - Captured stderr (may be empty).
 * @param timeoutMs - Configured timeout in milliseconds, if any.
 * @returns Error describing the failed command.
 */
function commandFailedError(
	cmd: string,
	code: number | null,
	signal: NodeJS.Signals | null,
	stderr: string,
	timeoutMs?: number,
): Error {
	const trimmed = stderr.trim();
	const detail = trimmed ? `: ${trimmed}` : "";
	let status = "no exit code";
	if (code !== null) status = `exit ${code}`;
	else if (timeoutMs !== undefined && timeoutMs > 0 && signal === "SIGTERM")
		status = `timed out after ${timeoutMs}ms`;
	else if (signal) status = `terminated by ${signal}`;
	return new Error(`Command failed: ${cmd} (${status})${detail}`);
}

/**
 * Run a command asynchronously without a shell.
 * @param cmd - Command string parsed into executable and args.
 * @param opts - Optional run options.
 * @returns Trimmed stdout for `pipe` stdio, or empty string for `inherit`/`ignore`.
 * @throws Error when the command is invalid, cannot start, or exits unsuccessfully.
 */
export function runAsync(cmd: string, opts: RunOptions = {}): Promise<string> {
	const { command, args } = parseCommand(cmd);
	return runArgvAsync(command, args, opts, cmd);
}

/**
 * Run an executable with an explicit argument vector without a shell.
 * @param executable - Program to spawn.
 * @param args - Argument vector.
 * @param opts - Optional run options.
 * @param display - Optional label used in failure messages (defaults to joined argv).
 * @returns Trimmed stdout for `pipe` stdio, or empty string for `inherit`/`ignore`.
 * @throws Error when the command cannot start or exits unsuccessfully.
 */
export function runArgvAsync(
	executable: string,
	args: string[],
	opts: RunOptions = {},
	display: string = [executable, ...args].join(" "),
): Promise<string> {
	const { cwd, stdio = "pipe", env, timeoutMs } = opts;
	const spawnEnv = { ...process.env, ...env };
	const pipes = stdio === "pipe";
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			cwd,
			env: spawnEnv,
			timeout: timeoutMs,
			// `inherit`/`ignore` pass their own stdio; `pipe` captures for stdout trimming.
			stdio: pipes ? ["ignore", "pipe", "pipe"] : stdio,
		});

		let stdout = "";
		let stderr = "";
		if (pipes) {
			child.stdout?.on("data", (data: Buffer | string) => {
				stdout += data;
			});
			child.stderr?.on("data", (data: Buffer | string) => {
				stderr += data;
			});
		}

		child.on("error", (error) => {
			reject(
				new Error(`Failed to start command: ${display}: ${error.message}`, {
					cause: error,
				}),
			);
		});
		child.on("close", (code, signal) => {
			if (code === 0) resolve(pipes ? stdout.trim() : "");
			else {
				reject(
					commandFailedError(
						display,
						code,
						signal,
						pipes ? stderr : "",
						timeoutMs,
					),
				);
			}
		});
	});
}
