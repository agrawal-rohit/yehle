import path from "node:path";
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import type { InstructionCategory } from "../../core/instructions-registry";
import { IdeFormat } from "./config";

/** Marketing comment prepended to written instructions (yehle registry). */
const YEHLE_REGISTRY_URL =
	"https://github.com/agrawal-rohit/yehle/blob/main/templates/instructions/";
const YEHLE_REGISTRY_COMMENT = `<!-- This instruction is part of the "yehle" instruction registry: ${YEHLE_REGISTRY_URL} -->\n\n`;

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
 * Build default metadata for an instruction based on category and name.
 * Used when metadata is not provided by the caller.
 */
export function getInstructionMetadata(
	category: InstructionCategory,
	name: string,
): InstructionMetadata {
	const humanName = name.replaceAll("-", " ");
	if (category === "global-preferences") {
		return {
			description: humanName,
			globs: ["**/*"],
			alwaysApply: true,
		};
	}
	if (category === "language" && name === "typescript") {
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
		"global-preferences": ".cursor/rules/{{ruleName}}.mdc",
		language: ".cursor/rules/{{ruleName}}.mdc",
		"use-case": ".cursor/rules/{{ruleName}}.mdc",
		template: ".cursor/rules/{{ruleName}}.mdc",
	},
	[IdeFormat.WINDSURF]: {
		"global-preferences": ".windsurf/rules/{{ruleName}}.md",
		language: ".windsurf/rules/{{ruleName}}.md",
		"use-case": ".windsurf/rules/{{ruleName}}.md",
		template: ".windsurf/rules/{{ruleName}}.md",
	},
	[IdeFormat.CLINE]: {
		"global-preferences": ".clinerules/{{ruleName}}.mdc",
		language: ".clinerules/{{ruleName}}.mdc",
		"use-case": ".clinerules/{{ruleName}}.mdc",
		template: ".clinerules/{{ruleName}}.mdc",
	},
	[IdeFormat.CLAUDE]: {
		"global-preferences": ".claude/rules/{{ruleName}}.md",
		language: ".claude/rules/{{ruleName}}.md",
		"use-case": ".claude/rules/{{ruleName}}.md",
		template: ".claude/rules/{{ruleName}}.md",
	},
	[IdeFormat.COPILOT]: {
		"global-preferences": ".github/copilot-instructions.md",
		language: ".github/instructions/{{ruleName}}.instructions.md",
		"use-case": ".github/instructions/{{ruleName}}.instructions.md",
		template: ".github/instructions/{{ruleName}}.instructions.md",
	},
	[IdeFormat.GEMINI]: {
		"global-preferences": "GEMINI.md",
		language: "GEMINI.md",
		"use-case": "GEMINI.md",
		template: "GEMINI.md",
	},
};

/** Transform behavior per IDE. Copilot repo-wide for global-preferences; path-specific otherwise. */
function getTransformForIde(
	ideFormat: IdeFormat,
	category: InstructionCategory,
): ((content: string, meta: InstructionMetadata) => string) | undefined {
	if (ideFormat === IdeFormat.COPILOT && category === "global-preferences")
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
 * Uses provided metadata when given; otherwise derives from category and name.
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
 * Writes the instruction to the appropriate location for the given IDE format.
 * @param metadata - Optional; when provided (e.g. from user prompts), used for frontmatter.
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
