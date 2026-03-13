import path from "node:path";
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import type { InstructionCategory } from "../../core/template-registry";
import { IdeFormat } from "./config";

/** Globs and metadata per instruction type for IDE frontmatter. */
export type InstructionMetadata = {
	description: string;
	globs: string[];
	alwaysApply: boolean;
};

/** Cursor .mdc: description, globs (YAML array), alwaysApply. */
function cursorFrontmatter(meta: InstructionMetadata): string {
	return `---
description: "${meta.description}"
globs:
${meta.globs.map((g) => `  - "${g}"`).join("\n")}
alwaysApply: ${meta.alwaysApply}
---

`;
}

/** Cline .mdc: title, description, glob (single pattern or comma-separated). */
function clineFrontmatter(meta: InstructionMetadata): string {
	const glob = meta.globs[0] ?? "**/*";
	return `---
title: "${meta.description}"
description: "${meta.description}"
glob: "${glob}"
---

`;
}

/** Claude .claude/rules: globs as comma-separated (per docs). */
function claudeFrontmatter(meta: InstructionMetadata): string {
	const globsStr = meta.globs.join(", ");
	return `---
globs: ${globsStr}
---

`;
}

/** Copilot path-specific .instructions.md: applyTo. */
function copilotFrontmatter(meta: InstructionMetadata): string {
	const applyTo = meta.globs[0] ?? "**/*";
	return `---
applyTo: "${applyTo}"
---

`;
}

/** Copilot repo-wide: no frontmatter. */
function copilotRepoWide(_meta: InstructionMetadata): string {
	return "";
}

/**
 * Build metadata for an instruction based on category and name.
 * Preferences apply to all files; languages apply to relevant file patterns.
 */
export function getInstructionMetadata(
	category: InstructionCategory,
	name: string,
): InstructionMetadata {
	const humanName = name.replaceAll("-", " ");
	if (category === "preferences") {
		return {
			description: humanName,
			globs: ["**/*"],
			alwaysApply: true,
		};
	}
	// Language-specific
	if (name === "typescript") {
		return {
			description: "TypeScript-specific coding standards",
			globs: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
			alwaysApply: false,
		};
	}
	return {
		description: humanName,
		globs: ["**/*"],
		alwaysApply: false,
	};
}

/** Path templates per IDE; some vary by category (e.g. Copilot). */
const IDE_PATH_TEMPLATES: Record<
	IdeFormat,
	Record<InstructionCategory, string>
> = {
	[IdeFormat.CURSOR]: {
		preferences: ".cursor/rules/{{ruleName}}.mdc",
		languages: ".cursor/rules/{{ruleName}}.mdc",
	},
	[IdeFormat.WINDSURF]: {
		preferences: ".windsurf/rules/{{ruleName}}.md",
		languages: ".windsurf/rules/{{ruleName}}.md",
	},
	[IdeFormat.CLINE]: {
		preferences: ".clinerules/{{ruleName}}.mdc",
		languages: ".clinerules/{{ruleName}}.mdc",
	},
	[IdeFormat.CLAUDE]: {
		preferences: ".claude/rules/{{ruleName}}.md",
		languages: ".claude/rules/{{ruleName}}.md",
	},
	[IdeFormat.COPILOT]: {
		preferences: ".github/copilot-instructions.md",
		languages: ".github/instructions/{{ruleName}}.instructions.md",
	},
	[IdeFormat.GEMINI]: {
		preferences: "GEMINI.md",
		languages: "GEMINI.md",
	},
};

/** Transform behavior per IDE. Copilot uses different transform for preferences vs languages. */
function getTransformForIde(
	ideFormat: IdeFormat,
	category: InstructionCategory,
): ((content: string, meta: InstructionMetadata) => string) | undefined {
	if (ideFormat === IdeFormat.COPILOT && category === "preferences")
		return (content, _meta) => copilotRepoWide(_meta) + content;
	if (ideFormat === IdeFormat.COPILOT && category === "languages")
		return (content, meta) => copilotFrontmatter(meta) + content;
	if (ideFormat === IdeFormat.CURSOR)
		return (content, meta) => cursorFrontmatter(meta) + content;
	if (ideFormat === IdeFormat.CLINE)
		return (content, meta) => clineFrontmatter(meta) + content;
	if (ideFormat === IdeFormat.CLAUDE)
		return (content, meta) => claudeFrontmatter(meta) + content;
	return undefined;
}

/**
 * Resolves the output path for an instruction given the IDE format, name, and category.
 */
export function resolveOutputPath(
	ideFormat: IdeFormat,
	ruleName: string,
	cwd: string,
	category: InstructionCategory,
): string {
	const template = IDE_PATH_TEMPLATES[ideFormat][category];
	const relPath = template.replaceAll("{{ruleName}}", ruleName);
	return path.resolve(cwd, relPath);
}

/**
 * Transforms the raw content for the given IDE format with appropriate frontmatter.
 */
export function transformContentForIde(
	content: string,
	ruleName: string,
	ideFormat: IdeFormat,
	category: InstructionCategory,
): string {
	const transform = getTransformForIde(ideFormat, category);
	const meta = getInstructionMetadata(category, ruleName);
	if (transform) return transform(content, meta);
	return content;
}

/**
 * Writes the instruction to the appropriate location for the given IDE format.
 */
export async function writeInstructionToFile(
	cwd: string,
	ruleName: string,
	content: string,
	ideFormat: IdeFormat,
	category: InstructionCategory,
): Promise<string> {
	const outputPath = resolveOutputPath(ideFormat, ruleName, cwd, category);
	const transformedContent = transformContentForIde(
		content,
		ruleName,
		ideFormat,
		category,
	);

	await ensureDirAsync(path.dirname(outputPath));
	await writeFileAsync(outputPath, transformedContent);

	return outputPath;
}
