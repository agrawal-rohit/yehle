import { isDirAsync } from "./fs";
import {
	buildContentsURL,
	DEFAULT_GITHUB_OWNER,
	downloadSubtreeToTemp,
	GITHUB_HEADERS,
} from "./registry";

/**
 * Check whether a remote repository subpath exists in GitHub.
 * @param subpath - Path under the repository root, using forward slashes.
 * @returns True if the subtree exists or is uncertain, false if definitely not.
 */
export async function remoteSubpathExists(subpath: string): Promise<boolean> {
	try {
		const url = buildContentsURL(subpath);
		const res = await fetch(url, { headers: GITHUB_HEADERS });
		if (res.status === 404) return false;
		if (!res.ok) return true;
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
