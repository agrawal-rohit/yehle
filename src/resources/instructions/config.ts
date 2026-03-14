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
}

/** A single (category, instruction) choice with metadata for writing to disk. */
export type InstructionSelection = {
	category: InstructionCategory;
	instruction: string;
	metadata: InstructionMetadata;
};

/** Configuration for adding instructions to an existing project (supports multiple selections). */
export type GenerateInstructionsConfiguration = {
	selections: InstructionSelection[];
	ideFormat: IdeFormat;
};

/** Options for the instructions command (CLI flags / programmatic input). */
export type GenerateInstructionsOptions = {
	/** Instruction type: preferences, language, use-case, template. */
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
	"preferences" as const satisfies InstructionCategory;

/** Category for language/framework instructions (used by package setup and language helpers). */
export const INSTRUCTION_CATEGORY_LANGUAGE =
	"language" as const satisfies InstructionCategory;

/** Human-readable labels for instruction categories (for prompts). */
const CATEGORY_LABELS: Record<InstructionCategory, string> = {
	preferences: "User preferences (coding style, personal quirks)",
	language: "Language & framework (best practices for a language/framework)",
	"use-case":
		"Use case & architecture (UI, API, monorepo, OSS, extension, etc.)",
	template: "Template-specific (folder setup, commands, workflows)",
};

/** All instruction categories in display order. */
export const INSTRUCTION_CATEGORIES: InstructionCategory[] = [
	"preferences",
	"language",
	"use-case",
	"template",
];

/** CLI option description for --category (single source of truth for category list). */
export const INSTRUCTION_CATEGORY_OPTION_DESCRIPTION = `Instruction type (${INSTRUCTION_CATEGORIES.join(", ")})`;

/** CLI option description for --ide-format (single source of truth for format list). */
export const IDE_FORMAT_OPTION_DESCRIPTION = `Target IDE format (${Object.values(IdeFormat).join(", ")})`;

/**
 * Build metadata from rule frontmatter only (no prompts). Used for multi-select and single-selection flows.
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @returns Promise resolving to metadata (description, globs, alwaysApply).
 */
async function getMetadataFromFrontmatter(
	category: InstructionCategory,
	name: string,
): Promise<InstructionMetadata> {
	const { frontmatter } = await getInstructionWithFrontmatter(category, name);
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

/**
 * Resolve an instruction name to (category, instruction) by searching all categories.
 * Used when only --instruction is provided (category unknown).
 * @param instructionName - Instruction name to find (e.g. "react-vite", "typescript").
 * @returns The category and instruction name when found.
 * @throws When the instruction is not found in any category.
 */
async function resolveInstructionInAnyCategory(
	instructionName: string,
): Promise<{ category: InstructionCategory; instruction: string }> {
	if (!IS_LOCAL_MODE) {
		await tasks.runWithTasks("Checking available instructions", async () => {
			for (const cat of INSTRUCTION_CATEGORIES) {
				await listAvailableInstructions(cat);
			}
		});
	}
	for (const category of INSTRUCTION_CATEGORIES) {
		const names = await listAvailableInstructions(category);
		if (names.includes(instructionName))
			return { category, instruction: instructionName };
	}
	throw new Error(
		`Instruction "${instructionName}" not found in any category (checked: ${INSTRUCTION_CATEGORIES.join(", ")})`,
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
		const metadata = await getMetadataFromFrontmatter(category, instruction);
		return {
			selections: [{ category, instruction, metadata }],
			ideFormat,
		};
	}

	// Multi-select: choose instruction type(s), then instruction(s) per type
	const selectedCategories = await promptCategoryMultiSelect();
	if (selectedCategories.length === 0)
		throw new Error("No instruction types selected.");

	const availableByCategory =
		await loadAvailableInstructionsByCategory(selectedCategories);
	const selections: InstructionSelection[] = [];

	for (const category of selectedCategories) {
		const available = availableByCategory.get(category) ?? [];
		if (available.length === 0) continue;
		const chosen = await promptInstructionMultiSelect(category, available);
		for (const instruction of chosen) {
			const metadata = await getMetadataFromFrontmatter(category, instruction);
			selections.push({ category, instruction, metadata });
		}
	}

	if (selections.length === 0) throw new Error("No instructions selected.");

	return { selections, ideFormat };
}

/**
 * Load instruction names for the given categories. In remote mode wraps in a task UI.
 * @param categories - Instruction categories to list.
 * @returns Promise resolving to a map of category -> instruction names.
 */
async function loadAvailableInstructionsByCategory(
	categories: InstructionCategory[],
): Promise<Map<InstructionCategory, string[]>> {
	const map = new Map<InstructionCategory, string[]>();
	const run = async () => {
		for (const cat of categories) {
			const names = await listAvailableInstructions(cat);
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
async function promptCategoryMultiSelect(): Promise<InstructionCategory[]> {
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
async function promptInstructionMultiSelect(
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
): Promise<string> {
	if (!localMode)
		await tasks.runWithTasks("Checking available instructions", async () => {
			await listAvailableInstructions(category);
		});
	const candidates = await listAvailableInstructions(category);
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
 * @param category - Instruction category.
 * @param name - Instruction name (basename without extension).
 * @returns Promise resolving to the instruction body string.
 */
export async function fetchInstructionContent(
	category: InstructionCategory,
	name: string,
): Promise<string> {
	return getInstructionContent(category, name);
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
	const available = await listAvailableInstructions(
		INSTRUCTION_CATEGORY_LANGUAGE,
	);
	if (!available.includes(lang)) return null;

	const { frontmatter } = await getInstructionWithFrontmatter(
		INSTRUCTION_CATEGORY_LANGUAGE,
		lang,
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
	const available = await listAvailableInstructions(
		INSTRUCTION_CATEGORY_LANGUAGE,
	);
	if (available.includes(lang)) return lang;
	return null;
}
