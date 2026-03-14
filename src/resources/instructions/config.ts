import prompts from "../../cli/prompts";
import tasks from "../../cli/tasks";
import { IS_LOCAL_MODE } from "../../core/constants";
import {
	getInstructionContent,
	getInstructionWithFrontmatter,
	type InstructionCategory,
	type InstructionContext,
	listAvailableInstructions,
	listLanguageNames,
	listProjectSpecNames,
} from "../../core/instructions-registry";
import { capitalizeFirstLetter } from "../../core/utils";
import type { InstructionMetadata } from "./ide-formats";

/** Supported IDE formats for agent instructions output. */
export enum IdeFormat {
	CURSOR = "cursor",
	WINDSURF = "windsurf",
	CLINE = "cline",
	CLAUDE = "claude",
	COPILOT = "copilot",
}

/** A single (category, instruction) choice with metadata for writing to disk. */
export type InstructionSelection = {
	category: InstructionCategory;
	instruction: string;
	metadata: InstructionMetadata;
	/** Required when fetching content for language, project-spec, or template. */
	context?: InstructionContext;
};

/** Configuration for adding instructions to an existing project (supports multiple selections). */
export type GenerateInstructionsConfiguration = {
	selections: InstructionSelection[];
	ideFormat: IdeFormat;
};

/** Options for the instructions command (CLI flags / programmatic input). */
export type GenerateInstructionsOptions = {
	/** Instruction type: essential, optional, language, project-spec, template. */
	category?: InstructionCategory;
	/** Instruction template name (e.g. react-vite). */
	instruction?: string;
	/** Target IDE format for written instructions. */
	ideFormat?: IdeFormat;
};

/** Describes the configuration for adding instructions during package creation. */
export type PackageInstructionsConfiguration = {
	includeInstructions: boolean;
	ideFormat?: IdeFormat;
};

/** Human-readable labels for IDE formats. */
export const IDE_FORMAT_LABELS: Record<IdeFormat, string> = {
	[IdeFormat.CURSOR]: "Cursor",
	[IdeFormat.WINDSURF]: "Windsurf",
	[IdeFormat.CLINE]: "Cline",
	[IdeFormat.CLAUDE]: "Claude Code",
	[IdeFormat.COPILOT]: "GitHub Copilot",
};

/** Default category when --instruction is provided without --category. */
export const DEFAULT_INSTRUCTION_CATEGORY =
	"essential" as const satisfies InstructionCategory;

/** Category for language instructions (used by package setup and language helpers). */
export const INSTRUCTION_CATEGORY_LANGUAGE =
	"language" as const satisfies InstructionCategory;

/** Human-readable labels for instruction categories (for prompts). */
const CATEGORY_LABELS: Record<InstructionCategory, string> = {
	essential: "Essential (default coding styles)",
	optional:
		"Optional / situational (e.g. react, node; extra based on project setup)",
	language: "Language (best practices for a language)",
	"project-spec":
		"Project spec (use case & architecture: package, app, monorepo, etc.)",
	template: "Template-specific (folder setup, commands, workflows)",
};

/** All instruction categories in display order. */
export const INSTRUCTION_CATEGORIES: InstructionCategory[] = [
	"essential",
	"optional",
	"language",
	"project-spec",
	"template",
];

/** CLI option description for --category (single source of truth for category list). */
export const INSTRUCTION_CATEGORY_OPTION_DESCRIPTION = `Instruction type (${INSTRUCTION_CATEGORIES.join(", ")})`;

/** CLI option description for --ide-format (single source of truth for format list). */
export const IDE_FORMAT_OPTION_DESCRIPTION = `Target IDE format (${Object.values(IdeFormat).join(", ")})`;

/**
 * Build metadata from rule frontmatter only (no prompts). Used for multi-select, single-selection, and package-instructions flows.
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @param context - Required for language, project-spec, template.
 * @returns Promise resolving to metadata (description, globs, alwaysApply).
 */
export async function getMetadataFromFrontmatter(
	category: InstructionCategory,
	name: string,
	context?: InstructionContext,
): Promise<InstructionMetadata> {
	const { frontmatter } = await getInstructionWithFrontmatter(
		category,
		name,
		context,
	);
	const description = frontmatter.description ?? name.replaceAll("-", " ");
	const globs =
		(frontmatter.globs?.length ? frontmatter.globs : undefined) ??
		(category === INSTRUCTION_CATEGORY_LANGUAGE
			? getDefaultGlobsForLanguage(name)
			: ["**/*"]);
	const alwaysApply =
		frontmatter.alwaysApply ?? category === DEFAULT_INSTRUCTION_CATEGORY;
	return { description, globs, alwaysApply };
}

/** Global categories that do not require context (can be listed without lang/projectSpec/template). */
const GLOBAL_CATEGORIES: InstructionCategory[] = ["essential", "optional"];

/**
 * Resolve an instruction name to (category, instruction) by searching global categories only.
 * Used when only --instruction is provided (category unknown). Scoped categories require context and are not searched.
 * @param instructionName - Instruction name to find (e.g. "code-style", "react").
 * @returns The category and instruction name when found.
 * @throws When the instruction is not found in any global category.
 */
async function resolveInstructionInAnyCategory(
	instructionName: string,
): Promise<{ category: InstructionCategory; instruction: string }> {
	if (!IS_LOCAL_MODE) {
		await tasks.runWithTasks("Checking available instructions", async () => {
			for (const cat of GLOBAL_CATEGORIES) {
				await listAvailableInstructions(cat);
			}
		});
	}
	for (const category of GLOBAL_CATEGORIES) {
		const names = await listAvailableInstructions(category);
		if (names.includes(instructionName))
			return { category, instruction: instructionName };
	}
	throw new Error(
		`Instruction "${instructionName}" not found in any category (checked: ${GLOBAL_CATEGORIES.join(", ")})`,
	);
}

/**
 * Gather configuration for standalone instructions (add to existing project).
 * Supports single selection via CLI flags or multi-select by category and instruction.
 * Metadata is always read from instruction frontmatter (no prompts or overrides).
 * @param cliFlags - Optional CLI options (category, instruction, ideFormat).
 * @returns Configuration with selections and IDE format.
 */
export async function getGenerateInstructionsConfiguration(
	cliFlags: Partial<GenerateInstructionsOptions> = {},
): Promise<GenerateInstructionsConfiguration> {
	const ideFormat = await getIdeFormatSelection(cliFlags);

	// Single selection from CLI flags: --instruction with optional --category
	if (cliFlags.instruction) {
		const { category, instruction } = cliFlags.category
			? {
					category: cliFlags.category,
					instruction: await resolveInstructionSelection(
						cliFlags.category,
						cliFlags.instruction,
						IS_LOCAL_MODE,
						undefined,
					),
				}
			: await resolveInstructionInAnyCategory(cliFlags.instruction);
		const metadata = await getMetadataFromFrontmatter(
			category,
			instruction,
			undefined,
		);
		return {
			selections: [{ category, instruction, metadata }],
			ideFormat,
		};
	}

	// Granular flow: essential → languages → project-spec → optional (then write in that order)
	const selections = await getGranularInstructionsSelections();
	if (selections.length === 0) throw new Error("No instructions selected.");
	return { selections, ideFormat };
}

/**
 * Run the granular prompt flow: essential (multi) → languages (multi) → project-spec (single, scoped by first language) → optional (multi).
 * Returns selections in write order: essential → language → project-spec → optional.
 */
async function getGranularInstructionsSelections(): Promise<
	InstructionSelection[]
> {
	const selections: InstructionSelection[] = [];

	// 1. Essential
	const essentialNames = await listAvailableInstructions("essential");
	if (essentialNames.length > 0) {
		const chosen = await prompts.multiselectInput(
			"Which essential (default) instructions do you want?",
			{
				options: essentialNames.map((name) => ({
					label: capitalizeFirstLetter(name.replaceAll("-", " ")),
					value: name,
				})),
			},
		);
		for (const name of chosen as string[]) {
			const metadata = await getMetadataFromFrontmatter(
				"essential",
				name,
				undefined,
			);
			selections.push({
				category: "essential",
				instruction: name,
				metadata,
			});
		}
	}

	// 2. Languages
	const langOptions = await getAvailableLanguageOptions();
	let chosenLangs: string[] = [];
	if (langOptions.length > 0) {
		chosenLangs = (await prompts.multiselectInput(
			"Which languages are you using?",
			{ options: langOptions },
		)) as string[];
		for (const lang of chosenLangs) {
			const names = await listAvailableInstructions("language", {
				lang,
			});
			if (names.length > 0) {
				for (const name of names) {
					const metadata = await getMetadataFromFrontmatter("language", name, {
						lang,
					});
					selections.push({
						category: "language",
						instruction: name,
						metadata,
						context: { lang },
					});
				}
			}
		}
	}

	// 3. Project-spec (list from first selected language)
	const projectSpecLang =
		chosenLangs.length > 0 ? chosenLangs[0] : langOptions[0]?.value;
	if (projectSpecLang) {
		const projectSpecNames = await listProjectSpecNames(projectSpecLang);
		if (projectSpecNames.length > 0) {
			const chosenProjectSpec = await prompts.selectInput(
				"What is the project spec?",
				{
					options: projectSpecNames.map((name) => ({
						label: capitalizeFirstLetter(name.replaceAll("-", " ")),
						value: name,
					})),
				},
				projectSpecNames[0],
			);
			if (chosenProjectSpec) {
				const names = await listAvailableInstructions("project-spec", {
					lang: projectSpecLang,
					projectSpec: chosenProjectSpec,
				});
				for (const name of names) {
					const metadata = await getMetadataFromFrontmatter(
						"project-spec",
						name,
						{ lang: projectSpecLang, projectSpec: chosenProjectSpec },
					);
					selections.push({
						category: "project-spec",
						instruction: name,
						metadata,
						context: {
							lang: projectSpecLang,
							projectSpec: chosenProjectSpec,
						},
					});
				}
			}
		}
	}

	// 4. Optional
	const optionalNames = await listAvailableInstructions("optional");
	if (optionalNames.length > 0) {
		const chosen = await prompts.multiselectInput(
			"Which optional instructions apply to this project?",
			{
				options: optionalNames.map((name) => ({
					label: capitalizeFirstLetter(name.replaceAll("-", " ")),
					value: name,
				})),
			},
		);
		for (const name of chosen as string[]) {
			const metadata = await getMetadataFromFrontmatter(
				"optional",
				name,
				undefined,
			);
			selections.push({
				category: "optional",
				instruction: name,
				metadata,
			});
		}
	}

	return selections;
}

/** Discover available languages by scanning templates/ for subdirs (excluding shared). */
async function getAvailableLanguageOptions(): Promise<
	{ label: string; value: string }[]
> {
	const names = await listLanguageNames();
	return names.map((name) => ({
		label: capitalizeFirstLetter(name.replaceAll("-", " ")),
		value: name,
	}));
}

/**
 * Load instruction names for the given categories. In remote mode wraps in a task UI.
 * For language, project-spec, template pass context so directories can be resolved.
 * @param categories - Instruction categories to list.
 * @param context - Required for language, project-spec, template.
 * @returns Promise resolving to a map of category -> instruction names.
 */
async function _loadAvailableInstructionsByCategory(
	categories: InstructionCategory[],
	context?: InstructionContext,
): Promise<Map<InstructionCategory, string[]>> {
	const map = new Map<InstructionCategory, string[]>();
	const run = async () => {
		for (const cat of categories) {
			const names = await listAvailableInstructions(cat, context);
			if (names.length > 0) map.set(cat, names);
		}
	};
	if (IS_LOCAL_MODE) {
		await run();
		return map;
	}
	await tasks.runWithTasks("Loading available instructions", run);
	return map;
}

/**
 * Prompt the user to select one or more instruction types (categories).
 * @returns Promise resolving to the selected category list.
 */
async function _promptCategoryMultiSelect(): Promise<InstructionCategory[]> {
	const options = INSTRUCTION_CATEGORIES.map((cat) => ({
		label: CATEGORY_LABELS[cat],
		value: cat,
	}));
	const values = await prompts.multiselectInput(
		"Which instruction type(s) do you want to add?",
		{ options },
	);
	return values as InstructionCategory[];
}

/**
 * Prompt the user to select one or more instructions from a category.
 * @param category - Instruction category (used for the prompt message).
 * @param available - List of instruction names to choose from.
 * @returns Promise resolving to the selected instruction names.
 */
async function _promptInstructionMultiSelect(
	category: InstructionCategory,
	available: string[],
): Promise<string[]> {
	const options = available.map((name) => ({
		label: capitalizeFirstLetter(name.replaceAll("-", " ")),
		value: name,
	}));
	const message = `Which ${CATEGORY_LABELS[category].toLowerCase()} instruction(s)?`;
	return prompts.multiselectInput(message, { options });
}

/**
 * Resolve and validate a single instruction name within a given category.
 * @param category - Instruction category.
 * @param instruction - Instruction name (e.g. "react-vite").
 * @param localMode - If false, wraps the check in a task UI for remote mode.
 * @returns Promise resolving to the validated instruction name.
 * @throws When the category has no instructions or the instruction is not in the category.
 */
async function resolveInstructionSelection(
	category: InstructionCategory,
	instruction: string,
	localMode: boolean,
	context?: InstructionContext,
): Promise<string> {
	if (!localMode)
		await tasks.runWithTasks("Checking available instructions", async () => {
			await listAvailableInstructions(category, context);
		});
	const candidates = await listAvailableInstructions(category, context);
	if (!candidates.length)
		throw new Error(
			`No instructions found for type "${CATEGORY_LABELS[category]}".`,
		);
	if (!candidates.includes(instruction))
		throw new Error(
			`Unsupported instruction "${instruction}" for ${category} (valid: ${candidates.join(", ")})`,
		);
	return instruction;
}

/**
 * Prompt for or validate the IDE format selection. Uses CLI flags when provided and valid.
 * @param cliFlags - Optional flags containing ideFormat.
 * @returns Promise resolving to the selected IDE format.
 * @throws When the provided ideFormat is not a valid IdeFormat value.
 */
export async function getIdeFormatSelection(
	cliFlags: Partial<GenerateInstructionsOptions> = {},
): Promise<IdeFormat> {
	const ideOptions = Object.values(IdeFormat).map((format) => ({
		label: IDE_FORMAT_LABELS[format],
		value: format,
	}));

	const ideFormat =
		cliFlags.ideFormat ??
		(await prompts.selectInput<IdeFormat>(
			"Which IDE should the instructions be written for?",
			{ options: ideOptions },
			IdeFormat.CURSOR,
		));

	const validFormats = new Set(Object.values(IdeFormat));
	if (!validFormats.has(ideFormat))
		throw new Error(
			`Unsupported IDE format: ${ideFormat} (valid: ${Array.from(validFormats).join(", ")})`,
		);

	return ideFormat;
}

/**
 * Prompt for whether to include agent instructions during package creation, and for IDE format if yes.
 * @param cliFlags - Optional flags (includeInstructions, ideFormat).
 * @returns Promise resolving to the package instructions configuration.
 */
export async function getPackageInstructionsConfiguration(
	cliFlags: Partial<PackageInstructionsConfiguration> = {},
): Promise<PackageInstructionsConfiguration> {
	const includeInstructions =
		cliFlags.includeInstructions ??
		(await prompts.confirmInput(
			"Would you like to include appropriate agent instructions?",
			undefined,
			false,
		));

	if (!includeInstructions) return { includeInstructions: false };

	const ideFormat = await getIdeFormatSelection(cliFlags);
	return { includeInstructions: true, ideFormat };
}

/**
 * Fetch the instruction body (markdown content without frontmatter) for a given category and name.
 * For language, project-spec, template pass context.
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @param context - Required for language, project-spec, template.
 * @returns Promise resolving to the instruction body string.
 */
export async function fetchInstructionContent(
	category: InstructionCategory,
	name: string,
	context?: InstructionContext,
): Promise<string> {
	return getInstructionContent(category, name, context);
}

/**
 * Default glob patterns per language when the rule file does not specify globs.
 * Exported for use in ide-formats fallback metadata.
 * @param lang - Language key (e.g. "typescript").
 * @returns Array of glob patterns.
 */
export function getDefaultGlobsForLanguage(lang: string): string[] {
	if (lang === "typescript")
		return ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
	return ["**/*"];
}

/**
 * Return metadata for a language instruction from its frontmatter (used during package creation).
 * Non-interactive: no prompts; uses rule file defaults.
 * @param lang - Language key (e.g. "typescript").
 * @returns Promise resolving to metadata, or null if the language has no instruction.
 */
export async function getLanguageInstructionMetadata(
	lang: string,
): Promise<InstructionMetadata | null> {
	const context: InstructionContext = { lang };
	const available = await listAvailableInstructions(
		INSTRUCTION_CATEGORY_LANGUAGE,
		context,
	);
	if (!available.includes(lang)) return null;

	const { frontmatter } = await getInstructionWithFrontmatter(
		INSTRUCTION_CATEGORY_LANGUAGE,
		lang,
		context,
	);
	const description = frontmatter.description ?? `${lang} coding standards`;
	const globs =
		(frontmatter.globs?.length ? frontmatter.globs : undefined) ??
		getDefaultGlobsForLanguage(lang);
	const alwaysApply = frontmatter.alwaysApply ?? false;

	return { description, globs, alwaysApply };
}

/**
 * Return the instruction name for a package language when it exists in the language category.
 * @param lang - Package language (e.g. "typescript").
 * @returns Promise resolving to the instruction name when available, null otherwise.
 */
export async function getLanguageInstructionForPackageLang(
	lang: string,
): Promise<string | null> {
	const context: InstructionContext = { lang };
	const available = await listAvailableInstructions(
		INSTRUCTION_CATEGORY_LANGUAGE,
		context,
	);
	if (available.includes(lang)) return lang;
	return null;
}
