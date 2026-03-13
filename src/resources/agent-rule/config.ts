import prompts from "../../cli/prompts";
import tasks from "../../cli/tasks";
import { IS_LOCAL_MODE } from "../../core/constants";
import {
	getAgentRuleContent,
	listAvailableAgentRules,
} from "../../core/template-registry";
import { capitalizeFirstLetter } from "../../core/utils";

/** Supported IDE formats for agent rule output. */
export enum IdeFormat {
	CURSOR = "cursor",
	WINDSURF = "windsurf",
	CLINE = "cline",
	CLAUDE = "claude",
	COPILOT = "copilot",
	GEMINI = "gemini",
}

/** Describes the configuration for generating an agent rule. */
export type GenerateAgentRuleConfiguration = {
	/** The selected agent rule template. */
	rule: string;
	/** The target IDE format for the rule output. */
	ideFormat: IdeFormat;
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
 * Gather configuration to proceed with agent rule generation.
 * @returns The agent rule configuration.
 */
export async function getGenerateAgentRuleConfiguration(
	cliFlags: Partial<GenerateAgentRuleConfiguration> = {},
): Promise<GenerateAgentRuleConfiguration> {
	const rule = await getAgentRuleSelection(cliFlags);
	const ideFormat = await getIdeFormatSelection(cliFlags);

	return { rule, ideFormat };
}

/**
 * Prompts for or validates the agent rule selection.
 */
export async function getAgentRuleSelection(
	cliFlags: Partial<GenerateAgentRuleConfiguration> = {},
): Promise<string> {
	let candidateRules: string[] = [];

	if (IS_LOCAL_MODE) {
		candidateRules = await listAvailableAgentRules();
	} else {
		await tasks.runWithTasks(
			"Checking available agent rule templates",
			async () => {
				candidateRules = await listAvailableAgentRules();
			},
		);
	}

	if (!candidateRules.length) throw new Error("No agent rule templates found.");

	const ruleOptions = candidateRules.map((r) => ({
		label: capitalizeFirstLetter(r.replaceAll("-", " ")),
		value: r,
	}));

	let rule = cliFlags.rule;

	if (ruleOptions.length === 1) {
		rule = ruleOptions[0].value;
	}

	if (!rule)
		rule = await prompts.selectInput<string>(
			"Which agent rule would you like to use?",
			{ options: ruleOptions },
			candidateRules[0],
		);

	if (!candidateRules.includes(rule))
		throw new Error(
			`Unsupported rule: ${rule} (valid: ${candidateRules.join(", ")})`,
		);

	return rule;
}

/**
 * Prompts for or validates the IDE format selection.
 */
export async function getIdeFormatSelection(
	cliFlags: Partial<GenerateAgentRuleConfiguration> = {},
): Promise<IdeFormat> {
	const ideOptions = Object.values(IdeFormat).map((format) => ({
		label: IDE_FORMAT_LABELS[format],
		value: format,
	}));

	const ideFormat =
		cliFlags.ideFormat ??
		(await prompts.selectInput<IdeFormat>(
			"Which IDE format should the rule be formatted for?",
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
 * Fetches the raw rule content for a given rule name.
 */
export async function fetchAgentRuleContent(ruleName: string): Promise<string> {
	return getAgentRuleContent(ruleName);
}
