import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../core/fs", () => ({
	ensureDirAsync: vi.fn(() => Promise.resolve()),
	writeFileAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../core/instructions", () => ({
	InstructionCategory: {
		ESSENTIAL: "essential",
		LANGUAGE: "language",
		PROJECT_SPEC: "project_spec",
		TEMPLATE: "template",
		TOOLING: "tooling",
		SUBAGENTS: "subagents",
		SKILLS: "skills",
	},
}));

// Import after mocks
import { ensureDirAsync, writeFileAsync } from "../../core/fs";
import {
	InstructionCategory,
	type RuleFrontmatter,
} from "../../core/instructions";
import {
	IDE_FORMATS,
	resolveOutputPath,
	transformContentForIde,
	writeInstructionToFile,
} from "./ide-formats";

describe("resources/instructions/ide-formats", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("IDE_FORMATS", () => {
		it("should contain all supported IDE formats", () => {
			expect(IDE_FORMATS).toHaveLength(4);
			expect(IDE_FORMATS.map((f) => f.value)).toEqual([
				"cursor",
				"windsurf",
				"cline",
				"claude",
			]);
		});
	});

	describe("resolveOutputPath", () => {
		it("should resolve path for cursor format", () => {
			const result = resolveOutputPath(
				"cursor",
				"my-rule",
				"/project",
				InstructionCategory.LANGUAGE,
			);
			expect(result).toBe("/project/.cursor/rules/my-rule.mdc");
		});

		it("should resolve path for windsurf format", () => {
			const result = resolveOutputPath(
				"windsurf",
				"my-rule",
				"/project",
				InstructionCategory.LANGUAGE,
			);
			expect(result).toBe("/project/.windsurf/rules/my-rule.md");
		});

		it("should resolve path for cline format", () => {
			const result = resolveOutputPath(
				"cline",
				"my-rule",
				"/project",
				InstructionCategory.LANGUAGE,
			);
			expect(result).toBe("/project/.clinerules/my-rule.md");
		});

		it("should resolve path for claude format", () => {
			const result = resolveOutputPath(
				"claude",
				"my-rule",
				"/project",
				InstructionCategory.LANGUAGE,
			);
			expect(result).toBe("/project/.claude/rules/my-rule.md");
		});
	});

	describe("resolveOutputPath for skills", () => {
		it("should resolve skills path for cursor", () => {
			const result = resolveOutputPath(
				"cursor",
				"deploy-skill",
				"/project",
				InstructionCategory.SKILLS,
			);
			expect(result).toBe("/project/.cursor/skills/deploy-skill/SKILL.md");
		});

		it("should resolve skills path for windsurf", () => {
			const result = resolveOutputPath(
				"windsurf",
				"deploy-skill",
				"/project",
				InstructionCategory.SKILLS,
			);
			expect(result).toBe("/project/.windsurf/skills/deploy-skill/SKILL.md");
		});

		it("should resolve skills path for cline", () => {
			const result = resolveOutputPath(
				"cline",
				"deploy-skill",
				"/project",
				InstructionCategory.SKILLS,
			);
			expect(result).toBe("/project/.cline/skills/deploy-skill/SKILL.md");
		});

		it("should resolve skills path for claude", () => {
			const result = resolveOutputPath(
				"claude",
				"deploy-skill",
				"/project",
				InstructionCategory.SKILLS,
			);
			expect(result).toBe("/project/.claude/skills/deploy-skill/SKILL.md");
		});
	});

	describe("resolveOutputPath for agents", () => {
		it("should resolve agents path for cursor format", () => {
			const result = resolveOutputPath(
				"cursor",
				"deploy-agent",
				"/project",
				InstructionCategory.SUBAGENTS,
			);
			expect(result).toBe("/project/.cursor/agents/deploy-agent.md");
		});

		it("should resolve agents path as skills on windsurf", () => {
			const result = resolveOutputPath(
				"windsurf",
				"deploy-agent",
				"/project",
				InstructionCategory.SUBAGENTS,
			);
			expect(result).toBe("/project/.windsurf/skills/deploy-agent/SKILL.md");
		});

		it("should resolve agents path as skills on cline", () => {
			const result = resolveOutputPath(
				"cline",
				"deploy-agent",
				"/project",
				InstructionCategory.SUBAGENTS,
			);
			expect(result).toBe("/project/.cline/skills/deploy-agent/SKILL.md");
		});

		it("should resolve agents path for claude format", () => {
			const result = resolveOutputPath(
				"claude",
				"deploy-agent",
				"/project",
				InstructionCategory.SUBAGENTS,
			);
			expect(result).toBe("/project/.claude/agents/deploy-agent.md");
		});
	});

	describe("transformContentForIde", () => {
		const frontmatter: RuleFrontmatter = {
			description: "Test rule",
			paths: ["**/*.ts", "**/*.tsx"],
			alwaysApply: true,
		};

		it("should add cursor frontmatter for cursor format", () => {
			const content = "# Test content";
			const result = transformContentForIde(
				content,
				"cursor",
				InstructionCategory.LANGUAGE,
				"my-rule",
				frontmatter,
			);
			expect(result).toContain('description: "Test rule"');
			expect(result).toContain("alwaysApply: true");
			expect(result).toContain("globs:");
			expect(result).toContain('  - "**/*.ts"');
			expect(result).toContain('  - "**/*.tsx"');
		});

		it("should add cline frontmatter for cline format", () => {
			const content = "# Test content";
			const result = transformContentForIde(
				content,
				"cline",
				InstructionCategory.LANGUAGE,
				"my-rule",
				frontmatter,
			);
			expect(result).toContain("paths:");
			expect(result).toContain('  - "**/*.ts"');
		});

		it("should add claude frontmatter for claude format", () => {
			const content = "# Test content";
			const result = transformContentForIde(
				content,
				"claude",
				InstructionCategory.LANGUAGE,
				"my-rule",
				frontmatter,
			);
			expect(result).toContain("paths:");
			expect(result).toContain('  - "**/*.ts"');
		});

		it("should not add frontmatter for windsurf format (pass through)", () => {
			const content = "# Test content";
			const result = transformContentForIde(
				content,
				"windsurf",
				InstructionCategory.LANGUAGE,
				"my-rule",
				frontmatter,
			);
			expect(result).toBe(content);
		});

		it("should handle empty paths array with default glob", () => {
			const content = "# Test content";
			const fmNoPaths: RuleFrontmatter = {
				description: "Test",
				alwaysApply: false,
			};
			const result = transformContentForIde(
				content,
				"cursor",
				InstructionCategory.LANGUAGE,
				"my-rule",
				fmNoPaths,
			);
			expect(result).toContain('  - "**/*"');
		});

		it("should add cursor subagent frontmatter for SUBAGENTS", () => {
			const content = "# Agent body";
			const agentFrontmatter: RuleFrontmatter = {
				description: "Agent description",
				model: "fast",
				readonly: true,
			};
			const result = transformContentForIde(
				content,
				"cursor",
				InstructionCategory.SUBAGENTS,
				"researcher",
				agentFrontmatter,
			);
			expect(result).toContain("name: researcher");
			expect(result).toContain("model: fast");
			expect(result).toContain("readonly: true");
			expect(result).toContain("# Agent body");
		});

		it("should omit readonly line for cursor subagents when readonly is not set", () => {
			const content = "# Agent body";
			const agentFrontmatter: RuleFrontmatter = {
				description: "Agent description",
				model: "fast",
			};
			const result = transformContentForIde(
				content,
				"cursor",
				InstructionCategory.SUBAGENTS,
				"researcher",
				agentFrontmatter,
			);
			expect(result).toContain("name: researcher");
			expect(result).toContain("model: fast");
			expect(result).not.toContain("readonly:");
			expect(result).toContain("# Agent body");
		});

		it("should add claude agent frontmatter for SUBAGENTS", () => {
			const content = "# Agent body";
			const agentFrontmatter: RuleFrontmatter = {
				description: "Agent description",
				model: "fast",
				readonly: true,
			};
			const result = transformContentForIde(
				content,
				"claude",
				InstructionCategory.SUBAGENTS,
				"researcher",
				agentFrontmatter,
			);
			expect(result).toContain("name: researcher");
			expect(result).toContain('description: "Agent description"');
			expect(result).toContain("model: fast");
			expect(result).toContain("permissionMode: plan");
			expect(result).not.toContain("readonly:");
			expect(result).toContain("# Agent body");
		});

		it("should omit model and permissionMode for claude subagents when model/readonly are not set", () => {
			const content = "# Agent body";
			const agentFrontmatter: RuleFrontmatter = {
				description: "Agent description",
			};
			const result = transformContentForIde(
				content,
				"claude",
				InstructionCategory.SUBAGENTS,
				"researcher",
				agentFrontmatter,
			);
			expect(result).toContain("name: researcher");
			expect(result).toContain('description: "Agent description"');
			expect(result).not.toContain("model:");
			expect(result).not.toContain("permissionMode:");
			expect(result).toContain("# Agent body");
		});

		it("should add skill frontmatter for SUBAGENTS on windsurf", () => {
			const content = "# Agent body";
			const agentFrontmatter: RuleFrontmatter = {
				description: "Agent description",
				model: "fast",
				readonly: true,
			};
			const result = transformContentForIde(
				content,
				"windsurf",
				InstructionCategory.SUBAGENTS,
				"researcher",
				agentFrontmatter,
			);
			expect(result).toContain("name: researcher");
			expect(result).toContain('description: "Agent description"');
			expect(result).not.toContain("model:");
			expect(result).toContain("# Agent body");
		});

		it("should add skill frontmatter for SUBAGENTS on cline", () => {
			const content = "# Agent body";
			const agentFrontmatter: RuleFrontmatter = {
				description: "Agent description",
				model: "fast",
				readonly: true,
			};
			const result = transformContentForIde(
				content,
				"cline",
				InstructionCategory.SUBAGENTS,
				"researcher",
				agentFrontmatter,
			);
			expect(result).toContain("name: researcher");
			expect(result).toContain('description: "Agent description"');
			expect(result).not.toContain("model:");
			expect(result).toContain("# Agent body");
		});
	});

	describe("writeInstructionToFile", () => {
		it("should write file with transformed content for cursor", async () => {
			const frontmatter: RuleFrontmatter = {
				description: "Test rule",
				paths: ["**/*.ts"],
				alwaysApply: false,
			};

			vi.mocked(ensureDirAsync).mockResolvedValue();
			vi.mocked(writeFileAsync).mockResolvedValue();

			const result = await writeInstructionToFile(
				"/project",
				"test-rule",
				"# Content here",
				"cursor",
				InstructionCategory.LANGUAGE,
				frontmatter,
			);

			expect(result).toBe("/project/.cursor/rules/test-rule.mdc");
			expect(ensureDirAsync).toHaveBeenCalledWith("/project/.cursor/rules");
			expect(writeFileAsync).toHaveBeenCalled();
			const writtenContent = (writeFileAsync as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[1];
			expect(writtenContent).toContain('description: "Test rule"');
		});

		it("should render known mustache placeholders in instruction content", async () => {
			const agentFrontmatter: RuleFrontmatter = {
				description: "Agent description",
				model: "fast",
				readonly: true,
			};

			vi.mocked(ensureDirAsync).mockResolvedValue();
			vi.mocked(writeFileAsync).mockResolvedValue();

			await writeInstructionToFile(
				"/project",
				"researcher",
				"# Body {{checkpointDir}} {{ideRoot}}",
				"cursor",
				InstructionCategory.SUBAGENTS,
				agentFrontmatter,
			);

			const writtenContent = (writeFileAsync as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[1];

			expect(writtenContent).toContain(".cursor/checkpoints");
			expect(writtenContent).toContain(".cursor");
		});

		it("should write file for windsurf without frontmatter transformation", async () => {
			const frontmatter: RuleFrontmatter = {
				description: "Test",
				alwaysApply: false,
			};

			vi.mocked(ensureDirAsync).mockResolvedValue();
			vi.mocked(writeFileAsync).mockResolvedValue();

			await writeInstructionToFile(
				"/project",
				"windsurf-rule",
				"# Windsurf content",
				"windsurf",
				InstructionCategory.LANGUAGE,
				frontmatter,
			);

			const writtenContent = (writeFileAsync as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[1];
			expect(writtenContent).not.toContain("description:");
			expect(writtenContent).toContain("# Windsurf content");
		});

		it("should write skills file to skills directory without extra frontmatter", async () => {
			const frontmatter: RuleFrontmatter = {
				description: "Skill",
				alwaysApply: true,
			};

			vi.mocked(ensureDirAsync).mockResolvedValue();
			vi.mocked(writeFileAsync).mockResolvedValue();

			const result = await writeInstructionToFile(
				"/project",
				"deploy-skill",
				"# Skill content",
				"cursor",
				InstructionCategory.SKILLS,
				frontmatter,
			);

			expect(result).toBe("/project/.cursor/skills/deploy-skill/SKILL.md");
			expect(ensureDirAsync).toHaveBeenCalledWith(
				"/project/.cursor/skills/deploy-skill",
			);
			const writtenContent = (writeFileAsync as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[1];
			// No Cursor rule frontmatter should be added for skills.
			expect(writtenContent).not.toContain("globs:");
		});
	});
});
