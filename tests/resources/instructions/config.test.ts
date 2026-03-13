import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: true,
}));

vi.mock("../../../src/core/template-registry", () => ({
	listAvailablePreferenceInstructions: vi.fn(),
	listAvailableLanguageInstructions: vi.fn(),
	getInstructionContent: vi.fn(),
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
		confirmInput: vi.fn(),
	},
}));

import {
	fetchInstructionContent,
	getGenerateInstructionsConfiguration,
	getIdeFormatSelection,
	getLanguageInstructionForPackageLang,
	getPackageInstructionsConfiguration,
	getPreferenceInstructionSelection,
} from "../../../src/resources/instructions/config";
import { IdeFormat } from "../../../src/resources/instructions/config";
import prompts from "../../../src/cli/prompts";
import {
	getInstructionContent,
	listAvailablePreferenceInstructions,
	listAvailableLanguageInstructions,
} from "../../../src/core/template-registry";

describe("instructions/config", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listAvailablePreferenceInstructions).mockResolvedValue([
			"react-vite",
			"general",
		]);
		vi.mocked(listAvailableLanguageInstructions).mockResolvedValue([
			"typescript",
		]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getPreferenceInstructionSelection", () => {
		it("should return instruction from CLI flags when provided", async () => {
			const result = await getPreferenceInstructionSelection({
				instruction: "react-vite",
			});
			expect(result).toBe("react-vite");
		});

		it("should throw when instruction is not in available list", async () => {
			await expect(
				getPreferenceInstructionSelection({ instruction: "invalid" }),
			).rejects.toThrow("Unsupported instruction");
		});

		it("should throw when no templates found", async () => {
			vi.mocked(listAvailablePreferenceInstructions).mockResolvedValue([]);
			await expect(getPreferenceInstructionSelection({})).rejects.toThrow(
				"No preference instruction templates found",
			);
		});

		it("should prompt when no instruction in flags", async () => {
			vi.mocked(prompts.selectInput).mockResolvedValue("general");
			const result = await getPreferenceInstructionSelection({});
			expect(result).toBe("general");
			expect(prompts.selectInput).toHaveBeenCalledWith(
				"Which coding standards would you like to add?",
				{ options: expect.any(Array) },
				"react-vite",
			);
		});
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
		it("should return full config with preferences category", async () => {
			const result = await getGenerateInstructionsConfiguration({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
			expect(result).toEqual({
				category: "preferences",
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
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
				"preferences",
				"react-vite",
			);
			expect(result).toBe("# Content");
			expect(getInstructionContent).toHaveBeenCalledWith(
				"preferences",
				"react-vite",
			);
		});
	});
});
