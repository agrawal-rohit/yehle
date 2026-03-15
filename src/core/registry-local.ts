import fs from "node:fs";
import path from "node:path";
import { isDirAsync } from "./fs";
import { getLocalTemplatesRoot } from "./registry";

/**
 * Resolve a repository subpath against the local templates root.
 * @param subpath - Path under the templates root, using forward slashes (e.g. "templates/typescript").
 * @returns The absolute path if it exists, null otherwise.
 */
export async function resolveLocalSubpath(
	subpath: string,
): Promise<string | null> {
	const root = await getLocalTemplatesRoot();
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
		exclude !== undefined
			? new Set(Array.from(exclude).map((n) => n.toLowerCase()))
			: null;

	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
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
		for (const ext of extensions) {
			if (entry.name.endsWith(ext)) {
				names.add(entry.name.slice(0, -ext.length));
				break;
			}
		}
	}

	return Array.from(names).sort((a, b) => a.localeCompare(b));
}
