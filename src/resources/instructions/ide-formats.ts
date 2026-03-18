import path from "node:path";
import mustache from "mustache";
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import {
	InstructionCategory,
	type RuleFrontmatter,
} from "../../core/instructions";
import { escapeYamlDoubleQuoted } from "../../core/utils";

/** IDE format options. */
export const IDE_FORMATS = [
	{ label: "Cursor", value: "cursor" },
	{ label: "Windsurf", value: "windsurf" },
	{ label: "Cline", value: "cline" },
	{ label: "Claude Code", value: "claude" },
] as const;

export type IdeFormat = (typeof IDE_FORMATS)[number]["value"];

/**
 * Resolve the `paths` glob list used in IDE-specific rule frontmatter.
 * Falls back to a broad default (written as `** / *`) when no explicit paths are provided.
 * @param frontmatter - Parsed instruction frontmatter.
 * @returns Array of glob patterns to embed in IDE frontmatter.
 */
function getPathsArray(frontmatter: RuleFrontmatter): string[] {
	return frontmatter.paths?.length ? frontmatter.paths : ["**/*"];
}

/**
 * Build a YAML frontmatter block that contains only a `paths:` array.
 * Used for IDEs that represent rules as simple markdown files with globs.
 * @param paths - Glob patterns to embed.
 * @returns Frontmatter string in the expected YAML format for the IDE.
 */
function frontmatterWithPathsArray(paths: string[]): string {
	return `---
paths:
${paths.map((p) => `  - "${p}"`).join("\n")}
---

`;
}

/**
 * Build Cursor (`.mdc`) rule frontmatter.
 * @param frontmatter - Rule frontmatter including `description`, `alwaysApply`, and optional `paths`.
 * @returns Frontmatter string appropriate for Cursor rule files.
 */
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

/**
 * Build Cline rule frontmatter (paths only).
 * @param frontmatter - Rule frontmatter including optional `paths`.
 * @returns Frontmatter string for Cline rule files.
 */
function clineFrontmatter(frontmatter: RuleFrontmatter): string {
	return frontmatterWithPathsArray(getPathsArray(frontmatter));
}

/**
 * Build Claude rule frontmatter (paths only).
 * @param frontmatter - Rule frontmatter including optional `paths`.
 * @returns Frontmatter string for Claude rule files.
 */
function claudeFrontmatter(frontmatter: RuleFrontmatter): string {
	return frontmatterWithPathsArray(getPathsArray(frontmatter));
}

/** Dot-directory root for each IDE format. */
const IDE_ROOTS: Record<IdeFormat, string> = {
	cursor: ".cursor",
	windsurf: ".windsurf",
	cline: ".cline",
	claude: ".claude",
};

/** Path templates per IDE for rules. */
const IDE_RULE_PATH_TEMPLATES: Record<IdeFormat, string> = {
	cursor: `${IDE_ROOTS.cursor}/rules/{{ruleName}}.mdc`,
	windsurf: `${IDE_ROOTS.windsurf}/rules/{{ruleName}}.md`,
	cline: `.clinerules/{{ruleName}}.md`,
	claude: `${IDE_ROOTS.claude}/rules/{{ruleName}}.md`,
};

/** Path templates per IDE for skills. */
const IDE_SKILL_PATH_TEMPLATES: Record<IdeFormat, string> = {
	cursor: `${IDE_ROOTS.cursor}/skills/{{ruleName}}/SKILL.md`,
	windsurf: `${IDE_ROOTS.windsurf}/skills/{{ruleName}}/SKILL.md`,
	cline: `${IDE_ROOTS.cline}/skills/{{ruleName}}/SKILL.md`,
	claude: `${IDE_ROOTS.claude}/skills/{{ruleName}}/SKILL.md`,
};

/**
 * Render known Mustache variables inside instruction bodies.
 * This keeps instruction templates portable across IDE formats.
 */
function renderKnownMustacheVariables(
	content: string,
	ideFormat: IdeFormat,
): string {
	// Fast path: avoid Mustache rendering when no placeholders exist.
	if (
		!content.includes("{{checkpointDir}}") &&
		!content.includes("{{ideRoot}}")
	)
		return content;

	const data = {
		checkpointDir: `${IDE_ROOTS[ideFormat]}/checkpoints`,
		ideRoot: IDE_ROOTS[ideFormat],
	};

	const previousEscape = mustache.escape;
	try {
		// Preserve literal markdown characters during rendering.
		mustache.escape = (s: string) => s;
		return mustache.render(content, data);
	} finally {
		mustache.escape = previousEscape;
	}
}

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
 * Build Cursor YAML frontmatter for agent/subagent files.
 * @param ruleName - Agent name/identifier.
 * @param frontmatter - Parsed instruction frontmatter (description, model, readonly).
 * @returns Frontmatter string suitable for a Cursor agent markdown file.
 */
function cursorAgentFrontmatter(
	ruleName: string,
	frontmatter: RuleFrontmatter,
): string {
	const description = frontmatter.description ?? ruleName;
	const model = frontmatter.model ?? "inherit";

	const readonlyLine =
		typeof frontmatter.readonly === "boolean"
			? `readonly: ${frontmatter.readonly}
`
			: "";

	return `---
name: ${ruleName}
description: "${escapeYamlDoubleQuoted(description)}"
model: ${model}
${readonlyLine}---

`;
}

/**
 * Build YAML frontmatter for IDE "skill" representations of agents/subagents.
 * @param ruleName - Skill identifier (typically matches the agent name).
 * @param frontmatter - Parsed instruction frontmatter (description is used when present).
 * @returns Frontmatter string appropriate for skill files.
 */
function ideSkillFrontmatter(
	ruleName: string,
	frontmatter: RuleFrontmatter,
): string {
	const description = frontmatter.description ?? ruleName;
	return `---
name: ${ruleName}
description: "${escapeYamlDoubleQuoted(description)}"
---

`;
}

/**
 * Build YAML frontmatter for Claude Code agent/subagent files.
 * @param ruleName - Agent name/identifier.
 * @param frontmatter - Parsed instruction frontmatter (description, model, readonly).
 * @returns Frontmatter string suitable for Claude Code agent markdown files.
 */
function claudeAgentFrontmatter(
	ruleName: string,
	frontmatter: RuleFrontmatter,
): string {
	const description = frontmatter.description ?? ruleName;
	const modelLine =
		typeof frontmatter.model === "string"
			? `model: ${frontmatter.model}
`
			: "";
	const permissionModeLine =
		frontmatter.readonly === true
			? `permissionMode: plan
`
			: "";

	return `---
name: ${ruleName}
description: "${escapeYamlDoubleQuoted(description)}"
${modelLine}${permissionModeLine}---

`;
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
	// Subagent: per-IDE subagent directory.
	if (category === InstructionCategory.SUBAGENTS) {
		// Cursor: write to `.cursor/agents/*.md`
		if (ideFormat === "cursor")
			return path.resolve(cwd, `.cursor/agents/${ruleName}.md`);

		// Claude Code: write to `.claude/agents/*.md`
		if (ideFormat === "claude") {
			return path.resolve(cwd, `.claude/agents/${ruleName}.md`);
		}

		// Other IDEs: write as skills instead (`*/skills/*/SKILL.md`)
		const relSkillPath = IDE_SKILL_PATH_TEMPLATES[ideFormat].replaceAll(
			"{{ruleName}}",
			ruleName,
		);
		return path.resolve(cwd, relSkillPath);
	}

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
	ruleName: string,
	frontmatter: RuleFrontmatter,
): string {
	// Subagent instructions
	if (category === InstructionCategory.SUBAGENTS) {
		// Cursor
		if (ideFormat === "cursor")
			return cursorAgentFrontmatter(ruleName, frontmatter) + content;

		// Claude Code
		if (ideFormat === "claude")
			return claudeAgentFrontmatter(ruleName, frontmatter) + content;

		// Use skill format for IDEs that don't support custom subagent files.
		return ideSkillFrontmatter(ruleName, frontmatter) + content;
	}

	// Rules, skills, and other categories (apply IDE-specific frontmatter transformations)
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
		ruleName,
		frontmatter,
	);
	const renderedContent = renderKnownMustacheVariables(
		transformedContent,
		ideFormat,
	);

	await ensureDirAsync(path.dirname(outputPath));
	await writeFileAsync(outputPath, renderedContent);

	return outputPath;
}
