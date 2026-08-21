import {
	type DefaultRenderer,
	Listr,
	type ListrTaskWrapper,
	type SimpleRenderer,
} from "listr2";

/** A single executable subtask. */
export interface Subtask {
	/** Subtask title shown in the nested list. */
	title: string;
	/** Async work for this subtask. */
	task: () => Promise<void>;
}

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
 * Run work under a Listr goal title, either as a single task or nested subtasks.
 * @param title - Overall goal title (e.g. `"Preparing package"`).
 * @param work - Optional single async unit of work.
 * @param subtasks - Nested subtasks when `work` is omitted.
 * @param opts - Optional rendering behavior.
 */
export async function runWithTasks(
	title: string,
	work?: () => Promise<void>,
	subtasks: Subtask[] = [],
	opts: { collapseErrors?: boolean } = {},
): Promise<void> {
	const tasks = new Listr(
		[
			{
				title,
				task: async (
					_ctx: unknown,
					parent: ListrTaskWrapper<
						unknown,
						typeof DefaultRenderer,
						typeof SimpleRenderer
					>,
				) => {
					if (work) {
						await work();
						return;
					}

					return parent.newListr(
						subtasks.map(({ title: subtaskTitle, task: run }) => ({
							title: subtaskTitle,
							task: async () => {
								await run();
							},
						})),
						{
							rendererOptions: {
								collapseErrors: opts.collapseErrors ?? true,
							},
						},
					);
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
