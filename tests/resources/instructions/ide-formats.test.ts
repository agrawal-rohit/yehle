import { describe, expect, it, vi } from "vitest";
import { IdeFormat } from "../../../src/resources/instructions/config";
import {
	getInstructionMetadata,
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
	describe("getInstructionMetadata", () => {
		it("returns global-preferences metadata with alwaysApply true", () => {
			const meta = getInstructionMetadata("global-preferences", "react-vite");
			expect(meta).toEqual({
				description: "react vite",
				globs: ["**/*"],
				alwaysApply: true,
			});
		});

		it("returns typescript language metadata with file globs", () => {
			const meta = getInstructionMetadata("language", "typescript");
			expect(meta).toEqual({
				description: "TypeScript-specific coding standards",
				globs: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
				alwaysApply: false,
			});
		});

		it("returns fallback for unknown language", () => {
			const meta = getInstructionMetadata("language", "python");
			expect(meta).toEqual({
				description: "python",
				globs: ["**/*"],
				alwaysApply: false,
			});
		});
	});

	describe("resolveOutputPath", () => {
		it("resolves Cursor path for global-preferences", () => {
			const result = resolveOutputPath(
				IdeFormat.CURSOR,
				"react-vite",
				"/project",
				"global-preferences",
			);
			expect(result).toBe("/project/.cursor/rules/react-vite.mdc");
		});

		it("resolves Copilot path for language (path-specific)", () => {
			const result = resolveOutputPath(
				IdeFormat.COPILOT,
				"typescript",
				"/project",
				"language",
			);
			expect(result).toBe(
				"/project/.github/instructions/typescript.instructions.md",
			);
		});

		it("resolves Copilot path for global-preferences (repo-wide)", () => {
			const result = resolveOutputPath(
				IdeFormat.COPILOT,
				"general",
				"/project",
				"global-preferences",
			);
			expect(result).toBe("/project/.github/copilot-instructions.md");
		});

		it("resolves Windsurf and Claude paths", () => {
			expect(
				resolveOutputPath(IdeFormat.WINDSURF, "x", "/p", "global-preferences"),
			).toBe("/p/.windsurf/rules/x.md");
			expect(
				resolveOutputPath(IdeFormat.CLAUDE, "x", "/p", "language"),
			).toBe("/p/.claude/rules/x.md");
		});
	});

	describe("transformContentForIde", () => {
		it("adds Cursor frontmatter for global-preferences", () => {
			const content = "# Rule\n\nContent.";
			const result = transformContentForIde(
				content,
				"react-vite",
				IdeFormat.CURSOR,
				"global-preferences",
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
				"general",
				IdeFormat.CLINE,
				"global-preferences",
			);
			expect(result).toContain('glob: "**/*"');
			expect(result).toContain("# Rule");
		});

		it("adds Claude frontmatter with comma-separated globs for language", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				"typescript",
				IdeFormat.CLAUDE,
				"language",
			);
			expect(result).toContain(
				"globs: **/*.ts, **/*.tsx, **/*.mts, **/*.cts",
			);
		});

		it("adds Copilot applyTo for language", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				"typescript",
				IdeFormat.COPILOT,
				"language",
			);
			expect(result).toContain('applyTo: "**/*.ts"');
		});

		it("passes through for Copilot global-preferences (repo-wide, no frontmatter)", () => {
			const content = "# Repo-wide rules";
			const result = transformContentForIde(
				content,
				"general",
				IdeFormat.COPILOT,
				"global-preferences",
			);
			expect(result).toBe(content);
			expect(result).not.toContain("---");
		});

		it("passes through for Windsurf (no frontmatter)", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				"general",
				IdeFormat.WINDSURF,
				"global-preferences",
			);
			expect(result).toBe(content);
		});

		it("passes through for Gemini (no frontmatter)", () => {
			const content = "# Rule";
			const result = transformContentForIde(
				content,
				"general",
				IdeFormat.GEMINI,
				"global-preferences",
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
				"global-preferences",
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
		});
	});
});
