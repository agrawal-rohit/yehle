/**
 * Convert an arbitrary string into a URL and npm-friendly slug.
 * @param value - The input string to slugify (e.g., package or repo name).
 * @returns A normalized slug suitable for package/repo names.
 */
export function toSlug(value: string): string {
	// Normalize case/whitespace and extract last path-like segment (supports URLs and Windows paths)
	const normalized = value.trim().toLowerCase();
	const segments = normalized.split(/[\\/]+/).filter(Boolean);
	let base = segments.at(-1) ?? normalized;

	// Handle npm scopes like "@scope/name" (base will typically be "name", but keep safe)
	base = base.replace(/^@/, "");

	// Strip common VCS suffix if present
	base = base.replace(/\.git$/, "");

	// Replace invalid characters with a hyphen
	base = base.replaceAll(/[^a-z0-9._-]+/g, "-");

	// Collapse multiple hyphens
	base = base.replaceAll(/-+/g, "-");

	// Trim leading and trailing hyphens
	base = base.replace(/^-+/, "");
	base = base.replace(/-+$/, "");

	return base;
}
