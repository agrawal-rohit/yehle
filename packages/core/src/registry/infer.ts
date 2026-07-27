import fs from "node:fs";
import path from "node:path";
import {
	type RegistryCondition,
	RegistryConditionInference,
	type RegistryContext,
} from "./schema";

/** Optional overrides used by tests to inject filesystem lookups. */
export type InferConditionOptions = {
	/** Check whether an absolute path exists. Defaults to `fs.existsSync`. */
	pathExists?: (absolutePath: string) => boolean;
};

/**
 * Infer a single condition value using its declared inference mode.
 * @param condition - Condition with an inference declaration.
 * @param projectDir - Absolute project root.
 * @param pathExists - Existence checker for absolute paths.
 * @returns Confident inferred value, or undefined when inference is ambiguous or fails.
 */
function inferOne(
	condition: RegistryCondition,
	projectDir: string,
	pathExists: (absolutePath: string) => boolean,
): string | undefined {
	const inference = condition.inference;
	if (inference === undefined) return undefined;

	if (inference === RegistryConditionInference.FILES) {
		const matches = condition.values.filter(
			(entry) =>
				Array.isArray(entry.files) &&
				entry.files.some((relative) =>
					pathExists(path.join(projectDir, relative)),
				),
		);
		// Exactly one matching value is confident; zero or many → prompt.
		if (matches.length !== 1) return undefined;
		return matches[0].value;
	}

	throw new Error(`Unhandled condition inference "${String(inference)}".`);
}

/**
 * Infer condition values from a project directory.
 * Only conditions with a declared `inference` mode are considered.
 * @param conditions - Shared condition definitions from the registry.
 * @param projectDir - Absolute path to the project root.
 * @param options - Optional injected lookups for tests.
 * @returns Partial context of inferred values.
 */
export async function inferConditionValues(
	conditions: Record<string, RegistryCondition> | undefined,
	projectDir: string,
	options: InferConditionOptions = {},
): Promise<RegistryContext> {
	if (!conditions) return {};

	const pathExists =
		options.pathExists ?? ((absolutePath) => fs.existsSync(absolutePath));
	const context: RegistryContext = {};

	for (const [key, condition] of Object.entries(conditions)) {
		const value = inferOne(condition, projectDir, pathExists);
		if (value !== undefined) context[key] = value;
	}

	return context;
}
