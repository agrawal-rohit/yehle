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
 * Resolve a catalog file `source` against the catalog location.
 * Absolute http(s) sources pass through unchanged. Relative sources use
 * WHATWG URL resolution against http(s) catalogs, or a traversal-safe join
 * under the catalog directory for local file paths.
 * @param catalogLocation - Absolute path or http(s) URL of `registry.json`.
 * @param source - Opaque URI from a compiled catalog file `source`.
 * @returns Absolute http(s) URL or absolute local filesystem path.
 * @throws Error when a local relative source escapes the catalog directory.
 */
export function resolveRegistryPayload(
	catalogLocation: string,
	source: string,
): string {
	const trimmedSource = source.trim();
	if (!trimmedSource)
		throw new Error("Registry file source must not be empty.");

	// If the source is an absolute URL, we don't need to resolve it
	if (isAbsoluteHttpUrl(trimmedSource)) return trimmedSource;

	const trimmedCatalog = catalogLocation.trim();
	if (!trimmedCatalog)
		throw new Error("Registry catalog location must not be empty.");

	// Remote catalogs: WHATWG URL path resolution (…/registry.json + r/x.json → …/r/x.json).
	if (isAbsoluteHttpUrl(trimmedCatalog))
		return new URL(trimmedSource, trimmedCatalog).href;

	// If the source is a relative path, we need to resolve it against the catalog directory
	if (
		path.isAbsolute(trimmedSource) ||
		trimmedSource.includes("\\") ||
		trimmedSource.split("/").includes("..")
	)
		throw new Error(
			`Registry file source "${trimmedSource}" must be a relative path under the catalog directory.`,
		);

	const catalogDir = path.dirname(path.resolve(trimmedCatalog));
	const resolved = path.resolve(catalogDir, trimmedSource);
	const relative = path.relative(catalogDir, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative))
		throw new Error(
			`Registry file source "${trimmedSource}" escapes the catalog directory.`,
		);

	return resolved;
}
