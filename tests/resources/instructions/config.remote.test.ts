/**
 * Tests for remote mode path (IS_LOCAL_MODE=false) in getPreferenceInstructionSelection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: false,
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
		confirmInput: vi.fn(),
	},
}));

import { getGlobalPreferenceInstructionSelection } from "../../../src/resources/instructions/config";
import { listAvailableInstructions } from "../../../src/core/instructions-registry";
import tasks from "../../../src/cli/tasks";

describe("instructions/config (remote mode)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listAvailableInstructions).mockResolvedValue([
			"react-vite",
			"general",
		]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should use runWithTasks when fetching templates in remote mode", async () => {
		const result = await getGlobalPreferenceInstructionSelection({
			instruction: "react-vite",
		});
		expect(result).toBe("react-vite");
		expect(tasks.runWithTasks).toHaveBeenCalledWith(
			"Checking available instruction templates",
			expect.any(Function),
		);
	});
});
