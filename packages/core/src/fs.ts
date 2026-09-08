import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** Result of classifying a filesystem path. */
export const PathKind = {
	FILE: "file",
	DIRECTORY: "directory",
	ABSENT: "absent",
} as const;

export type PathKind = (typeof PathKind)[keyof typeof PathKind];

/**
 * Check whether a filesystem error indicates the path does not exist.
 * @param error - Value caught from a filesystem call.
 * @returns True when the error carries an ENOENT code.
 */
export function isMissingPathError(
	error: unknown,
): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
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
		const stat = await fs.stat(filePath);
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
 * lstat a path without following symlinks, or `undefined` when it does not exist.
 * @param filePath - Absolute or relative path to inspect.
 * @returns File stats, or `undefined` when the path is missing.
 * @throws Error on unexpected filesystem failures (anything other than missing).
 */
export async function lstatAsync(filePath: string): Promise<Stats | undefined> {
	try {
		return await fs.lstat(filePath);
	} catch (error) {
		if (isMissingPathError(error)) return undefined;
		throw error;
	}
}

/**
 * Check whether a path exists and refers to a file (not a directory).
 * @param filePath - Absolute or relative path to check.
 * @returns Promise resolving to true when the path is a file, false otherwise.
 */
export async function isFileAsync(filePath: string): Promise<boolean> {
	try {
		return (await fs.stat(filePath)).isFile();
	} catch (error) {
		if (isMissingPathError(error)) return false;
		throw error;
	}
}

/**
 * Check whether a path exists and refers to a directory (not a file).
 * @param filePath - Absolute or relative path to check.
 * @returns Promise resolving to true when the path is a directory, false otherwise.
 */
export async function isDirectoryAsync(filePath: string): Promise<boolean> {
	try {
		return (await fs.stat(filePath)).isDirectory();
	} catch (error) {
		if (isMissingPathError(error)) return false;
		throw error;
	}
}

/**
 * Read a UTF-8 text file.
 * @param filePath - Absolute or relative path to the file.
 * @returns File contents.
 * @throws Error when the file is missing or unreadable.
 */
export async function readFileAsync(filePath: string): Promise<string> {
	return fs.readFile(filePath, "utf8");
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
export async function readJsonFileAsync<T = unknown>(
	filePath: string,
	label: string,
): Promise<T> {
	const text = await readFileAsync(filePath);
	try {
		return JSON.parse(text) as T;
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
export async function readDirectoryAsync(dirPath: string): Promise<Dirent[]> {
	return fs.readdir(dirPath, { withFileTypes: true });
}

/**
 * Remove a file or directory tree (missing paths are ignored).
 * @param targetPath - File or directory to remove.
 */
export async function removeAsync(targetPath: string): Promise<void> {
	await fs.rm(targetPath, {
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
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, data, "utf8");
}
