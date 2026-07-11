import fs from "node:fs";
import path from "node:path";
import { Language } from "./constants";
import { commandExistsAsync, runAsync } from "./shell";
import { validateTypescriptPackageName } from "./typescript";

/** Type representing the possible package managers. */
export type PackageManager =
	(typeof LANGUAGE_PACKAGE_MANAGER)[keyof typeof LANGUAGE_PACKAGE_MANAGER];

/** Type representing the possible package registries. */
export type PackageRegistry =
	(typeof LANGUAGE_PACKAGE_REGISTRY)[keyof typeof LANGUAGE_PACKAGE_REGISTRY];

/** Maps each supported language to its default package manager. */
export const LANGUAGE_PACKAGE_MANAGER = {
	[Language.TYPESCRIPT]: "pnpm",
} as const satisfies Record<Language, string>;

/** Maps each supported language to its package registry. */
export const LANGUAGE_PACKAGE_REGISTRY = {
	[Language.TYPESCRIPT]: "NPM",
} as const satisfies Record<Language, string>;

/**
 * Validate the given package name for the specified language (e.g. npm rules for TypeScript).
 * @param name - The name of the package to validate.
 * @param language - The programming language context to validate against.
 * @returns void.
 * @throws Error when the package name is invalid for the language or language is unsupported.
 */
export function validatePackageName(name: string, language: Language) {
	switch (language) {
		case Language.TYPESCRIPT: {
			const validation = validateTypescriptPackageName(name);
			if (validation !== true)
				throw new Error(
					typeof validation === "string" ? validation : "Invalid package name",
				);

			break;
		}

		default:
			throw new Error(`Unsupported language: ${language}`);
	}
}

/**
 * Ensure the selected package manager is available on the system and return its version string.
 * @param pm - The package manager to verify (e.g. "pnpm").
 * @returns Promise resolving to a version string (e.g. "pnpm@9.0.0").
 * @throws Error when the package manager is not installed or unsupported.
 */
export async function ensurePackageManager(
	pm: PackageManager,
): Promise<string> {
	switch (pm) {
		case "pnpm": {
			if (!(await commandExistsAsync("pnpm")))
				throw new Error(
					"pnpm is not installed. Please install PNPM and re-run.",
				);

			const version = await runAsync("pnpm --version");
			return `pnpm@${version}`;
		}

		default:
			throw new Error(`Unsupported package manager: ${pm}`);
	}
}

/**
 * Get the install command for the specified package manager to display in the next-steps box.
 * @param pm - The package manager to use.
 * @returns The shell command to install dependencies (e.g., "pnpm install").
 */
export function getInstallScript(pm: PackageManager): string {
	switch (pm) {
		case "pnpm":
			return "pnpm install";

		default:
			throw new Error(`Unsupported package manager: ${pm}`);
	}
}

/**
 * Install registry-declared npm packages into a target project.
 * Skips packages already listed in `dependencies` or `devDependencies`.
 * @param targetDir - Project root containing `package.json`.
 * @param dependencies - Runtime package names to install.
 * @param devDependencies - Dev package names to install.
 * @throws Error when packages are requested but `package.json` is missing.
 */
export async function installRegistryPackages(
	targetDir: string,
	dependencies: string[],
	devDependencies: string[],
): Promise<void> {
	if (dependencies.length === 0 && devDependencies.length === 0) return;

	const packageJsonPath = path.join(targetDir, "package.json");
	if (!fs.existsSync(packageJsonPath))
		throw new Error(
			`Cannot install registry packages: no package.json in ${targetDir}.`,
		);

	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};

	const installed = new Set([
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.devDependencies ?? {}),
	]);

	const runtime = dependencies.filter((name) => !installed.has(name));
	const dev = devDependencies.filter((name) => !installed.has(name));
	if (runtime.length === 0 && dev.length === 0) return;

	const args: string[] = [...runtime];
	if (dev.length > 0) {
		args.push("-D", ...dev);
	}

	await runAsync(`pnpm add ${args.join(" ")}`, {
		cwd: targetDir,
		stdio: "inherit",
	});
}
