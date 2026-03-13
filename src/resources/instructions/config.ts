import prompts from "../../cli/prompts";
import tasks from "../../cli/tasks";
import { IS_LOCAL_MODE } from "../../core/constants";
import {
	getInstructionContent,
	type InstructionCategory,
	listAvailableLanguageInstructions,
	listAvailablePreferenceInstructions,
} from "../../core/template-registry";
import { capitalizeFirstLetter } from "../../core/utils";

/** Supported IDE formats for agent instructions output. */
export enum IdeFormat {
	CURSOR = "cursor",
	WINDSURF = "windsurf",
	CLINE = "cline",
	CLAUDE = "claude",
	COPILOT = "copilot",
	GEMINI = "gemini",
}

/** Describes the configuration for adding instructions (standalone flow). */
export type GenerateInstructionsConfiguration = {
	category: InstructionCategory;
	instruction: string;
	ideFormat: IdeFormat;
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
	[IdeFormat.GEMINI]: "Gemini",
};

/**
 * Gather configuration for standalone instructions (add to existing project).
 * Standalone flow only offers preference instructions (coding standards).
 */
export async function getGenerateInstructionsConfiguration(
	cliFlags: Partial<GenerateInstructionsConfiguration> = {},
): Promise<GenerateInstructionsConfiguration> {
	const instruction = await getPreferenceInstructionSelection(cliFlags);
	const ideFormat = await getIdeFormatSelection(cliFlags);

	return { category: "preferences", instruction, ideFormat };
}

/**
 * Prompts for or validates the preference instruction selection.
 */
export async function getPreferenceInstructionSelection(
	cliFlags: Partial<GenerateInstructionsConfiguration> = {},
): Promise<string> {
	let candidates: string[] = [];

	if (IS_LOCAL_MODE) {
		candidates = await listAvailablePreferenceInstructions();
	} else {
		await tasks.runWithTasks(
			"Checking available instruction templates",
			async () => {
				candidates = await listAvailablePreferenceInstructions();
			},
		);
	}

	if (!candidates.length)
		throw new Error("No preference instruction templates found.");

	const options = candidates.map((r) => ({
		label: capitalizeFirstLetter(r.replaceAll("-", " ")),
		value: r,
	}));

	let instruction = cliFlags.instruction;

	if (options.length === 1) instruction = options[0].value;

	if (!instruction)
		instruction = await prompts.selectInput<string>(
			"Which coding standards would you like to add?",
			{ options },
			candidates[0],
		);

	if (!candidates.includes(instruction))
		throw new Error(
			`Unsupported instruction: ${instruction} (valid: ${candidates.join(", ")})`,
		);

	return instruction;
}

/**
 * Prompts for or validates the IDE format selection.
 */
export async function getIdeFormatSelection(
	cliFlags: Partial<
		GenerateInstructionsConfiguration & { ideFormat?: IdeFormat }
	> = {},
): Promise<IdeFormat> {
	const ideOptions = Object.values(IdeFormat).map((format) => ({
		label: IDE_FORMAT_LABELS[format],
		value: format,
	}));

	const ideFormat =
		cliFlags.ideFormat ??
		(await prompts.selectInput<IdeFormat>(
			"Which IDE format should the instructions be formatted for?",
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
 * Prompts for whether to include agent instructions during package creation.
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
 * Fetches the instruction content for a given category and name.
 */
export async function fetchInstructionContent(
	category: InstructionCategory,
	name: string,
): Promise<string> {
	return getInstructionContent(category, name);
}

/**
 * Returns the language instruction name for a package language (e.g. typescript -> typescript).
 * Uses available language instructions from templates.
 */
export async function getLanguageInstructionForPackageLang(
	lang: string,
): Promise<string | null> {
	const available = await listAvailableLanguageInstructions();
	if (available.includes(lang)) return lang;
	return null;
}
