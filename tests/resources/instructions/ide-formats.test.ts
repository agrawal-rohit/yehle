import { describe, expect, it, vi } from "vitest";
import { InstructionCategory } from "../../../src/core/instructions-registry";
import { IdeFormat } from "../../../src/resources/instructions/config";
import {
	resolveOutputPath,
	transformContentForIde,
	writeInstructionToFile,
} from "../../../src/resources/instructions/ide-formats";
import * as fs from "../../../src/core/fs";
import path from "node:path";

vi.mock("../../../src/core/fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return {
		...actual,
		ensureDirAsync: vi.fn(),
		writeFileAsync: vi.fn(),
	};
});

describe("instructions/ide-formats", () => {
	describe("resolveOutputPath", () => {
		it("resolves Cursor path for essential", () => {
			const result = resolveOutputPath(
				IdeFormat.CURSOR,
				"react-vite",
				"/project",
				InstructionCategory.ESSENTIAL,
			);
			expect(result).toBe("/project/.cursor/rules/react-vite.mdc");
		});

		it("resolves Copilot path for language (path-specific)", () => {
			const result = resolveOutputPath(
				IdeFormat.COPILOT,
				"typescript",
				"/project",
				InstructionCategory.LANGUAGE,
			);
			expect(result).toBe(
				"/project/.github/instructions/typescript.instructions.md",
			);
		});

		it("resolves Copilot path for essential (repo-wide)", () => {
			const result = resolveOutputPath(
				IdeFormat.COPILOT,
				"general",
				"/project",
				InstructionCategory.ESSENTIAL,
			);
			expect(result).toBe("/project/.github/copilot-instructions.md");
		});

		it("resolves Windsurf and Claude paths", () => {
			expect(
				resolveOutputPath(
					IdeFormat.WINDSURF,
					"x",
					"/p",
					InstructionCategory.ESSENTIAL,
				),
			).toBe("/p/.windsurf/rules/x.md");
			expect(
				resolveOutputPath(
					IdeFormat.CLAUDE,
					"x",
					"/p",
					InstructionCategory.LANGUAGE,
				),
			).toBe("/p/.claude/rules/x.md");
		});
	});

	const essentialMeta = {
		description: "react vite",
		globs: ["**/*"],
		alwaysApply: true,
	};
	const languageMeta = {
		description: "TypeScript standards",
		globs: ["**/*"],
		alwaysApply: false,
	};

	describe("transformContentForIde", () => {
		it("adds Cursor frontmatter for essential", () => {
			const content = "# Rule\n\nContent.";
			const result = transformContentForIde(
				content,
				IdeFormat.CURSOR,
				InstructionCategory.ESSENTIAL,
				essentialMeta,
			);
			expect(result).toContain("---");
			expect(result).toContain('description: "react vite"');
			expect(result).toContain("alwaysApply: true");
			expect(result).toContain("# Rule");
		});

		it("adds Cline frontmatter", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				IdeFormat.CLINE,
				InstructionCategory.ESSENTIAL,
				{ description: "general", globs: ["**/*"], alwaysApply: true },
			);
			expect(result).toContain('glob: "**/*"');
			expect(result).toContain("# Rule");
		});

		it("adds Claude frontmatter with comma-separated globs for language", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				IdeFormat.CLAUDE,
				InstructionCategory.LANGUAGE,
				languageMeta,
			);
			expect(result).toContain("globs: **/*");
		});

		it("adds Copilot applyTo for language", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				IdeFormat.COPILOT,
				InstructionCategory.LANGUAGE,
				languageMeta,
			);
			expect(result).toContain('applyTo: "**/*"');
		});

		it("passes through for Copilot essential (repo-wide, no frontmatter)", () => {
			const content = "# Repo-wide rules";
			const result = transformContentForIde(
				content,
				IdeFormat.COPILOT,
				InstructionCategory.ESSENTIAL,
				{ description: "general", globs: ["**/*"], alwaysApply: true },
			);
			expect(result).toBe(content);
			expect(result).not.toContain("---");
		});

		it("passes through for Windsurf (no frontmatter)", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				IdeFormat.WINDSURF,
				InstructionCategory.ESSENTIAL,
				{ description: "general", globs: ["**/*"], alwaysApply: true },
			);
			expect(result).toBe(content);
		});
	});

	describe("writeInstructionToFile", () => {
		it("writes file with transformed content and returns path", async () => {
			const cwd = "/project";
			const result = await writeInstructionToFile(
				cwd,
				"react-vite",
				"# Content",
				IdeFormat.CURSOR,
				InstructionCategory.ESSENTIAL,
				essentialMeta,
			);
			expect(result).toBe(
				path.join(cwd, ".cursor", "rules", "react-vite.mdc"),
			);
			expect(vi.mocked(fs.ensureDirAsync)).toHaveBeenCalled();
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				expect.stringContaining("---"),
			);
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				expect.stringContaining("# Content"),
			);
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				expect.stringContaining("instruction registry"),
			);
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				expect.stringContaining("https://github.com/agrawal-rohit/yehle"),
			);
		});
	});
});
