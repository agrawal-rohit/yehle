import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: true,
}));

vi.mock("../../../src/core/instructions-registry", () => ({
	listAvailableInstructions: vi.fn(),
	getInstructionContent: vi.fn(),
	getInstructionWithFrontmatter: vi.fn(),
}));

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
	fetchInstructionContent,
	getGenerateInstructionsConfiguration,
	getIdeFormatSelection,
	getLanguageInstructionForPackageLang,
	getPackageInstructionsConfiguration,
	IdeFormat,
} from "../../../src/resources/instructions/config";
import prompts from "../../../src/cli/prompts";
import {
	getInstructionContent,
	getInstructionWithFrontmatter,
	listAvailableInstructions,
} from "../../../src/core/instructions-registry";

describe("instructions/config", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listAvailableInstructions).mockImplementation(
			async (cat: string) => {
				if (cat === "global-preferences") return ["react-vite", "general"];
				if (cat === "language") return ["typescript"];
				return [];
			},
		);
		vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
			content: "# Rule",
			frontmatter: { globs: ["**/*"], alwaysApply: true },
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
		it("should return single selection when instruction (and optional category) provided", async () => {
			const metadata = {
				description: "react vite",
				globs: ["**/*"],
				alwaysApply: true,
			};
			const result = await getGenerateInstructionsConfiguration({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
				metadata,
			});
			expect(result.selections).toHaveLength(1);
			expect(result.selections[0].category).toBe("global-preferences");
			expect(result.selections[0].instruction).toBe("react-vite");
			expect(result.selections[0].metadata).toEqual(metadata);
			expect(result.ideFormat).toBe(IdeFormat.CURSOR);
		});

		it("should default category to global-preferences when only instruction provided", async () => {
			const result = await getGenerateInstructionsConfiguration({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
			expect(result.selections[0].category).toBe("global-preferences");
		});

		it("should throw when instruction is not in available list for category", async () => {
			await expect(
				getGenerateInstructionsConfiguration({
					instruction: "invalid",
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

	describe("getLanguageInstructionForPackageLang", () => {
		it("should return typescript when lang is typescript", async () => {
			const result = await getLanguageInstructionForPackageLang("typescript");
			expect(result).toBe("typescript");
		});

		it("should return null when lang has no instruction", async () => {
			const result = await getLanguageInstructionForPackageLang("python");
			expect(result).toBeNull();
		});
	});

	describe("fetchInstructionContent", () => {
		it("should delegate to getInstructionContent", async () => {
			vi.mocked(getInstructionContent).mockResolvedValue("# Content");
			const result = await fetchInstructionContent(
				"global-preferences",
				"react-vite",
			);
			expect(result).toBe("# Content");
			expect(getInstructionContent).toHaveBeenCalledWith(
				"global-preferences",
				"react-vite",
			);
		});
	});
});
