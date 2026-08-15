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
 * Strip trailing slashes from a compile-time origin URL.
 * @param origin - Absolute HTTP(S) origin.
 * @returns Origin with no trailing slash.
 */
export function normalizeOrigin(origin: string): string {
	let normalized = origin;
	while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
	return normalized;
}

/**
 * Catalog URL for the published default registry at a release tag.
 * @param version - Published CLI / registry package version (used in the `tuckshop@` tag).
 * @returns Absolute HTTPS URL to `packages/registry/registry.json`.
 */
export function publishedRegistryUrl(version: string): string {
	return `https://raw.githubusercontent.com/agrawal-rohit/tuckshop/tuckshop@${version}/packages/registry/registry.json`;
}

/**
 * Resolve a catalog `payload` URI reference against the catalog location.
 * Absolute http(s) payloads pass through unchanged. Relative payloads use
 * WHATWG URL resolution against http(s) catalogs, or a traversal-safe join
 * under the catalog directory for local file paths.
 * @param catalogLocation - Absolute path or http(s) URL of `registry.json`.
 * @param payload - Opaque URI reference from a compiled variant.
 * @returns Absolute http(s) URL or absolute local filesystem path.
 * @throws Error when a local relative payload escapes the catalog directory.
 */
export function resolveRegistryPayload(
	catalogLocation: string,
	payload: string,
): string {
	const trimmedPayload = payload.trim();
	if (!trimmedPayload)
		throw new Error("Registry payload URI reference must not be empty.");

	// If the payload is an absolute URL, we don't need to resolve it
	if (isAbsoluteHttpUrl(trimmedPayload)) return trimmedPayload;

	const trimmedCatalog = catalogLocation.trim();
	if (!trimmedCatalog)
		throw new Error("Registry catalog location must not be empty.");

	// Remote catalogs: WHATWG URL path resolution (…/registry.json + r/x.json → …/r/x.json).
	if (isAbsoluteHttpUrl(trimmedCatalog))
		return new URL(trimmedPayload, trimmedCatalog).href;

	// If the payload is a relative path, we need to resolve it against the catalog directory
	if (
		path.isAbsolute(trimmedPayload) ||
		trimmedPayload.includes("\\") ||
		trimmedPayload.split("/").includes("..")
	)
		throw new Error(
			`Registry payload "${trimmedPayload}" must be a relative path under the catalog directory.`,
		);

	const catalogDir = path.dirname(path.resolve(trimmedCatalog));
	const resolved = path.resolve(catalogDir, trimmedPayload);
	const relative = path.relative(catalogDir, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative))
		throw new Error(
			`Registry payload "${trimmedPayload}" escapes the catalog directory.`,
		);

	return resolved;
}
