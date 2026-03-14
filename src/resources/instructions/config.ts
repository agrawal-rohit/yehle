import prompts from "../../cli/prompts";
import tasks from "../../cli/tasks";
import { IS_LOCAL_MODE } from "../../core/constants";
import {
	getInstructionContent,
	getInstructionWithFrontmatter,
	type InstructionCategory,
	listAvailableInstructions,
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
	GEMINI = "gemini",
}

/** Describes the configuration for adding instructions (standalone flow). */
export type GenerateInstructionsConfiguration = {
	category: InstructionCategory;
	instruction: string;
	ideFormat: IdeFormat;
	/** User-provided metadata (globs, alwaysApply) with defaults from rule file. */
	metadata: InstructionMetadata;
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
 * Prompts for globs (comma-separated) with default from rule file.
 */
async function promptGlobs(defaultGlobs: string[]): Promise<string[]> {
	const defaultStr = defaultGlobs.join(", ");
	const input = await prompts.textInput(
		"Glob patterns for when this rule applies (comma-separated)",
		undefined,
		defaultStr,
	);
	if (!input.trim()) return defaultGlobs;
	return input
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Prompts for alwaysApply with default from rule file.
 */
async function promptAlwaysApply(defaultValue: boolean): Promise<boolean> {
	return prompts.confirmInput(
		"Apply this rule to all conversations?",
		undefined,
		defaultValue,
	);
}

/**
 * Build metadata from frontmatter and user prompts.
 */
async function getMetadataWithPrompts(
	category: InstructionCategory,
	name: string,
): Promise<InstructionMetadata> {
	const { frontmatter } = await getInstructionWithFrontmatter(category, name);
	const defaultGlobs = frontmatter.globs?.length ? frontmatter.globs : ["**/*"];
	const defaultAlways = frontmatter.alwaysApply ?? true;
	const description = frontmatter.description ?? name.replaceAll("-", " ");

	const globs = await promptGlobs(defaultGlobs);
	const alwaysApply = await promptAlwaysApply(defaultAlways);

	return { description, globs, alwaysApply };
}

/**
 * Gather configuration for standalone instructions (add to existing project).
 * Uses global-preferences category.
 */
export async function getGenerateInstructionsConfiguration(
	cliFlags: Partial<GenerateInstructionsConfiguration> = {},
): Promise<GenerateInstructionsConfiguration> {
	const category: InstructionCategory = "global-preferences";
	const instruction = await getGlobalPreferenceInstructionSelection(cliFlags);
	const ideFormat = await getIdeFormatSelection(cliFlags);

	const metadata =
		cliFlags.metadata ?? (await getMetadataWithPrompts(category, instruction));

	return { category, instruction, ideFormat, metadata };
}

/**
 * Prompts for or validates the global preference instruction selection.
 */
export async function getGlobalPreferenceInstructionSelection(
	cliFlags: Partial<GenerateInstructionsConfiguration> = {},
): Promise<string> {
	let candidates: string[] = [];

	if (IS_LOCAL_MODE) {
		candidates = await listAvailableInstructions("global-preferences");
	} else {
		await tasks.runWithTasks(
			"Checking available instruction templates",
			async () => {
				candidates = await listAvailableInstructions("global-preferences");
			},
		);
	}

	if (!candidates.length)
		throw new Error("No global preference instruction templates found.");

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
 * Returns metadata for a language instruction (used during package creation).
 * Uses defaults from rule file without prompting (non-interactive context).
 */
export async function getLanguageInstructionMetadata(
	lang: string,
): Promise<InstructionMetadata | null> {
	const available = await listAvailableInstructions("language");
	if (!available.includes(lang)) return null;

	const { frontmatter } = await getInstructionWithFrontmatter("language", lang);
	const description = frontmatter.description ?? `${lang} coding standards`;
	const globs =
		frontmatter.globs && frontmatter.globs.length > 0
			? frontmatter.globs
			: lang === "typescript"
				? ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]
				: ["**/*"];
	const alwaysApply = frontmatter.alwaysApply ?? false;

	return { description, globs, alwaysApply };
}

/**
 * Returns the language instruction name for a package language (e.g. typescript -> typescript).
 */
export async function getLanguageInstructionForPackageLang(
	lang: string,
): Promise<string | null> {
	const available = await listAvailableInstructions("language");
	if (available.includes(lang)) return lang;
	return null;
}
