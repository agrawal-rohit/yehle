import { primaryText } from "../../cli/logger";
import prompts from "../../cli/prompts";
import tasks from "../../cli/tasks";
import { IS_LOCAL_MODE } from "../../core/constants";
import { getGitEmail, getGitUsername } from "../../core/git";
import {
	LANGUAGE_PACKAGE_REGISTRY,
	validatePackageName,
} from "../../core/pkg-manager";
import { listAvailableTemplates } from "../../core/template-registry";
import { capitalizeFirstLetter, toSlug } from "../../core/utils";
import {
	getPackageInstructionsConfiguration,
	type IdeFormat,
} from "../instructions/config";

/** Supported programming languages for the package. */
export enum Language {
	TYPESCRIPT = "typescript",
}

/** Public files for the template. */
export const templatePublicPaths: Record<Language | "shared", string[]> = {
	shared: [
		"CODE_OF_CONDUCT.md",
		"CONTRIBUTING.md",
		"issue_template",
		"pull_request_template.md",
	],
	[Language.TYPESCRIPT]: ["release.mustache.yml"],
};

/** Describes the configuration for generating a package. */
export type GeneratePackageConfiguration = {
	/** The selected programming language for the package. */
	lang: Language;
	/** The package name. */
	name: string;
	/** The chosen template for the package. */
	template: string;
	/** Indicates whether the package should be published to a public registry. */
	public: boolean;
	/** Whether to include agent instructions for the package. */
	includeInstructions?: boolean;
	/** IDE format for agent instructions (when includeInstructions is true). */
	instructionsIdeFormat?: IdeFormat;
	/** Optional full name of the author (Only required for public packages). */
	authorName?: string;
	/** Optional Git username (Only required for public packages). */
	authorGitUsername?: string;
	/** Optional Git email address (Only required for public packages). */
	authorGitEmail?: string;
};

/**
 * Gather configuration for package creation via CLI flags or prompts (language, name, template, visibility, instructions, author).
 * @param cliFlags - Optional CLI options (lang, name, template, public, includeInstructions, instructionsIdeFormat, etc.).
 * @returns Promise resolving to the full package configuration.
 */
export async function getGeneratePackageConfiguration(
	cliFlags: Partial<GeneratePackageConfiguration> = {},
): Promise<GeneratePackageConfiguration> {
	const lang = await getPackageLanguage(cliFlags);
	const name = await getPackageName(lang, cliFlags);
	const template = await getPackageTemplate(lang, cliFlags);
	const isPublic = await getPackageVisibility(lang, cliFlags);

	const instructionsResult = await getPackageInstructionsConfiguration({
		includeInstructions: cliFlags.includeInstructions,
		ideFormat: cliFlags.instructionsIdeFormat,
	});
	const includeInstructions = instructionsResult.includeInstructions;
	const instructionsIdeFormat = instructionsResult.ideFormat;

	let authorName: string | undefined;
	let authorGitEmail: string | undefined;
	let authorGitUsername: string | undefined;
	if (isPublic) {
		authorName = await promptAuthorName();
		authorGitEmail = await promptAuthorGitEmail();
		authorGitUsername = await promptAuthorGitUsername();
	}

	const answers: GeneratePackageConfiguration = {
		lang: lang,
		name: name,
		template: template,
		public: isPublic,
		includeInstructions: includeInstructions,
		instructionsIdeFormat: instructionsIdeFormat,
		authorName: authorName,
		authorGitEmail: authorGitEmail,
		authorGitUsername: authorGitUsername,
	};

	return answers;
}

/**
 * Get the package language from CLI flags or prompt the user if not provided.
 * @param cliFlags - CLI flags that may include a predefined language selection.
 * @returns Promise resolving to the selected language.
 * @throws Error when the provided language is not in the supported set.
 */
export async function getPackageLanguage(
	cliFlags: Partial<GeneratePackageConfiguration> = {},
): Promise<GeneratePackageConfiguration["lang"]> {
	const languageOptions = Object.keys(Language).map((key: string) => ({
		label: capitalizeFirstLetter(Language[key as keyof typeof Language]),
		value: Language[key as keyof typeof Language],
	}));

	const language =
		cliFlags.lang ??
		(await prompts.selectInput<Language>(
			"Which language would you prefer to use?",
			{
				options: languageOptions,
			},
			Language.TYPESCRIPT,
		));

	const validLanguages = new Set<string>(
		languageOptions.map((opt) => opt.value),
	);
	if (!validLanguages.has(language))
		throw new Error(
			`Unsupported language: ${language} (valid: ${Array.from(validLanguages).join(", ")})`,
		);

	return language;
}

/**
 * Get the package name from CLI flags or prompt the user if not provided. Validates against the selected language.
 * @param language - The selected programming language (used for validation rules).
 * @param cliFlags - CLI flags that may include a predefined name.
 * @returns Promise resolving to the validated package name.
 * @throws Error when the name fails validation for the language.
 */
export async function getPackageName(
	language: Language,
	cliFlags: Partial<GeneratePackageConfiguration> = {},
): Promise<GeneratePackageConfiguration["name"]> {
	const name =
		cliFlags.name ??
		(await prompts.textInput(
			"What should we call your package?",
			{ required: true },
			"my-package",
		));

	validatePackageName(name, language);

	return name;
}

/**
 * Get the package template from CLI flags or prompt the user. In local mode lists templates without a spinner; in remote mode shows a loading task.
 * @param language - The selected programming language (determines which templates are available).
 * @param cliFlags - CLI flags that may include a predefined template.
 * @returns Promise resolving to the chosen template name.
 * @throws Error when no templates exist for the language or the chosen template is invalid.
 */
export async function getPackageTemplate(
	language: Language,
	cliFlags: Partial<GeneratePackageConfiguration> = {},
): Promise<GeneratePackageConfiguration["template"]> {
	let candidateTemplates: string[] = [];

	// If it's running in local mode, fetch templates without spinner
	if (IS_LOCAL_MODE) {
		candidateTemplates = await listAvailableTemplates(language, "package");
	}

	// Otherwise, show a loading spinner until the templates are fetched from Github
	else {
		console.log();
		await tasks.runWithTasks(
			"Checking available package templates",
			async () => {
				candidateTemplates = await listAvailableTemplates(language, "package");
			},
		);
	}

	if (!candidateTemplates || candidateTemplates.length === 0)
		throw new Error(`No templates found for language: ${language}`);

	const templateOptions = candidateTemplates.map((template) => ({
		label: capitalizeFirstLetter(template),
		value: template,
	}));

	let template = cliFlags.template;

	// If only a single template is available, just use that
	if (templateOptions.length === 1) {
		template = templateOptions[0].value;
		console.log(
			primaryText(
				`(Only one package template is available, using "${template}".)`,
			),
		);
	}

	if (!template)
		template = await prompts.selectInput<string>(
			"Which starter template would you like to use?",
			{ options: templateOptions },
			candidateTemplates[0],
		);

	if (!candidateTemplates.includes(template))
		throw new Error(
			`Unsupported template: ${template} (valid: ${Array.from(candidateTemplates).join(", ")})`,
		);

	return template;
}

/**
 * Get package visibility (public or private) from CLI flags or prompt the user. Prompt mentions the registry for the language.
 * @param language - The selected programming language (used for registry name in prompt).
 * @param cliFlags - CLI flags that may include a predefined visibility (e.g. --public).
 * @returns Promise resolving to true if the package is public, false otherwise.
 */
export async function getPackageVisibility(
	language: Language,
	cliFlags: Partial<GeneratePackageConfiguration> = {},
): Promise<GeneratePackageConfiguration["public"]> {
	const packageRegistry = LANGUAGE_PACKAGE_REGISTRY[language];
	const isPublic =
		cliFlags.public ??
		(await prompts.confirmInput(
			`Should this package be publicly available? (released to the ${packageRegistry} registry)`,
			undefined,
			true,
		));

	return isPublic;
}

/**
 * Prompt for the author's full name. Suggests the value from Git user.name when available.
 * @returns Promise resolving to the entered author name.
 */
export async function promptAuthorName(): Promise<string> {
	const gitName = await getGitUsername();
	return await prompts.textInput(
		"What is the author's name?",
		undefined,
		gitName,
	);
}

/**
 * Prompt for the author's Git email. Suggests the value from Git user.email when available.
 * @returns Promise resolving to the entered email.
 */
export async function promptAuthorGitEmail(): Promise<string> {
	const inferredGitEmail = await getGitEmail();
	return await prompts.textInput(
		"What is the author's email?",
		undefined,
		inferredGitEmail,
	);
}

/**
 * Prompt for the author's GitHub username. Suggests a value derived from Git user.name (lowercased, no spaces).
 * @returns Promise resolving to the entered username, normalized to a slug.
 */
export async function promptAuthorGitUsername(): Promise<string> {
	const gitName = await getGitUsername();
	const suggestedUsername = gitName
		? gitName.toLowerCase().replaceAll(/\s+/g, "")
		: undefined;

	const finalGitUserName = await prompts.textInput(
		"Under which GitHub account would this repository be stored?",
		undefined,
		suggestedUsername,
	);

	return toSlug(finalGitUserName);
}
