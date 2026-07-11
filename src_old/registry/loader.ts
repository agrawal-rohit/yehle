import fs from "node:fs";
import path from "node:path";
import { REGISTRY_BASE_URL_ENV } from "../core/constants";
import {
	parseRegistryCommandInputs,
	type RegistryCommandInputs,
	type RegistryDocument,
	type RegistryFileManifest,
	type RegistryItem,
	RegistryVisibility,
} from "./schema";

/** File name of the built registry index at the repository root. */
export const BUILT_REGISTRY_FILENAME = "registry.json";

/** Resolved absolute path to registry.json, cached after first lookup. */
let resolvedRegistryPath: string | null = null;

/**
 * Resolve the path to the built registry.json.
 * Checks the current working directory first (repo root during development),
 * then falls back to the packaged location relative to this module.
 * @returns Absolute path to registry.json, or null when not found.
 */
async function resolveBuiltRegistryPath(): Promise<string | null> {
	if (resolvedRegistryPath) return resolvedRegistryPath;

	const candidates = [
		path.resolve(process.cwd(), BUILT_REGISTRY_FILENAME),
		path.resolve(__dirname, "../../", BUILT_REGISTRY_FILENAME),
		path.resolve(__dirname, "../../../", BUILT_REGISTRY_FILENAME),
	];

	for (const candidate of candidates) {
		try {
			const stat = await fs.promises.stat(candidate);
			if (stat.isFile()) {
				resolvedRegistryPath = candidate;
				return candidate;
			}
		} catch {
			// continue
		}
	}

	return null;
}

/**
 * The loaded registry: item metadata plus the base URL for fetching content.
 */
export type LoadedRegistry = {
	version: string;
	contentBaseUrl: string;
	items: Map<string, RegistryItem>;
	commandInputs?: RegistryCommandInputs;
};

/**
 * Load the compiled registry document from the repository-root registry.json.
 * @returns Registry version, content base URL, and item metadata (no content).
 * @throws Error when the built registry is missing or empty.
 */
export async function loadRegistry(): Promise<LoadedRegistry> {
	const indexPath = await resolveBuiltRegistryPath();
	if (!indexPath)
		throw new Error(
			`Registry not found (${BUILT_REGISTRY_FILENAME}). Run \`pnpm run build:registry\` before using tuckshop.`,
		);

	const raw = await fs.promises.readFile(indexPath, "utf8");
	const doc = JSON.parse(raw) as RegistryDocument;
	const items = new Map(Object.entries(doc.items ?? {}));
	if (items.size === 0)
		throw new Error("Registry index is empty. Run `pnpm run build:registry`.");

	return {
		version: doc.version,
		contentBaseUrl: doc.contentBaseUrl,
		items,
		commandInputs: parseRegistryCommandInputs(doc.commandInputs),
	};
}

/**
 * Load only the registry item metadata keyed by item name.
 * @returns Registry index keyed by item name.
 */
export async function loadRegistryIndex(): Promise<Map<string, RegistryItem>> {
	return (await loadRegistry()).items;
}

/**
 * Fetch the content of a registry file by its repo-relative `source`.
 * Reads from the local checkout first (so contributors and tests work offline,
 * since the published package omits the registry sources), otherwise fetches it
 * from the registry's content base URL.
 * @param source - Repo-relative source path recorded in the built registry.
 * @param contentBaseUrl - Base URL from the loaded registry document.
 * @returns The file content as a string.
 * @throws Error when the content cannot be read locally or fetched remotely.
 */
export async function fetchRegistryFileContent(
	source: string,
	contentBaseUrl: string,
): Promise<string> {
	const registryPath = await resolveBuiltRegistryPath();
	if (registryPath) {
		const localPath = path.join(path.dirname(registryPath), source);
		try {
			const stat = await fs.promises.stat(localPath);
			if (stat.isFile()) return await fs.promises.readFile(localPath, "utf8");
		} catch {
			// fall through to remote fetch
		}
	}

	const base = (process.env[REGISTRY_BASE_URL_ENV] || contentBaseUrl).replace(
		/\/+$/,
		"",
	);
	const url = `${base}/${source}`;
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(
			`Failed to fetch registry file (${response.status}): ${url}`,
		);
	return await response.text();
}

/**
 * Scan an item folder and derive registry file manifests (build-time only).
 * Paths are recorded relative to the item folder. Files named with a
 * `.mustache.` segment are marked as templates and their target strips it.
 * @param itemDir - Absolute path to the item's own folder.
 * @param defaultVisibility - Visibility applied to every scanned file.
 * @returns File manifest entries relative to the item folder.
 */
export function scanItemFiles(
	itemDir: string,
	defaultVisibility?: RegistryVisibility,
): RegistryFileManifest[] {
	const files: RegistryFileManifest[] = [];

	const walk = (currentDir: string): void => {
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}

			if (!entry.isFile() || entry.name === "registry-item.json") continue;

			const relativePath = path
				.relative(itemDir, fullPath)
				.split(path.sep)
				.join("/");

			const isTemplate = /\.mustache\./i.test(entry.name);
			const target = isTemplate
				? relativePath.replace(/\.mustache\./i, ".")
				: relativePath;

			files.push({
				path: relativePath,
				target,
				...(isTemplate ? { template: true } : {}),
				...(defaultVisibility && defaultVisibility !== RegistryVisibility.ALWAYS
					? { visibility: defaultVisibility }
					: {}),
			});
		}
	};

	walk(itemDir);
	return files.sort((a, b) => a.target.localeCompare(b.target));
}
