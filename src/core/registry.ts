import path from "node:path";
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
