import path from "node:path";
import {
	assertSafeRemoteUrl,
	InvalidJsonError,
	isAbsoluteHttpUrl,
	isFileAsync,
	joinIndexSource,
	parseRegistryDocument,
	type Registry,
	readJsonFileAsync,
} from "@tuckshop/core";

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

/** Parsed registry paired with the location it was loaded from. */
export interface LoadedRegistry {
	/** Normalized registry document. */
	registry: Registry;
	/** Absolute path or HTTPS URL of the index document. */
	indexLocation: string;
}

/**
 * Locate which registry the CLI should use.
 * @param options - Inputs from CLI flags, env, and package defaults.
 * @returns Absolute local path or HTTPS URL to the index.
 * @throws Error when no local or bundled registry can be found, or an explicit URL is unsafe.
 */
export async function locateRegistry(
	options: LocateRegistryOptions = {},
): Promise<string> {
	const bundledRegistryPath =
		options.bundledRegistryPath ??
		path.resolve(__dirname, "../../", "registry.json");
	const fallbackRegistryPaths = options.fallbackRegistryPaths ?? [
		path.resolve(__dirname, "../../../registry/registry.json"),
	];

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

/**
 * Fetch and parse a remote JSON document over HTTPS with SSRF protections.
 * @param url - Absolute HTTPS URL.
 * @param label - Error context label for fetch failures.
 * @returns Parsed JSON value.
 * @throws Error when the request fails or the response is invalid.
 */
async function fetchRemoteJson(url: string, label: string): Promise<unknown> {
	const parsedUrl = new URL(url);
	assertSafeRemoteUrl(parsedUrl);

	const maxRegistryBytes = 5_000_000; // 5MB
	const fetchTimeoutMs = 10_000; // 10 seconds

	let response: Response;
	try {
		response = await fetch(parsedUrl, {
			method: "GET",
			redirect: "error",
			signal: AbortSignal.timeout(fetchTimeoutMs),
			headers: { accept: "application/json" },
		});
	} catch (error) {
		if (
			error instanceof Error &&
			(error.name === "TimeoutError" || error.name === "AbortError")
		)
			throw new Error(
				`Timed out fetching ${label} from ${url} after ${Math.floor(fetchTimeoutMs / 1000)}s.`,
				{ cause: error },
			);

		// fetch throws TypeError on redirect when redirect: "error".
		if (error instanceof TypeError && /redirect/i.test(error.message))
			throw new Error("Remote registries must not redirect.", {
				cause: error,
			});

		throw new Error(`Failed to fetch ${label} from ${url}.`, { cause: error });
	}

	if (!response.ok)
		throw new Error(
			`Failed to fetch ${label} (${response.status} ${response.statusText}).`,
		);

	const contentLengthHeader = response.headers.get("content-length");
	if (contentLengthHeader && Number(contentLengthHeader) > maxRegistryBytes)
		throw new Error(`Remote ${label} is too large.`);

	const body = Buffer.from(await response.arrayBuffer());
	if (body.length > maxRegistryBytes)
		throw new Error(`Remote ${label} is too large.`);

	try {
		return JSON.parse(body.toString("utf8")) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Remote ${label} returned invalid JSON: ${message}`);
	}
}

/**
 * Load and parse a JSON document from a local path or HTTPS URL.
 * @param location - Absolute filesystem path or HTTPS URL.
 * @param label - Error context label (e.g. `"registry"`, `"compiled item"`).
 * @returns Parsed JSON value.
 * @throws Error when the document cannot be read or parsed.
 */
async function loadJsonDocument(
	location: string,
	label: string,
): Promise<unknown> {
	if (isAbsoluteHttpUrl(location)) return fetchRemoteJson(location, label);

	try {
		return await readJsonFileAsync(location, `${label} at ${location}`);
	} catch (error) {
		// Parse failures are already labeled; wrap read failures with location context.
		if (error instanceof InvalidJsonError) throw error;

		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read ${label} at ${location}: ${message}`, {
			cause: error,
		});
	}
}

/**
 * Load the registry selected by CLI flags, env, saved config, or bundled defaults.
 * @param registryOverride - Optional `--registry` flag value.
 * @param savedRegistry - Optional registry source persisted via `tuckshop config set`.
 * @returns Parsed registry and the index path or URL it was loaded from.
 * @throws Error when the located registry cannot be loaded safely.
 */
export async function loadRuntimeRegistry(
	registryOverride?: string,
	savedRegistry?: string,
): Promise<LoadedRegistry> {
	const indexLocation = await locateRegistry({
		registry: registryOverride,
		savedRegistry,
	});

	return {
		registry: parseRegistryDocument(
			await loadJsonDocument(indexLocation, "registry"),
		),
		indexLocation,
	};
}

/**
 * Load unique compiled items relative to a index location.
 * @param indexLocation - Absolute path or HTTPS URL of the index document.
 * @param sources - Catalog `source` URIs from the install plan.
 * @returns Map of catalog source URI to parsed JSON value.
 */
export async function loadCompiledItems(
	indexLocation: string,
	sources: readonly string[],
): Promise<Map<string, unknown>> {
	const uniqueSources = [...new Set(sources)];
	const documents = new Map<string, unknown>();

	await Promise.all(
		uniqueSources.map(async (source) => {
			const location = joinIndexSource(indexLocation, source);
			documents.set(source, await loadJsonDocument(location, "compiled item"));
		}),
	);

	return documents;
}
