import validatePkg from "validate-npm-package-name";

/**
 * Validate a package name against npm rules (used for TypeScript packages).
 * @param name - The package name to validate.
 * @returns True if the name is valid for new packages; otherwise an error string describing the issues.
 */
export function validateTypescriptPackageName(name: string): true | string {
	const res = validatePkg(name);
	if (res.validForNewPackages) return true;

	const errors = [...(res.errors || []), ...(res.warnings || [])].join(", ");
	return `Invalid package name: ${errors}`;
}
