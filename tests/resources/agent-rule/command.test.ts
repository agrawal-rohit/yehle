import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/cli/logger", () => ({
	default: {
		intro: vi.fn(),
	},
	primaryText: vi.fn((text: string) => text),
}));

vi.mock("../../../src/cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(async (_goal, _task, subtasks) => {
			if (subtasks?.length) {
				for (const sub of subtasks) {
					if (sub.task) await sub.task();
				}
			}
		}),
	},
}));

vi.mock("../../../src/resources/agent-rule/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../src/resources/agent-rule/config")>();
	return {
		...actual,
		getGenerateAgentRuleConfiguration: vi.fn(),
		fetchAgentRuleContent: vi.fn(),
	};
});

vi.mock("../../../src/resources/agent-rule/ide-formats", () => ({
	writeAgentRuleToFile: vi.fn(),
}));

import logger from "../../../src/cli/logger";
import tasks from "../../../src/cli/tasks";
import { generateAgentRule } from "../../../src/resources/agent-rule/command";
import {
	fetchAgentRuleContent,
	getGenerateAgentRuleConfiguration,
} from "../../../src/resources/agent-rule/config";
import { writeAgentRuleToFile } from "../../../src/resources/agent-rule/ide-formats";
import { IdeFormat } from "../../../src/resources/agent-rule/config";

describe("resources/agent-rule/command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.mocked(getGenerateAgentRuleConfiguration).mockResolvedValue({
			rule: "react-vite",
			ideFormat: IdeFormat.CURSOR,
		});
		vi.mocked(fetchAgentRuleContent).mockResolvedValue("# Rule content");
		vi.mocked(writeAgentRuleToFile).mockResolvedValue(
			"/project/.cursor/rules/react-vite.mdc",
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("generateAgentRule", () => {
		it("should call logger.intro to start the process", async () => {
			await generateAgentRule({ rule: "react-vite", ideFormat: "cursor" });

			expect(logger.intro).toHaveBeenCalledWith("generating agent rule...");
		});

		it("should retrieve configuration with provided options", async () => {
			await generateAgentRule({
				rule: "typescript-library",
				ideFormat: "windsurf",
			});

			expect(getGenerateAgentRuleConfiguration).toHaveBeenCalledWith({
				rule: "typescript-library",
				ideFormat: "windsurf",
			});
		});

		it("should fetch rule content and write to file", async () => {
			await generateAgentRule({ rule: "react-vite", ideFormat: "cursor" });

			expect(fetchAgentRuleContent).toHaveBeenCalledWith("react-vite");
			expect(writeAgentRuleToFile).toHaveBeenCalledWith(
				process.cwd(),
				"react-vite",
				"# Rule content",
				IdeFormat.CURSOR,
			);
		});

		it("should run tasks for generating agent rule", async () => {
			await generateAgentRule({ rule: "react-vite", ideFormat: "cursor" });

			expect(tasks.runWithTasks).toHaveBeenCalledWith(
				"Generating agent rule",
				undefined,
				expect.arrayContaining([
					expect.objectContaining({ title: "Fetch and write rule" }),
				]),
			);
		});

		it("should print success message with output path", async () => {
			await generateAgentRule({ rule: "react-vite", ideFormat: "cursor" });

			expect(console.log).toHaveBeenCalledWith();
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Agent rule generated successfully!"),
			);
			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining("Rule written to"),
			);
		});
	});
});
