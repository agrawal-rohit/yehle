import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: true,
}));

vi.mock("../../../src/core/template-registry", () => ({
	listAvailableAgentRules: vi.fn(),
	getAgentRuleContent: vi.fn(),
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
	},
}));

import {
	fetchAgentRuleContent,
	getGenerateAgentRuleConfiguration,
	getAgentRuleSelection,
	getIdeFormatSelection,
} from "../../../src/resources/agent-rule/config";
import { IdeFormat } from "../../../src/resources/agent-rule/config";
import prompts from "../../../src/cli/prompts";
import {
	getAgentRuleContent,
	listAvailableAgentRules,
} from "../../../src/core/template-registry";

describe("agent-rule/config", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listAvailableAgentRules).mockResolvedValue([
			"react-vite",
			"typescript-library",
		]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getAgentRuleSelection", () => {
		it("should return rule from CLI flags when provided", async () => {
			const result = await getAgentRuleSelection({ rule: "react-vite" });
			expect(result).toBe("react-vite");
			expect(listAvailableAgentRules).toHaveBeenCalled();
		});

		it("should throw when rule is not in available list", async () => {
			await expect(
				getAgentRuleSelection({ rule: "invalid-rule" }),
			).rejects.toThrow("Unsupported rule");
		});

		it("should throw when no templates found", async () => {
			vi.mocked(listAvailableAgentRules).mockResolvedValue([]);
			await expect(getAgentRuleSelection({})).rejects.toThrow(
				"No agent rule templates found",
			);
		});

		it("should auto-select when only one template is available", async () => {
			vi.mocked(listAvailableAgentRules).mockResolvedValue([
				"react-vite",
			]);
			const result = await getAgentRuleSelection({});
			expect(result).toBe("react-vite");
			expect(prompts.selectInput).not.toHaveBeenCalled();
		});

		it("should prompt when no rule in flags and multiple templates", async () => {
			vi.mocked(prompts.selectInput).mockResolvedValue("typescript-library");
			const result = await getAgentRuleSelection({});
			expect(result).toBe("typescript-library");
			expect(prompts.selectInput).toHaveBeenCalledWith(
				"Which agent rule would you like to use?",
				{ options: expect.any(Array) },
				"react-vite",
			);
		});

	});

	describe("fetchAgentRuleContent", () => {
		it("should delegate to getAgentRuleContent", async () => {
			vi.mocked(getAgentRuleContent).mockResolvedValue("# Rule markdown");
			const result = await fetchAgentRuleContent("react-vite");
			expect(result).toBe("# Rule markdown");
			expect(getAgentRuleContent).toHaveBeenCalledWith("react-vite");
		});
	});

	describe("getIdeFormatSelection", () => {
		it("should return ideFormat from CLI flags when provided", async () => {
			const result = await getIdeFormatSelection({
				ideFormat: IdeFormat.CURSOR,
			});
			expect(result).toBe(IdeFormat.CURSOR);
		});

		it("should throw when ideFormat is invalid", async () => {
			await expect(
				getIdeFormatSelection({
					ideFormat: "invalid" as IdeFormat,
				}),
			).rejects.toThrow("Unsupported IDE format");
		});

		it("should prompt when no ideFormat in flags", async () => {
			vi.mocked(prompts.selectInput).mockResolvedValue(IdeFormat.WINDSURF);
			const result = await getIdeFormatSelection({});
			expect(result).toBe(IdeFormat.WINDSURF);
			expect(prompts.selectInput).toHaveBeenCalledWith(
				"Which IDE format should the rule be formatted for?",
				{ options: expect.any(Array) },
				IdeFormat.CURSOR,
			);
		});
	});

	describe("getGenerateAgentRuleConfiguration", () => {
		it("should return full config when all flags provided", async () => {
			const result = await getGenerateAgentRuleConfiguration({
				rule: "react-vite",
				ideFormat: IdeFormat.WINDSURF,
			});
			expect(result).toEqual({
				rule: "react-vite",
				ideFormat: IdeFormat.WINDSURF,
			});
		});
	});
});
