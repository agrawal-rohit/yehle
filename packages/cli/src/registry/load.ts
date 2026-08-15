import type { IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import {
	parseRegistryDocument,
	type Registry,
	readFileAsync,
} from "@tuckshop/core";
import { RegistrySourceKind, resolveRegistrySource } from "./source";

/**
 * Reject remote registry URLs that are not HTTPS hostnames.
 * @param url - Parsed remote registry URL.
 * @throws Error when the URL uses a disallowed protocol, credentials, localhost, or IP host.
 */
function assertSafeRegistryUrl(url: URL): void {
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
 * Read and parse a registry HTTP response with status and size checks.
 * @param response - HTTPS response for the registry document.
 * @returns Parsed JSON value.
 * @throws Error when the response is redirected, failed, oversized, or invalid JSON.
 */
async function readRemoteRegistryBody(
	response: IncomingMessage,
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
		throw new Error(`Failed to fetch registry (${status} ${statusMessage}).`);
	}

	// If the response is too large, reject it.
	const contentLength = response.headers["content-length"];
	if (contentLength && Number(contentLength) > maxRegistryBytes) {
		response.destroy();
		throw new Error("Remote registry is too large.");
	}

	// If the response is valid, read the body and parse it as JSON.
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	for await (const chunk of response) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalBytes += buffer.length;
		if (totalBytes > maxRegistryBytes) {
			response.destroy();
			throw new Error("Remote registry is too large.");
		}
		chunks.push(buffer);
	}

	const body = Buffer.concat(chunks).toString("utf8");
	try {
		return JSON.parse(body) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Remote registry returned invalid JSON: ${message}`);
	}
}

/**
 * Fetch and read a remote registry document body.
 * @param registryUrl - Absolute remote registry URL.
 * @returns Parsed JSON value from the registry document.
 * @throws Error when the request fails or the response is invalid.
 */
async function fetchRemoteRegistry(registryUrl: string): Promise<unknown> {
	const url = new URL(registryUrl);
	assertSafeRegistryUrl(url);

	let response: IncomingMessage;
	try {
		// Attempt to fetch the registry document with a 10s timeout.
		response = await new Promise<IncomingMessage>((resolve, reject) => {
			const req = https.request(
				url,
				{
					method: "GET",
					signal: AbortSignal.timeout(10_000),
					headers: {
						accept: "application/json",
					},
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
				`Timed out fetching registry from ${registryUrl} after 10s.`,
				{ cause: error },
			);
		throw new Error(`Failed to fetch registry from ${registryUrl}.`, {
			cause: error,
		});
	}

	return readRemoteRegistryBody(response);
}

/**
 * Load the registry selected by CLI flags, env, saved config, or bundled defaults.
 * @param registryOverride - Optional `--registry` flag value.
 * @param savedRegistry - Optional registry source persisted via `tuckshop config set`.
 * @returns Registry document used for the current CLI invocation.
 * @throws Error when the resolved registry source cannot be loaded safely.
 */
export async function loadRuntimeRegistry(
	registryOverride?: string,
	savedRegistry?: string,
): Promise<Registry> {
	const packageRoot = path.resolve(__dirname, "../..");
	const source = await resolveRegistrySource({
		registry: registryOverride,
		savedRegistry,
		bundledRegistryPath: path.resolve(packageRoot, "registry.json"),
		fallbackRegistryPaths: [
			path.resolve(packageRoot, "../registry/registry.json"),
		],
	});

	// Fetch a registry from a remote URL or load one from a local file path.
	const fetchedRegistry =
		source.kind === RegistrySourceKind.URL
			? await fetchRemoteRegistry(source.location)
			: (JSON.parse(await readFileAsync(source.location)) as unknown);

	return parseRegistryDocument(fetchedRegistry);
}
