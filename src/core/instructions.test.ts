import { beforeEach, describe, expect, it, vi } from "vitest";

/** Toggled by tests to switch between local and remote mode. */
let isLocalMode = false;

const mockReadDir = vi.fn();
const mockReadFile = vi.fn();
const mockAccess = vi.fn();

vi.mock("node:fs", () => ({
	default: {
		promises: {
			readdir: (...args: unknown[]) => mockReadDir(...args),
			readFile: (...args: unknown[]) => mockReadFile(...args),
			access: (...args: unknown[]) => mockAccess(...args),
		},
		constants: { R_OK: 4 },
	},
}));

vi.mock("gray-matter", () => ({
	default: vi.fn(),
}));

vi.mock("yaml", () => ({
	parse: vi.fn(),
}));

vi.mock("./constants", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./constants")>();
	return {
		...actual,
		get IS_LOCAL_MODE() {
			return isLocalMode;
		},
	};
});

vi.mock("./fs", () => ({
	isDirAsync: vi.fn(),
}));

vi.mock("./registry.local", () => ({
	getLocalRoot: vi.fn(),
	resolveLocalTemplatesSubpath: vi.fn(),
}));

vi.mock("./registry.remote", () => ({
	listRemoteFilesViaAPI: vi.fn(),
	resolveRemoteSubpath: vi.fn(),
}));

// Import after mocks
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { isDirAsync } from "./fs";
import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	listAvailableInstructions,
	readSkillsMapping,
	readSubagentsMapping,
	readToolingInstructionsMapping,
	resolveInstructionsDir,
} from "./instructions";
import { getLocalRoot, resolveLocalTemplatesSubpath } from "./registry.local";
import { listRemoteFilesViaAPI, resolveRemoteSubpath } from "./registry.remote";

describe("core/instructions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isLocalMode = false;
	});

	describe("InstructionCategory", () => {
		it("should define expected category values", () => {
			expect(InstructionCategory.ESSENTIAL).toBe("essential");
			expect(InstructionCategory.TOOLING).toBe("tooling");
			expect(InstructionCategory.SKILLS).toBe("skills");
			expect(InstructionCategory.LANGUAGE).toBe("language");
			expect(InstructionCategory.PROJECT_SPEC).toBe("project-spec");
			expect(InstructionCategory.TEMPLATE).toBe("template");
		});
	});

	describe("resolveInstructionsDir", () => {
		describe("getInstructionsSubpath (via resolveInstructionsDir)", () => {
			it("should throw for LANGUAGE without lang context", async () => {
				await expect(
					resolveInstructionsDir(InstructionCategory.LANGUAGE),
				).rejects.toThrow(
					/Instruction category "language" requires a language context/,
				);
			});

			it("should throw for PROJECT_SPEC without lang or projectSpec context", async () => {
				await expect(
					resolveInstructionsDir(InstructionCategory.PROJECT_SPEC),
				).rejects.toThrow(
					/Instruction category "project-spec" requires language and projectSpec context/,
				);
				await expect(
					resolveInstructionsDir(InstructionCategory.PROJECT_SPEC, {
						lang: "typescript",
					}),
				).rejects.toThrow(
					/Instruction category "project-spec" requires language and projectSpec context/,
				);
			});

			it("should throw for TEMPLATE without full context", async () => {
				await expect(
					resolveInstructionsDir(InstructionCategory.TEMPLATE, {
						lang: "typescript",
						projectSpec: "package",
					}),
				).rejects.toThrow(
					/Instruction category "template" requires language, projectSpec, and template context/,
				);
			});

			it("should throw for unknown instruction category", async () => {
				await expect(
					resolveInstructionsDir("unknown" as InstructionCategory),
				).rejects.toThrow(/Unknown instruction category: "unknown"/);
			});
		});

		describe("local mode", () => {
			beforeEach(() => {
				isLocalMode = true;
			});

			it("should resolve ESSENTIAL instructions dir", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValueOnce(
					"/local/templates/instructions/essential",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveInstructionsDir(
					InstructionCategory.ESSENTIAL,
				);

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/instructions/essential",
				);
				expect(result).toBe("/local/templates/instructions/essential");
			});

			it("should resolve SKILLS instructions dir", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValueOnce(
					"/local/templates/instructions/skills",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveInstructionsDir(InstructionCategory.SKILLS);

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/instructions/skills",
				);
				expect(result).toBe("/local/templates/instructions/skills");
			});

			it("should resolve SUBAGENTS instructions dir", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValueOnce(
					"/local/templates/instructions/subagents",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveInstructionsDir(
					InstructionCategory.SUBAGENTS,
				);

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/instructions/subagents",
				);
				expect(result).toBe("/local/templates/instructions/subagents");
			});

			it("should resolve TOOLING instructions dir", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValueOnce(
					"/local/templates/instructions/tooling",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveInstructionsDir(
					InstructionCategory.TOOLING,
				);

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/instructions/tooling",
				);
				expect(result).toBe("/local/templates/instructions/tooling");
			});

			it("should resolve LANGUAGE instructions dir with context", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/typescript/instructions",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveInstructionsDir(
					InstructionCategory.LANGUAGE,
					{ lang: "typescript" },
				);

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/typescript/instructions",
				);
				expect(result).toBe("/local/templates/typescript/instructions");
			});

			it("should resolve PROJECT_SPEC instructions dir with context", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/typescript/package/instructions",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveInstructionsDir(
					InstructionCategory.PROJECT_SPEC,
					{ lang: "typescript", projectSpec: "package" },
				);

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/typescript/package/instructions",
				);
				expect(result).toBe("/local/templates/typescript/package/instructions");
			});

			it("should resolve TEMPLATE instructions dir with context", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/typescript/package/basic/instructions",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveInstructionsDir(
					InstructionCategory.TEMPLATE,
					{
						lang: "typescript",
						projectSpec: "package",
						template: "basic",
					},
				);

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/typescript/package/basic/instructions",
				);
				expect(result).toBe(
					"/local/templates/typescript/package/basic/instructions",
				);
			});

			it("should throw when resolved path is not a directory", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/instructions/essential",
				);
				vi.mocked(isDirAsync).mockResolvedValue(false);
				vi.mocked(getLocalRoot).mockResolvedValue("/local/templates");

				await expect(
					resolveInstructionsDir(InstructionCategory.ESSENTIAL),
				).rejects.toThrow(/Local instructions not found for category/);
			});

			it("should throw when no local templates root", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(null);
				vi.mocked(getLocalRoot).mockResolvedValue(null);

				await expect(
					resolveInstructionsDir(InstructionCategory.ESSENTIAL),
				).rejects.toThrow("No local templates root found.");
			});

			it("should throw with expected path in error when dir not found", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(null);
				vi.mocked(getLocalRoot).mockResolvedValue("/local/templates");
				vi.mocked(isDirAsync).mockResolvedValue(false);

				await expect(
					resolveInstructionsDir(InstructionCategory.ESSENTIAL),
				).rejects.toThrow(
					/Local instructions not found for category "essential". Expected directory at/,
				);
			});
		});

		describe("remote mode", () => {
			it("should resolve ESSENTIAL via download", async () => {
				vi.mocked(resolveRemoteSubpath).mockResolvedValue(
					"/tmp/yehle-instructions-xxx/templates/instructions/essential",
				);

				const result = await resolveInstructionsDir(
					InstructionCategory.ESSENTIAL,
				);

				expect(resolveRemoteSubpath).toHaveBeenCalledWith(
					"templates/instructions/essential",
					"yehle-instructions-",
					expect.any(Function),
				);
				expect(result).toBe(
					"/tmp/yehle-instructions-xxx/templates/instructions/essential",
				);
			});

			it("should resolve LANGUAGE with context via download", async () => {
				vi.mocked(resolveRemoteSubpath).mockResolvedValue(
					"/tmp/yehle-instructions-xxx/templates/typescript/instructions",
				);

				const result = await resolveInstructionsDir(
					InstructionCategory.LANGUAGE,
					{ lang: "typescript" },
				);

				expect(resolveRemoteSubpath).toHaveBeenCalledWith(
					"templates/typescript/instructions",
					"yehle-instructions-",
					expect.any(Function),
				);
				expect(result).toBe(
					"/tmp/yehle-instructions-xxx/templates/typescript/instructions",
				);
			});

			it("should return downloadedDir when candidate subpath is not a directory", async () => {
				const downloadedDir = "/tmp/yehle-instructions-abc";
				vi.mocked(resolveRemoteSubpath).mockImplementation(
					async (_subpath, _tmpPrefix, normalize) => {
						const result = normalize
							? await normalize(downloadedDir)
							: downloadedDir;
						return result;
					},
				);
				// Candidate path (downloadedDir/templates/instructions/essential) does not exist
				vi.mocked(isDirAsync).mockResolvedValue(false);

				const result = await resolveInstructionsDir(
					InstructionCategory.ESSENTIAL,
				);

				expect(result).toBe(downloadedDir);
			});
		});
	});

	describe("listAvailableInstructions", () => {
		describe("local mode", () => {
			beforeEach(() => {
				isLocalMode = true;
			});

			it("should return empty array when subpath not found", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(null);

				const result = await listAvailableInstructions(
					InstructionCategory.ESSENTIAL,
				);

				expect(result).toEqual([]);
			});

			it("should return sorted instruction names from directory", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/instructions/essential",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);
				mockReadDir.mockResolvedValue([
					{ name: "code-style.mdc", isFile: () => true },
					{ name: "testing.md", isFile: () => true },
					{ name: "readme.txt", isFile: () => true },
				]);

				const result = await listAvailableInstructions(
					InstructionCategory.ESSENTIAL,
				);

				expect(result).toEqual(["code-style", "testing"]);
			});

			it("should return empty array when dir does not exist", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/instructions/essential",
				);
				vi.mocked(isDirAsync).mockResolvedValue(false);

				const result = await listAvailableInstructions(
					InstructionCategory.ESSENTIAL,
				);

				expect(result).toEqual([]);
			});
		});

		describe("remote mode", () => {
			it("should return names from listRemoteFilesViaAPI", async () => {
				vi.mocked(listRemoteFilesViaAPI).mockResolvedValue([
					"code-style",
					"testing",
				]);

				const result = await listAvailableInstructions(
					InstructionCategory.ESSENTIAL,
				);

				expect(listRemoteFilesViaAPI).toHaveBeenCalledWith(
					"templates/instructions/essential",
					[".mdc", ".md"],
				);
				expect(result).toEqual(["code-style", "testing"]);
			});

			it("should pass correct subpath for LANGUAGE with context", async () => {
				vi.mocked(listRemoteFilesViaAPI).mockResolvedValue([]);

				await listAvailableInstructions(InstructionCategory.LANGUAGE, {
					lang: "typescript",
				});

				expect(listRemoteFilesViaAPI).toHaveBeenCalledWith(
					"templates/typescript/instructions",
					[".mdc", ".md"],
				);
			});
		});
	});

	describe("getInstructionWithFrontmatter", () => {
		beforeEach(() => {
			isLocalMode = true;
		});

		it("should resolve dir, find .mdc file, and parse content", async () => {
			vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
				"/local/instructions/essential",
			);
			vi.mocked(isDirAsync).mockResolvedValue(true);
			mockAccess.mockRejectedValueOnce(new Error("not found")); // .mdc first
			mockAccess.mockResolvedValueOnce(undefined); // .md exists
			mockReadFile.mockResolvedValue(
				"---\ndescription: Code style\n---\n\nUse Biome.",
			);
			vi.mocked(matter).mockReturnValue({
				data: { description: "Code style" },
				content: "\n\nUse Biome.",
			} as unknown as ReturnType<typeof matter>);

			const result = await getInstructionWithFrontmatter(
				InstructionCategory.ESSENTIAL,
				"code-style",
			);

			expect(result).toEqual({
				content: "Use Biome.",
				frontmatter: { description: "Code style" },
			});
		});

		it("should use .mdc when it exists before .md", async () => {
			vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
				"/local/instructions/essential",
			);
			vi.mocked(isDirAsync).mockResolvedValue(true);
			mockAccess.mockResolvedValue(undefined); // .mdc exists
			mockReadFile.mockResolvedValue("---\n---\nBody");
			vi.mocked(matter).mockReturnValue({
				data: {},
				content: "Body",
			} as ReturnType<typeof matter>);

			const result = await getInstructionWithFrontmatter(
				InstructionCategory.ESSENTIAL,
				"code-style",
			);

			expect(mockAccess).toHaveBeenCalledWith(
				"/local/instructions/essential/code-style.mdc",
				4,
			);
			expect(result.content).toBe("Body");
		});

		it("should throw when instruction file not found", async () => {
			vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
				"/local/instructions/essential",
			);
			vi.mocked(isDirAsync).mockResolvedValue(true);
			mockAccess.mockRejectedValue(new Error("not found"));

			await expect(
				getInstructionWithFrontmatter(
					InstructionCategory.ESSENTIAL,
					"nonexistent",
				),
			).rejects.toThrow(
				/Instruction "nonexistent" not found in essential \(looked for \.mdc and \.md\)/,
			);
		});

		it("should normalize frontmatter (description, paths, alwaysApply)", async () => {
			vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
				"/local/instructions/essential",
			);
			vi.mocked(isDirAsync).mockResolvedValue(true);
			mockAccess.mockResolvedValue(undefined);
			mockReadFile.mockResolvedValue("body");
			vi.mocked(matter).mockReturnValue({
				data: {
					description: "Desc",
					paths: ["src/**"],
					alwaysApply: true,
				},
				content: "body",
			} as unknown as ReturnType<typeof matter>);

			const result = await getInstructionWithFrontmatter(
				InstructionCategory.ESSENTIAL,
				"rule",
			);

			expect(result.frontmatter).toEqual({
				description: "Desc",
				paths: ["src/**"],
				alwaysApply: true,
			});
			expect(result.content).toBe("body");
		});

		it("should trim content and ignore invalid frontmatter values", async () => {
			vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
				"/local/instructions/essential",
			);
			vi.mocked(isDirAsync).mockResolvedValue(true);
			mockAccess.mockResolvedValue(undefined);
			mockReadFile.mockResolvedValue("  \n\n  body  \n");
			vi.mocked(matter).mockReturnValue({
				data: {
					description: 123,
					paths: "not-array",
					alwaysApply: "yes",
				},
				content: "  \n\n  body  \n",
			} as unknown as ReturnType<typeof matter>);

			const result = await getInstructionWithFrontmatter(
				InstructionCategory.ESSENTIAL,
				"rule",
			);

			expect(result.content).toBe("body");
			expect(result.frontmatter).toEqual({});
		});
	});

	describe("readToolingInstructionsMapping", () => {
		it("should return empty array when file does not exist", async () => {
			mockReadFile.mockRejectedValue(new Error("ENOENT"));

			const result = await readToolingInstructionsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});

		it("should return empty array when YAML is invalid", async () => {
			mockReadFile.mockResolvedValue("not: valid: yaml: [");

			const result = await readToolingInstructionsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});

		it("should return empty array when no toolingInstructions key", async () => {
			mockReadFile.mockResolvedValue("otherKey: value");
			vi.mocked(parseYaml).mockReturnValue({ otherKey: "value" });

			const result = await readToolingInstructionsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});

		it("should return toolingInstructions array when present", async () => {
			mockReadFile.mockResolvedValue(
				"toolingInstructions:\n  - react\n  - sonarqube",
			);
			vi.mocked(parseYaml).mockReturnValue({
				toolingInstructions: ["react", "sonarqube"],
			});

			const result = await readToolingInstructionsMapping("/some/template/dir");

			expect(mockReadFile).toHaveBeenCalledWith(
				"/some/template/dir/yehle.yaml",
				"utf8",
			);
			expect(result).toEqual(["react", "sonarqube"]);
		});

		it("should return empty array when toolingInstructions is not an array", async () => {
			mockReadFile.mockResolvedValue("toolingInstructions: react");
			vi.mocked(parseYaml).mockReturnValue({
				toolingInstructions: "react",
			});

			const result = await readToolingInstructionsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});
	});

	describe("readSkillsMapping", () => {
		it("should return empty array when file does not exist", async () => {
			mockReadFile.mockRejectedValue(new Error("ENOENT"));

			const result = await readSkillsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});

		it("should return empty array when YAML is invalid", async () => {
			mockReadFile.mockResolvedValue("not: valid: yaml: [");

			const result = await readSkillsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});

		it("should return empty array when no skills key", async () => {
			mockReadFile.mockResolvedValue("otherKey: value");
			vi.mocked(parseYaml).mockReturnValue({ otherKey: "value" });

			const result = await readSkillsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});

		it("should return skills array when present", async () => {
			mockReadFile.mockResolvedValue("skills:\n  - react\n  - terraform");
			vi.mocked(parseYaml).mockReturnValue({
				skills: ["react", "terraform"],
			});

			const result = await readSkillsMapping("/some/template/dir");

			expect(mockReadFile).toHaveBeenCalledWith(
				"/some/template/dir/yehle.yaml",
				"utf8",
			);
			expect(result).toEqual(["react", "terraform"]);
		});

		it("should return empty array when skills is not an array", async () => {
			mockReadFile.mockResolvedValue("skills: react");
			vi.mocked(parseYaml).mockReturnValue({
				skills: "react",
			});

			const result = await readSkillsMapping("/some/template/dir");

			expect(result).toEqual([]);
		});

		describe("readSubagentsMapping", () => {
			it("should return empty array when file does not exist", async () => {
				mockReadFile.mockRejectedValue(new Error("ENOENT"));

				const result = await readSubagentsMapping("/some/template/dir");

				expect(result).toEqual([]);
			});

			it("should return empty array when YAML is invalid", async () => {
				mockReadFile.mockResolvedValue("not: valid: yaml: [");

				const result = await readSubagentsMapping("/some/template/dir");

				expect(result).toEqual([]);
			});

			it("should return empty array when no subagents key", async () => {
				mockReadFile.mockResolvedValue("otherKey: value");
				vi.mocked(parseYaml).mockReturnValue({ otherKey: "value" });

				const result = await readSubagentsMapping("/some/template/dir");

				expect(result).toEqual([]);
			});

			it("should return subagents array when present", async () => {
				mockReadFile.mockResolvedValue(
					"subagents:\n  - researcher\n  - verifier",
				);
				vi.mocked(parseYaml).mockReturnValue({
					subagents: ["researcher", "verifier"],
				});

				const result = await readSubagentsMapping("/some/template/dir");

				expect(mockReadFile).toHaveBeenCalledWith(
					"/some/template/dir/yehle.yaml",
					"utf8",
				);
				expect(result).toEqual(["researcher", "verifier"]);
			});

			it("should return empty array when subagents is not an array", async () => {
				mockReadFile.mockResolvedValue("subagents: researcher");
				vi.mocked(parseYaml).mockReturnValue({
					subagents: "researcher",
				});

				const result = await readSubagentsMapping("/some/template/dir");

				expect(result).toEqual([]);
			});
		});
	});
});
