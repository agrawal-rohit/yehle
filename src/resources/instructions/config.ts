import prompts from "../../cli/prompts";
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

	const essential = await promptEssentialSelections();
	all.push(...essential);

	const langResult = await promptLanguageSelections();
	all.push(...langResult.selections);

	const projectSpecResult = await promptProjectSpecSelections(
		langResult.chosenLangs,
		langResult.langOptions,
	);
	all.push(...projectSpecResult.selections);

	const tooling = await promptToolingSelections();
	all.push(...tooling);

	const skills = await promptSkillsSelections();
	all.push(...skills);

	return all;
}

/** Prompt for essential instructions (multi-select). User may select None to skip. */
async function promptEssentialSelections(): Promise<InstructionSelection[]> {
	const names = await listAvailableInstructions(InstructionCategory.ESSENTIAL);
	if (names.length === 0) return [];
	const options = [
		{ label: SKIP_OPTION_LABEL, value: SKIP_OPTION_VALUE },
		...names.map((name) => ({
			label: capitalizeFirstLetter(name.replaceAll("-", " ")),
			value: name,
		})),
	];
	const raw = await prompts.multiselectInput(
		"Which recommended instructions do you want? (we'll add common for most projects like coding style, testing patterns, etc.)",
		{ options },
	);
	const chosen = raw.filter((v) => v !== SKIP_OPTION_VALUE);
	const selections: InstructionSelection[] = [];
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
	return selections;
}

/** Prompt for languages (multi-select) and return language instructions for selected langs. User may select None to skip. */
async function promptLanguageSelections(): Promise<{
	selections: InstructionSelection[];
	chosenLangs: string[];
	langOptions: { label: string; value: string }[];
}> {
	const languageNames = await listLanguageNames();
	const langOptions = [
		{ label: SKIP_OPTION_LABEL, value: SKIP_OPTION_VALUE },
		...languageNames.map((name) => ({
			label: capitalizeFirstLetter(name),
			value: name,
		})),
	];
	if (languageNames.length === 0)
		return { selections: [], chosenLangs: [], langOptions: [] };

	const raw = await prompts.multiselectInput(
		"Which languages are you using? (we'll add best-practice instructions for each)",
		{ options: langOptions },
	);
	const chosenLangs = raw.filter((v) => v !== SKIP_OPTION_VALUE);
	const selections: InstructionSelection[] = [];
	for (const lang of chosenLangs) {
		const names = await listAvailableInstructions(
			InstructionCategory.LANGUAGE,
			{ lang },
		);
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

	const options = [
		{ label: SKIP_OPTION_LABEL, value: SKIP_OPTION_VALUE },
		...projectSpecNames.map((name) => ({
			label: capitalizeFirstLetter(name.replaceAll("-", " ")),
			value: name,
		})),
	];
	const chosenProjectSpec = await prompts.selectInput(
		"What are you building? (we'll add instructions based on your project constraints and architecture)",
		{ options },
		SKIP_OPTION_VALUE,
	);
	if (!chosenProjectSpec || chosenProjectSpec === SKIP_OPTION_VALUE)
		return { selections: [], projectSpecLang, chosenProjectSpec: undefined };

	const names = await listAvailableInstructions(
		InstructionCategory.PROJECT_SPEC,
		{ lang: projectSpecLang, projectSpec: chosenProjectSpec },
	);
	const selections: InstructionSelection[] = [];
	for (const name of names) {
		const { frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.PROJECT_SPEC,
			name,
			{ lang: projectSpecLang, projectSpec: chosenProjectSpec },
		);
		selections.push({
			category: InstructionCategory.PROJECT_SPEC,
			instruction: name,
			frontmatter,
			context: { lang: projectSpecLang, projectSpec: chosenProjectSpec },
		});
	}
	return {
		selections,
		projectSpecLang,
		chosenProjectSpec,
	};
}

/** Prompt for tooling instructions (multi-select). User may select None to skip. */
async function promptToolingSelections(): Promise<InstructionSelection[]> {
	const names = await listAvailableInstructions(InstructionCategory.TOOLING);
	if (names.length === 0) return [];
	const options = [
		{ label: SKIP_OPTION_LABEL, value: SKIP_OPTION_VALUE },
		...names.map((name) => ({
			label: capitalizeFirstLetter(name.replaceAll("-", " ")),
			value: name,
		})),
	];
	const raw = await prompts.multiselectInput(
		"Which tools or frameworks are you using in this repo? (we'll add best-practice instructions for each tool)",
		{ options },
	);
	const chosen = raw.filter((v) => v !== SKIP_OPTION_VALUE);
	const selections: InstructionSelection[] = [];
	for (const name of chosen) {
		const { frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.TOOLING,
			name,
		);
		selections.push({
			category: InstructionCategory.TOOLING,
			instruction: name,
			frontmatter,
		});
	}
	return selections;
}

/** Prompt for skills (multi-select). User may select None to skip. */
async function promptSkillsSelections(): Promise<InstructionSelection[]> {
	const names = await listAvailableInstructions(InstructionCategory.SKILLS);
	if (names.length === 0) return [];
	const options = [
		{ label: SKIP_OPTION_LABEL, value: SKIP_OPTION_VALUE },
		...names.map((name) => ({
			label: capitalizeFirstLetter(name.replaceAll("-", " ")),
			value: name,
		})),
	];
	const raw = await prompts.multiselectInput(
		"Which skills or workflows do you want to add? (we'll add multi-step workflows like deployment flows, documentation generation, etc.)",
		{ options },
	);
	const chosen = raw.filter((v) => v !== SKIP_OPTION_VALUE);
	const selections: InstructionSelection[] = [];
	for (const name of chosen) {
		const { frontmatter } = await getInstructionWithFrontmatter(
			InstructionCategory.SKILLS,
			name,
		);
		selections.push({
			category: InstructionCategory.SKILLS,
			instruction: name,
			frontmatter,
		});
	}
	return selections;
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
