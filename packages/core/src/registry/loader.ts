import path from "node:path";
import { isRegularFileAsync, readJSONFileAsync } from "../core/fs";
import type { Registry } from "./schema";
import { parseRegistryDocument } from "./validate";

export interface RegistrySource {
	kind: "bundled" | "path" | "url";
	location: string;
}

export interface ResolveRegistrySourceOptions {
	/** Explicit registry flag value from the CLI. */
	registry?: string;
	/** Current working directory used to resolve relative registry paths. */
	cwd?: string;
	/** Environment variables consulted for TUCKSHOP_REGISTRY. */
	env?: NodeJS.ProcessEnv;
	/** Absolute path to the packaged default registry.json. */
	bundledRegistryPath?: string;
	/** Additional absolute registry.json paths to probe before failing. */
	fallbackRegistryPaths?: string[];
}

/**
 * Check whether a registry source string should be treated as a URL.
 * @param value - Candidate registry source.
 * @returns True when the source is an absolute HTTP(S) URL.
 */
function isUrlSource(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

/**
 * Resolve the path to the built registry.json.
 * @returns Absolute path to registry.json, or null when not found.
 */
async function resolveBuiltRegistryPath(
	cwd: string,
	bundledRegistryPath: string,
	fallbackRegistryPaths: string[],
): Promise<string | null> {
	const registryFilename = "registry.json";
	const candidates = [
		// Prefer an explicit registry.json in the caller's working directory.
		path.resolve(cwd, registryFilename),
		// Packaged default (present after CLI prepack / install).
		bundledRegistryPath,
		// Workspace / local development fallbacks (e.g. packages/registry).
		...fallbackRegistryPaths,
	];

	for (const candidate of candidates)
		if (await isRegularFileAsync(candidate)) return candidate;

	return null;
}

/**
 * Resolve which registry source the CLI should use.
 * @param options - Resolution inputs from CLI flags, env, and package defaults.
 * @returns Resolved source descriptor.
 * @throws Error when no local or bundled registry can be found.
 */
export async function resolveRegistrySource(
	options: ResolveRegistrySourceOptions = {},
): Promise<RegistrySource> {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const bundledRegistryPath =
		options.bundledRegistryPath ??
		path.resolve(__dirname, "../../", "registry.json");
	const fallbackRegistryPaths = options.fallbackRegistryPaths ?? [];
	const configuredSource = options.registry ?? env.TUCKSHOP_REGISTRY;

	if (configuredSource) {
		if (isUrlSource(configuredSource))
			return { kind: "url", location: configuredSource };

		return {
			kind: "path",
			location: path.resolve(cwd, configuredSource),
		};
	}

	const builtRegistryPath = await resolveBuiltRegistryPath(
		cwd,
		bundledRegistryPath,
		fallbackRegistryPaths,
	);
	if (!builtRegistryPath)
		throw new Error(
			"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
		);

	return {
		kind: builtRegistryPath === bundledRegistryPath ? "bundled" : "path",
		location: builtRegistryPath,
	};
}

/**
 * Load and validate a registry document from a local registry.json path.
 * @param registryPath - Absolute path to the registry.json file.
 * @returns Registry version, schema version, content base URL, and item metadata.
 * @throws Error when the registry file is missing or malformed.
 */
export async function loadRegistry(registryPath: string): Promise<Registry> {
	const raw = await readJSONFileAsync<unknown>(registryPath);
	return parseRegistryDocument(raw);
}
