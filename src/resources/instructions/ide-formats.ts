import path from "node:path";
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import type { InstructionCategory } from "../../core/instructions-registry";
import { getDefaultGlobsForLanguage, IdeFormat } from "./config";

/** Marketing comment prepended to written instructions (yehle registry). */
const YEHLE_REGISTRY_URL =
	"https://github.com/agrawal-rohit/yehle/blob/main/instructions/";
const YEHLE_REGISTRY_COMMENT = `<!-- This instruction is part of the "yehle" instruction registry: ${YEHLE_REGISTRY_URL} -->\n\n`;

/** Globs and metadata per instruction type for IDE frontmatter. */
export type InstructionMetadata = {
	description: string;
	globs: string[];
	alwaysApply: boolean;
};

/**
 * Build Cursor .mdc frontmatter: description, globs (YAML array), alwaysApply.
 * @param meta - Instruction metadata.
 * @returns YAML frontmatter string (including closing ---).
 */
function cursorFrontmatter(meta: InstructionMetadata): string {
	return `---
description: "${meta.description}"
globs:
${meta.globs.map((g) => `  - "${g}"`).join("\n")}
alwaysApply: ${meta.alwaysApply}
---

`;
}

/**
 * Build Cline .mdc frontmatter: title, description, glob (single pattern).
 * @param meta - Instruction metadata.
 * @returns YAML frontmatter string (including closing ---).
 */
function clineFrontmatter(meta: InstructionMetadata): string {
	const glob = meta.globs[0] ?? "**/*";
	return `---
title: "${meta.description}"
description: "${meta.description}"
glob: "${glob}"
---

`;
}

/**
 * Build Claude .claude/rules frontmatter: globs as comma-separated (per docs).
 * @param meta - Instruction metadata.
 * @returns YAML frontmatter string (including closing ---).
 */
function claudeFrontmatter(meta: InstructionMetadata): string {
	const globsStr = meta.globs.join(", ");
	return `---
globs: ${globsStr}
---

`;
}

/**
 * Build Copilot path-specific .instructions.md frontmatter: applyTo (single glob).
 * @param meta - Instruction metadata.
 * @returns YAML frontmatter string (including closing ---).
 */
function copilotFrontmatter(meta: InstructionMetadata): string {
	const applyTo = meta.globs[0] ?? "**/*";
	return `---
applyTo: "${applyTo}"
---

`;
}

/**
 * Copilot repo-wide (e.g. preferences): no frontmatter, content only.
 * @param _meta - Unused; kept for signature consistency.
 * @returns Empty string.
 */
function copilotRepoWide(_meta: InstructionMetadata): string {
	return "";
}

/**
 * Build default metadata for an instruction based on category and name.
 * Used when metadata is not provided by the caller (e.g. in transformContentForIde).
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @returns Default metadata (description, globs, alwaysApply).
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
	if (category === "language") {
		return {
			description:
				name === "typescript"
					? "TypeScript-specific coding standards"
					: humanName,
			globs: getDefaultGlobsForLanguage(name),
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
		language: ".cursor/rules/{{ruleName}}.mdc",
		"use-case": ".cursor/rules/{{ruleName}}.mdc",
		template: ".cursor/rules/{{ruleName}}.mdc",
	},
	[IdeFormat.WINDSURF]: {
		preferences: ".windsurf/rules/{{ruleName}}.md",
		language: ".windsurf/rules/{{ruleName}}.md",
		"use-case": ".windsurf/rules/{{ruleName}}.md",
		template: ".windsurf/rules/{{ruleName}}.md",
	},
	[IdeFormat.CLINE]: {
		preferences: ".clinerules/{{ruleName}}.mdc",
		language: ".clinerules/{{ruleName}}.mdc",
		"use-case": ".clinerules/{{ruleName}}.mdc",
		template: ".clinerules/{{ruleName}}.mdc",
	},
	[IdeFormat.CLAUDE]: {
		preferences: ".claude/rules/{{ruleName}}.md",
		language: ".claude/rules/{{ruleName}}.md",
		"use-case": ".claude/rules/{{ruleName}}.md",
		template: ".claude/rules/{{ruleName}}.md",
	},
	[IdeFormat.COPILOT]: {
		preferences: ".github/copilot-instructions.md",
		language: ".github/instructions/{{ruleName}}.instructions.md",
		"use-case": ".github/instructions/{{ruleName}}.instructions.md",
		template: ".github/instructions/{{ruleName}}.instructions.md",
	},
};

/**
 * Get the transform function for the given IDE and category (adds frontmatter or passes through).
 * Copilot: repo-wide (no frontmatter) for preferences; path-specific frontmatter otherwise.
 * @param ideFormat - Target IDE format.
 * @param category - Instruction category.
 * @returns A function (content, meta) => transformed string, or undefined when no transform (e.g. Windsurf).
 */
function getTransformForIde(
	ideFormat: IdeFormat,
	category: InstructionCategory,
): ((content: string, meta: InstructionMetadata) => string) | undefined {
	if (ideFormat === IdeFormat.COPILOT && category === "preferences")
		return (content, _meta) => copilotRepoWide(_meta) + content;
	if (
		ideFormat === IdeFormat.COPILOT &&
		(category === "language" ||
			category === "use-case" ||
			category === "template")
	)
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
 * Resolve the output path for an instruction given the IDE format, name, and category.
 * @param ideFormat - Target IDE format (determines path template).
 * @param ruleName - Instruction name (replaces {{ruleName}} in template).
 * @param cwd - Current working directory (project root).
 * @param category - Instruction category (some IDEs use different paths per category).
 * @returns Absolute path where the instruction file should be written.
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
 * Transform raw instruction content for the given IDE format (add frontmatter when applicable).
 * Uses provided metadata when given; otherwise derives from category and name via getInstructionMetadata.
 * @param content - Raw markdown body (may already include registry comment).
 * @param ruleName - Instruction name (used when metadata is not provided).
 * @param ideFormat - Target IDE format.
 * @param category - Instruction category.
 * @param metadata - Optional metadata; when omitted, defaults are derived from category and ruleName.
 * @returns Transformed string (content with optional frontmatter prepended).
 */
export function transformContentForIde(
	content: string,
	ruleName: string,
	ideFormat: IdeFormat,
	category: InstructionCategory,
	metadata?: InstructionMetadata,
): string {
	const transform = getTransformForIde(ideFormat, category);
	const meta = metadata ?? getInstructionMetadata(category, ruleName);
	if (transform) return transform(content, meta);
	return content;
}

/**
 * Write the instruction to the appropriate location for the given IDE format.
 * Prepends the yehle registry comment, then IDE-specific frontmatter (when applicable), then content.
 * @param cwd - Current working directory (project root).
 * @param ruleName - Instruction name (used for path and default metadata if metadata omitted).
 * @param content - Raw instruction body (markdown).
 * @param ideFormat - Target IDE format.
 * @param category - Instruction category.
 * @param metadata - Optional metadata for frontmatter; when omitted, derived from category and ruleName.
 * @returns Promise resolving to the absolute path of the written file.
 */
export async function writeInstructionToFile(
	cwd: string,
	ruleName: string,
	content: string,
	ideFormat: IdeFormat,
	category: InstructionCategory,
	metadata?: InstructionMetadata,
): Promise<string> {
	const outputPath = resolveOutputPath(ideFormat, ruleName, cwd, category);
	const contentWithRegistryComment = YEHLE_REGISTRY_COMMENT + content;
	const transformedContent = transformContentForIde(
		contentWithRegistryComment,
		ruleName,
		ideFormat,
		category,
		metadata,
	);

	await ensureDirAsync(path.dirname(outputPath));
	await writeFileAsync(outputPath, transformedContent);

	return outputPath;
}
