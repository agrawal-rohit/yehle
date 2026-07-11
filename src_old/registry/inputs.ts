import type { ResolveInputFn } from "./install";
import { resolveRegistryInputs } from "./install";
import type { RegistryIndex, ResolvedRegistryItem } from "./resolver";
import {
	collectRegistryInputs,
	normalizeRegistryDependency,
	resolveRegistryPlan,
} from "./resolver";
import {
	INSTRUCTION_ITEM_TYPES,
	itemHasFrameworkTarget,
	type RegistryInput,
	RegistryInputType,
	type RegistryInstallContext,
	type RegistryItem,
	RegistryVisibility,
} from "./schema";

/** Context keys resolved before the dependency plan is expanded. */
const CONTEXT_CONTROL_INPUT_NAMES = new Set([
	"public",
	"includeInstructions",
	"instructionsIdeFormat",
	"framework",
]);

/** Legacy CLI option keys mapped to install context keys. */
const CLI_OPTION_ALIASES: Record<string, string> = {
	ideFormat: "instructionsIdeFormat",
};

/**
 * Convert a camelCase registry input name to a kebab-case CLI flag segment.
 * @param name - Registry input name.
 * @returns Kebab-case flag segment.
 */
export function registryInputNameToKebab(name: string): string {
	return name.replaceAll(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/**
 * Map a declared registry input to a CAC CLI flag and description.
 * @param input - Declared registry input.
 * @returns CLI flag string and help description.
 */
export function registryInputToCliFlag(input: RegistryInput): {
	flag: string;
	description: string;
} {
	const kebab = registryInputNameToKebab(input.name);

	switch (input.type) {
		case RegistryInputType.BOOLEAN:
			return { flag: `--${kebab}`, description: input.prompt };
		case RegistryInputType.STRING:
			return { flag: `--${kebab} <${kebab}>`, description: input.prompt };
		case RegistryInputType.SELECT:
			return {
				flag: `--${kebab} <${kebab}>`,
				description: input.prompt,
			};
		default: {
			const _exhaustive: never = input.type;
			throw new Error(
				`Unsupported registry input type: ${String(_exhaustive)}`,
			);
		}
	}
}

/**
 * Deduplicate registry inputs by name, keeping the first declaration.
 * @param inputs - Input declarations in priority order.
 * @returns Deduplicated inputs.
 */
function dedupeRegistryInputs(inputs: RegistryInput[]): RegistryInput[] {
	const seen = new Set<string>();
	const result: RegistryInput[] = [];

	for (const input of inputs) {
		if (seen.has(input.name)) continue;
		seen.add(input.name);
		result.push(input);
	}

	return result;
}

/**
 * Walk root items and all registry dependencies, ignoring `when` conditions.
 * Over-approximates the install plan so CLI flags cover every input that might
 * be needed once context-control values are known.
 * @param rootItemNames - Selected root registry item ids.
 * @param index - Registry index keyed by item id.
 * @returns Plan items in visit order (unknown roots are skipped).
 */
export function resolvePermissivePlan(
	rootItemNames: string[],
	index: RegistryIndex,
): RegistryItem[] {
	const seen = new Set<string>();
	const items: RegistryItem[] = [];

	const visit = (name: string): void => {
		if (seen.has(name)) return;
		seen.add(name);

		const item = index.get(name);
		if (!item) return;

		items.push(item);
		for (const dependency of item.registryDependencies ?? []) {
			visit(normalizeRegistryDependency(dependency).ref.id);
		}
		for (const variant of item.variants) {
			for (const dependency of variant.registryDependencies ?? []) {
				visit(normalizeRegistryDependency(dependency).ref.id);
			}
		}
	};

	for (const rootName of rootItemNames) visit(rootName);
	return items;
}

/**
 * Collect registry input declarations relevant to a known selection of roots.
 * @param rootItemNames - Selected root registry item ids.
 * @param index - Registry index keyed by item id.
 * @param commandInputs - Optional command-scoped inputs from registry.json.
 * @returns Deduplicated inputs for flag generation and parsing.
 */
export function collectInputsForSelection(
	rootItemNames: string[],
	index: RegistryIndex,
	commandInputs?: RegistryInput[],
): RegistryInput[] {
	const validRoots = rootItemNames.filter((name) => index.has(name));
	if (validRoots.length === 0) return [];

	const planItems = resolvePermissivePlan(validRoots, index);
	const relevantCommandInputs = (commandInputs ?? []).filter((input) => {
		if (CONTEXT_CONTROL_INPUT_NAMES.has(input.name))
			return planNeedsInput(planItems, input.name);
		return true;
	});

	return dedupeRegistryInputs([
		...relevantCommandInputs,
		...collectRegistryInputs(planItems.map((item) => ({ item, variant: item.variants[0] }))),
	]);
}

/**
 * Coerce a CLI option value to the type expected by a declared registry input.
 * @param input - Declared registry input.
 * @param rawValue - Raw CLI option value.
 * @returns Coerced context value.
 */
function coerceCliValue(
	input: RegistryInput | undefined,
	rawValue: unknown,
): string | boolean | undefined {
	if (rawValue === undefined || rawValue === null) return undefined;

	if (input?.type === RegistryInputType.BOOLEAN) {
		if (typeof rawValue === "boolean") return rawValue;
		if (rawValue === "true") return true;
		if (rawValue === "false") return false;
		return Boolean(rawValue);
	}

	if (typeof rawValue === "string") return rawValue;
	if (typeof rawValue === "boolean") return rawValue;
	return String(rawValue);
}

/**
 * Parse CAC named options into install context values for declared inputs.
 * @param options - Raw CAC options object.
 * @param declaredInputs - Declared inputs for the selected registry items.
 * @returns Partial install context from CLI flags.
 */
export function parseCliInputValues(
	options: Record<string, unknown>,
	declaredInputs: RegistryInput[],
): Partial<RegistryInstallContext> {
	const inputsByName = new Map(
		declaredInputs.map((input) => [input.name, input]),
	);
	const values: Partial<RegistryInstallContext> = {};

	for (const [alias, target] of Object.entries(CLI_OPTION_ALIASES)) {
		const coerced = coerceCliValue(inputsByName.get(target), options[alias]);
		if (coerced !== undefined) values[target] = coerced;
	}

	for (const input of declaredInputs) {
		const coerced = coerceCliValue(input, options[input.name]);
		if (coerced !== undefined) values[input.name] = coerced;
	}

	return values;
}

/**
 * Whether a resolved plan depends on a given install-context key.
 * @param planItems - Registry items in a (permissive or resolved) plan.
 * @param inputName - Context key to inspect.
 * @returns True when the key affects install output.
 */
export function planNeedsInput(
	planItems: RegistryItem[],
	inputName: string,
): boolean {
	if (inputName === "public") {
		return planItems.some(
			(item) =>
				item.variants.some((variant) =>
					variant.files.some(
						(file) =>
							Boolean(file.template) ||
							(file.visibility !== undefined &&
								file.visibility !== RegistryVisibility.ALWAYS),
					),
				) ||
				(item.inputs ?? []).some((input) => input.when?.includes("public")) ||
				(item.registryDependencies ?? []).some((dependency) =>
					normalizeRegistryDependency(dependency).when?.includes("public"),
				) ||
				item.variants.some((variant) =>
					(variant.registryDependencies ?? []).some((dependency) =>
						normalizeRegistryDependency(dependency).when?.includes("public"),
					),
				) ||
				(item.transforms ?? []).some((transform) =>
					transform.when?.includes("public"),
				),
		);
	}

	if (inputName === "includeInstructions") {
		return planItems.some(
			(item) =>
				INSTRUCTION_ITEM_TYPES.has(item.type) ||
				(item.registryDependencies ?? []).some((dependency) =>
					normalizeRegistryDependency(dependency).when?.includes(
						"includeInstructions",
					),
				) ||
				item.variants.some((variant) =>
					(variant.registryDependencies ?? []).some((dependency) =>
						normalizeRegistryDependency(dependency).when?.includes(
							"includeInstructions",
						),
					),
				),
		);
	}

	if (inputName === "instructionsIdeFormat") {
		return planItems.some((item) => INSTRUCTION_ITEM_TYPES.has(item.type));
	}

	if (inputName === "framework") {
		return planItems.some(
			(item) =>
				itemHasFrameworkTarget(item) ||
				(item.registryDependencies ?? []).some((dependency) =>
					normalizeRegistryDependency(dependency).when?.startsWith(
						"framework:",
					),
				) ||
				item.variants.some((variant) =>
					(variant.registryDependencies ?? []).some((dependency) =>
						normalizeRegistryDependency(dependency).when?.startsWith(
							"framework:",
						),
					),
				),
		);
	}

	return false;
}

/**
 * Collect context-control inputs from root items and shared command inputs.
 * @param rootItemNames - Selected root registry item ids.
 * @param index - Registry index.
 * @param commandInputs - Optional command-scoped inputs.
 * @returns Context-control input declarations.
 */
function collectContextControlInputs(
	rootItemNames: string[],
	index: RegistryIndex,
	commandInputs: RegistryInput[] | undefined,
): RegistryInput[] {
	const collected: RegistryInput[] = [];

	if (commandInputs) collected.push(...commandInputs);

	for (const itemName of rootItemNames) {
		const item = index.get(itemName);
		for (const input of item?.inputs ?? []) {
			if (CONTEXT_CONTROL_INPUT_NAMES.has(input.name)) collected.push(input);
		}
	}

	return dedupeRegistryInputs(collected);
}

/**
 * Filter context-control inputs to those relevant for the resolved plan.
 * @param inputs - Candidate context-control inputs.
 * @param planItems - Provisional resolved plan items.
 * @param cliValues - CLI-provided values (skip prompting when present).
 * @returns Inputs that should be resolved in phase one.
 */
function filterRelevantContextInputs(
	inputs: RegistryInput[],
	planItems: RegistryItem[],
	cliValues: Partial<RegistryInstallContext>,
): RegistryInput[] {
	return inputs.filter((input) => {
		if (cliValues[input.name] !== undefined) return false;
		if (CONTEXT_CONTROL_INPUT_NAMES.has(input.name))
			return planNeedsInput(planItems, input.name);
		return true;
	});
}

/**
 * Resolve a flattened install plan across one or more root registry items.
 * @param rootItemNames - Root item ids (optionally `id@variant`).
 * @param index - Registry index.
 * @param context - Install context used for conditional dependencies.
 * @returns Ordered resolved plan items.
 */
function resolvePlanForRoots(
	rootItemNames: string[],
	index: RegistryIndex,
	context: RegistryInstallContext,
): ResolvedRegistryItem[] {
	const planItems: ResolvedRegistryItem[] = [];
	const seen = new Set<string>();

	for (const itemName of rootItemNames) {
		for (const resolved of resolveRegistryPlan(itemName, index, context)
			.items) {
			if (seen.has(resolved.item.id)) continue;
			seen.add(resolved.item.id);
			planItems.push(resolved);
		}
	}

	return planItems;
}

/**
 * Apply add-command defaults before prompting (e.g. direct instruction items).
 * @param rootItemNames - Selected root registry item ids.
 * @param index - Registry index.
 * @param context - Install context mutated in place.
 * @param cliValues - CLI-provided values.
 */
function applyAddCommandDefaults(
	rootItemNames: string[],
	index: RegistryIndex,
	context: RegistryInstallContext,
	cliValues: Partial<RegistryInstallContext>,
): void {
	const addsInstructionItemsDirectly = rootItemNames.some((itemName) => {
		const id = itemName.includes("@") ? itemName.split("@")[0] : itemName;
		const item = index.get(id);
		return item ? INSTRUCTION_ITEM_TYPES.has(item.type) : false;
	});

	if (
		addsInstructionItemsDirectly &&
		cliValues.includeInstructions === undefined
	)
		context.includeInstructions = true;
}

export type ResolveInstallContextParams = {
	rootItemNames: string[];
	index: RegistryIndex;
	commandInputs?: RegistryInput[];
	cliValues?: Partial<RegistryInstallContext>;
	resolveInput: ResolveInputFn;
	lang?: string;
	command?: "create" | "add";
};

/**
 * Resolve install context via registry-declared inputs in two phases:
 * context-control inputs first, then dependency plan inputs.
 * @param params - Root items, registry index, CLI values, and input resolver.
 * @returns Fully resolved install context.
 */
export async function resolveInstallContext(
	params: ResolveInstallContextParams,
): Promise<RegistryInstallContext> {
	const cliValues = params.cliValues ?? {};
	// Required fields stay unset until prompts / trailing defaults fill them in.
	const context = { ...cliValues } as RegistryInstallContext;

	if (params.lang) context.lang = params.lang;
	if (params.command === "add")
		applyAddCommandDefaults(
			params.rootItemNames,
			params.index,
			context,
			cliValues,
		);

	const provisionalResolved = resolvePlanForRoots(
		params.rootItemNames,
		params.index,
		{
			...context,
			public: Boolean(context.public),
			includeInstructions: Boolean(context.includeInstructions),
		},
	);
	const provisionalPlan = provisionalResolved.map(({ item }) => item);

	const contextControlInputs = filterRelevantContextInputs(
		collectContextControlInputs(
			params.rootItemNames,
			params.index,
			params.commandInputs,
		),
		provisionalPlan,
		cliValues,
	);

	await resolveRegistryInputs(
		contextControlInputs,
		context,
		params.resolveInput,
	);

	const resolvedPlan = resolvePlanForRoots(params.rootItemNames, params.index, {
		...context,
		public: Boolean(context.public),
		includeInstructions: Boolean(context.includeInstructions),
	});

	await resolveRegistryInputs(
		collectRegistryInputs(resolvedPlan),
		context,
		params.resolveInput,
	);

	context.public ??= false;
	context.includeInstructions ??= false;

	return context;
}
