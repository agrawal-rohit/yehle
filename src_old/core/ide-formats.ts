import path from "node:path";
import mustache from "mustache";
import { ensureDirAsync, writeFileAsync } from "./fs";
import { InstructionCategory, type RuleFrontmatter } from "./instructions";

/** IDE format options. */
export const IDE_FORMATS = [
	{ label: "Cursor", value: "cursor" },
	{ label: "Windsurf", value: "windsurf" },
	{ label: "Cline", value: "cline" },
	{ label: "Claude Code", value: "claude" },
] as const;

export type IdeFormat = (typeof IDE_FORMATS)[number]["value"];

type IdeRuleTransform = (
	content: string,
	frontmatter: RuleFrontmatter,
) => string;

type IdeConfig = {
	root: string;
	rulePathTemplate: string;
	skillPathTemplate: string;
	subagentPath?: (ruleName: string) => string;
	ruleTransform?: IdeRuleTransform;
	subagentTransform?: (
		ruleName: string,
		frontmatter: RuleFrontmatter,
		content: string,
	) => string;
};

/**
 * Escape a string for safe embedding in YAML double-quoted values.
 * Ensures backslashes and double quotes are escaped for YAML parsers.
 * @param value - Raw string value to embed.
 * @returns The escaped string safe to include inside YAML double quotes.
 */
function escapeYamlDoubleQuoted(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', String.raw`\"`);
}

/**
 * Build a YAML frontmatter block that contains only a `paths:` array.
 * Used for IDEs that represent rules as simple markdown files with globs.
 * @param paths - Glob patterns to embed.
 * @returns Frontmatter string in the expected YAML format for the IDE.
 */
function frontmatterWithPathsArray(paths: string[]): string {
	if (paths.length === 0) return "";
	return `---
paths:
${paths.map((p) => `  - "${escapeYamlDoubleQuoted(p)}"`).join("\n")}
---

`;
}

/**
 * Build Cursor (`.mdc`) rule frontmatter.
 * @param frontmatter - Rule frontmatter including `description`, `alwaysApply`, and optional `paths`.
 * @returns Frontmatter string appropriate for Cursor rule files.
 */
function cursorFrontmatter(frontmatter: RuleFrontmatter): string {
	const globsLines = frontmatter.paths?.length
		? frontmatter.paths
				.map((p) => `  - "${escapeYamlDoubleQuoted(p)}"`)
				.join("\n")
		: "";
	const globsValue = globsLines ? `\nglobs:\n${globsLines}` : "";
	return `---
description: "${frontmatter.description}"
alwaysApply: ${frontmatter.alwaysApply}${globsValue}
---

`;
}

/**
 * Build Cline rule frontmatter (paths only).
 * @param frontmatter - Rule frontmatter including optional `paths`.
 * @returns Frontmatter string for Cline rule files.
 */
function clineFrontmatter(frontmatter: RuleFrontmatter): string {
	return frontmatterWithPathsArray(frontmatter.paths ?? []);
}

/**
 * Build Claude rule frontmatter (paths only).
 * @param frontmatter - Rule frontmatter including optional `paths`.
 * @returns Frontmatter string for Claude rule files.
 */
function claudeFrontmatter(frontmatter: RuleFrontmatter): string {
	return frontmatterWithPathsArray(frontmatter.paths ?? []);
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

/** Per-IDE path and transform configuration. */
const IDE_CONFIGS: Record<IdeFormat, IdeConfig> = {
	cursor: {
		root: ".cursor",
		rulePathTemplate: ".cursor/rules/{{ruleName}}.mdc",
		skillPathTemplate: ".cursor/skills/{{ruleName}}/SKILL.md",
		subagentPath: (ruleName) => `.cursor/agents/${ruleName}.md`,
		ruleTransform: (content, frontmatter) =>
			cursorFrontmatter(frontmatter) + content,
		subagentTransform: (ruleName, frontmatter, content) =>
			cursorAgentFrontmatter(ruleName, frontmatter) + content,
	},
	windsurf: {
		root: ".windsurf",
		rulePathTemplate: ".windsurf/rules/{{ruleName}}.md",
		skillPathTemplate: ".windsurf/skills/{{ruleName}}/SKILL.md",
	},
	cline: {
		root: ".cline",
		rulePathTemplate: ".clinerules/{{ruleName}}.md",
		skillPathTemplate: ".cline/skills/{{ruleName}}/SKILL.md",
		ruleTransform: (content, frontmatter) =>
			clineFrontmatter(frontmatter) + content,
		subagentTransform: (ruleName, frontmatter, content) =>
			ideSkillFrontmatter(ruleName, frontmatter) + content,
	},
	claude: {
		root: ".claude",
		rulePathTemplate: ".claude/rules/{{ruleName}}.md",
		skillPathTemplate: ".claude/skills/{{ruleName}}/SKILL.md",
		subagentPath: (ruleName) => `.claude/agents/${ruleName}.md`,
		ruleTransform: (content, frontmatter) =>
			claudeFrontmatter(frontmatter) + content,
		subagentTransform: (ruleName, frontmatter, content) =>
			claudeAgentFrontmatter(ruleName, frontmatter) + content,
	},
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
		checkpointDir: `${IDE_CONFIGS[ideFormat].root}/checkpoints`,
		ideRoot: IDE_CONFIGS[ideFormat].root,
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
	const config = IDE_CONFIGS[ideFormat];

	if (category === InstructionCategory.SUBAGENTS) {
		if (config.subagentPath)
			return path.resolve(cwd, config.subagentPath(ruleName));

		const relSkillPath = config.skillPathTemplate.replaceAll(
			"{{ruleName}}",
			ruleName,
		);
		return path.resolve(cwd, relSkillPath);
	}

	if (category === InstructionCategory.SKILLS) {
		const relSkillPath = config.skillPathTemplate.replaceAll(
			"{{ruleName}}",
			ruleName,
		);
		return path.resolve(cwd, relSkillPath);
	}

	const relPath = config.rulePathTemplate.replaceAll("{{ruleName}}", ruleName);
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
	const config = IDE_CONFIGS[ideFormat];

	if (category === InstructionCategory.SUBAGENTS) {
		if (config.subagentTransform)
			return config.subagentTransform(ruleName, frontmatter, content);
		return ideSkillFrontmatter(ruleName, frontmatter) + content;
	}

	if (category === InstructionCategory.SKILLS) return content;

	if (config.ruleTransform) return config.ruleTransform(content, frontmatter);
	return content;
}

/**
 * Write the instruction to the appropriate location for the given IDE format.
 * Prepends the tuckshop registry comment, then IDE-specific frontmatter (when applicable), then content.
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
