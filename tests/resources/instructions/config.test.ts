import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: true,
}));

vi.mock("../../../src/core/instructions-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/core/instructions-registry")>();
	return {
		...actual,
		listAvailableInstructions: vi.fn(),
		getInstructionWithFrontmatter: vi.fn(),
	}; 
});

vi.mock("../../../src/cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(async (_goal, task) => {
			if (task) await task();
		}),
	},
}));

vi.mock("../../../src/cli/prompts", () => ({
	default: {
		selectInput: vi.fn(),
		textInput: vi.fn(),
		confirmInput: vi.fn(),
		multiselectInput: vi.fn(),
	},
}));

import {
	getGenerateInstructionsConfiguration,
	getIdeFormatSelection,
	getPackageInstructionsConfiguration,
	IdeFormat,
} from "../../../src/resources/instructions/config";
import prompts from "../../../src/cli/prompts";
import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	listAvailableInstructions,
} from "../../../src/core/instructions-registry";

describe("instructions/config", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listAvailableInstructions).mockImplementation(
			async (cat: string) => {
				if (cat === "essential") return ["react-vite", "general"];
				if (cat === "language") return ["typescript"];
				return [];
			},
		);
		vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
			content: "# Rule",
			frontmatter: {
				description: "react vite",
				globs: ["**/*"],
				alwaysApply: true,
			},
		});
		vi.mocked(prompts.textInput).mockResolvedValue("**/*");
		vi.mocked(prompts.confirmInput).mockResolvedValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getIdeFormatSelection", () => {
		it("should return ideFormat from CLI flags when provided", async () => {
			const result = await getIdeFormatSelection({
				ideFormat: IdeFormat.CURSOR,
			});
			expect(result).toBe(IdeFormat.CURSOR);
		});

		it("should prompt when no ideFormat in flags", async () => {
			vi.mocked(prompts.selectInput).mockResolvedValue(IdeFormat.WINDSURF);
			const result = await getIdeFormatSelection({});
			expect(result).toBe(IdeFormat.WINDSURF);
		});

		it("should throw when ideFormat from flags is invalid", async () => {
			await expect(
				getIdeFormatSelection({ ideFormat: "invalid" as IdeFormat }),
			).rejects.toThrow("Unsupported IDE format");
		});
	});

	describe("getGenerateInstructionsConfiguration", () => {
		it("should return single selection with metadata from frontmatter when instruction provided", async () => {
			const result = await getGenerateInstructionsConfiguration({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
			expect(result.selections).toHaveLength(1);
			expect(result.selections[0].category).toBe("essential");
			expect(result.selections[0].instruction).toBe("react-vite");
			expect(result.selections[0].frontmatter).toEqual({
				description: "react vite",
				globs: ["**/*"],
				alwaysApply: true,
			});
			expect(result.ideFormat).toBe(IdeFormat.CURSOR);
		});

		it("should resolve instruction in any category when only --instruction provided", async () => {
			const result = await getGenerateInstructionsConfiguration({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
			expect(result.selections[0].category).toBe("essential");
		});

		it("should use given category when both --instruction and --category provided", async () => {
			const result = await getGenerateInstructionsConfiguration({
				instruction: "typescript",
				category: InstructionCategory.LANGUAGE,
				ideFormat: IdeFormat.CURSOR,
			});
			expect(result.selections[0].category).toBe("language");
			expect(result.selections[0].instruction).toBe("typescript");
		});

		it("should throw when instruction not found in any category", async () => {
			await expect(
				getGenerateInstructionsConfiguration({
					instruction: "invalid",
					ideFormat: IdeFormat.CURSOR,
				}),
			).rejects.toThrow("Instruction \"invalid\" not found in any category");
		});

		it("should throw when instruction is not in given category", async () => {
			await expect(
				getGenerateInstructionsConfiguration({
					instruction: "invalid",
					category: InstructionCategory.ESSENTIAL,
					ideFormat: IdeFormat.CURSOR,
				}),
			).rejects.toThrow("Unsupported instruction");
		});
	});

	describe("getPackageInstructionsConfiguration", () => {
		it("should return includeInstructions false when user declines", async () => {
			vi.mocked(prompts.confirmInput).mockResolvedValue(false);
			const result = await getPackageInstructionsConfiguration({});
			expect(result).toEqual({ includeInstructions: false });
		});

		it("should prompt for IDE when user accepts instructions", async () => {
			vi.mocked(prompts.confirmInput).mockResolvedValue(true);
			vi.mocked(prompts.selectInput).mockResolvedValue(IdeFormat.CURSOR);
			const result = await getPackageInstructionsConfiguration({});
			expect(result).toEqual({
				includeInstructions: true,
				ideFormat: IdeFormat.CURSOR,
			});
		});
	});

});
