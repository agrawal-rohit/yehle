import path from "node:path";
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import {
	InstructionCategory,
	type RuleFrontmatter,
} from "../../core/instructions";

/** IDE format options. */
export const IDE_FORMATS = [
	{ label: "Cursor", value: "cursor" },
	{ label: "Windsurf", value: "windsurf" },
	{ label: "Cline", value: "cline" },
	{ label: "Claude Code", value: "claude" },
] as const;

export type IdeFormat = (typeof IDE_FORMATS)[number]["value"];

/** Paths array for frontmatter. */
function getPathsArray(frontmatter: RuleFrontmatter): string[] {
	return frontmatter.paths?.length ? frontmatter.paths : ["**/*"];
}

/** Build frontmatter block with a YAML `paths:` array. */
function frontmatterWithPathsArray(paths: string[]): string {
	return `---
paths:
${paths.map((p) => `  - "${p}"`).join("\n")}
---

`;
}

/** Build Cursor .mdc frontmatter: description, globs (YAML array), alwaysApply. */
function cursorFrontmatter(frontmatter: RuleFrontmatter): string {
	const paths = getPathsArray(frontmatter);
	return `---
description: "${frontmatter.description}"
alwaysApply: ${frontmatter.alwaysApply}
globs:
${paths.map((p) => `  - "${p}"`).join("\n")}
---

`;
}

/** Build Cline .mdc frontmatter: paths (array of glob patterns). */
function clineFrontmatter(frontmatter: RuleFrontmatter): string {
	return frontmatterWithPathsArray(getPathsArray(frontmatter));
}

/** Build Claude .claude/rules frontmatter: paths (array of glob patterns). */
function claudeFrontmatter(frontmatter: RuleFrontmatter): string {
	return frontmatterWithPathsArray(getPathsArray(frontmatter));
}

/** Path templates per IDE for rules. */
const IDE_RULE_PATH_TEMPLATES: Record<IdeFormat, string> = {
	cursor: ".cursor/rules/{{ruleName}}.mdc",
	windsurf: ".windsurf/rules/{{ruleName}}.md",
	cline: ".clinerules/{{ruleName}}.md",
	claude: ".claude/rules/{{ruleName}}.md",
};

/** Path templates per IDE for skills. */
const IDE_SKILL_PATH_TEMPLATES: Record<IdeFormat, string> = {
	cursor: ".cursor/skills/{{ruleName}}/SKILL.md",
	windsurf: ".windsurf/skills/{{ruleName}}/SKILL.md",
	cline: ".cline/skills/{{ruleName}}/SKILL.md",
	claude: ".claude/skills/{{ruleName}}/SKILL.md",
};

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
	// Skills: keep author-provided frontmatter/body as-is for all IDEs).
	if (category === InstructionCategory.SKILLS) return undefined;

	// Cursor
	if (ideFormat === "cursor")
		return (content, fm) => cursorFrontmatter(fm) + content;

	// Cline
	if (ideFormat === "cline")
		return (content, fm) => clineFrontmatter(fm) + content;

	// Claude
	if (ideFormat === "claude")
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
	// Skills: per-IDE skills directory.
	if (category === InstructionCategory.SKILLS) {
		const relSkillPath = IDE_SKILL_PATH_TEMPLATES[ideFormat].replaceAll(
			"{{ruleName}}",
			ruleName,
		);
		return path.resolve(cwd, relSkillPath);
	}

	// Rules: per-IDE rules directory.
	const relPath = IDE_RULE_PATH_TEMPLATES[ideFormat].replaceAll(
		"{{ruleName}}",
		ruleName,
	);
	return path.resolve(cwd, relPath);
}

/**
 * Transform raw instruction content for the given IDE format.
 * @param content - Raw markdown body.
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
	const transformedContent = transformContentForIde(
		content,
		ideFormat,
		category,
		frontmatter,
	);

	await ensureDirAsync(path.dirname(outputPath));
	await writeFileAsync(outputPath, transformedContent);

	return outputPath;
}
