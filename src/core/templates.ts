import path from "node:path";
import type { Language } from "./constants";
import {
	DEFAULT_GITHUB_OWNER,
	DEFAULT_GITHUB_REPO,
	IS_LOCAL_MODE,
} from "./constants";
import { isDirAsync } from "./fs";
import {
	getLocalTemplatesRoot,
	listLocalChildDirs,
	resolveLocalSubpath,
} from "./registry.local";
import {
	listRemoteChildDirsViaAPI,
	resolveRemoteSubpath,
} from "./registry.remote";

/** Directory names to exclude when listing template/language children (e.g. shared, instructions). */
export const NON_TEMPLATE_DIR_NAMES = new Set(
	["shared", "instructions"].map((n) => n.toLowerCase()),
);

/**
 * Attempt to normalize the downloaded directory to the expected subtree.
 * @param downloadedDir - The path to the directory returned by giget.
 * @param language - The programming language for the templates (used to construct candidate paths).
 * @param resource - Optional resource within the language (e.g. "package").
 * @returns The normalized directory path.
 */
async function normalizeDownloadedDir(
	downloadedDir: string,
	language: string,
	resource?: string,
): Promise<string> {
	const candidates: string[] = resource
		? [path.join(downloadedDir, "templates", language, resource)]
		: [path.join(downloadedDir, "templates", language)];

	for (const cand of candidates) {
		if (await isDirAsync(cand)) return cand;
	}
	return downloadedDir;
}

/**
 * Resolve the on-disk directory that contains templates for a given language and resource.
 * In local mode uses ./templates; in remote mode downloads from GitHub to a temp dir.
 * @param language - The programming language for the templates.
 * @param resource - Optional resource within the language (e.g. "package").
 * @returns Promise resolving to the absolute path of the templates directory.
 * @throws Error when the path is not found (local) or download fails (remote).
 */
export async function resolveTemplatesDir(
	language: string,
	resource?: string,
): Promise<string> {
	if (IS_LOCAL_MODE) {
		const subpath = ["templates", language, resource].filter(Boolean).join("/");
		const localDir = await resolveLocalSubpath(subpath);
		if (localDir && (await isDirAsync(localDir))) return localDir;

		const root = (await getLocalTemplatesRoot()) || "<no local templates root>";
		const resourcePart = resource ? ` and resource "${resource}"` : "";
		throw new Error(
			`Local templates not found at ${root} for language "${language}"${resourcePart}.`,
		);
	}

	// Remote mode
	const subpath = ["templates", language, resource].filter(Boolean).join("/");
	const remoteDir = await resolveRemoteSubpath(
		subpath,
		"yehle-templates-",
		async (dir) => {
			const normalized = await normalizeDownloadedDir(dir, language, resource);
			if (await isDirAsync(normalized)) return normalized;

			const resourcePart = resource ? ` and resource "${resource}"` : "";
			throw new Error(
				`No remote templates found for language "${language}"${resourcePart} in ${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}.`,
			);
		},
	);
	return remoteDir;
}

/**
 * List available template names (subdirectories) for a given language and resource.
 * @param language - The programming language for the templates.
 * @param resource - The resource type (e.g. "package").
 * @returns Promise resolving to an array of available template names.
 * @throws Error when the GitHub API fails in remote mode.
 */
export async function listAvailableTemplates(
	language: Language,
	resource: string,
): Promise<string[]> {
	if (IS_LOCAL_MODE) {
		const subpath = ["templates", language, resource].filter(Boolean).join("/");
		const localDir = await resolveLocalSubpath(subpath);
		if (!localDir) return [];
		return listLocalChildDirs(localDir, NON_TEMPLATE_DIR_NAMES);
	}

	// Prefer API listing
	const subpath = ["templates", language, resource].filter(Boolean).join("/");
	const apiNames = await listRemoteChildDirsViaAPI(
		subpath,
		NON_TEMPLATE_DIR_NAMES,
	);
	return apiNames;
}
