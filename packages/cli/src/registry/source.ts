import path from "node:path";
import {
	assertSafeRemoteUrl,
	isAbsoluteHttpUrl,
	isFileAsync,
} from "@tuckshop/core";

/** Absolute path to the packaged default registry.json (present after prepack / install). */
const defaultBundledRegistryPath = path.resolve(
	__dirname,
	"../../",
	"registry.json",
);

/** Workspace development fallback: packages/registry/registry.json relative to the CLI package. */
const defaultFallbackRegistryPaths = [
	path.resolve(__dirname, "../../../registry/registry.json"),
];

export interface LocateRegistryOptions {
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
 * Locate which registry catalog the CLI should use.
 * Precedence for an explicit source: CLI flag > `TUCKSHOP_REGISTRY` env > saved config.
 * When none is set, probe: cwd `registry.json` > fallback paths > bundled default.
 * @param options - Inputs from CLI flags, env, and package defaults.
 * @returns Absolute local path or HTTPS URL to the catalog.
 * @throws Error when no local or bundled registry can be found, or an explicit URL is unsafe.
 */
export async function locateRegistry(
	options: LocateRegistryOptions = {},
): Promise<string> {
	const bundledRegistryPath =
		options.bundledRegistryPath ?? defaultBundledRegistryPath;
	const fallbackRegistryPaths =
		options.fallbackRegistryPaths ?? defaultFallbackRegistryPaths;

	// Source reading order: CLI flag > env > saved config > bundled.
	const source =
		options.registry ?? process.env.TUCKSHOP_REGISTRY ?? options.savedRegistry;

	// If a source is explicitly provided, use it.
	if (source) {
		if (isAbsoluteHttpUrl(source)) {
			assertSafeRemoteUrl(new URL(source));
			return source;
		}
		return path.resolve(process.cwd(), source);
	}

	const candidates = [
		path.resolve(process.cwd(), "registry.json"),
		...fallbackRegistryPaths,
		bundledRegistryPath,
	];

	for (const candidate of candidates)
		if (await isFileAsync(candidate)) return candidate;

	throw new Error(
		"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
	);
}
