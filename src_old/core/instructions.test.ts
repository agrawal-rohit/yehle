import { describe, expect, it } from "vitest";
import { RegistryItemType } from "../registry/schema";
import {
	InstructionCategory,
	resolveInstructionCategoryFromItemType,
} from "./instructions";

describe("core/instructions", () => {
	it("maps agent item types to IDE instruction categories", () => {
		expect(
			resolveInstructionCategoryFromItemType(
				RegistryItemType.AGENT_INSTRUCTION,
				"principles",
			),
		).toBe(InstructionCategory.ESSENTIAL);
		expect(
			resolveInstructionCategoryFromItemType(
				RegistryItemType.AGENT_SKILL,
				"deploy",
			),
		).toBe(InstructionCategory.SKILLS);
		expect(
			resolveInstructionCategoryFromItemType(
				RegistryItemType.SUBAGENT,
				"documentation-maintainer",
			),
		).toBe(InstructionCategory.SUBAGENTS);
	});

	it("throws for non-instruction registry item types", () => {
		expect(() =>
			resolveInstructionCategoryFromItemType(
				RegistryItemType.CONVENTION,
				"build",
			),
		).toThrow('Registry item "build" type "convention" is not an instruction item.');
	});
});
