import fs from "node:fs";
import path from "node:path";
import mitLicense from "spdx-license-list/licenses/MIT.json";
import {
	copyDirSafeAsync,
	ensureDirAsync,
	isDirAsync,
	removeFilesByBasename,
	renderMustacheTemplates,
	stripKeyFromJSONFile,
	writeFileAsync,
} from "./fs";
import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	type InstructionContext,
	listAvailableInstructions,
	type RuleFrontmatter,
	readSkillsMapping,
	readToolingInstructionsMapping,
} from "./instructions";
import { resolveTemplatesDir } from "./templates";

/** Basenames to remove from generated projects (template-only sources). */
const DEFAULT_FILES_TO_REMOVE_AFTER_COPY = ["instructions", "yehle.yaml"];

export type WriteTemplateFilesOptions = {
	lang: string;
	projectSpec: string;
	template: string;
	filesToRemoveAfterCopy?: string[];
	license?: { public: boolean; authorName?: string };
};

export type ApplyTemplateModificationsOptions = {
	targetDir: string;
	metadata: Record<string, unknown>;
	isPublic: boolean;
	publicOnlyFiles: string[];
	stripJsonKeys?: Array<{ file: string; key: string }>;
};

export type WriteInstructionFn = (
	targetDir: string,
	name: string,
	content: string,
	ideFormat: string,
	category: InstructionCategory,
	frontmatter: RuleFrontmatter,
) => Promise<string>;

export type AddProjectInstructionsContext = {
	lang: string;
	projectSpec: string;
	template: string;
	includeInstructions?: boolean;
	instructionsIdeFormat?: string;
};

/**
 * Creates the project directory based on the provided project name.
 * @param cwd - Current working directory (e.g., process.cwd()).
 * @param projectName - The name of the project, used as the directory name.
 * @returns The absolute path to the created project directory.
 */
export async function createProjectDirectory(
	cwd: string,
	projectName: string,
): Promise<string> {
	const targetDir = path.resolve(cwd, projectName);
	await ensureDirAsync(targetDir);
	return targetDir;
}

/**
 * Write template files into the target directory following the hierarchy:
 * shared → lang/shared → projectSpec/shared → projectSpec/template.
 * Optionally adds MIT LICENSE for public projects when authorName is set.
 *
 * @param targetDir - Project root directory to write into.
 * @param options - Configuration for which templates to copy and post-copy behaviour.
 * @returns Promise that resolves when all template files have been copied.
 */
export async function writeTemplateFiles(
	targetDir: string,
	options: WriteTemplateFilesOptions,
): Promise<void> {
	const { lang, projectSpec, template, license } = options;
	const filesToRemove = [
		...DEFAULT_FILES_TO_REMOVE_AFTER_COPY,
		...(options.filesToRemoveAfterCopy ?? []),
	];

	// Global shared: templates/shared
	const globalShared = await resolveTemplatesDir("shared");
	await copyDirSafeAsync(globalShared, targetDir);

	// Language shared: templates/<lang>/shared
	const langShared = await resolveTemplatesDir(lang, "shared");
	await copyDirSafeAsync(langShared, targetDir);

	// Project-spec shared: templates/<lang>/<projectSpec>/shared
	const itemShared = await resolveTemplatesDir(lang, `${projectSpec}/shared`);
	await copyDirSafeAsync(itemShared, targetDir);

	// Project-spec template: templates/<lang>/<projectSpec>/<template>
	const chosenTemplateDir = await resolveTemplatesDir(
		lang,
		`${projectSpec}/${template}`,
	);
	await copyDirSafeAsync(chosenTemplateDir, targetDir);

	await removeFilesByBasename(targetDir, filesToRemove);

	if (license?.public && license.authorName) {
		const year = new Date().getFullYear().toString();
		const licenseText = mitLicense.licenseText
			.replace("<year>", year)
			.replace("<copyright holders>", license.authorName);
		await writeFileAsync(path.join(targetDir, "LICENSE"), licenseText);
	}
}

/**
 * Apply template modifications: render mustache templates, remove public-only files when not public,
 * and optionally strip keys from JSON config files.
 *
 * @param options - Configuration for modifications.
 * @returns Promise that resolves when modifications are complete.
 */
export async function applyTemplateModifications(
	options: ApplyTemplateModificationsOptions,
): Promise<void> {
	await renderMustacheTemplates(options.targetDir, options.metadata);

	if (!options.isPublic && options.publicOnlyFiles.length > 0)
		await removeFilesByBasename(options.targetDir, options.publicOnlyFiles);

	for (const { file, key } of options.stripJsonKeys ?? []) {
		await stripKeyFromJSONFile(path.join(options.targetDir, file), key);
	}
}

/**
 * Add agent instructions to a project when includeInstructions is true and instructionsIdeFormat is set.
 * Applies in order: essential → language → project-spec → template → mapped tooling → mapped skills.
 * Generic across project types; projectSpec and template determine which instructions are selected.
 *
 * @param targetDir - Absolute path to the project root directory.
 * @param ctx - Context with lang, projectSpec, template, and instruction options.
 * @param writeInstruction - Callback to write each instruction (e.g. from resources/instructions/ide-formats).
 * @param projectOverviewContent - Optional custom content for the overview instruction; uses default when omitted.
 * @returns Promise that resolves when all instruction files have been written, or immediately when instructions are disabled.
 */
export async function addProjectInstructions(
	targetDir: string,
	ctx: AddProjectInstructionsContext,
	writeInstruction: WriteInstructionFn,
	projectOverviewContent?: string,
): Promise<void> {
	if (!ctx.includeInstructions || !ctx.instructionsIdeFormat) return;

	const ideFormat = ctx.instructionsIdeFormat;
	const instructionContext: InstructionContext = {
		lang: ctx.lang,
		projectSpec: ctx.projectSpec,
		template: ctx.template,
	};

	// Essential instructions
	const essentialNames = await listAvailableInstructions(
		InstructionCategory.ESSENTIAL,
	);
	for (const name of essentialNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.ESSENTIAL,
			name,
		);
		await writeInstruction(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.ESSENTIAL,
			frontmatter,
		);
	}

	// Language instructions
	const languageNames = await listAvailableInstructions(
		InstructionCategory.LANGUAGE,
		{ lang: ctx.lang },
	);
	for (const name of languageNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.LANGUAGE,
			name,
			{ lang: ctx.lang },
		);
		await writeInstruction(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.LANGUAGE,
			frontmatter,
		);
	}

	// Project-spec instructions
	const projectSpecNames = await listAvailableInstructions(
		InstructionCategory.PROJECT_SPEC,
		{
			lang: ctx.lang,
			projectSpec: ctx.projectSpec,
		},
	);
	for (const name of projectSpecNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.PROJECT_SPEC,
			name,
			instructionContext,
		);
		await writeInstruction(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.PROJECT_SPEC,
			frontmatter,
		);
	}

	// Template instructions
	const templateNames = await listAvailableInstructions(
		InstructionCategory.TEMPLATE,
		instructionContext,
	);
	const templateDir = await resolveTemplatesDir(
		ctx.lang,
		`${ctx.projectSpec}/${ctx.template}`,
	);
	for (const name of templateNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.TEMPLATE,
			name,
			instructionContext,
		);
		await writeInstruction(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.TEMPLATE,
			frontmatter,
		);
	}

	// Tooling instructions from yehle.yaml
	const toolingNames = await readToolingInstructionsMapping(templateDir);
	for (const name of toolingNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.TOOLING,
			name,
		);
		await writeInstruction(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.TOOLING,
			frontmatter,
		);
	}

	// Skills instructions from yehle.yaml
	const skillNames = await readSkillsMapping(templateDir);
	for (const name of skillNames) {
		const { content, frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.SKILLS,
			name,
		);
		await writeInstruction(
			targetDir,
			name,
			content,
			ideFormat,
			InstructionCategory.SKILLS,
			frontmatter,
		);
	}

	// Placeholder overview instruction
	const projectOverviewFrontmatter: RuleFrontmatter = {
		description:
			"Describe the project goal, scope, and non-technical product requirements",
		alwaysApply: true,
	};
	const overviewContent =
		projectOverviewContent ??
		`# Project overview

Briefly describe:

- What this project is about and who it is for.
- The core features and behaviours that are in scope.
- Important non-goals (what this project is explicitly not supposed to do).
- Any key constraints (performance, compliance, integration boundaries).
- How you will know this project is successful (metrics or outcomes).
`;
	await writeInstruction(
		targetDir,
		"overview",
		overviewContent,
		ideFormat,
		InstructionCategory.ESSENTIAL,
		projectOverviewFrontmatter,
	);
}

/**
 * Scan GitHub workflow files in the project for secrets.* references.
 * Returns the list of secret names (excluding GITHUB_TOKEN).
 *
 * @param targetDir - Absolute path to the project root (e.g. .github/workflows is under here).
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
 * Build template metadata for mustache rendering.
 * Includes packageManagerVersion, templateHasPlayground (when template has playground subdir), and custom extras.
 *
 * @param lang - Programming language.
 * @param templatePath - Path segment for the template (e.g. package/basic).
 * @param packageManagerVersion - Version string (e.g. "pnpm@9.0.0").
 * @param extras - Additional keys to merge into the metadata.
 * @returns Promise resolving to the merged metadata object.
 */
export async function buildTemplateMetadata(
	lang: string,
	templatePath: string,
	packageManagerVersion: string,
	extras: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const chosenTemplateDir = await resolveTemplatesDir(lang, templatePath);
	const hasPlayground = await isDirAsync(
		path.join(chosenTemplateDir, "playground"),
	);
	return {
		packageManagerVersion,
		templateHasPlayground: hasPlayground,
		...extras,
	};
}
