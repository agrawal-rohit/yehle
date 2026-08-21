import type { IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import {
	isAbsoluteHttpUrl,
	parseRegistryDocument,
	type Registry,
	readFileAsync,
	resolveRegistryPayload,
} from "@tuckshop/core";
import { resolveRegistrySource } from "./source";

/**
 * Reject remote registry URLs that are not HTTPS hostnames.
 * @param url - Parsed remote URL.
 * @throws Error when the URL uses a disallowed protocol, credentials, localhost, or IP host.
 */
function assertSafeRemoteUrl(url: URL): void {
	if (url.protocol !== "https:")
		throw new Error("Remote registries must use HTTPS.");
	if (url.username || url.password)
		throw new Error("Remote registries must not include credentials.");

	const host = url.hostname.replace(/\.$/, "").toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost"))
		throw new Error("Remote registries cannot target localhost.");

	// WHATWG URL.hostname keeps brackets on IPv6 literals (e.g. "[::1]").
	const literal =
		url.hostname.startsWith("[") && url.hostname.endsWith("]")
			? url.hostname.slice(1, -1)
			: url.hostname;
	if (isIP(literal))
		throw new Error(
			"Remote registries must use a hostname, not an IP address.",
		);
}

/**
 * Read and parse an HTTP response body with status and size checks.
 * @param response - HTTPS response stream.
 * @param label - Error context label for fetch failures.
 * @returns Parsed JSON value.
 * @throws Error when the response is redirected, failed, oversized, or invalid JSON.
 */
async function readRemoteJsonBody(
	response: IncomingMessage,
	label: string,
): Promise<unknown> {
	const maxRegistryBytes = 5_000_000; // 5MB
	const status = response.statusCode ?? 0;
	const statusMessage = response.statusMessage ?? "";

	// If the response is a redirect, reject it.
	if (status >= 300 && status < 400 && status !== 304) {
		response.destroy();
		throw new Error("Remote registries must not redirect.");
	}

	// If the response is not successful, reject it.
	if (status < 200 || status >= 300) {
		response.destroy();
		throw new Error(`Failed to fetch ${label} (${status} ${statusMessage}).`);
	}

	// If the response is too large, reject it.
	const contentLength = response.headers["content-length"];
	if (contentLength && Number(contentLength) > maxRegistryBytes) {
		response.destroy();
		throw new Error(`Remote ${label} is too large.`);
	}

	// If the response is valid, read the body and parse it as JSON.
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	for await (const chunk of response) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalBytes += buffer.length;
		if (totalBytes > maxRegistryBytes) {
			response.destroy();
			throw new Error(`Remote ${label} is too large.`);
		}
		chunks.push(buffer);
	}

	const body = Buffer.concat(chunks).toString("utf8");
	try {
		return JSON.parse(body) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Remote ${label} returned invalid JSON: ${message}`);
	}
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

	let response: IncomingMessage;
	const fetchTimeoutMs = 10_000; // 10 seconds

	try {
		// Attempt to fetch the registry document with a 10s timeout.
		response = await new Promise<IncomingMessage>((resolve, reject) => {
			const req = https.request(
				parsedUrl,
				{
					method: "GET",
					signal: AbortSignal.timeout(fetchTimeoutMs),
					headers: { accept: "application/json" },
				},
				(res) => resolve(res),
			);
			req.on("error", reject);
			req.end();
		});
	} catch (error) {
		if (
			error instanceof Error &&
			(error.name === "TimeoutError" || error.name === "AbortError")
		)
			throw new Error(
				`Timed out fetching ${label} from ${url} after ${Math.floor(fetchTimeoutMs / 1000)}s.`,
				{
					cause: error,
				},
			);
		throw new Error(`Failed to fetch ${label} from ${url}.`, { cause: error });
	}

	return readRemoteJsonBody(response, label);
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
): Promise<{ registry: Registry; catalogLocation: string }> {
	const packageRoot = path.resolve(__dirname, "../..");
	const catalogLocation = await resolveRegistrySource({
		registry: registryOverride,
		savedRegistry,
		bundledRegistryPath: path.resolve(packageRoot, "registry.json"),
		fallbackRegistryPaths: [
			path.resolve(packageRoot, "../registry/registry.json"),
		],
	});

	const rawRegistry = isAbsoluteHttpUrl(catalogLocation)
		? await fetchRemoteJson(catalogLocation, "registry")
		: (JSON.parse(await readFileAsync(catalogLocation)) as unknown);
	return {
		registry: parseRegistryDocument(rawRegistry),
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
	let nextIndex = 0;

	// Load payloads in parallel with a worker pool
	const worker = async (): Promise<void> => {
		while (nextIndex < uniqueSources.length) {
			const current = nextIndex;
			nextIndex += 1;

			// Resolve the source URI relative to the catalog location.
			const source = uniqueSources[current];
			const location = resolveRegistryPayload(catalogLocation, source);

			// Determine the error context label for fetch failures.
			const label = isAbsoluteHttpUrl(location)
				? "registry payload"
				: "registry payload file";
			const rawPayload = isAbsoluteHttpUrl(location)
				? await fetchRemoteJson(location, label)
				: (JSON.parse(await readFileAsync(location)) as unknown);
			documents.set(source, rawPayload);
		}
	};

	const concurrency = 8; // 8 concurrent payload fetches
	await Promise.all(
		Array.from({ length: Math.min(concurrency, uniqueSources.length) }, () =>
			worker(),
		),
	);

	return documents;
}
