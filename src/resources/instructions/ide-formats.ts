import path from "node:path";
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import {
	InstructionCategory,
	type RuleFrontmatter,
} from "../../core/instructions-registry";
import { IdeFormat } from "./config";

/** Marketing comment prepended to written instructions (yehle registry). */
const YEHLE_REGISTRY_URL =
	"https://github.com/agrawal-rohit/yehle/blob/main/instructions/";
const YEHLE_REGISTRY_COMMENT = `<!-- This instruction is part of the "yehle" instruction registry: ${YEHLE_REGISTRY_URL} -->\n\n`;

/**
 * Build Cursor .mdc frontmatter: description, globs (YAML array), alwaysApply.
 * @param frontmatter - Rule frontmatter (description, globs, alwaysApply from instruction file).
 * @returns YAML frontmatter string (including closing ---).
 */
function cursorFrontmatter(frontmatter: RuleFrontmatter): string {
	return `---
description: "${frontmatter.description}"
globs:
${frontmatter.globs?.map((g) => `  - "${g}"`).join("\n")}
alwaysApply: ${frontmatter.alwaysApply}
---

`;
}

/**
 * Build Cline .mdc frontmatter: title, description, glob (single pattern).
 */
function clineFrontmatter(frontmatter: RuleFrontmatter): string {
	const glob = frontmatter.globs?.[0] ?? "**/*";
	return `---
title: "${frontmatter.description}"
description: "${frontmatter.description}"
glob: "${glob}"
---

`;
}

/**
 * Build Claude .claude/rules frontmatter: globs as comma-separated (per docs).
 */
function claudeFrontmatter(frontmatter: RuleFrontmatter): string {
	const globsStr = frontmatter.globs?.join(", ") ?? "";
	return `---
globs: ${globsStr}
---

`;
}

/**
 * Build Copilot path-specific .instructions.md frontmatter: applyTo (single glob).
 */
function copilotFrontmatter(frontmatter: RuleFrontmatter): string {
	const applyTo = frontmatter.globs?.[0] ?? "**/*";
	return `---
applyTo: "${applyTo}"
---

`;
}

/** Copilot repo-wide (e.g. essential): no frontmatter, content only. */
function copilotRepoWide(_frontmatter: RuleFrontmatter): string {
	return "";
}

/** Path templates per IDE; some vary by category (e.g. Copilot). */
/** Path template per IDE ({{ruleName}} replaced with instruction name). Same for all categories except Copilot essential. */
const IDE_PATH_TEMPLATES: Record<IdeFormat, string> = {
	[IdeFormat.CURSOR]: ".cursor/rules/{{ruleName}}.mdc",
	[IdeFormat.WINDSURF]: ".windsurf/rules/{{ruleName}}.md",
	[IdeFormat.CLINE]: ".clinerules/{{ruleName}}.mdc",
	[IdeFormat.CLAUDE]: ".claude/rules/{{ruleName}}.md",
	[IdeFormat.COPILOT]: ".github/instructions/{{ruleName}}.instructions.md",
};

/** Copilot repo-wide single file for essential (no {{ruleName}}). */
const COPILOT_REPO_WIDE_PATH = ".github/copilot-instructions.md";

/**
 * Get the transform function for the given IDE and category (adds frontmatter or passes through).
 * Copilot: repo-wide (no frontmatter) for essential; path-specific frontmatter otherwise.
 * @param ideFormat - Target IDE format.
 * @param category - Instruction category.
 * @returns A function (content, frontmatter) => transformed string, or undefined when no transform (e.g. Windsurf).
 */
function getTransformForIde(
	ideFormat: IdeFormat,
	category: InstructionCategory,
): ((content: string, frontmatter: RuleFrontmatter) => string) | undefined {
	if (
		ideFormat === IdeFormat.COPILOT &&
		category === InstructionCategory.ESSENTIAL
	)
		return (content, fm) => copilotRepoWide(fm) + content;
	if (
		ideFormat === IdeFormat.COPILOT &&
		(category === InstructionCategory.OPTIONAL ||
			category === InstructionCategory.LANGUAGE ||
			category === InstructionCategory.PROJECT_SPEC ||
			category === InstructionCategory.TEMPLATE)
	)
		return (content, fm) => copilotFrontmatter(fm) + content;
	if (ideFormat === IdeFormat.CURSOR)
		return (content, fm) => cursorFrontmatter(fm) + content;
	if (ideFormat === IdeFormat.CLINE)
		return (content, fm) => clineFrontmatter(fm) + content;
	if (ideFormat === IdeFormat.CLAUDE)
		return (content, fm) => claudeFrontmatter(fm) + content;
	return undefined;
}

/**
 * Resolve the output path for an instruction given the IDE format, name, and category.
 * @param ideFormat - Target IDE format (determines path template).
 * @param ruleName - Instruction name (replaces {{ruleName}} in template).
 * @param cwd - Current working directory (project root).
 * @param category - Instruction category (Copilot uses repo-wide path for essential only).
 * @returns Absolute path where the instruction file should be written.
 */
export function resolveOutputPath(
	ideFormat: IdeFormat,
	ruleName: string,
	cwd: string,
	category: InstructionCategory,
): string {
	if (
		ideFormat === IdeFormat.COPILOT &&
		category === InstructionCategory.ESSENTIAL
	) {
		return path.resolve(cwd, COPILOT_REPO_WIDE_PATH);
	}
	const relPath = IDE_PATH_TEMPLATES[ideFormat].replaceAll(
		"{{ruleName}}",
		ruleName,
	);
	return path.resolve(cwd, relPath);
}

/**
 * Transform raw instruction content for the given IDE format (add frontmatter when applicable).
 * @param content - Raw markdown body (may already include registry comment).
 * @param ideFormat - Target IDE format.
 * @param category - Instruction category.
 * @param frontmatter - Rule frontmatter from the instruction file.
 * @returns Transformed string (content with optional frontmatter prepended).
 */
export function transformContentForIde(
	content: string,
	ideFormat: IdeFormat,
	category: InstructionCategory,
	frontmatter: RuleFrontmatter,
): string {
	const transform = getTransformForIde(ideFormat, category);
	if (transform) return transform(content, frontmatter);
	return content;
}

/**
 * Write the instruction to the appropriate location for the given IDE format.
 * Prepends the yehle registry comment, then IDE-specific frontmatter (when applicable), then content.
 * @param cwd - Current working directory (project root).
 * @param ruleName - Instruction name (used for path).
 * @param content - Raw instruction body (markdown).
 * @param ideFormat - Target IDE format.
 * @param category - Instruction category.
 * @param frontmatter - Rule frontmatter from the instruction file.
 * @returns Promise resolving to the absolute path of the written file.
 */
export async function writeInstructionToFile(
	cwd: string,
	ruleName: string,
	content: string,
	ideFormat: IdeFormat,
	category: InstructionCategory,
	frontmatter: RuleFrontmatter,
): Promise<string> {
	const outputPath = resolveOutputPath(ideFormat, ruleName, cwd, category);
	const contentWithRegistryComment = YEHLE_REGISTRY_COMMENT + content;
	const transformedContent = transformContentForIde(
		contentWithRegistryComment,
		ideFormat,
		category,
		frontmatter,
	);

	await ensureDirAsync(path.dirname(outputPath));
	await writeFileAsync(outputPath, transformedContent);

	return outputPath;
}
