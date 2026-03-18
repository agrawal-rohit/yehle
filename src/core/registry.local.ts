import fs from "node:fs";
import path from "node:path";
import { isDirAsync } from "./fs";

/**
 * Resolve a directory under process.cwd() and return its path if it exists.
 * @param dirName - Name of the directory under cwd (e.g. "templates").
 * @returns The absolute path if the directory exists, null otherwise.
 */
export async function getLocalRoot(dirName: string): Promise<string | null> {
	const root = path.resolve(process.cwd(), dirName);
	if (await isDirAsync(root)) return root;
	return null;
}

/**
 * Resolve a repository subpath against the local templates root.
 * @param subpath - Path under the templates root, using forward slashes (e.g. "templates/typescript").
 * @returns The absolute path if it exists, null otherwise.
 */
export async function resolveLocalTemplatesSubpath(
	subpath: string,
): Promise<string | null> {
	const root = await getLocalRoot("templates");
	if (!root) return null;

	const fullPath = path.join(root, ...subpath.split("/").slice(1));
	if (await isDirAsync(fullPath)) return fullPath;
	return null;
}

/**
 * List child directory names for a local directory.
 * @param dir - Absolute path to the directory to scan.
 * @param exclude - Optional set of directory names (case-insensitive) to exclude.
 */
export async function listLocalChildDirs(
	dir: string,
	exclude?: Set<string>,
): Promise<string[]> {
	if (!(await isDirAsync(dir))) return [];
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });

	const excludeSet =
		exclude === undefined
			? null
			: new Set(Array.from(exclude).map((n) => n.toLowerCase()));

	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) =>
			excludeSet ? !excludeSet.has(name.toLowerCase()) : true,
		);
}

/**
 * List file basenames (without extension) from a local directory, filtered by extension.
 * @param dir - Absolute path to the directory to scan.
 * @param extensions - Allowed file extensions such as [".mdc", ".md"].
 */
export async function listLocalFilesWithExtensions(
	dir: string,
	extensions: readonly string[],
): Promise<string[]> {
	if (!(await isDirAsync(dir))) return [];
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });

	const names = new Set<string>();
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		for (const extension of extensions) {
			if (entry.name.endsWith(extension)) {
				names.add(entry.name.slice(0, -extension.length));
				break;
			}
		}
	}

	return Array.from(names).sort((a, b) => a.localeCompare(b));
}
