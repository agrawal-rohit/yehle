import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectInput = vi.fn();
const mockMultiselectInput = vi.fn();

vi.mock("../../cli/prompts", () => ({
	default: {
		selectInput: (...args: unknown[]) => mockSelectInput(...args),
		multiselectInput: (...args: unknown[]) => mockMultiselectInput(...args),
	},
}));

vi.mock("../../core/instructions", () => ({
	InstructionCategory: {
		ESSENTIAL: "essential",
		TOOLING: "tooling",
		SKILLS: "skills",
		LANGUAGE: "language",
		PROJECT_SPEC: "project-spec",
	},
	getInstructionWithFrontmatter: vi.fn(),
	listAvailableInstructions: vi.fn(),
}));

vi.mock("../../core/templates", () => ({
	listAvailableTemplates: vi.fn(),
	listLanguageNames: vi.fn(),
	listProjectSpecNames: vi.fn(),
}));

vi.mock("../../core/utils", () => ({
	capitalizeFirstLetter: vi.fn((s: string) => s[0].toUpperCase() + s.slice(1)),
}));

vi.mock("./ide-formats", () => ({
	IDE_FORMATS: [
		{ label: "Cursor", value: "cursor" },
		{ label: "Windsurf", value: "windsurf" },
		{ label: "Cline", value: "cline" },
	],
}));

// Import after mocks
import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	listAvailableInstructions,
} from "../../core/instructions";
import { listLanguageNames, listProjectSpecNames } from "../../core/templates";
import {
	getGenerateInstructionsConfiguration,
	getIdeFormatSelection,
	INSTRUCTION_CATEGORIES,
	type InstructionSelection,
} from "./config";

describe("resources/instructions/config", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelectInput.mockReset();
		mockMultiselectInput.mockReset();
	});

	describe("INSTRUCTION_CATEGORIES", () => {
		it("should export categories in display order", () => {
			expect(INSTRUCTION_CATEGORIES).toEqual([
				InstructionCategory.ESSENTIAL,
				InstructionCategory.LANGUAGE,
				InstructionCategory.PROJECT_SPEC,
				InstructionCategory.TOOLING,
				InstructionCategory.SKILLS,
			]);
		});
	});

	describe("getIdeFormatSelection", () => {
		it("should return provided ideFormat when valid", async () => {
			const result = await getIdeFormatSelection("cursor");

			expect(result).toBe("cursor");
			expect(mockSelectInput).not.toHaveBeenCalled();
		});

		it("should prompt when ideFormat is not provided", async () => {
			mockSelectInput.mockResolvedValue("windsurf");

			const result = await getIdeFormatSelection();

			expect(mockSelectInput).toHaveBeenCalledWith(
				"Which IDE should the instructions be written for?",
				expect.objectContaining({ options: expect.any(Array) }),
				"cursor",
			);
			expect(result).toBe("windsurf");
		});

		it("should throw when provided ideFormat is not valid", async () => {
			await expect(
				getIdeFormatSelection("invalid" as "cursor"),
			).rejects.toThrow(
				/Unsupported IDE format: invalid \(valid: cursor, windsurf, cline\)/,
			);
			expect(mockSelectInput).not.toHaveBeenCalled();
		});

		it("should throw when prompt returns invalid value", async () => {
			mockSelectInput.mockResolvedValue("unknown");

			await expect(getIdeFormatSelection()).rejects.toThrow(
				/Unsupported IDE format: unknown/,
			);
		});
	});

	describe("getGenerateInstructionsConfiguration", () => {
		it("should return ideFormat from CLI flags and empty selections when no instructions available", async () => {
			vi.mocked(listAvailableInstructions).mockResolvedValue([]);
			vi.mocked(listLanguageNames).mockResolvedValue([]);

			const result = await getGenerateInstructionsConfiguration({
				ideFormat: "cursor",
			});

			expect(result).toEqual({
				selections: [],
				ideFormat: "cursor",
			});
			expect(mockSelectInput).not.toHaveBeenCalled();
		});

		it("should prompt for ideFormat when not provided", async () => {
			vi.mocked(listAvailableInstructions).mockResolvedValue([]);
			vi.mocked(listLanguageNames).mockResolvedValue([]);
			mockSelectInput.mockResolvedValue("cline");

			const result = await getGenerateInstructionsConfiguration({});

			expect(mockSelectInput).toHaveBeenCalledWith(
				"Which IDE should the instructions be written for?",
				expect.any(Object),
				"cursor",
			);
			expect(result.ideFormat).toBe("cline");
			expect(result.selections).toEqual([]);
		});

		it("should return essential selections when user selects from essential list", async () => {
			vi.mocked(listAvailableInstructions)
				.mockResolvedValueOnce(["code-style", "testing"])
				.mockResolvedValue([]);
			vi.mocked(listLanguageNames).mockResolvedValue([]);
			mockMultiselectInput
				.mockResolvedValueOnce(["code-style"])
				.mockResolvedValueOnce([]);
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "body",
				frontmatter: { description: "Code style" },
			});

			const result = await getGenerateInstructionsConfiguration({
				ideFormat: "cursor",
			});

			expect(result.ideFormat).toBe("cursor");
			expect(result.selections).toHaveLength(1);
			expect(result.selections[0]).toMatchObject({
				category: InstructionCategory.ESSENTIAL,
				instruction: "code-style",
				frontmatter: { description: "Code style" },
			});
			expect(getInstructionWithFrontmatter).toHaveBeenCalledWith(
				InstructionCategory.ESSENTIAL,
				"code-style",
			);
		});

		it("should return language selections when user selects languages", async () => {
			vi.mocked(listAvailableInstructions).mockImplementation((cat, ctx?) => {
				if (cat === InstructionCategory.ESSENTIAL) return Promise.resolve([]);
				if (
					cat === InstructionCategory.LANGUAGE &&
					(ctx as { lang?: string })?.lang === "typescript"
				)
					return Promise.resolve(["typescript-best-practices"]);
				return Promise.resolve([]);
			});
			vi.mocked(listLanguageNames).mockResolvedValue(["typescript"]);
			vi.mocked(listProjectSpecNames).mockResolvedValue([]);
			mockMultiselectInput.mockImplementation((msg: string) => {
				if (msg.includes("languages")) return Promise.resolve(["typescript"]);
				return Promise.resolve([]);
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "body",
				frontmatter: {},
			});

			const result = await getGenerateInstructionsConfiguration({
				ideFormat: "cursor",
			});

			const langSelections = result.selections.filter(
				(s: InstructionSelection) =>
					s.category === InstructionCategory.LANGUAGE,
			);
			expect(langSelections).toHaveLength(1);
			expect(langSelections[0]).toMatchObject({
				instruction: "typescript-best-practices",
				context: { lang: "typescript" },
			});
		});

		it("should return project-spec and template selections when user selects them", async () => {
			// Call order: ESSENTIAL, LANGUAGE (per lang), PROJECT_SPEC names
			vi.mocked(listAvailableInstructions)
				.mockResolvedValueOnce([]) // essential
				.mockResolvedValueOnce([]) // LANGUAGE for typescript (no lang-specific instructions)
				.mockResolvedValueOnce(["ts-package"]); // PROJECT_SPEC
			vi.mocked(listLanguageNames).mockResolvedValue(["typescript"]);
			vi.mocked(listProjectSpecNames).mockResolvedValue(["package"]);
			mockMultiselectInput.mockResolvedValueOnce(["typescript"]); // language
			mockSelectInput.mockResolvedValueOnce("package"); // project-spec
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "body",
				frontmatter: {},
			});

			const result = await getGenerateInstructionsConfiguration({
				ideFormat: "cursor",
			});

			const projectSpecSelections = result.selections.filter(
				(s: InstructionSelection) =>
					s.category === InstructionCategory.PROJECT_SPEC,
			);
			expect(projectSpecSelections.length).toBeGreaterThan(0);
			expect(projectSpecSelections[0].context).toEqual({
				lang: "typescript",
				projectSpec: "package",
			});
		});

		it("should skip project-spec and template when user selects None", async () => {
			vi.mocked(listAvailableInstructions).mockResolvedValue([]);
			vi.mocked(listLanguageNames).mockResolvedValue(["typescript"]);
			vi.mocked(listProjectSpecNames).mockResolvedValue(["package"]);
			mockMultiselectInput
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce(["typescript"])
				.mockResolvedValueOnce([]);
			mockSelectInput.mockResolvedValueOnce("cursor").mockResolvedValueOnce(""); // skip project-spec

			const result = await getGenerateInstructionsConfiguration({
				ideFormat: "cursor",
			});

			const projectSpecSelections = result.selections.filter(
				(s: InstructionSelection) =>
					s.category === InstructionCategory.PROJECT_SPEC,
			);
			expect(projectSpecSelections).toHaveLength(0);
		});

		it("should return tooling selections when user selects from tooling list", async () => {
			vi.mocked(listAvailableInstructions).mockImplementation(
				(cat: InstructionCategory) => {
					if (cat === InstructionCategory.ESSENTIAL) return Promise.resolve([]);
					if (cat === InstructionCategory.TOOLING)
						return Promise.resolve(["react", "sonarqube"]);
					if (cat === InstructionCategory.SKILLS) return Promise.resolve([]);
					return Promise.resolve([]);
				},
			);
			vi.mocked(listLanguageNames).mockResolvedValue([]);
			mockMultiselectInput.mockImplementation((msg: string) => {
				if (msg.includes("tools or frameworks"))
					return Promise.resolve(["react"]);
				return Promise.resolve([]);
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "body",
				frontmatter: {},
			});

			const result = await getGenerateInstructionsConfiguration({
				ideFormat: "cursor",
			});

			const toolingSelections = result.selections.filter(
				(s: InstructionSelection) => s.category === InstructionCategory.TOOLING,
			);
			expect(toolingSelections).toHaveLength(1);
			expect(toolingSelections[0]).toMatchObject({
				category: InstructionCategory.TOOLING,
				instruction: "react",
			});
		});

		it("should return skills selections when user selects from skills list", async () => {
			vi.mocked(listAvailableInstructions).mockImplementation(
				(cat: InstructionCategory) => {
					if (cat === InstructionCategory.ESSENTIAL) return Promise.resolve([]);
					if (cat === InstructionCategory.TOOLING) return Promise.resolve([]);
					if (cat === InstructionCategory.SKILLS)
						return Promise.resolve(["deploy-skill", "migrate-db"]);
					return Promise.resolve([]);
				},
			);
			vi.mocked(listLanguageNames).mockResolvedValue([]);
			mockMultiselectInput.mockImplementation((msg: string) => {
				if (msg.includes("skills or workflows"))
					return Promise.resolve(["deploy-skill"]);
				return Promise.resolve([]);
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "body",
				frontmatter: {},
			});

			const result = await getGenerateInstructionsConfiguration({
				ideFormat: "cursor",
			});

			const skillSelections = result.selections.filter(
				(s: InstructionSelection) => s.category === InstructionCategory.SKILLS,
			);
			expect(skillSelections).toHaveLength(1);
			expect(skillSelections[0]).toMatchObject({
				category: InstructionCategory.SKILLS,
				instruction: "deploy-skill",
			});
		});

		it("should pass empty object when cliFlags not provided", async () => {
			vi.mocked(listAvailableInstructions).mockResolvedValue([]);
			vi.mocked(listLanguageNames).mockResolvedValue([]);
			// getIdeFormatSelection(undefined) prompts; default would be IDE_FORMATS[0].value
			mockSelectInput.mockResolvedValue("cursor");

			const result = await getGenerateInstructionsConfiguration();

			expect(result).toEqual({ selections: [], ideFormat: "cursor" });
		});
	});
});
