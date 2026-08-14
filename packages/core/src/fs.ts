import fs from "node:fs";

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
