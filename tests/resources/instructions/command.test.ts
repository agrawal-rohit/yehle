import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/cli/logger", () => ({
	default: {
		intro: vi.fn(),
	},
	primaryText: vi.fn((text: string) => text),
}));

vi.mock("../../../src/cli/tasks", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../src/cli/tasks")>();
	return {
		...actual,
		default: {
			runWithTasks: vi.fn(async (_goal, _task, subtasks) => {
				if (subtasks?.length) {
					for (const sub of subtasks) {
						if (sub.task) await sub.task();
					}
				}
			}),
		},
	};
});

vi.mock("../../../src/core/instructions-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/core/instructions-registry")>();
	return {
		...actual,
		getInstructionWithFrontmatter: vi.fn(),
	};
});

vi.mock("../../../src/resources/instructions/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../src/resources/instructions/config")>();
	return {
		...actual,
		getGenerateInstructionsConfiguration: vi.fn(),
	};
});

vi.mock("../../../src/resources/instructions/ide-formats", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/resources/instructions/ide-formats")>();
	return {
		...actual,
		writeInstructionToFile: vi.fn(),
	};
});

import logger from "../../../src/cli/logger";
import { getInstructionWithFrontmatter } from "../../../src/core/instructions-registry";
import { generateInstructions } from "../../../src/resources/instructions/command";
import {
	getGenerateInstructionsConfiguration,
	IdeFormat,
} from "../../../src/resources/instructions/config";
import { writeInstructionToFile } from "../../../src/resources/instructions/ide-formats";

describe("resources/instructions/command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
			selections: [
				{
					category: "essential",
					instruction: "react-vite",
					frontmatter: {
						description: "react vite",
						globs: ["**/*"],
						alwaysApply: true,
					},
				},
			],
			ideFormat: IdeFormat.CURSOR,
		});
		vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
			content: "# Rule content",
			frontmatter: {},
		});
		vi.mocked(writeInstructionToFile).mockResolvedValue(
			"/project/.cursor/rules/react-vite.mdc",
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("generateInstructions", () => {
		it("should call logger.intro to start the process", async () => {
			await generateInstructions({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
			expect(logger.intro).toHaveBeenCalledWith(
				"adding agent instructions...",
			);
		});

		it("should fetch and write instruction with correct category", async () => {
			await generateInstructions({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
			expect(getInstructionWithFrontmatter).toHaveBeenCalledWith(
				"essential",
				"react-vite",
				undefined,
			);
			expect(writeInstructionToFile).toHaveBeenCalledWith(
				process.cwd(),
				"react-vite",
				"# Rule content",
				IdeFormat.CURSOR,
				"essential",
				{ description: "react vite", globs: ["**/*"], alwaysApply: true },
			);
		});

		it("should print success message with output path", async () => {
			await generateInstructions({
				instruction: "react-vite",
				ideFormat: IdeFormat.CURSOR,
			});
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Agent instructions added successfully!"),
			);
		});
	});
});
