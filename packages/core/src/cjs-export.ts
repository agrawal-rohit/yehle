/**
 * Accept either `export default fn` or `module.exports = fn`.
 * @param imported - Value returned by `require`.
 * @returns Default export when present, otherwise the module object.
 */
export function unwrapModuleExport(imported: unknown): unknown {
	if (
		imported !== null &&
		typeof imported === "object" &&
		"default" in imported &&
		imported.default !== undefined
	)
		return imported.default;
	return imported;
}
