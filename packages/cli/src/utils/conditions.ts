import {
	assumeContextFromSelectedItems,
	buildInstallPlan,
	collectItemLocalConditions,
	collectRegistryDependencies,
	collectRequiredConditions,
	createHandlerRuntime,
	type HandlerRuntime,
	type InstallNode,
	inferConditionDefault,
	isFileAsync,
	policyForConditionKind,
	type Registry,
	RegistryConditionKind,
	type RegistryContext,
	type RegistryContextValue,
	type RequiredCondition,
	readFileAsync,
	runAsync,
} from "@tuckshop/core";
import {
	confirmInput,
	multiselectInput,
	selectInput,
	textInput,
} from "../cli/prompts";

/**
 * Build shared handler runtime helpers for the current project.
 * @param projectDir - Absolute project root.
 * @returns Handler runtime bound to the project filesystem and shell.
 */
export function createProjectHandlerRuntime(
	projectDir: string,
): HandlerRuntime {
	return createHandlerRuntime(projectDir, {
		isFile: isFileAsync,
		readFile: readFileAsync,
		run: (command) => runAsync(command, { cwd: projectDir, stdio: "pipe" }),
	});
}

/**
 * Map condition values to Clack select/multiselect options.
 * @param condition - Condition whose labelled values become options.
 * @returns Options for a select or multiselect prompt.
 */
function conditionSelectOptions(condition: RequiredCondition) {
	return condition.values.map((entry) => ({
		label: entry.label,
		value: entry.value,
	}));
}

/**
 * Capture a multiselect condition via sole-option auto-select or a multiselect prompt.
 * @param condition - Multiselect condition to capture.
 * @param promptMessage - Message shown to the user.
 * @param inferred - Optional default from a condition handler.
 * @returns Selected values, or undefined when an optional prompt is left empty.
 */
async function promptMultiselectCondition(
	condition: RequiredCondition,
	promptMessage: string,
	inferred: RegistryContextValue | undefined,
): Promise<string[] | undefined> {
	const optional = condition.optional === true;
	if (!optional && condition.values.length === 1)
		return [condition.values[0].value];

	let defaultValues: string[] | undefined;
	if (Array.isArray(inferred)) defaultValues = inferred;

	const selected = await multiselectInput(
		promptMessage,
		{ options: conditionSelectOptions(condition) },
		defaultValues,
	);

	if (optional && selected.length === 0) return undefined;
	return selected;
}

/**
 * Capture a select condition via sole-option auto-select or a select prompt.
 * @param condition - Select condition to capture.
 * @param promptMessage - Message shown to the user.
 * @param inferred - Optional default from a condition handler.
 * @returns Selected value, or undefined when the user chooses None on an optional condition.
 */
async function promptSelectCondition(
	condition: RequiredCondition,
	promptMessage: string,
	inferred: RegistryContextValue | undefined,
): Promise<string | undefined> {
	const optional = condition.optional === true;
	if (!optional && condition.values.length === 1)
		return condition.values[0].value;

	const options = optional
		? [...conditionSelectOptions(condition), { label: "None", value: "None" }]
		: conditionSelectOptions(condition);

	const selected = await selectInput<string>(
		promptMessage,
		{ options },
		typeof inferred === "string" ? inferred : undefined,
	);

	if (optional && selected === "None") return undefined;
	return selected;
}

/**
 * Capture an optional boolean via Yes / No / None (confirm cannot represent unset).
 * @param promptMessage - Message shown to the user.
 * @param inferred - Optional default from a condition handler.
 * @returns Captured boolean, or undefined when skipped.
 */
async function promptOptionalBooleanCondition(
	promptMessage: string,
	inferred: RegistryContextValue | undefined,
): Promise<boolean | undefined> {
	const selected = await selectInput<string>(
		promptMessage,
		{
			options: [
				{ label: "Yes", value: "true" },
				{ label: "No", value: "false" },
				{ label: "None", value: "None" },
			],
		},
		typeof inferred === "boolean" ? String(inferred) : undefined,
	);

	if (selected === "None") return undefined;
	return selected === "true";
}

/**
 * Prompt for a boolean condition, including optional skip handling.
 * @param promptMessage - User-facing prompt text.
 * @param optional - Whether the condition may be skipped.
 * @param inferred - Optional default from a condition handler.
 * @returns Captured boolean, or undefined when skipped.
 */
async function promptBooleanCondition(
	promptMessage: string,
	optional: boolean,
	inferred: RegistryContextValue | undefined,
): Promise<RegistryContextValue | undefined> {
	if (optional) return promptOptionalBooleanCondition(promptMessage, inferred);
	return confirmInput(
		promptMessage,
		{},
		typeof inferred === "boolean" ? inferred : undefined,
	);
}

/**
 * Prompt for a free-text condition, including optional skip handling.
 * @param promptMessage - User-facing prompt text.
 * @param optional - Whether the condition may be skipped.
 * @param inferred - Optional default from a condition handler.
 * @returns Captured text, or undefined when skipped.
 */
async function promptTextCondition(
	promptMessage: string,
	optional: boolean,
	inferred: RegistryContextValue | undefined,
): Promise<RegistryContextValue | undefined> {
	const value = await textInput(
		promptMessage,
		{ required: !optional },
		typeof inferred === "string" ? inferred : undefined,
	);
	if (optional && value === "") return undefined;
	return value;
}

/**
 * Prompt (or auto-select) a value for one condition.
 * @param condition - Condition the install plan still needs.
 * @param inferred - Optional default from a condition handler.
 * @returns Captured context value, or undefined when an optional condition is skipped.
 */
async function promptConditionValue(
	condition: RequiredCondition,
	inferred: RegistryContextValue | undefined,
): Promise<RegistryContextValue | undefined> {
	const optional = condition.optional === true;
	const promptMessage = condition.description ?? condition.label;
	const { kind } = policyForConditionKind(condition.kind);

	switch (kind) {
		case RegistryConditionKind.MULTISELECT:
			return promptMultiselectCondition(condition, promptMessage, inferred);
		case RegistryConditionKind.SELECT:
			return promptSelectCondition(condition, promptMessage, inferred);
		case RegistryConditionKind.BOOLEAN:
			return promptBooleanCondition(promptMessage, optional, inferred);
		case RegistryConditionKind.TEXT:
			return promptTextCondition(promptMessage, optional, inferred);
		/* v8 ignore start */
		// Stryker disable all: unreachable exhaustive default
		default: {
			const exhaustive: never = kind;
			throw new Error(`Unsupported condition kind: ${String(exhaustive)}`);
		}
		// Stryker restore all
		/* v8 ignore stop */
	}
}

/**
 * Capture defaults and prompt for each pending condition, merging answers into context.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param conditions - Conditions still missing from context.
 * @param runtime - Shared handler runtime for condition inference.
 * @param context - Condition values already captured.
 * @returns Context including newly captured answers.
 */
async function captureConditionValues(
	catalogLocation: string,
	conditions: RequiredCondition[],
	runtime: HandlerRuntime,
	context: RegistryContext,
): Promise<RegistryContext> {
	const next: RegistryContext = { ...context };

	for (const condition of conditions) {
		const inferred = await inferConditionDefault(
			catalogLocation,
			condition,
			runtime,
			next,
		);
		const value = await promptConditionValue(condition, inferred);
		if (value !== undefined) next[condition.key] = value;
	}

	return next;
}

/**
 * Capture remaining conditions until none are left to ask.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param runtime - Shared handler runtime for condition inference.
 * @param context - Condition values already captured.
 * @param collectPending - Returns conditions that are promptable for the current context.
 * @param afterBatch - Optional work after each capture batch (e.g. rebuild the install plan).
 * @returns Context after no further conditions remain.
 */
async function capturePendingConditions(
	catalogLocation: string,
	runtime: HandlerRuntime,
	context: RegistryContext,
	collectPending: (context: RegistryContext) => RequiredCondition[],
	afterBatch?: (context: RegistryContext) => void,
): Promise<RegistryContext> {
	const askedKeys = new Set<string>();
	let next = context;
	const unread = (current: RegistryContext) =>
		collectPending(current).filter(
			(condition) => !askedKeys.has(condition.key),
		);
	let pending = unread(next);

	while (pending.length > 0) {
		for (const condition of pending) askedKeys.add(condition.key);
		next = await captureConditionValues(
			catalogLocation,
			pending,
			runtime,
			next,
		);
		afterBatch?.(next);
		pending = unread(next);
	}

	return next;
}

/**
 * Capture shared conditions until none remain promptable.
 * @param registry - Loaded registry catalog.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param projectDir - Absolute project root.
 * @param items - Selected items (`id` or `id@pack`).
 * @param runtime - Shared handler runtime for condition inference.
 * @returns Captured condition context for pack selection.
 */
export async function captureRequiredConditions(
	registry: Registry,
	catalogLocation: string,
	projectDir: string,
	items: string[],
	runtime = createProjectHandlerRuntime(projectDir),
): Promise<RegistryContext> {
	const context = assumeContextFromSelectedItems(
		items,
		registry.items,
		registry.conditions,
	);
	const dependencies = collectRegistryDependencies(items, registry.items);

	return capturePendingConditions(
		catalogLocation,
		runtime,
		context,
		(current) =>
			collectRequiredConditions(dependencies, registry.conditions, current),
	);
}

/**
 * Capture item-local conditions for planned items, rebuilding the plan when answers change pack selection.
 * @param registry - Loaded registry catalog.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param items - Selected items (`id` or `id@pack`).
 * @param plan - Ordered install nodes from the latest plan.
 * @param context - Shared conditions already captured.
 * @param runtime - Shared handler runtime.
 * @returns Context and plan after local conditions are settled.
 */
export async function captureItemLocalConditionsForPlan(
	registry: Registry,
	catalogLocation: string,
	items: string[],
	plan: InstallNode[],
	context: RegistryContext,
	runtime: HandlerRuntime,
): Promise<{ context: RegistryContext; plan: InstallNode[] }> {
	let nextPlan = plan;

	const nextContext = await capturePendingConditions(
		catalogLocation,
		runtime,
		context,
		(current) => {
			const entries = nextPlan.flatMap((node) => {
				const item = registry.items[node.itemId];
				return item ? [{ itemId: node.itemId, item }] : [];
			});
			return collectItemLocalConditions(entries, current);
		},
		(current) => {
			// Newly matching packs may add dependsOn items with their own local conditions.
			nextPlan = buildInstallPlan(items, registry.items, current);
		},
	);

	return { context: nextContext, plan: nextPlan };
}
