/**
 * Package-specific setup logic. Delegates to core/setup for shared scaffolding;
 * keeps only package-specific configuration (public paths, template layout).
 */

import {
	addProjectInstructions,
	applyTemplateModifications as applyCoreTemplateModifications,
	buildTemplateMetadata,
	createProjectDirectory,
	writeTemplateFiles,
} from "../../core/setup";
import { writeInstructionToFile } from "../instructions/ide-formats";
import type { GeneratePackageConfiguration } from "./config";
import { templatePublicPaths } from "./config";

/** Re-export for backwards compatibility and package command usage. */
export { getRequiredGithubSecrets } from "../../core/setup";

/**
 * Creates the package directory based on the provided package name.
 * @param cwd - Current working directory (e.g., process.cwd()).
 * @param packageName - The name of the package, used as the directory name.
 * @returns The absolute path to the created package directory.
 */
export async function createPackageDirectory(
	cwd: string,
	packageName: string,
): Promise<string> {
	return createProjectDirectory(cwd, packageName);
}

/**
 * Apply template modifications: render mustache templates with config, remove public-only files when not public, and strip "root" from biome.json if present.
 * @param targetDir - Absolute path to the package directory.
 * @param generateConfig - Generate configuration describing the new package.
 * @param packageManagerVersion - Version string (e.g. "pnpm@9.0.0") to record in package.json's packageManager field.
 * @returns Promise that resolves when modifications are complete.
 * @throws Error when template resolution fails or (theoretically) when biome.json is invalid JSON.
 */
export async function applyTemplateModifications(
	targetDir: string,
	generateConfig: GeneratePackageConfiguration,
	packageManagerVersion: string,
): Promise<void> {
	const templatePath = `package/${generateConfig.template}`;
	const metadata = await buildTemplateMetadata(
		generateConfig.lang,
		templatePath,
		packageManagerVersion,
		generateConfig,
	);

	const publicFiles = [
		...templatePublicPaths.shared,
		...(templatePublicPaths[generateConfig.lang] ?? []),
	];

	await applyCoreTemplateModifications({
		targetDir,
		metadata,
		isPublic: generateConfig.public,
		publicOnlyFiles: publicFiles,
		stripJsonKeys: [{ file: "biome.json", key: "root" }],
	});
}

/**
 * Add agent instructions to the package when includeInstructions is true and instructionsIdeFormat is set.
 * Applies in order: essential → language → project-spec (package) → template → mapped tooling (from yehle.yaml) → mapped skills (from yehle.yaml).
 * @param targetDir - Absolute path to the package root directory.
 * @param generateConfig - Generate configuration (must have includeInstructions, instructionsIdeFormat, and lang).
 * @returns Promise that resolves when all instruction files have been written, or immediately when instructions are disabled.
 */
export async function addPackageInstructions(
	targetDir: string,
	generateConfig: GeneratePackageConfiguration,
): Promise<void> {
	await addProjectInstructions(
		targetDir,
		{
			lang: generateConfig.lang,
			projectSpec: "package",
			template: generateConfig.template,
			includeInstructions: generateConfig.includeInstructions,
			instructionsIdeFormat: generateConfig.instructionsIdeFormat,
		},
		writeInstructionToFile as import("../../core/setup").WriteInstructionFn,
	);
}

/**
 * Write the chosen template files into the target directory: global shared, language shared, package shared, then the chosen package template. Optionally adds MIT LICENSE for public packages.
 * @param targetDir - Package root directory to write into.
 * @param generateConfig - Generate configuration (lang, template, public, authorName).
 * @returns Promise that resolves when all template files have been copied and license written (if applicable).
 */
export async function writePackageTemplateFiles(
	targetDir: string,
	generateConfig: GeneratePackageConfiguration,
): Promise<void> {
	await writeTemplateFiles(targetDir, {
		lang: generateConfig.lang,
		projectSpec: "package",
		template: generateConfig.template,
		license:
			generateConfig.public && generateConfig.authorName
				? { public: true, authorName: generateConfig.authorName }
				: undefined,
	});
}
