import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadTemplate } from "giget";
import { isDirAsync } from "./fs";

/** Default GitHub owner for fetching templates and instructions in remote mode. */
export const DEFAULT_GITHUB_OWNER = "agrawal-rohit";

/** Default GitHub repository for fetching templates and instructions in remote mode. */
export const DEFAULT_GITHUB_REPO = "yehle";

/** HTTP headers used when calling the GitHub API. */
export const GITHUB_HEADERS = {
	"User-Agent": "yehle-cli",
	Accept: "application/vnd.github.v3+json",
} as const;

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
 * Resolve the local templates root directory (process.cwd()/templates).
 * @returns The absolute path if it exists, null otherwise.
 */
export async function getLocalTemplatesRoot(): Promise<string | null> {
	return getLocalRoot("templates");
}

/**
 * Build a GitHub Contents API URL for a repository subpath.
 * @param subpath - Path under the repository root, using forward slashes (e.g. "templates/typescript").
 */
export function buildContentsURL(subpath: string): string {
	return `https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/contents/${subpath}`;
}

/**
 * Build a giget specification string for a repository subpath.
 * @param subpath - Path under the repository root, using forward slashes.
 */
export function buildGigetSpec(subpath: string): string {
	return `github:${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/${subpath}`;
}

/**
 * Download a GitHub subtree to a temporary directory and return the raw download directory.
 * Normalization to a specific subpath is left to the caller so different
 * registry consumers can adapt to giget's layout for their own use-cases.
 * @param subpath - Repository subpath being downloaded (for error messages only).
 * @param tmpPrefix - Prefix for the temporary directory name.
 */
export async function downloadSubtreeToTemp(
	subpath: string,
	tmpPrefix: string,
): Promise<string> {
	const spec = buildGigetSpec(subpath);
	const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), tmpPrefix));

	try {
		const res = await downloadTemplate(spec, { dir: tmpRoot, force: true });
		return res.dir;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(
			`Failed to download templates from "${spec}" (subpath "${subpath}"). ${msg}. ` +
				`Ensure the path exists and that network/GitHub access are available.`,
		);
	}
}

/**
 * List child directory names from the GitHub Contents API for a repository subpath.
 * @param subpath - Path under the repository root, using forward slashes.
 * @param exclude - Optional set of directory names (case-insensitive) to exclude.
 */
export async function listRemoteChildDirsViaAPI(
	subpath: string,
	exclude?: Set<string>,
): Promise<string[]> {
	const url = buildContentsURL(subpath);
	const res = await fetch(url, { headers: GITHUB_HEADERS });
	if (!res.ok)
		throw new Error(
			`Failed to fetch from GitHub API: ${res.status} ${res.statusText}`,
		);

	const data = await res.json();
	if (!Array.isArray(data))
		throw new Error(
			"Invalid response from GitHub API: expected array of contents",
		);

	const excludeSet =
		exclude !== undefined
			? new Set(Array.from(exclude).map((n) => n.toLowerCase()))
			: null;

	return data
		.filter((entry) => entry?.type === "dir" && typeof entry.name === "string")
		.map((entry) => entry.name as string)
		.filter((name) =>
			excludeSet ? !excludeSet.has(name.toLowerCase()) : true,
		);
}

/**
 * List file basenames (without extension) from the GitHub Contents API for a repository subpath.
 * Only files whose names end with one of the provided extensions are included.
 * @param subpath - Path under the repository root, using forward slashes.
 * @param extensions - Allowed file extensions such as [".mdc", ".md"].
 */
export async function listRemoteFilesViaAPI(
	subpath: string,
	extensions: readonly string[],
): Promise<string[]> {
	const url = buildContentsURL(subpath);
	const res = await fetch(url, { headers: GITHUB_HEADERS });
	if (!res.ok)
		throw new Error(
			`Failed to fetch from GitHub API: ${res.status} ${res.statusText}`,
		);

	const data = (await res.json()) as { type?: string; name?: string }[];
	if (!Array.isArray(data))
		throw new Error(
			"Invalid response from GitHub API: expected array of contents",
		);

	const names = new Set<string>();
	for (const entry of data) {
		if (entry?.type !== "file" || typeof entry.name !== "string") continue;
		for (const ext of extensions) {
			if (entry.name.endsWith(ext)) {
				names.add(entry.name.slice(0, -ext.length));
				break;
			}
		}
	}

	return Array.from(names).sort((a, b) => a.localeCompare(b));
}
