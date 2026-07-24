import path from "node:path";
import { isRegularFileAsync, readJSONFileAsync } from "../core/fs";
import type { Registry } from "./schema";

/**
 * Resolve the path to the built registry.json.
 * @returns Absolute path to registry.json, or null when not found.
 */
async function resolveBuiltRegistryPath(): Promise<string | null> {
	const registryFilename = "registry.json";
	const candidates = [
		// Check the current working directory first (repo root during development)
		path.resolve(process.cwd(), registryFilename),
		// Check the packaged location relative to this module
		path.resolve(__dirname, "../../", registryFilename),
	];

	for (const candidate of candidates)
		if (await isRegularFileAsync(candidate)) return candidate;

	return null;
}

/**
 * Load the built registry from the registry.json.
 * @returns Registry version, content base URL, and item metadata (no content).
 * @throws Error when the built registry is missing or empty.
 */
export async function loadRegistry(): Promise<Registry> {
	const indexPath = await resolveBuiltRegistryPath();
	if (!indexPath)
		throw new Error(
			"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
		);

	return await readJSONFileAsync<Registry>(indexPath);
}
