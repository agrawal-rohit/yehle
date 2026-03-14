import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadTemplate } from "giget";
import type { Language } from "../resources/package/config";
import { IS_LOCAL_MODE } from "./constants";
import { isDirAsync } from "./fs";

/** Name of the shared templates directory that may be filtered out from listings. */
const SHARED_DIR_NAME = "shared";

/** Default GitHub owner to fetch templates from in remote mode.*/
const DEFAULT_GITHUB_OWNER = "agrawal-rohit";

/** Default GitHub repository to fetch templates from in remote mode. */
const DEFAULT_GITHUB_REPO = "yehle";

/** HTTP headers used when communicating with the GitHub API. */
const GITHUB_HEADERS = {
	"User-Agent": "yehle-cli",
	Accept: "application/vnd.github.v3+json",
} as const;

export type TemplateSource = "local" | "remote";

/**
 * Resolve the absolute path to the local templates root directory.
 * @returns The absolute path if the directory exists at `./templates`; otherwise null.
 */
async function getLocalTemplatesRoot(): Promise<string | null> {
	const localTemplatesPath = path.resolve(process.cwd(), "templates");
	if (await isDirAsync(localTemplatesPath)) return localTemplatesPath;
	return null;
}

/**
 * Resolves the absolute path to the local templates subdirectory for a given language and resource.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns The path to the language subdirectory or resource directory if it exists; otherwise null.
 */
async function getLocalTemplatesSubdir(
	language: string,
	resource?: string,
): Promise<string | null> {
	const root = await getLocalTemplatesRoot();
	if (!root) return null;

	const langRoot = path.join(root, language);
	if (!(await isDirAsync(langRoot))) return null;

	if (resource) {
		const resourceDir = path.join(langRoot, resource);
		if (await isDirAsync(resourceDir)) return resourceDir;
		return null;
	}

	return langRoot;
}

/**
 * @param dir The directory to list child directories from.
 * @returns An array of child directory names, excluding shared if not included.
 */
async function listChildDirs(dir: string): Promise<string[]> {
	if (!(await isDirAsync(dir))) return [];
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const names = entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((n) => n.toLowerCase() !== SHARED_DIR_NAME);
	return names;
}

/**
 * Build a GitHub API Contents URL for a templates subtree.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns The constructed API URL.
 */
function buildContentsURL(language: string, resource?: string): string {
	const subpath = ["templates", language, resource].filter(Boolean).join("/");
	return `https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/contents/${subpath}`;
}

/**
 * Build a giget specification for a subtree within the default repo.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns The constructed giget spec string.
 */
function buildGigetSpec(language: string, resource?: string): string {
	const subpath = ["templates", language, resource].filter(Boolean).join("/");
	return `github:${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/${subpath}`;
}

/**
 * Check whether a remote templates subtree exists in GitHub.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns True if the subtree exists or is uncertain, false if definitely not.
 */
async function subtreeExistsRemote(
	language: string,
	resource?: string,
): Promise<boolean> {
	try {
		const url = buildContentsURL(language, resource);
		const res = await fetch(url, { headers: GITHUB_HEADERS });
		if (res.status === 404) return false; // definitely not there
		if (!res.ok) return true; // uncertain; assume exists and let giget verify
		const data = await res.json();
		if (Array.isArray(data)) return true;
		if (
			data &&
			typeof data === "object" &&
			(data as Record<string, unknown>).type === "dir"
		)
			return true;
		return false;
	} catch {
		return true;
	}
}

/**
 * Attempt to normalize the downloaded directory to the expected subtree.
 * @param downloadedDir - The path to the downloaded directory.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns The normalized directory path.
 */
async function normalizeDownloadedDir(
	downloadedDir: string,
	language: string,
	resource?: string,
): Promise<string> {
	const candidates: string[] = resource
		? [
				path.join(downloadedDir, "templates", language, resource),
				path.join(downloadedDir, language, resource),
				path.join(downloadedDir, resource),
				downloadedDir,
			]
		: [
				path.join(downloadedDir, "templates", language),
				path.join(downloadedDir, language),
				downloadedDir,
			];

	for (const cand of candidates) {
		if (await isDirAsync(cand)) return cand;
	}
	return downloadedDir;
}

/**
 * Download a remote templates subtree to a temporary directory and return the normalized path.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns The path to the downloaded and normalized directory.
 */
async function downloadRemoteTemplatesSubdir(
	language: string,
	resource?: string,
): Promise<string> {
	const spec = buildGigetSpec(language, resource);

	const promise = (async () => {
		const exists = await subtreeExistsRemote(language, resource);
		if (!exists) {
			const resourcePart = resource ? `/${resource}` : "";
			throw new Error(
				`Remote templates path does not exist: templates/${language}${resourcePart} (repo: ${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}).`,
			);
		}

		const tmpRoot = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "yehle-templates-"),
		);

		try {
			const res = await downloadTemplate(spec, { dir: tmpRoot, force: true });
			const normalized = await normalizeDownloadedDir(
				res.dir,
				language,
				resource,
			);
			return normalized;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(
				`Failed to download templates from "${spec}". ${msg}. ` +
					`Ensure the path exists and that network/GitHub access are available.`,
			);
		}
	})();

	return promise;
}

/**
 * List child directories from the GitHub Contents API without downloading the subtree.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns An array of child directory names.
 */
async function listRemoteChildDirsViaAPI(
	language: string,
	resource?: string,
): Promise<string[]> {
	const url = buildContentsURL(language, resource);
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

	const names = data
		.filter((entry) => entry?.type === "dir" && typeof entry.name === "string")
		.map((entry) => entry.name as string)
		.filter((n) => n.toLowerCase() !== SHARED_DIR_NAME);

	return names;
}

/**
 * Resolve the on-disk directory that contains templates for a given language and resource.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language.
 * @returns An object with the path and source of the templates directory.
 */
export async function resolveTemplatesDir(
	language: string,
	resource?: string,
): Promise<string> {
	if (IS_LOCAL_MODE) {
		const localDir = await getLocalTemplatesSubdir(language, resource);
		if (localDir) return localDir;

		const root = (await getLocalTemplatesRoot()) || "<no local templates root>";
		const resourcePart = resource ? ` and resource "${resource}"` : "";
		throw new Error(
			`Local templates not found at ${root} for language "${language}"${resourcePart}.`,
		);
	}

	// Remote mode
	const remoteDir = await downloadRemoteTemplatesSubdir(language, resource);
	if (await isDirAsync(remoteDir)) return remoteDir;

	const resourcePart = resource ? ` and resource "${resource}"` : "";
	throw new Error(
		`No remote templates found for language "${language}"${resourcePart} in ${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}.`,
	);
}

/**
 * List available template names (subdirectories) for a given language and resource.
 * @param language - The programming language for the templates.
 * @param resource - The resource type
 * @returns An array of available template names.
 */
export async function listAvailableTemplates(
	language: Language,
	resource: string,
): Promise<string[]> {
	if (IS_LOCAL_MODE) {
		const resourceDir = await getLocalTemplatesSubdir(language, resource);
		if (!resourceDir) return [];
		return listChildDirs(resourceDir);
	}

	// Prefer API listing
	const apiNames = await listRemoteChildDirsViaAPI(language, resource);
	return apiNames;
}
