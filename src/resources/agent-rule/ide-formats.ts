import path from "node:path";
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import { IdeFormat } from "./config";

/** Output path and optional content transformation per IDE format. */
export type IdeFormatOutput = {
	/** Relative path from cwd where the rule should be written. */
	outputPath: string;
	/** Optional transformation to apply to the raw rule content before writing. */
	transformContent?: (content: string, ruleName: string) => string;
};

/** Maps each IDE format to its output path and optional content transformation. */
export const IDE_FORMAT_OUTPUT: Record<IdeFormat, IdeFormatOutput> = {
	[IdeFormat.CURSOR]: {
		outputPath: ".cursor/rules/{{ruleName}}.mdc",
		transformContent: (content, ruleName) =>
			`---
description: "${ruleName.replaceAll("-", " ")}"
globs: ["**/*"]
alwaysApply: true
---

${content}`,
	},
	[IdeFormat.WINDSURF]: {
		outputPath: ".windsurf/rules/{{ruleName}}.md",
	},
	[IdeFormat.CLINE]: {
		outputPath: ".clinerules/{{ruleName}}.md",
	},
	[IdeFormat.CLAUDE]: {
		outputPath: ".claude/rules/{{ruleName}}.md",
	},
	[IdeFormat.COPILOT]: {
		outputPath: ".github/copilot-instructions.md",
	},
	[IdeFormat.GEMINI]: {
		outputPath: "GEMINI.md",
	},
};

/**
 * Resolves the output path for a rule given the IDE format and rule name.
 */
export function resolveOutputPath(
	ideFormat: IdeFormat,
	ruleName: string,
	cwd: string,
): string {
	const spec = IDE_FORMAT_OUTPUT[ideFormat];
	const relPath = spec.outputPath.replaceAll("{{ruleName}}", ruleName);
	return path.resolve(cwd, relPath);
}

/**
 * Transforms the raw rule content for the given IDE format.
 */
export function transformContentForIde(
	content: string,
	ruleName: string,
	ideFormat: IdeFormat,
): string {
	const spec = IDE_FORMAT_OUTPUT[ideFormat];
	if (spec.transformContent) return spec.transformContent(content, ruleName);
	return content;
}

/**
 * Writes the agent rule to the appropriate location for the given IDE format.
 */
export async function writeAgentRuleToFile(
	cwd: string,
	ruleName: string,
	content: string,
	ideFormat: IdeFormat,
): Promise<string> {
	const outputPath = resolveOutputPath(ideFormat, ruleName, cwd);
	const transformedContent = transformContentForIde(
		content,
		ruleName,
		ideFormat,
	);

	await ensureDirAsync(path.dirname(outputPath));
	await writeFileAsync(outputPath, transformedContent);

	return outputPath;
}
