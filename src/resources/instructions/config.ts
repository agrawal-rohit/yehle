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
import { IDE_FORMATS, type IdeFormat } from "./ide-formats";

/** Option value used to skip a step (single-select or multi-select). */
const SKIP_OPTION_VALUE = "";

/** Label for the skip option in multi-select prompts. */
const SKIP_OPTION_LABEL = "None";

type SelectOption = { label: string; value: string };

/**
 * Runs a potentially slow async operation inside the CLI task renderer
 * (remote mode only) so the terminal doesn't appear "stuck".
 * @param goalTitle - Title shown by listr2 while the operation runs.
 * @param fn - Async function to run.
 * @returns The resolved value of `fn`.
 */
async function withLoadingTask<T>(
	goalTitle: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (IS_LOCAL_MODE) return fn();

	let result!: T;
	await tasks.runWithTasks(goalTitle, async () => {
		result = await fn();
	});
	return result;
}

/**
 * Builds select options including the common "None" skip option.
 * @param names - Option values to include (order preserved).
 * @param toLabel - Maps a name to its human-readable label.
 * @returns Options suitable for `prompts.selectInput` / `prompts.multiselectInput`.
 */
function buildSkipAndOptions(
	names: readonly string[],
	toLabel: (name: string) => string,
): SelectOption[] {
	return [
		{ label: SKIP_OPTION_LABEL, value: SKIP_OPTION_VALUE },
		...names.map((name) => ({ label: toLabel(name), value: name })),
	];
}

/**
 * Convert an instruction basename into its human label.
 * @param name - Instruction basename (kebab-case).
 * @returns Human readable label (Title Case words).
 */
function instructionNameToOptionLabel(name: string): string {
	return capitalizeFirstLetter(name.replaceAll("-", " "));
}

/**
 * Create `InstructionSelection` objects for instruction names.
 * Fetches all frontmatters concurrently.
 * @param category - Instruction category.
 * @param names - Instruction basenames (order preserved).
 * @param context - Optional context used for category scoping.
 * @returns Array of instruction selections in `names` order.
 */
async function getInstructionSelectionsForNames(
	category: InstructionCategory,
	names: readonly string[],
	context?: InstructionContext,
): Promise<InstructionSelection[]> {
	const fetched = await Promise.all(
		names.map(async (instruction) => {
			const { frontmatter } = context
				? await getInstructionWithFrontmatter(category, instruction, context)
				: await getInstructionWithFrontmatter(category, instruction);
			return { instruction, frontmatter };
		}),
	);

	return fetched.map(({ instruction, frontmatter }) => ({
		category,
		instruction,
		frontmatter,
		...(context ? { context } : {}),
	}));
}

/**
 * Prompt for multi-select of an unscoped instruction category
 * (essential/tooling/skills/subagents).
 * @param category - Instruction category.
 * @param message - Prompt message.
 * @returns Chosen instruction selections with normalized frontmatter.
 */
async function promptUnscopedMultiSelectInstructionSelections(
	category: InstructionCategory,
	message: string,
): Promise<InstructionSelection[]> {
	const names = await listAvailableInstructions(category);
	if (names.length === 0) return [];

	const options = buildSkipAndOptions(names, instructionNameToOptionLabel);
	const raw = await prompts.multiselectInput(message, { options });
	const chosen = raw.filter((v) => v !== SKIP_OPTION_VALUE);
	if (chosen.length === 0) return [];

	return await withLoadingTask(
		`Processing ${category} instruction choices`,
		async () => await getInstructionSelectionsForNames(category, chosen),
	);
}

/** A single instruction selection with frontmatter for writing to disk. */
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
	/** Target IDE format for written instructions. */
	ideFormat?: IdeFormat;
};

/** All instruction categories in display order. */
export const INSTRUCTION_CATEGORIES: InstructionCategory[] = [
	InstructionCategory.ESSENTIAL,
	InstructionCategory.LANGUAGE,
	InstructionCategory.PROJECT_SPEC,
	InstructionCategory.TOOLING,
	InstructionCategory.SUBAGENTS,
	InstructionCategory.SKILLS,
];

/**
 * Gather configuration for standalone instructions (add to existing project).
 * Only ideFormat can be passed via options; all instruction selections are made interactively.
 * @param cliFlags - Optional CLI options (ideFormat only).
 * @returns Configuration with selections and IDE format.
 */
export async function getGenerateInstructionsConfiguration(
	cliFlags: Partial<GenerateInstructionsOptions> = {},
): Promise<GenerateInstructionsConfiguration> {
	const ideFormat = await getIdeFormatSelection(cliFlags.ideFormat);
	const selections = await getGranularInstructionsSelections();
	return { selections, ideFormat };
}

/**
 * Run the granular prompt flow in INSTRUCTION_CATEGORIES order with dependency filtering.
 * User may select nothing at any step and move on. Returns selections in write order.
 */
async function getGranularInstructionsSelections(): Promise<
	InstructionSelection[]
> {
	const all: InstructionSelection[] = [];

	const essential = await promptUnscopedMultiSelectInstructionSelections(
		InstructionCategory.ESSENTIAL,
		"Which recommended instructions do you want? (we'll add always-on security + coding principles + SDLC workflow guidance for most projects)",
	);
	all.push(...essential);

	const langResult = await promptLanguageSelections();
	all.push(...langResult.selections);

	const projectSpecResult = await promptProjectSpecSelections(
		langResult.chosenLangs,
		langResult.langOptions,
	);
	all.push(...projectSpecResult.selections);

	const tooling = await promptUnscopedMultiSelectInstructionSelections(
		InstructionCategory.TOOLING,
		"Which tools or frameworks are you using in this repo? (we'll add best-practice instructions for each tool)",
	);
	all.push(...tooling);

	const agents = await promptUnscopedMultiSelectInstructionSelections(
		InstructionCategory.SUBAGENTS,
		"Which subagents do you want to add? (we'll add helpful subagents like researcher, planner, implementer, verifier)",
	);
	all.push(...agents);

	const skills = await promptUnscopedMultiSelectInstructionSelections(
		InstructionCategory.SKILLS,
		"Which skills or workflows do you want to add? (we'll add multi-step workflows like deployment flows, incident playbooks, migrations, etc.)",
	);
	all.push(...skills);

	return all;
}

/** Prompt for languages (multi-select) and return language instructions for selected langs. User may select None to skip. */
async function promptLanguageSelections(): Promise<{
	selections: InstructionSelection[];
	chosenLangs: string[];
	langOptions: { label: string; value: string }[];
}> {
	const languageNames = await listLanguageNames();
	const langOptions = buildSkipAndOptions(languageNames, (name) =>
		capitalizeFirstLetter(name),
	);
	if (languageNames.length === 0)
		return { selections: [], chosenLangs: [], langOptions: [] };

	// Pre-check whether any language has available language-category
	// instruction choices. If not, skip prompting entirely (but keep
	// `langOptions` for project-spec scoping).
	const instructionNamesByLang = await Promise.all(
		languageNames.map(async (lang) => ({
			lang,
			names: await listAvailableInstructions(InstructionCategory.LANGUAGE, {
				lang,
			}),
		})),
	);
	const hasAnyLanguageInstructionChoices = instructionNamesByLang.some(
		(v) => v.names.length > 0,
	);
	const langOptionsWithoutSkip = langOptions.filter(
		(o) => o.value !== SKIP_OPTION_VALUE,
	);
	if (!hasAnyLanguageInstructionChoices) {
		return {
			selections: [],
			chosenLangs: [],
			langOptions: langOptionsWithoutSkip,
		};
	}

	const raw = await prompts.multiselectInput(
		"Which languages are you using? (we'll add best-practice instructions for each)",
		{ options: langOptions },
	);
	const chosenLangs = raw.filter((v) => v !== SKIP_OPTION_VALUE);
	const selections =
		chosenLangs.length === 0
			? []
			: await withLoadingTask(
					"Processing language instruction choices",
					async () => {
						const selectionsByLang = await Promise.all(
							chosenLangs.map(async (lang) => {
								const names =
									instructionNamesByLang.find((v) => v.lang === lang)?.names ??
									[];
								return await getInstructionSelectionsForNames(
									InstructionCategory.LANGUAGE,
									names,
									{ lang },
								);
							}),
						);
						return selectionsByLang.flat();
					},
				);
	return {
		selections,
		chosenLangs,
		langOptions: langOptions.filter((o) => o.value !== SKIP_OPTION_VALUE),
	};
}

/** Prompt for project-spec (single, scoped by language). User may select None to skip. */
async function promptProjectSpecSelections(
	chosenLangs: string[],
	langOptions: { label: string; value: string }[],
): Promise<{
	selections: InstructionSelection[];
	projectSpecLang?: string;
	chosenProjectSpec?: string;
}> {
	const projectSpecLang =
		chosenLangs.length > 0 ? chosenLangs[0] : langOptions[0]?.value;
	if (!projectSpecLang) return { selections: [] };

	const projectSpecNames = await listProjectSpecNames(projectSpecLang);
	if (projectSpecNames.length === 0) return { selections: [] };

	// Only prompt when there are actual project-spec instruction choices.
	// This prevents a confusing "What are you building?" prompt when no
	// instructions exist for the candidates.
	const projectSpecInstructionNames = await Promise.all(
		projectSpecNames.map(async (projectSpec) => ({
			projectSpec,
			names: await listAvailableInstructions(InstructionCategory.PROJECT_SPEC, {
				lang: projectSpecLang,
				projectSpec,
			}),
		})),
	);
	const availableProjectSpecs = projectSpecInstructionNames.filter(
		(v) => v.names.length > 0,
	);
	if (availableProjectSpecs.length === 0)
		return {
			selections: [],
			projectSpecLang,
			chosenProjectSpec: undefined,
		};

	const options = buildSkipAndOptions(
		availableProjectSpecs.map((v) => v.projectSpec),
		(spec) => capitalizeFirstLetter(spec.replaceAll("-", " ")),
	);
	const chosenProjectSpec = await prompts.selectInput(
		"What are you building? (we'll add instructions based on your project constraints and architecture)",
		{ options },
		SKIP_OPTION_VALUE,
	);
	if (!chosenProjectSpec || chosenProjectSpec === SKIP_OPTION_VALUE)
		return { selections: [], projectSpecLang, chosenProjectSpec: undefined };

	const names =
		availableProjectSpecs.find((v) => v.projectSpec === chosenProjectSpec)
			?.names ??
		(await listAvailableInstructions(InstructionCategory.PROJECT_SPEC, {
			lang: projectSpecLang,
			projectSpec: chosenProjectSpec,
		}));
	const context: InstructionContext = {
		lang: projectSpecLang,
		projectSpec: chosenProjectSpec,
	};
	const selections =
		names.length === 0
			? []
			: await withLoadingTask(
					"Processing project-spec instruction choices",
					async () =>
						await getInstructionSelectionsForNames(
							InstructionCategory.PROJECT_SPEC,
							names,
							context,
						),
				);
	return {
		selections,
		projectSpecLang,
		chosenProjectSpec,
	};
}

/**
 * Prompt for or validate the IDE format selection. Uses CLI flags when provided and valid.
 * @param ideFormat - Optional IDE format.
 * @returns Promise resolving to the selected IDE format.
 * @throws When the provided ideFormat is not a valid IdeFormat value.
 */
export async function getIdeFormatSelection(
	ideFormat?: IdeFormat,
): Promise<IdeFormat> {
	const selectedIdeFormat =
		ideFormat ??
		(await prompts.selectInput<IdeFormat>(
			"Which IDE should the instructions be written for?",
			{ options: [...IDE_FORMATS] },
			IDE_FORMATS[0].value,
		));

	const validFormats = new Set(IDE_FORMATS.map((f) => f.value));
	if (!validFormats.has(selectedIdeFormat))
		throw new Error(
			`Unsupported IDE format: ${selectedIdeFormat} (valid: ${Array.from(validFormats).join(", ")})`,
		);

	return selectedIdeFormat;
}
