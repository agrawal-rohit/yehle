import fs from "node:fs";
import path from "node:path";

/**
 * Check whether a path exists and refers to a file (not a directory).
 * @param filePath - Absolute or relative path to check.
 * @returns Promise resolving to true when the path is a file, false otherwise.
 */
export async function isFileAsync(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isFile();
	} catch {
		return false;
	}
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
