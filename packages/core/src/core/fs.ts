import fs from "node:fs";
import path from "node:path";

/**
 * Check whether a path exists and refers to a regular file.
 * @param filePath - Absolute or relative path to check.
 * @returns Promise resolving to true when the path is a regular file, false otherwise.
 */
export async function isRegularFileAsync(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isFile();
	} catch {
		return false;
	}
}

/**
 * Read and parse a JSON file.
 * @param filePath - Absolute or relative path to the JSON file.
 * @returns Parsed JSON value.
 * @throws Error when the file is missing or contains invalid JSON.
 */
export async function readJSONFileAsync<T = unknown>(
	filePath: string,
): Promise<T> {
	const content = await fs.promises.readFile(filePath, "utf8");
	return JSON.parse(content) as T;
}

/**
 * Ensure a directory exists (mkdir -p). Creates parent directories as needed.
 * @param dirPath - Directory to create if missing.
 * @returns Promise that resolves when the directory exists.
 */
async function ensureDirAsync(dirPath: string): Promise<void> {
	await fs.promises.mkdir(dirPath, { recursive: true });
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
	const dir = path.dirname(filePath);
	await ensureDirAsync(dir);
	await fs.promises.writeFile(filePath, data, "utf8");
}
