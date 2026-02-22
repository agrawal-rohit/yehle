import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Create mock for newListr
const mockNewListr = vi.fn(() => ({}));

// Mock listr2 before imports - create mock functions inside factory
vi.mock("listr2", () => ({
	Listr: vi.fn((tasks) => {
		// Store tasks for inspection
		return {
			run: vi.fn(async () => {
				// Execute the task function to improve coverage
				if (tasks && tasks[0] && tasks[0].task) {
					const mockTask = {
						newListr: vi.fn(() => ({})),
					};
					await tasks[0].task({}, mockTask);
				}
			}),
			_tasks: tasks,
		};
	}),
}));

// Mock chalk
vi.mock("chalk", () => ({
	default: {
		magentaBright: vi.fn((text) => text),
		grey: vi.fn((text) => text),
		hex: vi.fn(() => vi.fn((text) => text)),
	},
}));

import chalk from "chalk";
import { Listr } from "listr2";
import tasks, {
	conditionalTask,
	runWithTasks,
	task,
} from "../../src/cli/tasks";

describe("cli/tasks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("task", () => {
		test("should create a subtask with title and task function", () => {
			const title = "Test Task";
			const taskFn = vi.fn(async () => {});

			const result = task(title, taskFn);

			expect(result).toEqual({ title, task: taskFn });
		});
	});

	describe("conditionalTask", () => {
		test("should return array with subtask when condition is true", () => {
			const title = "Test Task";
			const taskFn = vi.fn(async () => {});
			const subtask = task(title, taskFn);

			const result = conditionalTask(true, subtask);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(subtask);
		});

		test("should return empty array when condition is false", () => {
			const title = "Test Task";
			const taskFn = vi.fn(async () => {});
			const subtask = task(title, taskFn);

			const result = conditionalTask(false, subtask);

			expect(result).toHaveLength(0);
			expect(result).toEqual([]);
		});

		test("should preserve subtask reference when condition is true", () => {
			const mockTask = vi.fn(async () => {});
			const subtask = task("Title", mockTask);

			const result = conditionalTask(true, subtask);

			expect(result[0]).toBe(subtask);
		});

		test("should handle multiple conditional subtasks together", () => {
			const task1 = vi.fn(async () => {});
			const task2 = vi.fn(async () => {});
			const task3 = vi.fn(async () => {});
			const subtask1 = task("Task 1", task1);
			const subtask2 = task("Task 2", task2);
			const subtask3 = task("Task 3", task3);

			const allTasks = [
				...conditionalTask(true, subtask1),
				...conditionalTask(false, subtask2),
				...conditionalTask(true, subtask3),
			];

			expect(allTasks).toHaveLength(2);
			expect(allTasks[0]).toBe(subtask1);
			expect(allTasks[1]).toBe(subtask3);
		});
	});

	describe("runWithTasks", () => {
		test("should create Listr instance and run it", async () => {
			const goalTitle = "Installing packages";

			await runWithTasks(goalTitle);

			expect(Listr).toHaveBeenCalled();
			const listrInstance = vi.mocked(Listr).mock.results[0].value;
			expect(listrInstance.run).toHaveBeenCalled();
		});

		test("should format goal title with primaryText", async () => {
			const goalTitle = "Beautiful Goal";

			await runWithTasks(goalTitle);

			expect(chalk.hex).toHaveBeenCalledWith("#FEA624");
			const colorFn = (chalk.hex as any).mock.results[0].value;
			expect(colorFn).toHaveBeenCalledWith(goalTitle);
		});

		test("should execute single task when task function is provided", async () => {
			const mockTask = vi.fn(async () => {});

			await runWithTasks("Test Goal", mockTask);

			expect(mockTask).toHaveBeenCalled();
			const listrInstance = vi.mocked(Listr).mock.results[0].value;
			expect(listrInstance.run).toHaveBeenCalled();
		});

		test("should handle subtasks when provided", async () => {
			const subtask1 = vi.fn(async () => {});
			const subtask2 = vi.fn(async () => {});

			const subtasks = [
				{ title: "Subtask 1", task: subtask1 },
				{ title: "Subtask 2", task: subtask2 },
			];

			await runWithTasks("Test Goal", undefined, subtasks);

			const listrInstance = vi.mocked(Listr).mock.results[0].value;
			expect(listrInstance.run).toHaveBeenCalled();
		});

		test("should use default collapseErrors option as true", async () => {
			await runWithTasks("Test Goal");

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			expect(listrArgs[1]).toEqual({
				rendererOptions: {
					collapseErrors: true,
				},
			});
		});

		test("should respect custom collapseErrors option", async () => {
			await runWithTasks("Test Goal", undefined, [], { collapseErrors: false });

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			expect(listrArgs[1]).toEqual({
				rendererOptions: {
					collapseErrors: false,
				},
			});
		});

		test("should handle empty subtasks array", async () => {
			await runWithTasks("Test Goal", undefined, []);

			const listrInstance = vi.mocked(Listr).mock.results[0].value;
			expect(listrInstance.run).toHaveBeenCalled();
		});

		test("should handle task execution errors", async () => {
			const error = new Error("Task failed");
			vi.mocked(Listr).mockImplementationOnce(
				() =>
					({
						run: vi.fn(() => Promise.reject(error)),
					}) as any,
			);

			await expect(runWithTasks("Test Goal")).rejects.toThrow("Task failed");
		});

		test("should pass goal title to Listr task configuration", async () => {
			const goalTitle = "Setup Project";

			await runWithTasks(goalTitle);

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			expect(listrArgs[0][0].title).toBe(goalTitle);
		});

		test("should map subtasks and format titles with grey", async () => {
			const subtask1 = vi.fn(async () => {});
			const subtask2 = vi.fn(async () => {});

			const subtasks = [
				{ title: "Subtask 1", task: subtask1 },
				{ title: "Subtask 2", task: subtask2 },
			];

			await runWithTasks("Test Goal", undefined, subtasks);

			// Verify chalk.grey was called for subtask titles (mapping happens during task execution)
			expect(chalk.grey).toHaveBeenCalledWith("Subtask 1");
			expect(chalk.grey).toHaveBeenCalledWith("Subtask 2");
		});

		test("should execute subtasks when newListr is called", async () => {
			const subtask1 = vi.fn(async () => {});
			const subtask2 = vi.fn(async () => {});
			const subtasks = [
				{ title: "Subtask 1", task: subtask1 },
				{ title: "Subtask 2", task: subtask2 },
			];

			// Mock Listr to actually execute subtasks
			vi.mocked(Listr).mockImplementationOnce(
				(tasks) =>
					({
						run: vi.fn(async () => {
							if (tasks && tasks[0] && tasks[0].task) {
								const mockTaskWrapper = {
									newListr: vi.fn((subTasks) => {
										// Execute each subtask to cover lines 63-64
										subTasks.forEach(async (subTask: any) => {
											if (subTask.task) {
												await subTask.task();
											}
										});
										return {};
									}),
								};
								await tasks[0].task({}, mockTaskWrapper);
							}
						}),
					}) as any,
			);

			await runWithTasks("Test Goal", undefined, subtasks);

			// Verify subtasks were executed
			expect(subtask1).toHaveBeenCalled();
			expect(subtask2).toHaveBeenCalled();
		});

		test("should call newListr with subtasks and rendererOptions", async () => {
			const subtask = vi.fn(async () => {});
			const subtasks = [{ title: "Test", task: subtask }];

			await runWithTasks("Goal", undefined, subtasks, {
				collapseErrors: false,
			});

			// Get the task function that was passed to Listr
			const listrArgs = vi.mocked(Listr).mock.calls[0];
			const taskConfig = listrArgs[0][0];

			// Execute the task function to trigger newListr
			const mockTaskWrapper = {
				newListr: vi.fn(),
			};
			await taskConfig.task({}, mockTaskWrapper);

			// Verify newListr was called with correct options
			expect(mockTaskWrapper.newListr).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						title: "Test",
					}),
				]),
				expect.objectContaining({
					rendererOptions: {
						collapseErrors: false,
					},
				}),
			);
		});
	});

	describe("integration tests", () => {
		test("should run conditional tasks with runWithTasks", async () => {
			const task1 = vi.fn(async () => {});
			const task2 = vi.fn(async () => {});

			const subtasks = [
				...conditionalTask(true, task("Task 1", task1)),
				...conditionalTask(false, task("Task 2", task2)),
			];

			await runWithTasks("Complete Setup", undefined, subtasks);

			const listrInstance = vi.mocked(Listr).mock.results[0].value;
			expect(listrInstance.run).toHaveBeenCalled();
			expect(subtasks).toHaveLength(1);
		});

		test("should handle mixed task scenarios", async () => {
			const directTask = vi.fn(async () => {});

			await runWithTasks("Mixed Goal", directTask, []);

			const listrInstance = vi.mocked(Listr).mock.results[0].value;
			expect(listrInstance.run).toHaveBeenCalled();
		});
	});

	describe("default export", () => {
		test("should export an object with all task utilities", () => {
			expect(tasks).toBeDefined();
			expect(tasks.task).toBe(task);
			expect(tasks.runWithTasks).toBe(runWithTasks);
			expect(tasks.conditionalTask).toBe(conditionalTask);
		});

		test("should have runWithTasks method", () => {
			expect(tasks.runWithTasks).toBeDefined();
			expect(typeof tasks.runWithTasks).toBe("function");
		});

		test("should have task method", () => {
			expect(tasks.task).toBeDefined();
			expect(typeof tasks.task).toBe("function");
		});

		test("should have conditionalTask method", () => {
			expect(tasks.conditionalTask).toBeDefined();
			expect(typeof tasks.conditionalTask).toBe("function");
		});
	});
});
