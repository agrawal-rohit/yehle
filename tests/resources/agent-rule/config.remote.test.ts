/**
 * Tests for the remote mode path (IS_LOCAL_MODE=false) in getAgentRuleSelection.
 * Must be in a separate file so we can mock IS_LOCAL_MODE: false.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: false,
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

import { getAgentRuleSelection } from "../../../src/resources/agent-rule/config";
import prompts from "../../../src/cli/prompts";
import {
	listAvailableAgentRules,
} from "../../../src/core/template-registry";
import tasks from "../../../src/cli/tasks";

describe("agent-rule/config (remote mode)", () => {
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

	it("should use runWithTasks when fetching templates in remote mode", async () => {
		const result = await getAgentRuleSelection({ rule: "react-vite" });
		expect(result).toBe("react-vite");
		expect(tasks.runWithTasks).toHaveBeenCalledWith(
			"Checking available agent rule templates",
			expect.any(Function),
		);
		expect(listAvailableAgentRules).toHaveBeenCalled();
		expect(prompts.selectInput).not.toHaveBeenCalled();
	});
});
