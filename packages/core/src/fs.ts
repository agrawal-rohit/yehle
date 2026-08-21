import fs from "node:fs";
import path from "node:path";

/** Result of classifying a filesystem path. */
export enum PathKind {
	FILE = "file",
	DIRECTORY = "directory",
	ABSENT = "absent",
}

/**
 * Check whether a filesystem error means the path does not exist.
 * Lets callers tolerate missing paths while still failing on permission or type errors.
 * @param error - Value caught from a filesystem call.
 * @returns True when the error carries an ENOENT code.
 */
export function isMissingPathError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}

/**
 * Classify a path as a file, directory, or absent.
 * @param filePath - Absolute or relative path to inspect.
 * @returns Path kind for the current filesystem state.
 * @throws Error on unexpected filesystem failures (anything other than missing).
 */
export async function pathKindAsync(filePath: string): Promise<PathKind> {
	try {
		const stat = await fs.promises.stat(filePath);
		if (stat.isDirectory()) return PathKind.DIRECTORY;
		if (stat.isFile()) return PathKind.FILE;
		throw new Error(
			`Path "${filePath}" exists but is neither a file nor a directory.`,
		);
	} catch (error) {
		if (isMissingPathError(error)) return PathKind.ABSENT;
		throw error;
	}
}

/**
 * Check whether a path exists and refers to a file (not a directory).
 * @param filePath - Absolute or relative path to check.
 * @returns Promise resolving to true when the path is a file, false otherwise.
 */
export async function isFileAsync(filePath: string): Promise<boolean> {
	return (await pathKindAsync(filePath)) === PathKind.FILE;
}

/**
 * Read a UTF-8 text file.
 * @param filePath - Absolute or relative path to the file.
 * @returns File contents.
 * @throws Error when the file is missing or unreadable.
 */
export async function readFileAsync(filePath: string): Promise<string> {
	return fs.promises.readFile(filePath, "utf8");
}

/** Thrown when a file cannot be parsed as JSON. */
export class InvalidJsonError extends Error {
	constructor(label: string, cause: unknown) {
		const message = cause instanceof Error ? cause.message : String(cause);
		super(`${label} is not valid JSON: ${message}`, { cause });
		this.name = "InvalidJsonError";
	}
}

/**
 * Read and parse a JSON file with a labeled error on syntax failure.
 * @param filePath - Absolute or relative path to the JSON file.
 * @param label - Error context prefix (e.g. `"Registry types"`).
 * @returns Parsed JSON value.
 * @throws {InvalidJsonError} when the file content is not valid JSON.
 * @throws Error when the file is missing or unreadable.
 */
export async function readJsonFileAsync(
	filePath: string,
	label: string,
): Promise<unknown> {
	const text = await readFileAsync(filePath);
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new InvalidJsonError(label, error);
	}
}

/**
 * List directory entries with file-type information.
 * @param dirPath - Directory to read.
 * @returns Directory entries.
 * @throws Error when the directory is missing or unreadable.
 */
export async function readDirectoryAsync(
	dirPath: string,
): Promise<fs.Dirent[]> {
	return fs.promises.readdir(dirPath, { withFileTypes: true });
}

/**
 * Remove a file or directory tree (missing paths are ignored).
 * @param targetPath - File or directory to remove.
 */
export async function removeAsync(targetPath: string): Promise<void> {
	await fs.promises.rm(targetPath, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50,
	});
}

/**
 * Write data to a file, ensuring parent directories exist.
 * @param filePath - Absolute or relative path to the file.
 * @param data - File contents.
 * @returns Promise that resolves when the file has been written.
 */
export async function writeFileAsync(
	filePath: string,
	data: string,
): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
	await fs.promises.writeFile(filePath, data, "utf8");
}
