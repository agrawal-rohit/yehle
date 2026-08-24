import { isIP } from "node:net";
import path from "node:path";

/**
 * Check whether a string is an absolute HTTP(S) URL.
 * @param value - Candidate URL or path.
 * @returns True when the value starts with `http://` or `https://`.
 */
export function isAbsoluteHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

/**
 * Reject remote registry URLs that are not HTTPS hostnames.
 * @param url - Parsed remote URL.
 * @throws Error when the URL uses a disallowed protocol, credentials, localhost, or IP host.
 */
export function assertSafeRemoteUrl(url: URL): void {
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
 * Index URL for the published default registry at a release tag.
 * @param version - Published CLI / registry package version (used in the `tuckshop@` tag).
 * @returns Absolute HTTPS URL to `packages/registry/registry.json`.
 */
export function publishedRegistryUrl(version: string): string {
	return `https://raw.githubusercontent.com/agrawal-rohit/tuckshop/tuckshop@${version}/packages/registry/registry.json`;
}

/**
 * Join a relative path under a root directory, rejecting escapes and absolute inputs.
 * @param rootDir - Absolute directory the result must stay under.
 * @param relativePath - Candidate relative path (may include surrounding whitespace).
 * @param label - Noun phrase used in error messages (e.g. `"Compiled item file target"`).
 * @param rootLabel - Human label for the root (e.g. `"project directory"`).
 * @returns Absolute path under `rootDir`.
 * @throws Error when the path is empty, absolute, uses `..`, or escapes `rootDir`.
 */
export function joinRelativePathUnderRoot(
	rootDir: string,
	relativePath: string,
	label: string,
	rootLabel: string,
): string {
	const trimmed = relativePath.trim();
	if (!trimmed) throw new Error(`${label} must not be empty.`);

	if (
		path.isAbsolute(trimmed) ||
		trimmed.includes("\\") ||
		trimmed.split("/").includes("..")
	)
		throw new Error(
			`${label} "${relativePath}" must be a relative path under the ${rootLabel}.`,
		);

	const absolutePath = path.resolve(rootDir, trimmed);
	const relative = path.relative(rootDir, absolutePath);
	if (relative.startsWith("..") || path.isAbsolute(relative))
		throw new Error(`${label} "${relativePath}" escapes the ${rootLabel}.`);

	return absolutePath;
}

/**
 * Reject absolute http(s) compiled `source` values that leave the index origin.
 * Local indexes reject absolute URLs entirely; remote indexes require the same origin.
 * @param indexLocation - Absolute path or http(s) URL of registry.json.
 * @param source - Candidate source URI.
 * @throws Error when the source is an unsafe cross-origin absolute URL.
 */
export function assertSameOriginIndexSource(
	indexLocation: string,
	source: string,
): void {
	const trimmedSource = source.trim();
	if (!isAbsoluteHttpUrl(trimmedSource)) return;

	if (!isAbsoluteHttpUrl(indexLocation))
		throw new Error(
			`Registry file source "${source}" must be a relative path under a local registry (absolute URLs are not allowed).`,
		);

	const indexUrl = new URL(indexLocation);
	const sourceUrl = new URL(trimmedSource);
	if (indexUrl.origin !== sourceUrl.origin)
		throw new Error(
			`Registry file source "${source}" must stay on the same origin as the registry index (${indexUrl.origin}).`,
		);
}

/**
 * Join a index item or variant `source` against the index location.
 * @param indexLocation - Absolute path or http(s) URL of `registry.json`.
 * @param source - Opaque URI from a compiled index item or variant `source`.
 * @returns Absolute http(s) URL or absolute local filesystem path.
 * @throws Error when a local relative source escapes the registry directory,
 *   or an absolute source is cross-origin / disallowed for local indexes.
 */
export function joinIndexSource(indexLocation: string, source: string): string {
	const trimmedSource = source.trim();
	if (!trimmedSource)
		throw new Error("Registry file source must not be empty.");

	assertSameOriginIndexSource(indexLocation, trimmedSource);

	// Absolute same-origin URLs are already fetchable; skip index-relative joining.
	if (isAbsoluteHttpUrl(trimmedSource)) return trimmedSource;

	const trimmedCatalog = indexLocation.trim();
	if (!trimmedCatalog)
		throw new Error("Registry index location must not be empty.");

	// Remote registries: WHATWG URL path joining (…/registry.json + r/x.json → …/r/x.json).
	if (isAbsoluteHttpUrl(trimmedCatalog))
		return new URL(trimmedSource, trimmedCatalog).href;

	const indexDir = path.dirname(path.resolve(trimmedCatalog));
	return joinRelativePathUnderRoot(
		indexDir,
		trimmedSource,
		"Registry file source",
		"registry directory",
	);
}
