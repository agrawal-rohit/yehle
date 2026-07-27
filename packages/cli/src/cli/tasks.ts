import {
	type DefaultRenderer,
	Listr,
	type ListrTaskWrapper,
	type SimpleRenderer,
} from "listr2";
import { defaultText, primaryText } from "./colors";

/** A single executable subtask. */
export type Subtask = {
	title: string;
	task: () => Promise<void>;
};

/**
 * Create a subtask.
 * @param title - Task title.
 * @param task - Task function.
 * @returns A subtask object.
 */
export function task(title: string, task: () => Promise<void>): Subtask {
	return { title, task };
}

/**
 * Helper to conditionally include a subtask in a task list.
 * @param condition - Include the subtask when true; exclude when false.
 * @param subtask - The subtask to conditionally include.
 * @returns Array with the subtask if condition is true; otherwise an empty array.
 */
export function conditionalTask(
	condition: boolean,
	subtask: Subtask,
): Subtask[] {
	return condition ? [subtask] : [];
}

/**
 * Run multiple subtasks grouped under a single goal using listr2.
 * Provides a clean, stylized task list with collapsed errors.
 * @param goalTitle - Overall goal title (e.g., "Preparing package").
 * @param subtasks - Array of subtasks to run.
 * @param opts - Optional rendering behavior.
 */
export async function runWithTasks(
	goalTitle: string,
	task?: () => Promise<void>,
	subtasks: Subtask[] = [],
	opts: { collapseErrors?: boolean } = {},
): Promise<void> {
	const tasks = new Listr(
		[
			{
				title: primaryText(goalTitle),
				task: async (
					_ctx: unknown,
					_task: ListrTaskWrapper<
						unknown,
						typeof DefaultRenderer,
						typeof SimpleRenderer
					>,
				) => {
					if (task) {
						await task();
						return;
					}

					const subTasks = subtasks.map(({ title, task: run }) => ({
						title: defaultText(title),
						task: async () => {
							await run();
						},
					}));

					return _task.newListr(subTasks, {
						rendererOptions: {
							collapseErrors: opts.collapseErrors ?? true,
						},
					});
				},
			},
		],
		{
			rendererOptions: {
				collapseErrors: opts.collapseErrors ?? true,
			},
		},
	);

	await tasks.run();
}

/** Convenience default export for straightforward importing. */
const tasks = {
	runWithTasks,
	task,
	conditionalTask,
};

export default tasks;
