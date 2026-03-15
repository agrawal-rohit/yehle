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
	{ label: "GitHub Copilot", value: "copilot" },
] as const;

export type IdeFormat = (typeof IDE_FORMATS)[number]["value"];

/** Comment prepended to written instructions (yehle registry). */
const YEHLE_REGISTRY_URL =
	"https://github.com/agrawal-rohit/yehle/blob/main/instructions/";

const YEHLE_REGISTRY_COMMENT = `<!-- This instruction is part of the "yehle" instruction registry: ${YEHLE_REGISTRY_URL} -->\n\n`;

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

/** Build Copilot path-specific .instructions.md frontmatter. */
function copilotFrontmatter(frontmatter: RuleFrontmatter): string {
	const paths = getPathsArray(frontmatter);
	const applyTo = paths.join(", ");
	return `---
applyTo: "${applyTo}"
---

`;
}

/** Copilot repo-wide. */
function copilotRepoWide(_frontmatter: RuleFrontmatter): string {
	return "";
}

/** Path templates per IDE. */
const IDE_PATH_TEMPLATES: Record<IdeFormat, string> = {
	cursor: ".cursor/rules/{{ruleName}}.mdc",
	windsurf: ".windsurf/rules/{{ruleName}}.md",
	cline: ".clinerules/{{ruleName}}.mdc",
	claude: ".claude/rules/{{ruleName}}.md",
	copilot: ".github/instructions/{{ruleName}}.instructions.md",
};

/** Copilot repo-wide single file. */
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
	// Copilot repo-wide.
	if (ideFormat === "copilot" && category === InstructionCategory.ESSENTIAL)
		return (content, fm) => copilotRepoWide(fm) + content;

	// Copilot path-specific.
	if (
		ideFormat === "copilot" &&
		(category === InstructionCategory.SITUATIONAL ||
			category === InstructionCategory.LANGUAGE ||
			category === InstructionCategory.PROJECT_SPEC ||
			category === InstructionCategory.TEMPLATE)
	)
		return (content, fm) => copilotFrontmatter(fm) + content;

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
	// Copilot repo-wide.
	if (ideFormat === "copilot" && category === InstructionCategory.ESSENTIAL)
		return path.resolve(cwd, COPILOT_REPO_WIDE_PATH);

	// Path-specific.
	const relPath = IDE_PATH_TEMPLATES[ideFormat].replaceAll(
		"{{ruleName}}",
		ruleName,
	);
	return path.resolve(cwd, relPath);
}

/**
 * Transform raw instruction content for the given IDE format.
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
