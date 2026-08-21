import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("listr2", () => ({
	Listr: vi.fn((tasks) => ({
		run: vi.fn(async () => {
			const firstTask = Array.isArray(tasks) ? tasks[0] : undefined;
			if (firstTask?.task) {
				const mockTask = {
					newListr: vi.fn(() => ({})),
				};
				await firstTask.task({}, mockTask);
			}
		}),
		_tasks: tasks,
	})),
}));

import { Listr } from "listr2";
import { conditionalTask, runWithTasks, task } from "./tasks";

describe("cli/tasks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("task", () => {
		test("creates a subtask with title and task function", () => {
			const title = "Test Task";
			const taskFn = vi.fn(async () => {});

			expect(task(title, taskFn)).toEqual({ title, task: taskFn });
		});
	});

	describe("conditionalTask", () => {
		test("returns the subtask when the condition is true", () => {
			const subtask = task(
				"Test Task",
				vi.fn(async () => {}),
			);

			expect(conditionalTask(true, subtask)).toEqual([subtask]);
		});

		test("returns an empty array when the condition is false", () => {
			const subtask = task(
				"Test Task",
				vi.fn(async () => {}),
			);

			expect(conditionalTask(false, subtask)).toEqual([]);
		});

		test("can be spread to build a filtered subtask list", () => {
			const subtask1 = task(
				"Task 1",
				vi.fn(async () => {}),
			);
			const subtask2 = task(
				"Task 2",
				vi.fn(async () => {}),
			);
			const subtask3 = task(
				"Task 3",
				vi.fn(async () => {}),
			);

			const allTasks = [
				...conditionalTask(true, subtask1),
				...conditionalTask(false, subtask2),
				...conditionalTask(true, subtask3),
			];

			expect(allTasks).toEqual([subtask1, subtask3]);
		});
	});

	describe("runWithTasks", () => {
		test("creates a Listr instance and runs the work function", async () => {
			const work = vi.fn(async () => {});

			await runWithTasks("Installing packages", work);

			expect(Listr).toHaveBeenCalled();
			expect(work).toHaveBeenCalled();
			const listrInstance = vi.mocked(Listr).mock.results[0].value;
			expect(listrInstance.run).toHaveBeenCalled();
		});

		test("passes the title through without restyling", async () => {
			const title = `Fetching ${"payloads"}`;

			await runWithTasks(title, async () => {});

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			const taskConfigs = listrArgs[0] as Array<{ title: string }>;
			expect(taskConfigs[0]?.title).toBe(title);
		});

		test("defaults collapseErrors to true", async () => {
			await runWithTasks("Test Goal", async () => {});

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			expect(listrArgs[1]).toEqual({
				rendererOptions: {
					collapseErrors: true,
				},
			});
		});

		test("respects custom collapseErrors", async () => {
			await runWithTasks("Test Goal", undefined, [], {
				collapseErrors: false,
			});

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			expect(listrArgs[1]).toEqual({
				rendererOptions: {
					collapseErrors: false,
				},
			});
		});

		test("nests subtasks when no work function is provided", async () => {
			const subtask1 = vi.fn(async () => {});
			const subtask2 = vi.fn(async () => {});
			const subtasks = [
				task("Subtask 1", subtask1),
				task("Subtask 2", subtask2),
			];

			await runWithTasks("Test Goal", undefined, subtasks);

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			const taskConfig = (
				listrArgs[0] as Array<{
					task: (ctx: unknown, wrapper: unknown) => Promise<void>;
				}>
			)[0];
			const mockTaskWrapper = { newListr: vi.fn() };
			await taskConfig.task({}, mockTaskWrapper);

			expect(mockTaskWrapper.newListr).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ title: "Subtask 1" }),
					expect.objectContaining({ title: "Subtask 2" }),
				]),
				expect.objectContaining({
					rendererOptions: { collapseErrors: true },
				}),
			);
		});

		test("executes nested subtask runners", async () => {
			const subtask1 = vi.fn(async () => {});
			const subtask2 = vi.fn(async () => {});

			vi.mocked(Listr).mockImplementationOnce((tasksArg) => {
				const run = vi.fn(async () => {
					type TaskFn = (ctx: unknown, wrapper: unknown) => Promise<void>;
					const firstTask = (
						Array.isArray(tasksArg) ? tasksArg[0] : undefined
					) as { task?: TaskFn } | undefined;

					if (firstTask?.task) {
						const mockTaskWrapper = {
							newListr: vi.fn(
								async (nested: Array<{ task?: () => Promise<void> }>) => {
									for (const nestedTask of nested) {
										if (nestedTask.task) await nestedTask.task();
									}
									return {};
								},
							),
						};
						await firstTask.task({}, mockTaskWrapper);
					}
				});
				return { run } as unknown as InstanceType<typeof Listr>;
			});

			await runWithTasks("Test Goal", undefined, [
				task("Subtask 1", subtask1),
				task("Subtask 2", subtask2),
			]);

			expect(subtask1).toHaveBeenCalled();
			expect(subtask2).toHaveBeenCalled();
		});

		test("propagates task execution errors", async () => {
			const error = new Error("Task failed");
			vi.mocked(Listr).mockImplementationOnce(
				() =>
					({
						run: vi.fn(() => Promise.reject(error)),
					}) as unknown as InstanceType<typeof Listr>,
			);

			await expect(runWithTasks("Test Goal", async () => {})).rejects.toThrow(
				"Task failed",
			);
		});
	});
});
