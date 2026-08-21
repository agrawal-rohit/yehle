import { spawn } from "node:child_process";

/** Options for running a subprocess. */
export interface RunOptions {
	/** Working directory to run the command in. */
	cwd?: string;
	/** How to handle stdio (`pipe` captures stdout; `inherit` streams to the parent). */
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
		if (char === '"' && !inQuotes) inQuotes = true;
		else if (char === '"' && inQuotes) inQuotes = false;
		else if (char === " " && !inQuotes) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else current += char;
	}
	if (current) tokens.push(current);

	const [command, ...args] = tokens;
	return { command, args };
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

	if (stdio === "inherit") {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd,
				env: { ...process.env, ...env },
				stdio: "inherit",
				timeout: timeoutMs,
			});

			child.on("error", reject);
			child.on("close", (code) => {
				if (code === 0) resolve("");
				else reject(new Error(`Command failed: ${cmd} (exit ${code})`));
			});
		});
	}

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
			timeout: timeoutMs,
		});

		let stdout = "";
		child.stdout.on("data", (data) => {
			stdout += data;
		});

		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(stdout.trim());
			else reject(new Error(`Command failed: ${cmd} (exit ${code})`));
		});
	});
}

/**
 * Check asynchronously if a command exists on the system's PATH.
 * @param command - The command name to check.
 * @returns True when the command is available.
 */
export async function commandExistsAsync(command: string): Promise<boolean> {
	try {
		if (process.platform === "win32")
			await runAsync(`where ${command}`, { stdio: "ignore" });
		else await runAsync(`which ${command}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
