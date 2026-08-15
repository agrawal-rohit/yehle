import path from "node:path";
import { isFileAsync } from "@tuckshop/core";

/** How a resolved registry source was located. */
export enum RegistrySourceKind {
	BUNDLED = "bundled",
	PATH = "path",
	URL = "url",
}

export interface RegistrySource {
	kind: RegistrySourceKind;
	location: string;
}

export interface ResolveRegistrySourceOptions {
	/** Explicit registry flag value from the CLI. */
	registry?: string;
	/** Registry source persisted via `tuckshop config set`. */
	savedRegistry?: string;
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
		// Workspace / local development (e.g. packages/registry)
		...fallbackRegistryPaths,
		// Packaged default (present after CLI prepack / install).
		bundledRegistryPath,
	];

	for (const candidate of candidates)
		if (await isFileAsync(candidate)) return candidate;

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
	const bundledRegistryPath =
		options.bundledRegistryPath ??
		path.resolve(__dirname, "../../", "registry.json");
	const fallbackRegistryPaths = options.fallbackRegistryPaths ?? [];

	// Source reading order: CLI flag > env > saved config > bundled.
	const source =
		options.registry ?? process.env.TUCKSHOP_REGISTRY ?? options.savedRegistry;

	// If a source is explicitly provided, use it.
	if (source) {
		// If the source is a URL, use it as is.
		if (isUrlSource(source))
			return { kind: RegistrySourceKind.URL, location: source };

		// Otherwise, resolve it relative to the current working directory.
		return {
			kind: RegistrySourceKind.PATH,
			location: path.resolve(process.cwd(), source),
		};
	}

	// If no source is explicitly provided, resolve the built registry path.
	const builtRegistryPath = await resolveBuiltRegistryPath(
		process.cwd(),
		bundledRegistryPath,
		fallbackRegistryPaths,
	);
	if (!builtRegistryPath)
		throw new Error(
			"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
		);

	return {
		kind:
			builtRegistryPath === bundledRegistryPath
				? RegistrySourceKind.BUNDLED
				: RegistrySourceKind.PATH,
		location: builtRegistryPath,
	};
}
