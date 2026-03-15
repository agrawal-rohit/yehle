import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../cli/logger", () => ({
	default: {
		intro: vi.fn(),
	},
	primaryText: vi.fn((s: string) => s),
}));

vi.mock("../../cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(),
	},
}));

vi.mock("../../core/instructions", () => ({
	getInstructionWithFrontmatter: vi.fn(),
}));

vi.mock("./config", () => ({
	getGenerateInstructionsConfiguration: vi.fn(),
}));

vi.mock("./ide-formats", () => ({
	writeInstructionToFile: vi.fn(),
}));

vi.mock("chalk", () => ({
	default: {
		bold: vi.fn((s: string) => s),
	},
}));

vi.mock("node:path", () => ({
	default: {
		relative: vi.fn((_, p) => p),
	},
}));

import path from "node:path";

// Import after mocks
import logger, { primaryText } from "../../cli/logger";
import tasks from "../../cli/tasks";
import { getInstructionWithFrontmatter } from "../../core/instructions";
import generateInstructions from "./command";
import {
	type GenerateInstructionsOptions,
	getGenerateInstructionsConfiguration,
	type InstructionSelection,
} from "./config";
import { writeInstructionToFile } from "./ide-formats";

describe("resources/instructions/command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(process, "cwd").mockReturnValue("/test/cwd");
	});

	describe("generateInstructions", () => {
		it("should call logger.intro with correct message", async () => {
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: [],
				ideFormat: "cursor",
			});
			vi.mocked(tasks.runWithTasks).mockResolvedValue();

			await generateInstructions();

			expect(logger.intro).toHaveBeenCalledWith("adding agent instructions...");
		});

		it("should get configuration from getGenerateInstructionsConfiguration", async () => {
			const options: Partial<GenerateInstructionsOptions> = {
				ideFormat: "windsurf",
			};
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: [],
				ideFormat: "windsurf",
			});
			vi.mocked(tasks.runWithTasks).mockResolvedValue();

			await generateInstructions(options);

			expect(getGenerateInstructionsConfiguration).toHaveBeenCalledWith(
				options,
			);
		});

		it("should process empty selections without calling task functions", async () => {
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: [],
				ideFormat: "cursor",
			});
			vi.mocked(tasks.runWithTasks).mockResolvedValue();

			await generateInstructions();

			expect(tasks.runWithTasks).toHaveBeenCalledWith(
				"Adding instructions",
				undefined,
				[],
			);
			expect(getInstructionWithFrontmatter).not.toHaveBeenCalled();
			expect(writeInstructionToFile).not.toHaveBeenCalled();
		});

		it("should fetch and write each selected instruction", async () => {
			const selections = [
				{
					category: "language" as const,
					instruction: "typescript",
					frontmatter: {
						description: "TS rules",
						alwaysApply: false,
					},
					context: { lang: "typescript" },
				},
				{
					category: "essential" as const,
					instruction: "coding-standards",
					frontmatter: {
						description: "Standards",
						alwaysApply: true,
					},
				},
			];
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: selections as InstructionSelection[],
				ideFormat: "cursor",
			});
			vi.mocked(getInstructionWithFrontmatter)
				.mockResolvedValueOnce({
					content: "# TypeScript rules",
					frontmatter: selections[0].frontmatter,
				})
				.mockResolvedValueOnce({
					content: "# Coding standards",
					frontmatter: selections[1].frontmatter,
				});
			vi.mocked(writeInstructionToFile)
				.mockResolvedValueOnce("/test/cwd/.cursor/rules/typescript.mdc")
				.mockResolvedValueOnce("/test/cwd/.cursor/rules/coding-standards.mdc");
			vi.mocked(tasks.runWithTasks).mockImplementation(async (_, __, tasks) => {
				for (const t of tasks ?? []) {
					if (t.task) await t.task();
				}
			});

			await generateInstructions();

			expect(getInstructionWithFrontmatter).toHaveBeenCalledTimes(2);
			expect(getInstructionWithFrontmatter).toHaveBeenCalledWith(
				"language",
				"typescript",
				{ lang: "typescript" },
			);
			expect(getInstructionWithFrontmatter).toHaveBeenCalledWith(
				"essential",
				"coding-standards",
				undefined,
			);

			expect(writeInstructionToFile).toHaveBeenCalledTimes(2);
			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/test/cwd",
				"typescript",
				"# TypeScript rules",
				"cursor",
				"language",
				selections[0].frontmatter,
			);
			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/test/cwd",
				"coding-standards",
				"# Coding standards",
				"cursor",
				"essential",
				selections[1].frontmatter,
			);
		});

		it("should pass correct task titles to runWithTasks", async () => {
			const selections = [
				{
					category: "language" as const,
					instruction: "typescript",
					frontmatter: { description: "TS", alwaysApply: false },
				},
			];
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: selections as InstructionSelection[],
				ideFormat: "cline",
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# TS",
				frontmatter: selections[0].frontmatter,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/test/cwd/.clinerules/typescript.mdc",
			);
			vi.mocked(tasks.runWithTasks).mockImplementation(async (_, __, tasks) => {
				for (const t of tasks ?? []) {
					if (t.task) await t.task();
				}
			});

			await generateInstructions();

			expect(tasks.runWithTasks).toHaveBeenCalledWith(
				"Adding instructions",
				undefined,
				[
					{
						title: "Fetch and write language/typescript",
						task: expect.any(Function),
					},
				],
			);
		});

		it("should log success message after instructions are added", async () => {
			const consoleSpy = vi.spyOn(console, "log");
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: [],
				ideFormat: "cursor",
			});
			vi.mocked(tasks.runWithTasks).mockResolvedValue();
			vi.mocked(primaryText).mockImplementation((s) => s);

			await generateInstructions();

			expect(consoleSpy).toHaveBeenCalledWith();
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Agent instructions added successfully!"),
			);
		});

		it("should log relative paths of written files", async () => {
			const selections = [
				{
					category: "language" as const,
					instruction: "typescript",
					frontmatter: { description: "TS", alwaysApply: false },
				},
			];
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: selections as InstructionSelection[],
				ideFormat: "cursor",
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# TS",
				frontmatter: selections[0].frontmatter,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/test/cwd/.cursor/rules/typescript.mdc",
			);
			vi.mocked(tasks.runWithTasks).mockImplementation(async (_, __, tasks) => {
				for (const t of tasks ?? []) {
					if (t.task) await t.task();
				}
			});
			vi.mocked(path.relative).mockReturnValue(".cursor/rules/typescript.mdc");
			vi.mocked(primaryText).mockImplementation((s) => s);

			await generateInstructions();

			expect(path.relative).toHaveBeenCalledWith(
				"/test/cwd",
				"/test/cwd/.cursor/rules/typescript.mdc",
			);
		});

		it("should handle single selection correctly", async () => {
			const selections = [
				{
					category: "essential" as const,
					instruction: "main",
					frontmatter: { description: "Main", alwaysApply: true },
				},
			];
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: selections as InstructionSelection[],
				ideFormat: "copilot",
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# Main",
				frontmatter: selections[0].frontmatter,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/test/cwd/.github/copilot-instructions.md",
			);
			vi.mocked(tasks.runWithTasks).mockImplementation(async (_, __, tasks) => {
				for (const t of tasks ?? []) {
					if (t.task) await t.task();
				}
			});
			vi.spyOn(console, "log").mockImplementation(() => {});

			await generateInstructions();

			expect(getInstructionWithFrontmatter).toHaveBeenCalledTimes(1);
			expect(writeInstructionToFile).toHaveBeenCalledTimes(1);
		});

		it("should pass correct ideFormat to writeInstructionToFile", async () => {
			const selections = [
				{
					category: "language" as const,
					instruction: "python",
					frontmatter: { description: "Python", alwaysApply: false },
				},
			];
			vi.mocked(getGenerateInstructionsConfiguration).mockResolvedValue({
				selections: selections as InstructionSelection[],
				ideFormat: "claude",
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# Python",
				frontmatter: selections[0].frontmatter,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/test/cwd/.claude/rules/python.md",
			);
			vi.mocked(tasks.runWithTasks).mockImplementation(async (_, __, tasks) => {
				for (const t of tasks ?? []) {
					if (t.task) await t.task();
				}
			});
			vi.spyOn(console, "log").mockImplementation(() => {});

			await generateInstructions();

			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/test/cwd",
				"python",
				"# Python",
				"claude",
				"language",
				selections[0].frontmatter,
			);
		});
	});
});
