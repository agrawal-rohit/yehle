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

vi.mock("../../../src/resources/instructions/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../src/resources/instructions/config")>();
	return {
		...actual,
		getGenerateInstructionsConfiguration: vi.fn(),
		fetchInstructionContent: vi.fn(),
	};
});

vi.mock("../../../src/resources/instructions/ide-formats", () => ({
	writeInstructionToFile: vi.fn(),
}));

import logger from "../../../src/cli/logger";
import { generateInstructions } from "../../../src/resources/instructions/command";
import {
	fetchInstructionContent,
	getGenerateInstructionsConfiguration,
	IdeFormat,
} from "../../../src/resources/instructions/config";
import { writeInstructionToFile } from "../../../src/resources/instructions/ide-formats";

describe("resources/instructions/command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
			category: "global-preferences",
			instruction: "react-vite",
			ideFormat: IdeFormat.CURSOR,
			metadata: {
				description: "react vite",
				globs: ["**/*"],
				alwaysApply: true,
			},
		});
		vi.mocked(fetchInstructionContent).mockResolvedValue("# Rule content");
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
			expect(fetchInstructionContent).toHaveBeenCalledWith(
				"global-preferences",
				"react-vite",
			);
			expect(writeInstructionToFile).toHaveBeenCalledWith(
				process.cwd(),
				"react-vite",
				"# Rule content",
				IdeFormat.CURSOR,
				"global-preferences",
				expect.objectContaining({
					description: "react vite",
					globs: ["**/*"],
					alwaysApply: true,
				}),
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
