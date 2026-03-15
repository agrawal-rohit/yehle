import fs from "node:fs";
import path from "node:path";
import mitLicense from "spdx-license-list/licenses/MIT.json";
import {
	copyDirSafeAsync,
	ensureDirAsync,
	isDirAsync,
	removeFilesByBasename,
	renderMustacheTemplates,
	writeFileAsync,
} from "../../core/fs";
import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	type InstructionContext,
	listAvailableInstructions,
	readSituationalInstructionsMapping,
} from "../../core/instructions";
import { resolveTemplatesDir } from "../../core/templates";
import { INSTRUCTION_CATEGORY_LANGUAGE } from "../instructions/config";
import { writeInstructionToFile } from "../instructions/ide-formats";
import type { GeneratePackageConfiguration } from "./config";
import { templatePublicPaths } from "./config";

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
	const targetDir = path.resolve(cwd, packageName);
	await ensureDirAsync(targetDir);
	return targetDir;
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
	const chosenTemplateDir = await resolveTemplatesDir(
		generateConfig.lang,
		`package/${generateConfig.template}`,
	);
	const hasPlayground = await isDirAsync(
		path.join(chosenTemplateDir, "playground"),
	);
	const templateMetadata = {
		packageManagerVersion,
		templateHasPlayground: hasPlayground,
		...generateConfig,
	};

	await renderMustacheTemplates(targetDir, templateMetadata);

	// Remove public files after rendering, so templated files match by basename
	if (!generateConfig.public) {
		const publicFiles = [
			...templatePublicPaths.shared,
			...(templatePublicPaths[generateConfig.lang] ?? []),
		];
		await removeFilesByBasename(targetDir, publicFiles);
	}

	// Remove "root" property from biome.json if it exists
	const biomeJsonPath = path.join(targetDir, "biome.json");
	try {
		await fs.promises.access(biomeJsonPath);
		const content = await fs.promises.readFile(biomeJsonPath, "utf8");
		const config = JSON.parse(content);
		delete config.root;
		await fs.promises.writeFile(
			biomeJsonPath,
			`${JSON.stringify(config, null, "\t")}\n`,
		);
	} catch {
		// biome.json does not exist or error; ignore
	}
}

/**
 * Add agent instructions to the package when includeInstructions is true and instructionsIdeFormat is set.
 * Applies in order: essential → language → project-spec (package) → template → mapped situational (from yehle.yaml).
 * @param targetDir - Absolute path to the package root directory.
 * @param generateConfig - Generate configuration (must have includeInstructions, instructionsIdeFormat, and lang).
 * @returns Promise that resolves when all instruction files have been written, or immediately when instructions are disabled.
 */
export async function addPackageInstructions(
	targetDir: string,
	generateConfig: GeneratePackageConfiguration,
): Promise<void> {
	if (
		!generateConfig.includeInstructions ||
		!generateConfig.instructionsIdeFormat
	)
		return;

	const ideFormat = generateConfig.instructionsIdeFormat;
	const projectSpec = "package";
	const ctx: InstructionContext = {
		lang: generateConfig.lang,
		projectSpec: projectSpec,
		template: generateConfig.template,
	};

	// Add all essential instructions (e.g. templates/instructions/essential/*.md)
	const essentialNames = await listAvailableInstructions(
		InstructionCategory.ESSENTIAL,
	);
	for (const name of essentialNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.ESSENTIAL,
			name,
		);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.ESSENTIAL,
			frontmatter,
		);
	}

	// Add all language instructions for the package's language (e.g. templates/typescript/instructions/*.md)
	const languageContext = { lang: generateConfig.lang };
	const languageNames = await listAvailableInstructions(
		INSTRUCTION_CATEGORY_LANGUAGE,
		languageContext,
	);
	for (const name of languageNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			INSTRUCTION_CATEGORY_LANGUAGE,
			name,
			languageContext,
		);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			INSTRUCTION_CATEGORY_LANGUAGE,
			frontmatter,
		);
	}

	// Add all project-spec instructions (e.g. templates/typescript/package/instructions/*.md)
	const projectSpecNames = await listAvailableInstructions(
		InstructionCategory.PROJECT_SPEC,
		{
			lang: generateConfig.lang,
			projectSpec: projectSpec,
		},
	);
	for (const name of projectSpecNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.PROJECT_SPEC,
			name,
			ctx,
		);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.PROJECT_SPEC,
			frontmatter,
		);
	}

	// Add all template instructions (e.g. templates/typescript/package/<template>/instructions/*.md)
	const templateNames = await listAvailableInstructions(
		InstructionCategory.TEMPLATE,
		ctx,
	);
	const templateDir = await resolveTemplatesDir(
		generateConfig.lang,
		`package/${generateConfig.template}`,
	);
	for (const name of templateNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.TEMPLATE,
			name,
			ctx,
		);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.TEMPLATE,
			frontmatter,
		);
	}

	// Add all situational instructions listed in yehle.yaml (e.g. templates/typescript/package/<template>/yehle.yaml)
	const situationalNames =
		await readSituationalInstructionsMapping(templateDir);
	for (const name of situationalNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.SITUATIONAL,
			name,
		);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.SITUATIONAL,
			frontmatter,
		);
	}
}

/**
 * Scan GitHub workflow files in the package for secrets.* references and return the list of secret names (excluding GITHUB_TOKEN).
 * @param targetDir - Absolute path to the package root (e.g. .github/workflows is under here).
 * @returns Promise resolving to a sorted array of secret names (e.g. ["NPM_TOKEN"]).
 */
export async function getRequiredGithubSecrets(
	targetDir: string,
): Promise<string[]> {
	const secrets = new Set<string>();

	try {
		const workflowsDir = path.join(targetDir, ".github", "workflows");
		const entries = await fs.promises.readdir(workflowsDir, {
			withFileTypes: true,
		});
		const files = entries
			.filter((e) => e.isFile())
			.map((e) => path.join(workflowsDir, e.name));

		const secretRegex = /secrets\.([A-Z0-9_]+)/g;
		for (const file of files) {
			const content = await fs.promises.readFile(file, "utf8");
			for (const match of content.matchAll(secretRegex)) {
				const key = match[1];
				if (key && key.toUpperCase() !== "GITHUB_TOKEN") {
					secrets.add(key);
				}
			}
		}
	} catch {
		// No workflows directory found; ignore
	}

	return Array.from(secrets).sort((a, b) => a.localeCompare(b));
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
	// Global shared: templates/shared
	const globalShared = await resolveTemplatesDir("shared");
	await copyDirSafeAsync(globalShared, targetDir);

	// Language shared: templates/<lang>/shared
	const langShared = await resolveTemplatesDir(generateConfig.lang, "shared");
	await copyDirSafeAsync(langShared, targetDir);

	// Item-specific shared: templates/<lang>/package/shared
	const itemShared = await resolveTemplatesDir(
		generateConfig.lang,
		"package/shared",
	);
	await copyDirSafeAsync(itemShared, targetDir);

	// Item-specific template: templates/<lang>/package/<template>
	const chosenTemplateDir = await resolveTemplatesDir(
		generateConfig.lang,
		`package/${generateConfig.template}`,
	);
	await copyDirSafeAsync(chosenTemplateDir, targetDir);

	// Add MIT license
	if (generateConfig.public && generateConfig.authorName) {
		const year = new Date().getFullYear().toString();

		const licenseText = mitLicense.licenseText
			.replace("<year>", year)
			.replace("<copyright holders>", generateConfig.authorName);

		await writeFileAsync(path.join(targetDir, "LICENSE"), licenseText);
	}
}
