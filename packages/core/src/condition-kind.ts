/** How a shared condition is prompted. */
export enum RegistryConditionKind {
	TEXT = "text",
	SELECT = "select",
	BOOLEAN = "boolean",
	MULTISELECT = "multiselect",
}

/** Labelled value shape used by select/multiselect conditions. */
export interface ConditionValueOption {
	/** Matcher / stored value. */
	value: string;
	/** Display label. */
	label: string;
}

/** Runtime resolved condition values keyed by condition name. */
export type RegistryContextValue = string | string[] | boolean;
export type RegistryContext = Record<string, RegistryContextValue | undefined>;

/**
 * Kind-specific rules shared by schema validation, when parsing, prompting, and inference.
 */
export interface ConditionKindPolicy {
	/** Whether the condition declaration must include labelled values. */
	requiresValues: boolean;
	/** Whether this kind may appear in a variant `when` matcher. */
	allowsInWhen: boolean;
	/**
	 * Validate a `when` string against this kind's rules.
	 * @param value - Matcher value from a variant `when` map.
	 * @param declaredValues - Declared select/multiselect values when present.
	 * @throws Error description fragment when the value is invalid for this kind.
	 */
	assertWhenValue: (
		value: string,
		declaredValues: ConditionValueOption[] | undefined,
	) => void;
	/**
	 * Seed a context entry from a pinned-variant `when` value.
	 * @param context - Context being mutated.
	 * @param key - Condition key.
	 * @param value - `when` string value.
	 */
	seedContext: (context: RegistryContext, key: string, value: string) => void;
	/**
	 * Normalize a handler-inferred default to a typed context value.
	 * @param inferred - Raw value returned by a condition handler.
	 * @param values - Prompt options for select/multiselect kinds.
	 * @returns Typed default when valid, otherwise undefined.
	 */
	normalizeInferred: (
		inferred: string | string[] | boolean,
		values: ConditionValueOption[],
	) => RegistryContextValue | undefined;
}

/**
 * Validate that a select/multiselect when value is among declared options.
 * @param value - Matcher value.
 * @param declaredValues - Declared labelled values.
 * @throws Error when the value is undeclared.
 */
function assertDeclaredWhenValue(
	value: string,
	declaredValues: ConditionValueOption[] | undefined,
): void {
	if (!declaredValues?.some((entry) => entry.value === value))
		throw new Error(`undeclared:${value}`);
}

/** Policy table keyed by {@link RegistryConditionKind}. */
export const conditionKindPolicy: Record<
	RegistryConditionKind,
	ConditionKindPolicy
> = {
	[RegistryConditionKind.SELECT]: {
		requiresValues: true,
		allowsInWhen: true,
		assertWhenValue: assertDeclaredWhenValue,
		seedContext: (context, key, value) => {
			context[key] = value;
		},
		normalizeInferred: (inferred, values) => {
			if (typeof inferred !== "string") return undefined;
			if (!values.some((entry) => entry.value === inferred)) return undefined;
			return inferred;
		},
	},
	[RegistryConditionKind.MULTISELECT]: {
		requiresValues: true,
		allowsInWhen: true,
		assertWhenValue: assertDeclaredWhenValue,
		seedContext: (context, key, value) => {
			const existing = context[key];
			if (!Array.isArray(existing)) {
				context[key] = [value];
				return;
			}
			if (!existing.includes(value)) existing.push(value);
		},
		normalizeInferred: (inferred, values) => {
			let candidates: string[] | null = null;
			if (Array.isArray(inferred)) candidates = inferred;
			else if (typeof inferred === "string") candidates = [inferred];
			if (!candidates) return undefined;
			if (
				!candidates.every((value) =>
					values.some((entry) => entry.value === value),
				)
			)
				return undefined;
			return candidates;
		},
	},
	[RegistryConditionKind.BOOLEAN]: {
		requiresValues: false,
		allowsInWhen: true,
		assertWhenValue: (value) => {
			if (value !== "true" && value !== "false")
				throw new Error(`boolean:${value}`);
		},
		seedContext: (context, key, value) => {
			context[key] = value === "true";
		},
		normalizeInferred: (inferred) => {
			if (typeof inferred === "boolean") return inferred;
			if (inferred === "true") return true;
			if (inferred === "false") return false;
			return undefined;
		},
	},
	[RegistryConditionKind.TEXT]: {
		requiresValues: false,
		allowsInWhen: false,
		assertWhenValue: () => {
			throw new Error("text_in_when");
		},
		seedContext: (context, key, value) => {
			context[key] = value;
		},
		normalizeInferred: (inferred) => {
			if (typeof inferred !== "string") return undefined;
			if (inferred === "") return undefined;
			return inferred;
		},
	},
};

/**
 * Resolve the policy for a condition kind, defaulting to select.
 * @param kind - Declared kind, or undefined when omitted.
 * @returns Policy for the effective kind.
 */
export function policyForConditionKind(
	kind: RegistryConditionKind | undefined,
): ConditionKindPolicy & { kind: RegistryConditionKind } {
	const resolved = kind ?? RegistryConditionKind.SELECT;
	return { kind: resolved, ...conditionKindPolicy[resolved] };
}
