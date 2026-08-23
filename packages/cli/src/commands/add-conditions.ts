import {
	assumeContextFromSelectedItems,
	collectRegistryDependencies,
	collectRequiredConditions,
	createHandlerRuntime,
	inferConditionDefault,
	isFileAsync,
	type PromptHost,
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
 * Prompt host that adapts Clack wrappers for registry handlers.
 * @returns PromptHost bound to the CLI prompt helpers.
 */
function createCliPromptHost(): PromptHost {
	return {
		text: textInput,
		select: selectInput,
		multiselect: multiselectInput,
		confirm: confirmInput,
	};
}

/**
 * Build shared handler runtime helpers for the current project.
 * @param projectDir - Absolute project root.
 * @returns Handler runtime bound to the CLI prompts and filesystem.
 */
export function createProjectHandlerRuntime(projectDir: string) {
	return createHandlerRuntime(projectDir, createCliPromptHost(), {
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
 * @returns Selected values.
 */
async function promptMultiselectCondition(
	condition: RequiredCondition,
	promptMessage: string,
	inferred: RegistryContextValue | undefined,
): Promise<string[]> {
	if (condition.values.length === 1) return [condition.values[0].value];

	let defaultValues: string[] | undefined;
	if (Array.isArray(inferred)) defaultValues = inferred;

	return multiselectInput(
		promptMessage,
		{ options: conditionSelectOptions(condition) },
		defaultValues,
	);
}

/**
 * Capture a select condition via sole-option auto-select or a select prompt.
 * @param condition - Select condition to capture.
 * @param promptMessage - Message shown to the user.
 * @param inferred - Optional default from a condition handler.
 * @returns Selected value.
 */
async function promptSelectCondition(
	condition: RequiredCondition,
	promptMessage: string,
	inferred: RegistryContextValue | undefined,
): Promise<string> {
	if (condition.values.length === 1) return condition.values[0].value;

	return selectInput<string>(
		promptMessage,
		{ options: conditionSelectOptions(condition) },
		typeof inferred === "string" ? inferred : undefined,
	);
}

/**
 * Prompt (or auto-select) a value for one required condition.
 * @param condition - Condition the install plan still needs.
 * @param inferred - Optional default from a condition handler.
 * @returns Captured context value for this condition key.
 */
async function promptConditionValue(
	condition: RequiredCondition,
	inferred: RegistryContextValue | undefined,
): Promise<RegistryContextValue> {
	const promptMessage = condition.description ?? condition.label;
	const { kind, requiresValues } = policyForConditionKind(condition.kind);

	if (requiresValues) {
		if (kind === RegistryConditionKind.MULTISELECT)
			return promptMultiselectCondition(condition, promptMessage, inferred);
		return promptSelectCondition(condition, promptMessage, inferred);
	}

	if (kind === RegistryConditionKind.BOOLEAN)
		return confirmInput(
			promptMessage,
			{},
			typeof inferred === "boolean" ? inferred : undefined,
		);

	return textInput(
		promptMessage,
		{ required: true },
		typeof inferred === "string" ? inferred : undefined,
	);
}

/**
 * Capture required conditions by prompting for shared conditions.
 * Runs local condition handlers to seed prompt defaults when available.
 * @param registry - Loaded registry catalog.
 * @param catalogLocation - Absolute path or HTTPS URL of the catalog document.
 * @param projectDir - Absolute project root.
 * @param items - Selected items (`id` or `id@variant`).
 * @param runtime - Shared handler runtime for condition inference.
 * @returns Captured condition context for variant selection.
 */
export async function captureRequiredConditions(
	registry: Registry,
	catalogLocation: string,
	projectDir: string,
	items: string[],
	runtime = createProjectHandlerRuntime(projectDir),
): Promise<RegistryContext> {
	const context: RegistryContext = assumeContextFromSelectedItems(
		items,
		registry.items,
		registry.conditions,
	);

	const dependencies = collectRegistryDependencies(items, registry.items);
	const required = collectRequiredConditions(
		dependencies,
		registry.conditions,
		context,
	);

	for (const condition of required) {
		const inferred = await inferConditionDefault(
			catalogLocation,
			condition,
			runtime,
			context,
		);
		context[condition.key] = await promptConditionValue(condition, inferred);
	}

	return context;
}
