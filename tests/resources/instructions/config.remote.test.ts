/**
 * Tests for remote mode path (IS_LOCAL_MODE=false) when resolving instruction selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: false,
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

import prompts from "../../../src/cli/prompts";
import { getGenerateInstructionsConfiguration, IdeFormat } from "../../../src/resources/instructions/config";
import {
	getInstructionWithFrontmatter,
	listAvailableInstructions,
} from "../../../src/core/instructions-registry";
import tasks from "../../../src/cli/tasks";

describe("instructions/config (remote mode)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listAvailableInstructions).mockResolvedValue([
			"react-vite",
			"general",
		]);
		vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
			content: "# Rule",
			frontmatter: {
				description: "react vite",
				paths: ["**/*"],
				alwaysApply: true,
			},
		});
		vi.mocked(prompts.textInput).mockResolvedValue("**/*");
		vi.mocked(prompts.confirmInput).mockResolvedValue(true);
		vi.mocked(tasks.runWithTasks).mockImplementation(async (_goal, task) => {
			if (task) await task();
		});
	});

	afterEach(() => {
		vi.restoreAllMocks(); 
	});

	it("should use runWithTasks when resolving instruction in remote mode", async () => {
		const result = await getGenerateInstructionsConfiguration({
			instruction: "react-vite",
			ideFormat: IdeFormat.CURSOR,
		});
		expect(result.selections).toHaveLength(1);
		expect(result.selections[0].instruction).toBe("react-vite");
		expect(tasks.runWithTasks).toHaveBeenCalledWith(
			"Checking available instructions",
			expect.any(Function),
		);
	});
});
