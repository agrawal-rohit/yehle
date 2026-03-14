import fs from "node:fs";
import path from "node:path";
import mustache from "mustache";
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
	type InstructionContext,
	listAvailableInstructions,
	readOptionalInstructionsMapping,
} from "../../core/instructions-registry";
import { resolveTemplatesDir } from "../../core/template-registry";
import {
	fetchInstructionContent,
	getLanguageInstructionForPackageLang,
	getLanguageInstructionMetadata,
	getMetadataFromFrontmatter,
	INSTRUCTION_CATEGORY_LANGUAGE,
} from "../instructions/config";
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
 * Applies in order: essential (default set) → language → project-spec (package) → template (pre-processed) → mapped optional.
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
		projectSpec,
		template: generateConfig.template,
	};

	// 1. Essential (all files in essential)
	const essentialNames = await listAvailableInstructions("essential");
	for (const name of essentialNames) {
		const content = await fetchInstructionContent("essential", name);
		const metadata = await getMetadataFromFrontmatter("essential", name);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			"essential",
			metadata,
		);
	}

	// 2. Language (single instruction for package lang)
	const languageName = await getLanguageInstructionForPackageLang(
		generateConfig.lang,
	);
	if (languageName) {
		const metadata = await getLanguageInstructionMetadata(generateConfig.lang);
		if (metadata) {
			const content = await fetchInstructionContent(
				INSTRUCTION_CATEGORY_LANGUAGE,
				languageName,
				{ lang: generateConfig.lang },
			);
			await writeInstructionToFile(
				targetDir,
				languageName,
				content,
				ideFormat,
				INSTRUCTION_CATEGORY_LANGUAGE,
				metadata,
			);
		}
	}

	// 3. Project-spec (package)
	const projectSpecNames = await listAvailableInstructions("project-spec", {
		lang: generateConfig.lang,
		projectSpec,
	});
	for (const name of projectSpecNames) {
		const content = await fetchInstructionContent("project-spec", name, ctx);
		const metadata = await getMetadataFromFrontmatter(
			"project-spec",
			name,
			ctx,
		);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			"project-spec",
			metadata,
		);
	}

	// 4. Template (from chosen template dir; pre-process with mustache)
	const templateNames = await listAvailableInstructions("template", ctx);
	const templateDir = await resolveTemplatesDir(
		generateConfig.lang,
		`package/${generateConfig.template}`,
	);
	const mustacheView = { ...generateConfig };
	for (const name of templateNames) {
		let content = await fetchInstructionContent("template", name, ctx);
		try {
			content = mustache.render(content, mustacheView);
		} catch {
			// If mustache fails, use raw content
		}
		const metadata = await getMetadataFromFrontmatter("template", name, ctx);
		await writeInstructionToFile(
			targetDir,
			name,
			content,
			ideFormat,
			"template",
			metadata,
		);
	}

	// 5. Mapped optional (from yehle-instructions.json in template dir)
	const optionalNames = await readOptionalInstructionsMapping(templateDir);
	for (const name of optionalNames) {
		try {
			const content = await fetchInstructionContent("optional", name);
			const metadata = await getMetadataFromFrontmatter("optional", name);
			await writeInstructionToFile(
				targetDir,
				name,
				content,
				ideFormat,
				"optional",
				metadata,
			);
		} catch {
			// Skip optional instruction if not found or invalid
		}
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
