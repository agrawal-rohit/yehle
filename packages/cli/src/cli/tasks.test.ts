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
import { runWithTasks, task, taskGroup } from "./tasks";

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

	describe("taskGroup", () => {
		test("creates a parent subtask that groups children", () => {
			const child = task(
				"File",
				vi.fn(async () => {}),
			);

			expect(taskGroup("Item", [child])).toEqual({
				title: "Item",
				subtasks: [child],
			});
		});

		test("throws when the group has no children", () => {
			expect(() => taskGroup("Item", [])).toThrow(
				'Task group "Item" has no work.',
			);
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

		test("throws when given an empty subtask list", async () => {
			await expect(runWithTasks("Test Goal", [])).rejects.toThrow(
				'Task "Test Goal" has no work.',
			);
			expect(Listr).not.toHaveBeenCalled();
		});

		test("throws when a leaf subtask has no work", async () => {
			type TaskFn = (ctx: unknown, wrapper: unknown) => Promise<void>;

			await runWithTasks("Test Goal", [{ title: "Empty leaf" }]);

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			const taskConfig = (
				listrArgs[0] as Array<{
					task: TaskFn;
				}>
			)[0];
			const mockTaskWrapper = {
				newListr: vi.fn(async (nested: Array<{ task?: TaskFn }>) => {
					for (const nestedTask of nested) {
						if (nestedTask.task) await nestedTask.task({}, mockTaskWrapper);
					}
					return {};
				}),
			};

			await expect(taskConfig.task({}, mockTaskWrapper)).rejects.toThrow(
				'Subtask "Empty leaf" has no work.',
			);
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
			await runWithTasks("Test Goal", async () => {}, {
				collapseErrors: false,
			});

			const listrArgs = vi.mocked(Listr).mock.calls[0];
			expect(listrArgs[1]).toEqual({
				rendererOptions: {
					collapseErrors: false,
				},
			});
		});

		test("nests grouped subtasks under a parent", async () => {
			const fileTask = vi.fn(async () => {});

			await runWithTasks("Installing items", [
				taskGroup("Installing Demo", [task("a.txt", fileTask)]),
			]);

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
					expect.objectContaining({ title: "Installing Demo" }),
				]),
				expect.objectContaining({
					rendererOptions: { collapseErrors: true },
				}),
			);
		});

		test("runs a parent task before nesting its subtasks", async () => {
			const parentWork = vi.fn(async () => {});
			const childWork = vi.fn(async () => {});

			type TaskFn = (ctx: unknown, wrapper: unknown) => Promise<void>;

			/**
			 * Recursively run nested Listr task functions with a parent wrapper.
			 * @param nested - Nested task configs from `newListr`.
			 */
			async function runNested(
				nested: Array<{ task?: TaskFn }>,
			): Promise<object> {
				for (const nestedTask of nested) {
					if (!nestedTask.task) continue;
					const nestedWrapper = {
						newListr: vi.fn(async (deeper: Array<{ task?: TaskFn }>) =>
							runNested(deeper),
						),
					};
					await nestedTask.task({}, nestedWrapper);
				}
				return {};
			}

			vi.mocked(Listr).mockImplementationOnce((tasksArg) => {
				const run = vi.fn(async () => {
					const firstTask = (
						Array.isArray(tasksArg) ? tasksArg[0] : undefined
					) as { task?: TaskFn } | undefined;

					if (firstTask?.task) {
						const mockTaskWrapper = {
							newListr: vi.fn(async (nested: Array<{ task?: TaskFn }>) =>
								runNested(nested),
							),
						};
						await firstTask.task({}, mockTaskWrapper);
					}
				});
				return { run } as unknown as InstanceType<typeof Listr>;
			});

			await runWithTasks("Test Goal", [
				{
					title: "Parent",
					task: parentWork,
					subtasks: [task("Child", childWork)],
				},
			]);

			expect(parentWork).toHaveBeenCalled();
			expect(childWork).toHaveBeenCalled();
			expect(parentWork.mock.invocationCallOrder[0]).toBeLessThan(
				childWork.mock.invocationCallOrder[0]!,
			);
		});

		test("nests subtasks when no work function is provided", async () => {
			const subtask1 = vi.fn(async () => {});
			const subtask2 = vi.fn(async () => {});
			const subtasks = [
				task("Subtask 1", subtask1),
				task("Subtask 2", subtask2),
			];

			await runWithTasks("Test Goal", subtasks);

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

			await runWithTasks("Test Goal", [
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
