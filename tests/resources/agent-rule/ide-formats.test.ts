import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { IdeFormat } from "../../../src/resources/agent-rule/config";
import {
	resolveOutputPath,
	transformContentForIde,
	writeAgentRuleToFile,
} from "../../../src/resources/agent-rule/ide-formats";
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

describe("agent-rule/ide-formats", () => {
	describe("resolveOutputPath", () => {
		it("should resolve Cursor path with rule name", () => {
			const result = resolveOutputPath(
				IdeFormat.CURSOR,
				"react-vite",
				"/project",
			);
			expect(result).toBe("/project/.cursor/rules/react-vite.mdc");
		});

		it("should resolve Copilot path (same for all rules)", () => {
			const result = resolveOutputPath(
				IdeFormat.COPILOT,
				"any-rule",
				"/project",
			);
			expect(result).toBe("/project/.github/copilot-instructions.md");
		});

		it("should resolve Gemini path", () => {
			const result = resolveOutputPath(
				IdeFormat.GEMINI,
				"react-vite",
				"/project",
			);
			expect(result).toBe("/project/GEMINI.md");
		});

		it("should resolve Windsurf path", () => {
			const result = resolveOutputPath(
				IdeFormat.WINDSURF,
				"react-vite",
				"/project",
			);
			expect(result).toBe("/project/.windsurf/rules/react-vite.md");
		});

		it("should resolve Claude path", () => {
			const result = resolveOutputPath(
				IdeFormat.CLAUDE,
				"codebase-management",
				"/project",
			);
			expect(result).toBe(
				"/project/.claude/rules/codebase-management.md",
			);
		});
	});

	describe("transformContentForIde", () => {
		it("should add frontmatter for Cursor format", () => {
			const content = "# My Rule\n\nContent here.";
			const result = transformContentForIde(
				content,
				"react-vite",
				IdeFormat.CURSOR,
			);
			expect(result).toContain("---");
			expect(result).toContain('description: "react vite"');
			expect(result).toContain("alwaysApply: true");
			expect(result).toContain("# My Rule");
		});

		it("should pass through content for Windsurf (no transform)", () => {
			const content = "# My Rule\n\nContent here.";
			const result = transformContentForIde(
				content,
				"react-vite",
				IdeFormat.WINDSURF,
			);
			expect(result).toBe(content);
		});

		it("should pass through content for Cline (no transform)", () => {
			const content = "# My Rule";
			const result = transformContentForIde(
				content,
				"general",
				IdeFormat.CLINE,
			);
			expect(result).toBe(content);
		});

		it("should pass through content for Copilot (no transform)", () => {
			const content = "# Copilot instructions";
			const result = transformContentForIde(
				content,
				"any-rule",
				IdeFormat.COPILOT,
			);
			expect(result).toBe(content);
		});
	});

	describe("writeAgentRuleToFile", () => {
		it("should write file and return path for Cline", async () => {
			const cwd = "/project";
			const result = await writeAgentRuleToFile(
				cwd,
				"react-vite",
				"# Rule content",
				IdeFormat.CLINE,
			);
			expect(result).toBe(
				path.join(cwd, ".clinerules", "react-vite.md"),
			);
			expect(vi.mocked(fs.ensureDirAsync)).toHaveBeenCalled();
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				"# Rule content",
			);
		});

		it("should transform and write for Cursor format", async () => {
			const cwd = "/project";
			const content = "# Rule content";
			const result = await writeAgentRuleToFile(
				cwd,
				"react-vite",
				content,
				IdeFormat.CURSOR,
			);
			expect(result).toBe(
				path.join(cwd, ".cursor", "rules", "react-vite.mdc"),
			);
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				expect.stringContaining("---"),
			);
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				expect.stringContaining('description: "react vite"'),
			);
			expect(vi.mocked(fs.writeFileAsync)).toHaveBeenCalledWith(
				result,
				expect.stringContaining("# Rule content"),
			);
		});
	});
});
