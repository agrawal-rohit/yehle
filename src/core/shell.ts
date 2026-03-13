import { spawn } from "node:child_process";

export type RunOptions = {
	/** Working directory to run the command in. */
	cwd?: string;
	/**  How to handle stdio ("pipe": capture stdout and return it as a string (default), "inherit": stream output directly to the parent process, "ignore": ignore all stdio) */
	stdio?: "inherit" | "pipe" | "ignore";
	/**  Environment variables to use while running the command. */
	env?: NodeJS.ProcessEnv;
	/** Optional timeout in milliseconds for the command. */
	timeoutMs?: number;
};

/**
 * Parses a command string into a command name and an array of arguments.
 * Supports quoted arguments and spaces within arguments.
 * @param cmd - The command string to parse.
 * @returns An object containing the command name and an array of arguments.
 */
function parseCommand(cmd: string): { command: string; args: string[] } {
	const tokens: string[] = [];
	let current = "";
	let inQuotes = false;

	for (const char of cmd) {
		if (char === '"' && !inQuotes) {
			inQuotes = true;
		} else if (char === '"' && inQuotes) {
			inQuotes = false;
		} else if (char === " " && !inQuotes) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}
	if (current) tokens.push(current);

	const [command, ...args] = tokens;
	return { command, args };
}

/**
 * Run a command asynchronously and resolve with stdout (trimmed) for "pipe" stdio, or an empty string for "inherit" or "ignore" stdio.
 * The command string is parsed into command and arguments to avoid shell interpretation.
 * @param cmd - The command string to run (will be parsed into command and args).
 * @param opts - Optional run options to customize execution.
 * @returns Promise resolving to the trimmed stdout for "pipe" stdio, or empty string for others.
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

	// Default: capture stdout using spawn
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
 * Checks asynchronously if a command exists on the system's PATH.
 * Uses 'where' on Windows and 'command -v' on other platforms.
 * @param command - The command name to check.
 * @returns Promise resolving to true if the command exists, false otherwise.
 */
export async function commandExistsAsync(command: string): Promise<boolean> {
	try {
		if (process.platform === "win32") {
			await runAsync(`where ${command}`, { stdio: "ignore" });
		} else {
			// `which` is a real executable, unlike `command` which is a shell
			// built-in that spawn() cannot invoke without a shell.
			await runAsync(`which ${command}`, { stdio: "ignore" });
		}
		return true;
	} catch {
		return false;
	}
}
