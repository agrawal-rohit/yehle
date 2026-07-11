/**
 * Registry item types. Install behaviour is derived from the type:
 * - agent-instruction / agent-skill / subagent are routed through the IDE output adapter;
 * - template drives `tuckshop create` (full project scaffold);
 * - everything else is a file-writing item installable via `tuckshop add`.
 */
export enum RegistryItemType {
	/** Full project scaffold installed via `tuckshop create`. */
	TEMPLATE = "template",
	/** UI component (with optional helpers). */
	COMPONENT = "component",
	/** UI theme or colour scheme. */
	THEME = "theme",
	/** Composed UI block or pre-implemented feature kit. */
	BLOCK = "block",
	/** Project convention (hooks, build/release, Dependabot, CoC, mutation testing, …). */
	CONVENTION = "convention",
	/** Agent rule/instruction. */
	AGENT_INSTRUCTION = "agent-instruction",
	/** Agent skill (multi-step workflow). */
	AGENT_SKILL = "agent-skill",
	/** Agent subagent definition. */
	SUBAGENT = "subagent",
}

/** Item types routed through the IDE instruction output adapter. */
export const INSTRUCTION_ITEM_TYPES = new Set<RegistryItemType>([
	RegistryItemType.AGENT_INSTRUCTION,
	RegistryItemType.AGENT_SKILL,
	RegistryItemType.SUBAGENT,
]);

/** Visibility gate for files and dependency edges. */
export enum RegistryVisibility {
	ALWAYS = "always",
	PUBLIC = "public",
	PRIVATE = "private",
}

/** Supported declarative transform operations applied after install. */
export enum RegistryTransformOp {
	STRIP_JSON_KEY = "stripJsonKey",
}

/** Value kinds for a declared registry input. */
export enum RegistryInputType {
	STRING = "string",
	BOOLEAN = "boolean",
	SELECT = "select",
}

/** Built-in option sources for `select` inputs resolved at prompt/CLI time. */
export enum RegistryInputOptionsFrom {
	IDE_FORMATS = "ideFormats",
}

/** A selectable option for a `select` input. */
export type RegistryInputOption = {
	label: string;
	value: string;
};

/**
 * A declared input required to render an item's mustache files or evaluate its
 * conditions. Commands prompt for these when installing (unless already provided
 * via flags or a parent flow), then feed the values into the install context.
 */
export type RegistryInput = {
	/** Context key the value is stored under (referenced by `{{ name }}` etc.). */
	name: string;
	type: RegistryInputType;
	/** Question shown to the user when prompting. */
	prompt: string;
	default?: string | boolean;
	required?: boolean;
	/** Options for `select` inputs. */
	options?: RegistryInputOption[];
	/** Resolve select options from a built-in source instead of `options`. */
	optionsFrom?: RegistryInputOptionsFrom;
	/** Only prompt when this condition passes (e.g. "public"). */
	when?: string;
};

/** Command-scoped inputs merged into registry.json at build time. */
export type RegistryCommandInputs = {
	create?: RegistryInput[];
	add?: RegistryInput[];
};

/**
 * Optional target facets for a variant. Omitted facets mean the variant is
 * agnostic on that axis (e.g. a CSS theme with no language/framework).
 */
export type RegistryTargets = {
	language?: string;
	framework?: string;
	tool?: string;
	/** Package ecosystem (npm, pypi, cargo, …) for build/release conventions. */
	ecosystem?: string;
};

/** A registry dependency by id (optionally `id@variant`) or with a condition. */
export type RegistryDependency =
	| string
	| {
			name: string;
			when?: string;
	  };

/** Parsed dependency reference (`button` or `button@react`). */
export type RegistryDependencyRef = {
	id: string;
	variantId?: string;
};

/** File entry in a registry manifest (source path relative to the item folder). */
export type RegistryFileManifest = {
	/** Source path relative to the item's own folder. */
	path: string;
	/** Destination path relative to the install target directory. */
	target: string;
	template?: boolean;
	visibility?: RegistryVisibility;
};

/** Declarative post-install transform. */
export type RegistryTransformManifest = {
	file: string;
	op: RegistryTransformOp;
	key?: string;
	when?: string;
};

/** Authoring / built variant payload (installable slice of an item). */
export type RegistryVariantManifest = {
	id: string;
	targets?: RegistryTargets;
	files?: RegistryFileManifest[];
	dependencies?: string[];
	devDependencies?: string[];
	registryDependencies?: RegistryDependency[];
};

/**
 * Authoring manifest colocated with its files as `registry-item.json`.
 * Single-variant sugar: top-level `files` / `targets` / npm deps stand in for
 * one `variants: [{ id: "default", ... }]`. Build normalizes to variants.
 */
export type RegistryItemManifest = {
	id: string;
	title: string;
	description: string;
	type: RegistryItemType;
	tags?: string[];
	/** Project shape for templates/conventions (app, package). */
	projectSpec?: string;
	/** Instruction basename for agent-instruction / agent-skill / subagent items. */
	instructionName?: string;
	/** Default visibility applied to auto-scanned files (defaults to always). */
	defaultVisibility?: RegistryVisibility;
	/** Inputs required to render this item's mustache files / evaluate conditions. */
	inputs?: RegistryInput[];
	/** Item-level composition deps (typical for templates). */
	registryDependencies?: RegistryDependency[];
	transforms?: RegistryTransformManifest[];
	variants?: RegistryVariantManifest[];
	/** Single-variant sugar fields (normalized away at build time). */
	targets?: RegistryTargets;
	files?: RegistryFileManifest[];
	dependencies?: string[];
	devDependencies?: string[];
};

/**
 * Built registry file: lean metadata only. Content is NOT inlined — it is
 * fetched at install time from `source` (a repo-relative path resolved against
 * the registry's content base URL, or read locally when running from source).
 */
export type RegistryFile = {
	/** Repo-relative path used to fetch the file content at install time. */
	source: string;
	/** Destination path relative to the install target directory. */
	target: string;
	template?: boolean;
	visibility?: RegistryVisibility;
};

/** Built variant with repo-relative file sources. */
export type RegistryVariant = {
	id: string;
	targets?: RegistryTargets;
	files: RegistryFile[];
	dependencies?: string[];
	devDependencies?: string[];
	registryDependencies?: RegistryDependency[];
};

/** Built registry item consumed by the resolver and installer (metadata only). */
export type RegistryItem = {
	id: string;
	title: string;
	description: string;
	type: RegistryItemType;
	tags?: string[];
	projectSpec?: string;
	instructionName?: string;
	inputs?: RegistryInput[];
	registryDependencies?: RegistryDependency[];
	transforms?: RegistryTransformManifest[];
	variants: RegistryVariant[];
};

/**
 * The compiled registry document written to registry.json at the repo root.
 * Holds lean metadata plus the base URL from which file content is fetched.
 */
export type RegistryDocument = {
	/** CLI/registry version the metadata was built for. */
	version: string;
	/** Base URL for fetching file content (`${contentBaseUrl}/${source}`). */
	contentBaseUrl: string;
	items: Record<string, RegistryItem>;
	/** Shared inputs for tuckshop create/add commands. */
	commandInputs?: RegistryCommandInputs;
};

/** Install-time context used for Mustache rendering and condition evaluation. */
export type RegistryInstallContext = {
	public: boolean;
	includeInstructions: boolean;
	framework?: string;
	lang?: string;
	tool?: string;
	ecosystem?: string;
	packageManagerVersion?: string;
	templateHasPlayground?: boolean;
	authorName?: string;
	instructionsIdeFormat?: string;
	[key: string]: unknown;
};

/**
 * Keep only the string entries of an unknown array.
 * @param value - Raw array value.
 * @returns Array of strings.
 */
function toStringArray(value: unknown[]): string[] {
	return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Parse a dependency reference string into item id and optional variant pin.
 * @param ref - `id` or `id@variantId`.
 * @returns Parsed dependency reference.
 * @throws Error when the reference is empty or malformed.
 */
export function parseRegistryDependencyRef(ref: string): RegistryDependencyRef {
	if (ref.length === 0)
		throw new Error("Registry dependency reference must be non-empty.");

	const separatorIndex = ref.indexOf("@");
	if (separatorIndex === -1) return { id: ref };
	if (separatorIndex === 0 || separatorIndex === ref.length - 1)
		throw new Error(
			`Invalid registry dependency reference "${ref}" (expected id or id@variant).`,
		);

	return {
		id: ref.slice(0, separatorIndex),
		variantId: ref.slice(separatorIndex + 1),
	};
}

/**
 * Parse optional target facets from raw JSON.
 * @param raw - Raw targets object.
 * @param label - Context label for error messages.
 * @returns Validated targets, or undefined when absent.
 * @throws Error when a present facet is not a non-empty string.
 */
export function parseRegistryTargets(
	raw: unknown,
	label: string,
): RegistryTargets | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "object" || Array.isArray(raw))
		throw new Error(`${label} targets must be a JSON object.`);

	const source = raw as Record<string, unknown>;
	const targets: RegistryTargets = {};
	for (const key of ["language", "framework", "tool", "ecosystem"] as const) {
		const value = source[key];
		if (value === undefined) continue;
		if (typeof value !== "string" || value.length === 0)
			throw new Error(`${label} targets.${key} must be a non-empty string.`);
		targets[key] = value;
	}
	return Object.keys(targets).length > 0 ? targets : {};
}

/**
 * Parse and validate a single declared input from a manifest.
 * @param raw - Raw input object.
 * @param itemId - Owning item id (for error messages).
 * @returns Validated registry input.
 * @throws Error when the input is missing required fields or has an invalid type.
 */
export function parseRegistryInput(raw: unknown, itemId: string): RegistryInput {
	const input = raw as Record<string, unknown>;

	if (typeof input.name !== "string" || input.name.length === 0)
		throw new Error(`Registry item "${itemId}" has an input without a name.`);
	if (
		typeof input.type !== "string" ||
		!Object.values(RegistryInputType).includes(input.type as RegistryInputType)
	)
		throw new Error(
			`Registry input "${input.name}" in "${itemId}" has invalid type "${String(input.type)}".`,
		);
	if (typeof input.prompt !== "string" || input.prompt.length === 0)
		throw new Error(
			`Registry input "${input.name}" in "${itemId}" requires a prompt.`,
		);

	const parsed: RegistryInput = {
		name: input.name,
		type: input.type as RegistryInputType,
		prompt: input.prompt,
	};
	if (input.default !== undefined)
		parsed.default = input.default as string | boolean;
	if (typeof input.required === "boolean") parsed.required = input.required;
	if (Array.isArray(input.options))
		parsed.options = input.options as RegistryInputOption[];
	if (typeof input.optionsFrom === "string") {
		if (
			!Object.values(RegistryInputOptionsFrom).includes(
				input.optionsFrom as RegistryInputOptionsFrom,
			)
		)
			throw new Error(
				`Registry input "${input.name}" in "${itemId}" has invalid optionsFrom "${String(input.optionsFrom)}".`,
			);
		parsed.optionsFrom = input.optionsFrom as RegistryInputOptionsFrom;
	}
	if (typeof input.when === "string") parsed.when = input.when;
	return parsed;
}

/**
 * Parse command-scoped registry inputs from JSON.
 * @param raw - Raw commandInputs object from registry.json.
 * @returns Validated command input groups.
 * @throws Error when any input is invalid.
 */
export function parseRegistryCommandInputs(
	raw: unknown,
): RegistryCommandInputs | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "object")
		throw new Error("Registry commandInputs must be a JSON object.");

	const source = raw as Record<string, unknown>;
	const parsed: RegistryCommandInputs = {};

	if (Array.isArray(source.create))
		parsed.create = source.create.map((entry) =>
			parseRegistryInput(entry, "commandInputs.create"),
		);
	if (Array.isArray(source.add))
		parsed.add = source.add.map((entry) =>
			parseRegistryInput(entry, "commandInputs.add"),
		);

	return parsed;
}

/**
 * Validate command input declarations before they are written to registry.json.
 * @param commandInputs - Command input groups to validate.
 * @returns The same command inputs after validation.
 * @throws Error when a command declares duplicate input names.
 */
export function validateRegistryCommandInputs(
	commandInputs: RegistryCommandInputs,
): RegistryCommandInputs {
	for (const [command, inputs] of Object.entries(commandInputs)) {
		const seen = new Set<string>();
		for (const input of inputs ?? []) {
			if (seen.has(input.name))
				throw new Error(
					`Duplicate command input "${input.name}" in commandInputs.${command}.`,
				);
			seen.add(input.name);
		}
	}
	return commandInputs;
}

/**
 * Parse a single variant from a manifest.
 * @param raw - Raw variant object.
 * @param itemId - Owning item id.
 * @returns Validated variant manifest.
 * @throws Error when required fields are missing.
 */
function parseRegistryVariantManifest(
	raw: unknown,
	itemId: string,
): RegistryVariantManifest {
	if (!raw || typeof raw !== "object")
		throw new Error(`Registry item "${itemId}" has an invalid variant entry.`);

	const source = raw as Record<string, unknown>;
	if (typeof source.id !== "string" || source.id.length === 0)
		throw new Error(`Registry item "${itemId}" has a variant without an id.`);

	const variant: RegistryVariantManifest = { id: source.id };
	const targets = parseRegistryTargets(
		source.targets,
		`Registry item "${itemId}" variant "${source.id}"`,
	);
	if (targets) variant.targets = targets;
	if (Array.isArray(source.files))
		variant.files = source.files as RegistryFileManifest[];
	if (Array.isArray(source.dependencies))
		variant.dependencies = toStringArray(source.dependencies);
	if (Array.isArray(source.devDependencies))
		variant.devDependencies = toStringArray(source.devDependencies);
	if (Array.isArray(source.registryDependencies))
		variant.registryDependencies =
			source.registryDependencies as RegistryDependency[];
	return variant;
}

/**
 * Normalize single-variant sugar into an explicit variants array.
 * @param manifest - Parsed authoring fields before normalization.
 * @returns Variants to use for the item.
 * @throws Error when both sugar and variants are declared, or neither provides files.
 */
export function normalizeRegistryVariants(
	manifest: Pick<
		RegistryItemManifest,
		| "id"
		| "variants"
		| "files"
		| "targets"
		| "dependencies"
		| "devDependencies"
	>,
): RegistryVariantManifest[] {
	const hasSugar =
		manifest.files !== undefined ||
		manifest.targets !== undefined ||
		manifest.dependencies !== undefined ||
		manifest.devDependencies !== undefined;

	if (manifest.variants && hasSugar)
		throw new Error(
			`Registry item "${manifest.id}" cannot declare both variants and top-level files/targets/dependencies.`,
		);

	if (manifest.variants) {
		if (manifest.variants.length === 0)
			throw new Error(`Registry item "${manifest.id}" has an empty variants array.`);
		return manifest.variants;
	}

	return [
		{
			id: "default",
			...(manifest.targets ? { targets: manifest.targets } : {}),
			...(manifest.files ? { files: manifest.files } : {}),
			...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
			...(manifest.devDependencies
				? { devDependencies: manifest.devDependencies }
				: {}),
		},
	];
}

/**
 * Parse a registry item manifest from unknown JSON and validate required fields.
 * @param data - Raw parsed JSON.
 * @returns Validated registry item manifest (variants normalized).
 * @throws Error when required fields are missing or invalid.
 */
export function parseRegistryItemManifest(data: unknown): RegistryItemManifest {
	if (!data || typeof data !== "object")
		throw new Error("Registry manifest must be a JSON object.");

	const manifest = data as Record<string, unknown>;
	const id = manifest.id;
	if (typeof id !== "string" || id.length === 0)
		throw new Error("Registry manifest requires a non-empty `id`.");

	const title = manifest.title;
	if (typeof title !== "string" || title.length === 0)
		throw new Error(`Registry item "${id}" requires a non-empty \`title\`.`);

	const description = manifest.description;
	if (typeof description !== "string" || description.length === 0)
		throw new Error(
			`Registry item "${id}" requires a non-empty \`description\`.`,
		);

	const type = manifest.type;
	if (
		typeof type !== "string" ||
		!Object.values(RegistryItemType).includes(type as RegistryItemType)
	)
		throw new Error(
			`Registry item "${id}" has invalid type "${String(type)}".`,
		);

	const parsed: RegistryItemManifest = {
		id,
		title,
		description,
		type: type as RegistryItemType,
	};

	if (Array.isArray(manifest.tags))
		parsed.tags = toStringArray(manifest.tags);

	if (typeof manifest.projectSpec === "string")
		parsed.projectSpec = manifest.projectSpec;
	if (typeof manifest.instructionName === "string")
		parsed.instructionName = manifest.instructionName;

	if (
		INSTRUCTION_ITEM_TYPES.has(parsed.type) &&
		(!parsed.instructionName || parsed.instructionName.length === 0)
	)
		throw new Error(
			`Registry item "${id}" of type "${parsed.type}" requires instructionName.`,
		);

	if (
		typeof manifest.defaultVisibility === "string" &&
		Object.values(RegistryVisibility).includes(
			manifest.defaultVisibility as RegistryVisibility,
		)
	)
		parsed.defaultVisibility = manifest.defaultVisibility as RegistryVisibility;

	if (Array.isArray(manifest.inputs))
		parsed.inputs = manifest.inputs.map((raw) => parseRegistryInput(raw, id));

	if (Array.isArray(manifest.registryDependencies))
		parsed.registryDependencies =
			manifest.registryDependencies as RegistryDependency[];

	if (Array.isArray(manifest.transforms))
		parsed.transforms = manifest.transforms as RegistryTransformManifest[];

	if (Array.isArray(manifest.variants))
		parsed.variants = manifest.variants.map((raw) =>
			parseRegistryVariantManifest(raw, id),
		);

	const targets = parseRegistryTargets(
		manifest.targets,
		`Registry item "${id}"`,
	);
	if (targets) parsed.targets = targets;
	if (Array.isArray(manifest.files))
		parsed.files = manifest.files as RegistryFileManifest[];
	if (Array.isArray(manifest.dependencies))
		parsed.dependencies = toStringArray(manifest.dependencies);
	if (Array.isArray(manifest.devDependencies))
		parsed.devDependencies = toStringArray(manifest.devDependencies);

	parsed.variants = normalizeRegistryVariants(parsed);
	return parsed;
}

/**
 * Evaluate a simple condition expression against the install context.
 * Supported: `public`, `!public`, `includeInstructions`, `!includeInstructions`, `framework:<name>`.
 * @param expression - Condition string from manifest metadata.
 * @param context - Install context.
 * @returns True when the condition passes or expression is empty.
 */
export function evaluateRegistryCondition(
	expression: string | undefined,
	context: RegistryInstallContext,
): boolean {
	if (!expression) return true;

	if (expression === "public") return context.public;
	if (expression === "!public") return !context.public;
	if (expression === "includeInstructions") return context.includeInstructions;
	if (expression === "!includeInstructions")
		return !context.includeInstructions;

	if (expression.startsWith("framework:")) {
		const expected = expression.slice("framework:".length);
		return context.framework === expected;
	}

	throw new Error(
		`Unsupported registry condition expression: "${expression}".`,
	);
}

/**
 * Determine whether a file should be installed for the given visibility and context.
 * @param visibility - File visibility gate.
 * @param context - Install context.
 * @returns True when the file should be written.
 */
export function shouldInstallFileVisibility(
	visibility: RegistryVisibility | undefined,
	context: RegistryInstallContext,
): boolean {
	const gate = visibility ?? RegistryVisibility.ALWAYS;
	switch (gate) {
		case RegistryVisibility.ALWAYS:
			return true;
		case RegistryVisibility.PUBLIC:
			return context.public;
		case RegistryVisibility.PRIVATE:
			return !context.public;
		default: {
			const _exhaustive: never = gate;
			return _exhaustive;
		}
	}
}

/**
 * Whether a variant's targets conflict with the install context.
 * Agnostic facets (omitted) never conflict.
 * @param targets - Variant targets.
 * @param context - Install context.
 * @returns True when the variant is compatible with the context.
 */
export function variantMatchesContext(
	targets: RegistryTargets | undefined,
	context: RegistryInstallContext,
): boolean {
	const t = targets ?? {};
	if (t.framework && context.framework && t.framework !== context.framework)
		return false;
	if (t.language && context.lang && t.language !== context.lang) return false;
	if (t.tool && context.tool && t.tool !== context.tool) return false;
	if (
		t.ecosystem &&
		context.ecosystem &&
		t.ecosystem !== context.ecosystem
	)
		return false;
	return true;
}

/**
 * Score how specifically a variant matches the install context (higher is better).
 * @param targets - Variant targets.
 * @param context - Install context.
 * @returns Match score.
 */
function variantMatchScore(
	targets: RegistryTargets | undefined,
	context: RegistryInstallContext,
): number {
	const t = targets ?? {};
	let score = 0;
	if (context.framework && t.framework === context.framework) score += 4;
	if (context.lang && t.language === context.lang) score += 2;
	if (context.tool && t.tool === context.tool) score += 2;
	if (context.ecosystem && t.ecosystem === context.ecosystem) score += 2;
	// Prefer more specific variants when context provides matching facets.
	if (t.framework) score += 1;
	if (t.language) score += 1;
	if (t.tool) score += 1;
	if (t.ecosystem) score += 1;
	return score;
}

/**
 * Select the installable variant for an item given an optional pin and context.
 * @param item - Registry item with variants.
 * @param pinnedVariantId - Optional variant pin from `id@variant`.
 * @param context - Install context.
 * @returns The selected variant.
 * @throws Error when no variant matches or selection is ambiguous.
 */
export function selectRegistryVariant(
	item: RegistryItem,
	pinnedVariantId: string | undefined,
	context: RegistryInstallContext,
): RegistryVariant {
	if (pinnedVariantId) {
		const pinned = item.variants.find((variant) => variant.id === pinnedVariantId);
		if (!pinned)
			throw new Error(
				`Registry item "${item.id}" has no variant "${pinnedVariantId}" (available: ${item.variants.map((v) => v.id).join(", ")}).`,
			);
		return pinned;
	}

	if (item.variants.length === 1) return item.variants[0];

	const compatible = item.variants.filter((variant) =>
		variantMatchesContext(variant.targets, context),
	);
	if (compatible.length === 0)
		throw new Error(
			`No variant of "${item.id}" matches install context (framework=${String(context.framework)}, lang=${String(context.lang)}, tool=${String(context.tool)}, ecosystem=${String(context.ecosystem)}; available: ${item.variants.map((v) => v.id).join(", ")}).`,
		);

	const ranked = [...compatible].sort(
		(a, b) =>
			variantMatchScore(b.targets, context) -
			variantMatchScore(a.targets, context),
	);
	const bestScore = variantMatchScore(ranked[0].targets, context);
	const best = ranked.filter(
		(variant) => variantMatchScore(variant.targets, context) === bestScore,
	);
	if (best.length > 1)
		throw new Error(
			`Ambiguous variant selection for "${item.id}" (candidates: ${best.map((v) => v.id).join(", ")}). Pin with ${item.id}@<variant> or set framework/lang/tool/ecosystem in context.`,
		);

	return best[0];
}

/**
 * Collect language from an item's variants (first declared language wins).
 * @param item - Registry item.
 * @returns Language string, or undefined when none declared.
 */
export function getRegistryItemLanguage(item: RegistryItem): string | undefined {
	for (const variant of item.variants) {
		if (variant.targets?.language) return variant.targets.language;
	}
	return undefined;
}

/**
 * Whether any variant declares a framework target.
 * @param item - Registry item.
 * @returns True when at least one variant is framework-specific.
 */
export function itemHasFrameworkTarget(item: RegistryItem): boolean {
	return item.variants.some((variant) => Boolean(variant.targets?.framework));
}
