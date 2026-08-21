import type { SpawnOptions } from "node:child_process";
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
 * Parse a command string into a command name and argument list.
 * Supports quoted arguments and spaces within quotes.
 * @param cmd - The command string to parse.
 * @returns Parsed command and arguments without invoking a shell.
 */
function parseCommand(cmd: string): { command: string; args: string[] } {
	const tokens: string[] = [];
	let current = "";
	let inQuotes = false;

	for (const char of cmd) {
		// Quotes toggle token boundaries; the quote characters themselves are not kept.
		if (char === '"') {
			inQuotes = !inQuotes;
			continue;
		}
		if (char === " " && !inQuotes) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);

	const [command, ...args] = tokens;
	return { command, args };
}

/**
 * Build a failure error that includes captured stderr when available.
 * @param cmd - Original command string.
 * @param code - Process exit code.
 * @param stderr - Captured stderr (may be empty).
 * @returns Error describing the failed command.
 */
function commandFailedError(
	cmd: string,
	code: number | null,
	stderr: string,
): Error {
	const trimmed = stderr.trim();
	const detail = trimmed ? `: ${trimmed}` : "";
	return new Error(`Command failed: ${cmd} (exit ${code})${detail}`);
}

/**
 * Run a command asynchronously without a shell.
 * @param cmd - Command string parsed into executable and args.
 * @param opts - Optional run options.
 * @returns Trimmed stdout for `pipe` stdio, or empty string for `inherit`/`ignore`.
 * @throws Error when the process exits with a non-zero code.
 */
export function runAsync(cmd: string, opts: RunOptions = {}): Promise<string> {
	const { cwd, stdio = "pipe", env, timeoutMs } = opts;
	const { command, args } = parseCommand(cmd);
	const spawnEnv = { ...process.env, ...env };
	const baseOptions: SpawnOptions = {
		cwd,
		env: spawnEnv,
		timeout: timeoutMs,
	};

	if (stdio === "inherit") {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { ...baseOptions, stdio: "inherit" });
			child.on("error", reject);
			child.on("close", (code) => {
				if (code === 0) resolve("");
				else reject(commandFailedError(cmd, code, ""));
			});
		});
	}

	if (stdio === "ignore") {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { ...baseOptions, stdio: "ignore" });
			child.on("error", reject);
			child.on("close", (code) => {
				if (code === 0) resolve("");
				else reject(commandFailedError(cmd, code, ""));
			});
		});
	}

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			...baseOptions,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (data: Buffer | string) => {
			stdout += data;
		});
		child.stderr?.on("data", (data: Buffer | string) => {
			stderr += data;
		});

		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(stdout.trim());
			else reject(commandFailedError(cmd, code, stderr));
		});
	});
}
