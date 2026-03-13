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
	});

	describe("writeAgentRuleToFile", () => {
		it("should write file and return path", async () => {
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
	});
});
