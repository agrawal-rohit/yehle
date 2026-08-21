import {
	assertSafeRemoteUrl,
	InvalidJsonError,
	isAbsoluteHttpUrl,
	parseRegistryDocument,
	type Registry,
	readJsonFileAsync,
	resolveRegistryPayload,
} from "@tuckshop/core";
import { resolveRegistrySource } from "./source";

/** Parsed registry catalog paired with the location it was loaded from. */
export interface LoadedRegistry {
	/** Normalized registry document. */
	registry: Registry;
	/** Absolute path or HTTPS URL of the catalog document. */
	catalogLocation: string;
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
 * @param label - Error context label (e.g. `"registry"`, `"registry payload"`).
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
 * @returns Parsed registry and the catalog path or URL it was loaded from.
 * @throws Error when the resolved registry source cannot be loaded safely.
 */
export async function loadRuntimeRegistry(
	registryOverride?: string,
	savedRegistry?: string,
): Promise<LoadedRegistry> {
	const catalogLocation = await resolveRegistrySource({
		registry: registryOverride,
		savedRegistry,
	});

	return {
		registry: parseRegistryDocument(
			await loadJsonDocument(catalogLocation, "registry"),
		),
		catalogLocation,
	};
}

/**
 * Load unique install payloads relative to a catalog location.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param sources - Catalog `source` URIs from the install plan.
 * @returns Map of catalog source URI to parsed JSON value.
 */
export async function loadRegistryPayloads(
	catalogLocation: string,
	sources: readonly string[],
): Promise<Map<string, unknown>> {
	const uniqueSources = [...new Set(sources)];
	const documents = new Map<string, unknown>();

	await Promise.all(
		uniqueSources.map(async (source) => {
			const location = resolveRegistryPayload(catalogLocation, source);
			documents.set(
				source,
				await loadJsonDocument(location, "registry payload"),
			);
		}),
	);

	return documents;
}
