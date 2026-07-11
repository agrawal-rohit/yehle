import { RegistryItemType } from "../registry/schema";

/**
 * Instruction categories used by the IDE output adapter to choose rules vs
 * skills vs subagents paths. Derived from registry item type at install time —
 * not authored on manifests.
 */
export enum InstructionCategory {
	ESSENTIAL = "essential",
	TOOLING = "tooling",
	SUBAGENTS = "subagents",
	SKILLS = "skills",
	LANGUAGE = "language",
	PROJECT_SPEC = "project-spec",
	TEMPLATE = "template",
}

/** Frontmatter for a rule (non-skill instructions). */
export type RuleFrontmatter = {
	description?: string;
	paths?: string[];
	alwaysApply?: boolean;
	model?: string;
	readonly?: boolean;
};

/**
 * Map a registry item type to the IDE InstructionCategory used for path routing.
 * Agent instructions use the rules path (ESSENTIAL); skills and subagents use
 * their dedicated paths.
 * @param type - Registry item type.
 * @param itemId - Owning registry item id (for error messages).
 * @returns Matching instruction category.
 * @throws Error when the type is not an instruction-like item.
 */
export function resolveInstructionCategoryFromItemType(
	type: RegistryItemType,
	itemId: string,
): InstructionCategory {
	switch (type) {
		case RegistryItemType.AGENT_INSTRUCTION:
			return InstructionCategory.ESSENTIAL;
		case RegistryItemType.AGENT_SKILL:
			return InstructionCategory.SKILLS;
		case RegistryItemType.SUBAGENT:
			return InstructionCategory.SUBAGENTS;
		case RegistryItemType.TEMPLATE:
		case RegistryItemType.COMPONENT:
		case RegistryItemType.THEME:
		case RegistryItemType.BLOCK:
		case RegistryItemType.CONVENTION:
			throw new Error(
				`Registry item "${itemId}" type "${type}" is not an instruction item.`,
			);
		default: {
			const _exhaustive: never = type;
			throw new Error(
				`Registry item "${itemId}" has unknown type "${String(_exhaustive)}".`,
			);
		}
	}
}
