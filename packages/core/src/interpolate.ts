import Mustache, { type TemplateSpans } from "mustache";
import type { RegistryContext } from "./condition-kind";
import {
	PACKAGE_MANAGER_KEY,
	packageManagerBindings,
	type RegistryPackageManager,
	reservedInterpolationKeys,
} from "./packages";
import {
	type CompiledItem,
	type RegistryConditionValue,
	RegistryEcosystem,
} from "./schema";

/** Replaces `${{` so Mustache does not treat GitHub Actions expressions as tags. */
const GITHUB_ACTIONS_SENTINEL = "\uE000GHA\uE000";

/** Mustache tag types that are ignored by `assertKnownMustacheTags`. */
const IGNORED_TAG_TYPES = new Set(["text", "!", "="]);
const NAME_TAG_TYPES = new Set(["name", "&", "{"]);

/** Render options: do not HTML-escape YAML, shell, or source files. */
const MUSTACHE_RENDER_OPTIONS = {
	escape: String,
} as const;

/** Typed Mustache view: conditions keep their runtime types; bindings are strings. */
export type InterpolationView = Record<
	string,
	string | string[] | boolean | undefined
>;

/** Inputs for the install interpolation view. Later layers cannot overwrite reserved or condition keys. */
export interface InterpolationContextInput {
	/** Captured condition context. */
	conditions: RegistryContext;
	/** Select options keyed by condition name (shared + item-local). */
	optionValues?: Record<string, RegistryConditionValue[]>;
	/** Bindings from beforeWrite hooks (extra keys only). */
	hookBindings?: Record<string, string>;
	/** Selected package manager, when the install uses an ecosystem. */
	packageManager?: RegistryPackageManager;
	/** Ecosystem for `packageManager`. Required when a manager is set. */
	ecosystem?: RegistryEcosystem;
}

/**
 * Build a typed Mustache view from conditions, option bindings, package-manager bindings, and hook bindings.
 * @param input - View layers for this install.
 * @returns View used for `{{key}}` and Mustache sections.
 * @throws Error when a manager is set without an ecosystem, or option/hook bindings collide with a condition or reserved key.
 */
export function buildInterpolationContext(
	input: InterpolationContextInput,
): InterpolationView {
	const optionValues = input.optionValues ?? {};
	const hookBindings = input.hookBindings ?? {};
	const reservedKeys = new Set(
		reservedInterpolationKeys(input.ecosystem ?? RegistryEcosystem.NPM),
	);
	const conditionKeys = new Set([
		...Object.keys(input.conditions),
		...Object.keys(optionValues),
	]);
	const values: InterpolationView = {};

	for (const [key, value] of Object.entries(input.conditions)) {
		if (value === undefined) continue;
		values[key] = value;

		if (typeof value === "string") {
			const optionBindings = optionValues[key]?.find(
				(entry) => entry.value === value,
			)?.bindings;
			if (!optionBindings) continue;
			assertFreeBindingKeys(
				optionBindings,
				conditionKeys,
				reservedKeys,
				"Select option",
			);
			Object.assign(values, optionBindings);
		}
	}

	if (input.packageManager !== undefined) {
		if (input.ecosystem === undefined)
			throw new Error(
				"buildInterpolationContext requires ecosystem when packageManager is set.",
			);
		values[PACKAGE_MANAGER_KEY] = input.packageManager;
		Object.assign(
			values,
			packageManagerBindings(input.ecosystem, input.packageManager),
		);
	}

	assertFreeBindingKeys(
		hookBindings,
		conditionKeys,
		reservedKeys,
		"beforeWrite hook",
	);
	Object.assign(values, hookBindings);

	return values;
}

/**
 * Throw when binding keys collide with condition names or reserved interpolation keys.
 * @param bindings - Option or hook bindings to apply.
 * @param conditionKeys - Condition names in this install (captured or declared).
 * @param reservedKeys - `packageManager` and `pm*` keys.
 * @param source - Binding origin for the error message.
 */
function assertFreeBindingKeys(
	bindings: Record<string, string>,
	conditionKeys: Set<string>,
	reservedKeys: ReadonlySet<string>,
	source: "Select option" | "beforeWrite hook",
): void {
	for (const key of Object.keys(bindings)) {
		if (reservedKeys.has(key))
			throw new Error(`${source} binding "${key}" is reserved.`);
		if (conditionKeys.has(key))
			throw new Error(
				`${source} binding "${key}" collides with a condition key.`,
			);
	}
}

/**
 * Throw when a Mustache name tag is not in the view.
 * `{{.}}` is valid only inside a section. Absent keys are allowed as `{{#key}}` / `{{^key}}` sections.
 * @param name - Tag name from the parse tree.
 * @param values - Interpolation view.
 * @param inSection - Whether this tag is nested in a section.
 * @param subject - File or command label for the error.
 */
function assertKnownNameTag(
	name: string,
	values: InterpolationView,
	inSection: boolean,
	subject: string,
): void {
	if (name === ".") {
		if (!inSection)
			throw new Error(`Unknown interpolation key "." in ${subject}.`);
		return;
	}
	if (!Object.hasOwn(values, name) || values[name] === undefined)
		throw new Error(`Unknown interpolation key "${name}" in ${subject}.`);
}

/**
 * Walk a Mustache parse tree and reject unknown name tags and partials.
 * @param tokens - Tokens from `Mustache.parse`.
 * @param values - Interpolation view.
 * @param inSection - Whether these tokens are nested in a section.
 * @param subject - File or command label for the error.
 * @throws Error when a token names a missing key or partial.
 */
function assertKnownMustacheTags(
	tokens: TemplateSpans,
	values: InterpolationView,
	inSection: boolean,
	subject: string,
): void {
	for (const token of tokens) {
		const type: string = token[0];
		const name = token[1];
		if (IGNORED_TAG_TYPES.has(type)) continue;

		if (NAME_TAG_TYPES.has(type)) {
			assertKnownNameTag(name, values, inSection, subject);
			continue;
		}

		if (type === "#" || type === "^") {
			const children = token[4];
			if (Array.isArray(children))
				assertKnownMustacheTags(
					children as TemplateSpans,
					values,
					true,
					subject,
				);
			continue;
		}

		if (type === ">")
			throw new Error(`Unknown interpolation partial "${name}" in ${subject}.`);

		throw new Error(
			`Unhandled Mustache tag type "${String(type)}" in ${subject}.`,
		);
	}
}

/**
 * Render a Mustache template with a typed interpolation view.
 * @param input - Template string.
 * @param values - Interpolation view.
 * @param subject - File or command label for unknown-key errors.
 * @returns Resolved string.
 * @throws Error when the template names a missing key or partial.
 */
function interpolateString(
	input: string,
	values: InterpolationView,
	subject: string,
): string {
	const template = input.replaceAll("${{", GITHUB_ACTIONS_SENTINEL);
	assertKnownMustacheTags(Mustache.parse(template), values, false, subject);
	return Mustache.render(
		template,
		values,
		undefined,
		MUSTACHE_RENDER_OPTIONS,
	).replaceAll(GITHUB_ACTIONS_SENTINEL, "${{");
}

/**
 * Replace `{{key}}` placeholders in compiled item file contents and command values.
 * Targets, package names, and secrets are left literal.
 * @param compiledItem - Compiled item to interpolate.
 * @param values - Interpolation view.
 * @returns Payload with placeholders resolved.
 * @throws Error when a file or command template names a missing key.
 */
export function interpolateCompiledItem(
	compiledItem: CompiledItem,
	values: InterpolationView,
): CompiledItem {
	const files = compiledItem.files.map((file) => ({
		...file,
		content: interpolateString(file.content, values, `file "${file.target}"`),
	}));

	let commands = compiledItem.commands;
	if (commands) {
		const nextCommands: NonNullable<CompiledItem["commands"]> = {};
		for (const [ecosystem, set] of Object.entries(commands)) {
			if (!set) continue;
			const nextSet: Record<string, string> = {};
			for (const [name, value] of Object.entries(set))
				nextSet[name] = interpolateString(
					value,
					values,
					`command "${ecosystem}.${name}"`,
				);
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
