import Mustache from "mustache";
import type { RegistryContext } from "./condition-kind";
import type { CompiledItem, RegistryConditionValue } from "./schema";

/** Replaces `${{` so Mustache does not treat GitHub Actions expressions as tags. */
const GITHUB_ACTIONS_SENTINEL = "\uE000GHA\uE000";

/** Render options: do not HTML-escape YAML, shell, or source files. */
const MUSTACHE_RENDER_OPTIONS = {
	escape: unescapeInterpolation,
} as const;

/**
 * Stringify a Mustache value without HTML escaping.
 * @param value - Interpolated view value.
 * @returns String form of the interpolated value.
 */
function unescapeInterpolation(value: unknown): string {
	return String(value);
}

/** Typed Mustache view: conditions keep their runtime types; bindings are strings. */
export type InterpolationView = Record<
	string,
	string | string[] | boolean | undefined
>;

/**
 * Build a typed Mustache view from install conditions, select-option bindings, and hook bindings.
 * Skipped optionals are omitted (falsy for sections). Hook bindings win on key conflicts.
 * @param conditions - Captured condition context.
 * @param bindings - Bindings from beforeInstall hooks.
 * @param optionValues - Select options keyed by condition name (shared + item-local).
 * @returns View used for `{{key}}` and Mustache sections.
 */
export function buildInterpolationContext(
	conditions: RegistryContext,
	bindings: Record<string, string>,
	optionValues: Record<string, RegistryConditionValue[]> = {},
): InterpolationView {
	const values: InterpolationView = {};

	for (const [key, value] of Object.entries(conditions)) {
		if (value === undefined) continue;
		values[key] = value;
		if (typeof value === "string") {
			const optionBindings = optionValues[key]?.find(
				(entry) => entry.value === value,
			)?.bindings;
			if (optionBindings) Object.assign(values, optionBindings);
		}
	}

	// Hook bindings win over condition keys and option bindings.
	Object.assign(values, bindings);

	return values;
}

/**
 * Render a Mustache template with a typed interpolation view.
 * Missing keys become empty strings. Does not touch `${{ ... }}`.
 * @param input - Template string.
 * @param values - Interpolation view.
 * @returns Resolved string.
 */
function interpolateString(input: string, values: InterpolationView): string {
	return Mustache.render(
		input.replaceAll("${{", GITHUB_ACTIONS_SENTINEL),
		values,
		undefined,
		MUSTACHE_RENDER_OPTIONS,
	).replaceAll(GITHUB_ACTIONS_SENTINEL, "${{");
}

/**
 * Replace `{{key}}` placeholders in compiled item file contents and command values.
 * Does not touch GitHub Actions expressions (`${{ ... }}`).
 * Skipped optionals (missing keys) become empty strings / falsy sections.
 * @param payload - Compiled item to interpolate.
 * @param values - Interpolation view.
 * @returns Payload with placeholders resolved.
 */
export function interpolateCompiledItem(
	compiledItem: CompiledItem,
	values: InterpolationView,
): CompiledItem {
	const files = compiledItem.files.map((file) => ({
		...file,
		content: interpolateString(file.content, values),
	}));

	let commands = compiledItem.commands;
	if (commands) {
		const nextCommands: NonNullable<CompiledItem["commands"]> = {};
		for (const [ecosystem, set] of Object.entries(commands)) {
			if (!set) continue;
			const nextSet: Record<string, string> = {};
			for (const [name, value] of Object.entries(set))
				nextSet[name] = interpolateString(value, values);
			nextCommands[ecosystem as keyof typeof nextCommands] = nextSet;
		}
		commands = nextCommands;
	}

	return {
		...compiledItem,
		files,
		...(commands ? { commands } : {}),
	};
}
