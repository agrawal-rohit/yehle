/** How a shared or item-level condition is prompted. */
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

/** Captured condition values keyed by condition name. */
export type RegistryContextValue = string | string[] | boolean;
export type RegistryContext = Record<string, RegistryContextValue | undefined>;
export type RegistryWhenValue = string | string[] | boolean;

/**
 * Kind-specific rules shared by schema validation, when parsing, prompting, and inference.
 */
export interface ConditionKindPolicy {
	/** Whether the condition declaration must include labelled values. */
	requiresValues: boolean;
	/** Whether this kind may appear in a pack or condition `when` matcher. */
	allowsInWhen: boolean;
	/**
	 * Validate a `when` value against this kind's rules.
	 * @param value - Matcher value from a pack or condition `when` map.
	 * @param declaredValues - Declared select/multiselect values when present.
	 * @throws Error description fragment when the value is invalid for this kind.
	 */
	assertWhenValue: (
		value: RegistryWhenValue,
		declaredValues: ConditionValueOption[] | undefined,
	) => void;
	/**
	 * Seed a context entry from a pinned-pack `when` value.
	 * @param context - Context being mutated.
	 * @param key - Condition key.
	 * @param value - `when` match value.
	 */
	seedContext: (
		context: RegistryContext,
		key: string,
		value: RegistryWhenValue,
	) => void;
	/**
	 * Typed context value for a handler-inferred default.
	 * @param inferred - Raw value returned by a condition handler.
	 * @param values - Prompt options for select/multiselect kinds.
	 * @returns Typed context value when valid, otherwise undefined.
	 */
	inferredContextValue: (
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
	value: RegistryWhenValue,
	declaredValues: ConditionValueOption[] | undefined,
): void {
	const values = Array.isArray(value) ? value : [value];
	if (values.some((entry) => typeof entry !== "string"))
		throw new Error(`unexpected:${String(value)}`);
	for (const entry of values)
		if (!declaredValues?.some((option) => option.value === entry))
			throw new Error(`undeclared:${entry}`);
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
			if (typeof value === "string") context[key] = value;
		},
		inferredContextValue: (inferred, values) => {
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
			let seeded: string[] = [];
			if (Array.isArray(value))
				seeded = value.filter(
					(entry): entry is string => typeof entry === "string",
				);
			else if (typeof value === "string") seeded = [value];
			if (seeded.length === 0) return;
			const existing = context[key];
			if (!Array.isArray(existing)) {
				context[key] = seeded;
				return;
			}
			for (const entry of seeded)
				if (!existing.includes(entry)) existing.push(entry);
		},
		inferredContextValue: (inferred, values) => {
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
			if (typeof value === "boolean") return;
			throw new Error(`boolean:${String(value)}`);
		},
		seedContext: (context, key, value) => {
			if (typeof value === "boolean") context[key] = value;
		},
		inferredContextValue: (inferred) => {
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
			if (typeof value === "string") context[key] = value;
		},
		inferredContextValue: (inferred) => {
			if (typeof inferred !== "string") return undefined;
			if (inferred === "") return undefined;
			return inferred;
		},
	},
};

/**
 * Return the policy for a condition kind, defaulting to select.
 * @param kind - Declared kind, or undefined when omitted.
 * @returns Policy for the effective kind.
 */
export function policyForConditionKind(
	kind: RegistryConditionKind | undefined,
): ConditionKindPolicy & { kind: RegistryConditionKind } {
	const effectiveKind = kind ?? RegistryConditionKind.SELECT;
	return { kind: effectiveKind, ...conditionKindPolicy[effectiveKind] };
}
