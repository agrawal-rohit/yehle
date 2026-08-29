import path from "node:path";
import {
	assertSafeRemoteUrl,
	InvalidJsonError,
	isAbsoluteHttpUrl,
	isFileAsync,
	joinIndexSource,
	parseRegistryDocument,
	type Registry,
	readFileAsync,
	verifyItemIntegrity,
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
 * Absolute path to the registry.json packaged with the CLI.
 * @returns Absolute filesystem path.
 */
export function bundledRegistryPath(): string {
	return path.resolve(__dirname, "../../", "registry.json");
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
	const resolvedBundledRegistryPath =
		options.bundledRegistryPath ?? bundledRegistryPath();
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
		resolvedBundledRegistryPath,
	];

	for (const candidate of candidates)
		if (await isFileAsync(candidate)) return candidate;

	throw new Error(
		"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
	);
}

/**
 * Fetch a remote JSON document over HTTPS with SSRF protections.
 * @param url - Absolute HTTPS URL.
 * @param label - Error context label for fetch failures.
 * @returns Response body bytes.
 * @throws Error when the request fails or the response is too large.
 */
async function fetchRemoteJsonBytes(
	url: string,
	label: string,
): Promise<Buffer> {
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

	return body;
}

/**
 * Load a JSON document and retain the raw bytes for integrity checks.
 * @param location - Absolute path or HTTPS URL.
 * @param label - Error context label.
 * @returns Raw UTF-8 bytes and parsed JSON value.
 */
async function loadJsonDocumentWithBytes(
	location: string,
	label: string,
): Promise<{ bytes: Buffer; value: unknown }> {
	if (isAbsoluteHttpUrl(location)) {
		const bytes = await fetchRemoteJsonBytes(location, label);
		try {
			return { bytes, value: JSON.parse(bytes.toString("utf8")) as unknown };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Remote ${label} returned invalid JSON: ${message}`);
		}
	}

	try {
		const text = await readFileAsync(location);
		const bytes = Buffer.from(text);
		return { bytes, value: JSON.parse(text) as unknown };
	} catch (error) {
		if (error instanceof SyntaxError)
			throw new InvalidJsonError(`${label} at ${location}`, error);
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
	const { value } = await loadJsonDocumentWithBytes(indexLocation, "registry");

	return {
		registry: parseRegistryDocument(value),
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
	itemIntegrity?: Record<string, string>,
): Promise<Map<string, unknown>> {
	const uniqueSources = [...new Set(sources)];
	const documents = new Map<string, unknown>();

	await Promise.all(
		uniqueSources.map(async (source) => {
			const location = joinIndexSource(indexLocation, source);
			const { bytes, value } = await loadJsonDocumentWithBytes(
				location,
				"compiled item",
			);
			if (itemIntegrity) verifyItemIntegrity(itemIntegrity, source, bytes);
			documents.set(source, value);
		}),
	);

	return documents;
}
