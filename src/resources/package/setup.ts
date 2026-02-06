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
import { resolveTemplatesDir } from "../../core/template-registry";
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
 * Create the package.json using the provided answers and package manager version.
 * @param targetDir - Absolute path to the package directory.
 * @param generateConfig - Generate configuration describing the new package.
 * @param packageManagerVersion - A string like "pnpm@9.0.0" to record in package.json's packageManager.
 * @returns The final package.json object that was persisted to disk.
 * @throws If an existing package.json is invalid JSON.
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
			JSON.stringify(config, null, "\t") + "\n",
		);
	} catch {
		// biome.json does not exist or error; ignore
	}
}

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
 * Write the chosen template files for a resource into the target directory.
 * @param targetDir - Package root directory to write into.
 * @param generateConfig - Generate configuration describing the new package.
 * @returns A promise that resolves when the template files have been written.
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
