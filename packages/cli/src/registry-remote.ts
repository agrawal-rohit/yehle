import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import {
	loadRegistry,
	parseRegistryDocument,
	type Registry,
	resolveRegistrySource,
} from "@tuckshop/core";

const registryCache = new Map<string, Registry>();
const packageRoot = path.resolve(__dirname, "..");
const bundledRegistryPath = path.resolve(packageRoot, "registry.json");
const workspaceRegistryPath = path.resolve(
	packageRoot,
	"../registry/registry.json",
);
const MAX_REGISTRY_BYTES = 1_000_000;

/**
 * Parse an IPv4 address into octets, or null when malformed.
 * @param address - IPv4 address string.
 * @returns Four octets, or null when the address is invalid.
 */
function parseIpv4Octets(
	address: string,
): [number, number, number, number] | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => Number(part));
	if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
	return octets as [number, number, number, number];
}

const PRIVATE_IPV4_MATCHERS: Array<(a: number, b: number) => boolean> = [
	(a) => a === 0,
	(a) => a === 10,
	(a) => a === 127,
	(a, b) => a === 100 && b >= 64 && b <= 127,
	(a, b) => a === 169 && b === 254,
	(a, b) => a === 172 && b >= 16 && b <= 31,
	(a, b) => a === 192 && b === 168,
];

/**
 * Check whether an IPv4 address is private, loopback, link-local, or otherwise
 * unsafe for outbound registry fetches.
 * @param address - IPv4 address string.
 * @returns True when the address should not be contacted.
 */
function isPrivateIpv4(address: string): boolean {
	const octets = parseIpv4Octets(address);
	if (!octets) return true;
	const [a, b] = octets;
	return PRIVATE_IPV4_MATCHERS.some((match) => match(a, b));
}

/**
 * Check whether an IPv6 address is loopback, ULA, link-local, or IPv4-mapped
 * private.
 * @param address - IPv6 address string.
 * @returns True when the address should not be contacted.
 */
function isPrivateIpv6(address: string): boolean {
	const normalized = address.toLowerCase();
	if (normalized === "::1" || normalized === "::") return true;

	const ipv4MappedPrefix = "::ffff:";
	if (normalized.startsWith(ipv4MappedPrefix)) {
		const mapped = normalized.slice(ipv4MappedPrefix.length);
		if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
	}

	return (
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		normalized.startsWith("fe80:")
	);
}

/**
 * Check whether an IP address resolves to a private or loopback range.
 * @param address - IPv4 or IPv6 address string.
 * @returns True when the address should not be contacted.
 */
function isPrivateAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return isPrivateIpv4(address);
	if (family === 6) return isPrivateIpv6(address);
	return false;
}

/**
 * Guard remote registry URLs against local-network access.
 * @param url - Parsed remote registry URL.
 * @throws Error when the URL is not safe to fetch.
 */
async function assertSafeRegistryUrl(url: URL): Promise<void> {
	if (url.protocol !== "https:")
		throw new Error("Remote registries must use HTTPS.");
	if (url.username || url.password)
		throw new Error("Remote registries must not include credentials.");
	if (url.hostname === "localhost")
		throw new Error("Remote registries cannot target localhost.");

	const rejectPrivateHost = (): never => {
		throw new Error(
			`Remote registries cannot target private network hosts (${url.hostname}).`,
		);
	};

	if (isIP(url.hostname) && isPrivateAddress(url.hostname)) rejectPrivateHost();

	const addresses = await lookup(url.hostname, { all: true, verbatim: true });
	if (addresses.length === 0)
		throw new Error(`Could not resolve registry host "${url.hostname}".`);

	if (addresses.some((entry) => isPrivateAddress(entry.address)))
		rejectPrivateHost();
}

/**
 * Read and parse a remote registry response body with size limits.
 * @param response - Fetch response for the registry document.
 * @returns Parsed JSON value.
 * @throws Error when the response is redirected, failed, oversized, or invalid JSON.
 */
async function readRemoteRegistryBody(response: Response): Promise<unknown> {
	if (response.status >= 300 && response.status < 400)
		throw new Error("Remote registries must not redirect.");
	if (!response.ok)
		throw new Error(
			`Failed to fetch registry (${response.status} ${response.statusText}).`,
		);

	const contentLength = response.headers.get("content-length");
	if (contentLength && Number(contentLength) > MAX_REGISTRY_BYTES)
		throw new Error("Remote registry is too large.");

	const body = await response.text();
	if (body.length > MAX_REGISTRY_BYTES)
		throw new Error("Remote registry is too large.");

	try {
		return JSON.parse(body) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Remote registry returned invalid JSON: ${message}`);
	}
}

/**
 * Fetch, size-limit, and validate a remote registry document.
 * @param registryUrl - Absolute remote registry URL.
 * @returns Validated registry document.
 * @throws Error when the request fails or the document is invalid.
 */
async function fetchRemoteRegistry(registryUrl: string): Promise<Registry> {
	const cached = registryCache.get(registryUrl);
	if (cached) return cached;

	const url = new URL(registryUrl);
	await assertSafeRegistryUrl(url);

	const response = await fetch(url, {
		method: "GET",
		redirect: "manual",
		signal: AbortSignal.timeout(10_000),
		headers: {
			accept: "application/json",
		},
	});

	const raw = await readRemoteRegistryBody(response);
	const parsed = parseRegistryDocument(raw);
	registryCache.set(registryUrl, parsed);
	return parsed;
}

/**
 * Load the registry selected by CLI flags, env, or bundled defaults.
 * @param registryOverride - Optional `--registry` flag value.
 * @returns Registry document used for the current CLI invocation.
 * @throws Error when the resolved registry source cannot be loaded safely.
 */
export async function loadRuntimeRegistry(
	registryOverride?: string,
): Promise<Registry> {
	const source = await resolveRegistrySource({
		registry: registryOverride,
		bundledRegistryPath,
		fallbackRegistryPaths: [workspaceRegistryPath],
	});
	if (source.kind === "url") return await fetchRemoteRegistry(source.location);
	return await loadRegistry(source.location);
}
