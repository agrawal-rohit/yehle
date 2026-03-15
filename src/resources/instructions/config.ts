import prompts from "../../cli/prompts";
import tasks from "../../cli/tasks";
import { IS_LOCAL_MODE } from "../../core/constants";
import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	type InstructionContext,
	listAvailableInstructions,
	type RuleFrontmatter,
} from "../../core/instructions";
import { listLanguageNames, listProjectSpecNames } from "../../core/templates";
import { capitalizeFirstLetter } from "../../core/utils";

/** Supported IDE formats for agent instructions output. */
export enum IdeFormat {
	CURSOR = "cursor",
	WINDSURF = "windsurf",
	CLINE = "cline",
	CLAUDE = "claude",
	COPILOT = "copilot",
}

/** A single (category, instruction) choice with frontmatter for writing to disk. */
export type InstructionSelection = {
	category: InstructionCategory;
	instruction: string;
	frontmatter: RuleFrontmatter;
	context?: InstructionContext;
};

/** Configuration for adding instructions to an existing project (supports multiple selections). */
export type GenerateInstructionsConfiguration = {
	selections: InstructionSelection[];
	ideFormat: IdeFormat;
};

/** Options for the instructions command (CLI flags / programmatic input). */
export type GenerateInstructionsOptions = {
	/** Instruction type: essential, situational, language, project-spec, template. */
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
export const DEFAULT_INSTRUCTION_CATEGORY = InstructionCategory.ESSENTIAL;

/** Category for language instructions (used by package setup and language helpers). */
export const INSTRUCTION_CATEGORY_LANGUAGE = InstructionCategory.LANGUAGE;

/** Human-readable labels for instruction categories (for prompts). */
const CATEGORY_LABELS: Record<InstructionCategory, string> = {
	[InstructionCategory.ESSENTIAL]: "Essential (default coding styles)",
	[InstructionCategory.SITUATIONAL]:
		"Situational (e.g. react, node; extra based on project setup)",
	[InstructionCategory.LANGUAGE]: "Language (best practices for a language)",
	[InstructionCategory.PROJECT_SPEC]:
		"Project spec (use case & architecture: package, app, monorepo, etc.)",
	[InstructionCategory.TEMPLATE]:
		"Template-specific (folder setup, commands, workflows)",
};

/** All instruction categories in display order. */
export const INSTRUCTION_CATEGORIES: InstructionCategory[] = [
	InstructionCategory.ESSENTIAL,
	InstructionCategory.SITUATIONAL,
	InstructionCategory.LANGUAGE,
	InstructionCategory.PROJECT_SPEC,
	InstructionCategory.TEMPLATE,
];

/** CLI option description for --category (single source of truth for category list). */
export const INSTRUCTION_CATEGORY_OPTION_DESCRIPTION = `Instruction type (${INSTRUCTION_CATEGORIES.join(", ")})`;

/** CLI option description for --ide-format (single source of truth for format list). */
export const IDE_FORMAT_OPTION_DESCRIPTION = `Target IDE format (${Object.values(IdeFormat).join(", ")})`;

/** Global categories that do not require context (can be listed without lang/projectSpec/template). */
const GLOBAL_CATEGORIES: InstructionCategory[] = [
	InstructionCategory.ESSENTIAL,
	InstructionCategory.SITUATIONAL,
];

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
					),
				}
			: await resolveInstructionInAnyCategory(cliFlags.instruction);
		const { frontmatter } = await getInstructionWithFrontmatter(
			category,
			instruction,
		);
		return {
			selections: [{ category, instruction, frontmatter }],
			ideFormat,
		};
	}

	// Granular flow: essential → languages → project-spec → situational (then write in that order)
	const selections = await getGranularInstructionsSelections();
	if (selections.length === 0) throw new Error("No instructions selected.");
	return { selections, ideFormat };
}

/**
 * Run the granular prompt flow: essential (multi) → languages (multi) → project-spec (single, scoped by first language) → situational (multi).
 * Returns selections in write order: essential → language → project-spec → situational.
 */
async function getGranularInstructionsSelections(): Promise<
	InstructionSelection[]
> {
	const selections: InstructionSelection[] = [];

	// 1. Essential
	const essentialNames = await listAvailableInstructions(
		InstructionCategory.ESSENTIAL,
	);
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
		for (const name of chosen) {
			const { frontmatter } = await getInstructionWithFrontmatter(
				InstructionCategory.ESSENTIAL,
				name,
			);
			selections.push({
				category: InstructionCategory.ESSENTIAL,
				instruction: name,
				frontmatter,
			});
		}
	}

	// 2. Languages
	const langOptions = await getAvailableLanguageOptions();
	let chosenLangs: string[] = [];
	if (langOptions.length > 0) {
		chosenLangs = await prompts.multiselectInput(
			"Which languages are you using?",
			{ options: langOptions },
		);
		for (const lang of chosenLangs) {
			const names = await listAvailableInstructions(
				InstructionCategory.LANGUAGE,
				{ lang },
			);
			if (names.length > 0) {
				for (const name of names) {
					const { frontmatter } = await getInstructionWithFrontmatter(
						InstructionCategory.LANGUAGE,
						name,
						{ lang },
					);
					selections.push({
						category: InstructionCategory.LANGUAGE,
						instruction: name,
						frontmatter,
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
				const names = await listAvailableInstructions(
					InstructionCategory.PROJECT_SPEC,
					{
						lang: projectSpecLang,
						projectSpec: chosenProjectSpec,
					},
				);
				for (const name of names) {
					const { frontmatter } = await getInstructionWithFrontmatter(
						InstructionCategory.PROJECT_SPEC,
						name,
						{
							lang: projectSpecLang,
							projectSpec: chosenProjectSpec,
						},
					);
					selections.push({
						category: InstructionCategory.PROJECT_SPEC,
						instruction: name,
						frontmatter,
						context: {
							lang: projectSpecLang,
							projectSpec: chosenProjectSpec,
						},
					});
				}
			}
		}
	}

	// 4. Situational
	const situationalNames = await listAvailableInstructions(
		InstructionCategory.SITUATIONAL,
	);
	if (situationalNames.length > 0) {
		const chosen = await prompts.multiselectInput(
			"Which situational instructions apply to this project?",
			{
				options: situationalNames.map((name) => ({
					label: capitalizeFirstLetter(name.replaceAll("-", " ")),
					value: name,
				})),
			},
		);
		for (const name of chosen) {
			const { frontmatter } = await getInstructionWithFrontmatter(
				InstructionCategory.SITUATIONAL,
				name,
			);
			selections.push({
				category: InstructionCategory.SITUATIONAL,
				instruction: name,
				frontmatter,
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
