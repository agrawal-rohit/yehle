import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadTemplate } from "giget";
import {
	DEFAULT_GITHUB_OWNER,
	DEFAULT_GITHUB_REPO,
	GITHUB_HEADERS,
} from "./constants";
import { isDirAsync } from "./fs";

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
				`Ensure the path exists and that network access is available.`,
		);
	}
}

/**
 * Check whether a remote repository subpath exists in GitHub.
 * @param subpath - Path under the repository root, using forward slashes.
 * @returns True if the subtree exists, false if not or when the check fails (e.g. non-OK response or network error).
 */
export async function remoteSubpathExists(subpath: string): Promise<boolean> {
	try {
		const url = buildContentsURL(subpath);
		const res = await fetch(url, { headers: GITHUB_HEADERS });
		if (res.status === 404) return false;
		if (!res.ok) return false;
		const data = await res.json();

		// If the data is an array, then the subtree exists.
		if (Array.isArray(data)) return true;

		// If the data is an object with a type property that is "dir", then the subtree exists.
		if (
			data &&
			typeof data === "object" &&
			(data as Record<string, unknown>).type === "dir"
		)
			return true;
		return false;
	} catch {
		return false;
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
		exclude === undefined
			? null
			: new Set(Array.from(exclude).map((n) => n.toLowerCase()));

	return data
		.filter((entry) => entry?.type === "dir" && typeof entry.name === "string")
		.map((entry) => entry.name as string)
		.filter((name) =>
			excludeSet ? !excludeSet.has(name.toLowerCase()) : true,
		);
}

/**
 * List file basenames from the GitHub Contents API for a repository subpath.
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

	// The response is an array of objects with a type and name property.
	const data = (await res.json()) as { type?: string; name?: string }[];
	if (!Array.isArray(data))
		throw new Error(
			"Invalid response from GitHub API: expected array of contents",
		);

	// We need to filter out the objects that are not files.
	const names = new Set<string>();
	for (const entry of data) {
		if (entry?.type !== "file" || typeof entry.name !== "string") continue;
		for (const extension of extensions) {
			if (entry.name.endsWith(extension)) {
				names.add(entry.name.slice(0, -extension.length));
				break;
			}
		}
	}

	return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Download a remote repository subpath to a temporary directory and normalize it.
 * @param subpath - Path under the repository root, using forward slashes.
 * @param tmpPrefix - Prefix for the temporary directory name.
 * @param normalize - Optional function to normalize giget's download directory structure.
 * @returns The normalized directory path.
 */
export async function resolveRemoteSubpath(
	subpath: string,
	tmpPrefix: string,
	normalize?: (downloadedDir: string) => Promise<string>,
): Promise<string> {
	const exists = await remoteSubpathExists(subpath);
	if (!exists)
		throw new Error(
			`Remote templates path does not exist: ${subpath} (repo: ${DEFAULT_GITHUB_OWNER}/yehle).`,
		);

	const downloadedDir = await downloadSubtreeToTemp(subpath, tmpPrefix);
	const normalized = normalize ? await normalize(downloadedDir) : downloadedDir;

	if (await isDirAsync(normalized)) return normalized;

	throw new Error(
		`No remote templates found at ${subpath} after download (repo: ${DEFAULT_GITHUB_OWNER}/yehle).`,
	);
}
