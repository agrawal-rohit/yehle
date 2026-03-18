import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node modules and internal modules
vi.mock("node:fs", () => ({
	default: {
		promises: {
			readdir: vi.fn(),
			readFile: vi.fn(),
			access: vi.fn(),
			writeFile: vi.fn(),
		},
	},
}));

vi.mock("spdx-license-list/licenses/MIT.json", () => ({
	default: {
		licenseText:
			"MIT License\n\nCopyright (c) <year> <copyright holders>\n\nPermission is hereby granted...",
	},
}));

vi.mock("../../core/constants", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../core/constants")>();
	return {
		...actual,
		IS_LOCAL_MODE: false,
	};
});

vi.mock("../../core/fs", () => ({
	copyDirSafeAsync: vi.fn(),
	ensureDirAsync: vi.fn(),
	isDirAsync: vi.fn(),
	removeFilesByBasename: vi.fn(),
	renderMustacheTemplates: vi.fn(),
	stripJsonKey: vi.fn(),
	writeFileAsync: vi.fn(),
}));

vi.mock("../../core/git", () => ({
	getGitEmail: vi.fn(),
	getGitUsername: vi.fn(),
}));

vi.mock("../../core/pkg-manager", () => ({
	LANGUAGE_PACKAGE_REGISTRY: {
		typescript: "npm",
	},
	validatePackageName: vi.fn(),
}));

vi.mock("../../core/templates", () => ({
	listAvailableTemplates: vi.fn(),
	resolveTemplatesDir: vi.fn(),
}));

vi.mock("../../core/instructions", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../core/instructions")>();
	return {
		...actual,
		getInstructionWithFrontmatter: vi.fn(),
		listAvailableInstructions: vi.fn(() => Promise.resolve([])),
		readToolingInstructionsMapping: vi.fn(() => Promise.resolve([])),
		readSkillsMapping: vi.fn(() => Promise.resolve([])),
	};
});

vi.mock("../../core/utils", () => ({
	capitalizeFirstLetter: vi.fn(),
	toSlug: vi.fn(),
}));

vi.mock("../../cli/prompts", () => ({
	default: {
		selectInput: vi.fn(),
		textInput: vi.fn(),
		confirmInput: vi.fn(),
	},
}));

vi.mock("../../cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(async (_, task) => {
			if (task) await task();
		}),
	},
}));

import { Language } from "../../core/constants";
import {
	isDirAsync,
	removeFilesByBasename,
	renderMustacheTemplates,
	stripJsonKey,
} from "../../core/fs";
import { resolveTemplatesDir } from "../../core/templates";

vi.mock("../../resources/instructions/config", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../instructions/config")>();
	return { ...actual };
});

vi.mock("../../resources/instructions/ide-formats", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../instructions/ide-formats")>();
	return {
		...actual,
		writeInstructionToFile: vi.fn(),
	};
});

import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	listAvailableInstructions,
	readSkillsMapping,
	readToolingInstructionsMapping,
} from "../../core/instructions";
import { writeInstructionToFile } from "../instructions/ide-formats";
// Import after mocks
import { addPackageInstructions, applyTemplateModifications } from "./setup";

describe("resources/package/setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("addPackageInstructions", () => {
		it("should no-op when includeInstructions is false", async () => {
			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
			});

			expect(listAvailableInstructions).not.toHaveBeenCalled();
			expect(writeInstructionToFile).not.toHaveBeenCalled();
		});

		it("should no-op when instructionsIdeFormat is missing", async () => {
			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: undefined,
			});

			expect(listAvailableInstructions).not.toHaveBeenCalled();
		});

		// Language without instructions now still resolves templates dirs for tooling/skills mapping,
		// so we only assert that no language-category instructions are written.
		it("should not write language instructions when language has no instruction", async () => {
			vi.mocked(listAvailableInstructions).mockImplementation((category) => {
				if (category === InstructionCategory.LANGUAGE)
					return Promise.resolve([]);
				return Promise.resolve([]);
			});
			vi.mocked(resolveTemplatesDir)
				.mockResolvedValueOnce("/templates/no-lang") // lang
				.mockResolvedValueOnce("/templates/no-lang/package") // project-spec
				.mockResolvedValueOnce("/templates/no-lang/package/basic"); // template
			vi.mocked(readToolingInstructionsMapping).mockResolvedValue([]);
			vi.mocked(readSkillsMapping).mockResolvedValue([]);

			await addPackageInstructions("/target", {
				lang: "no-lang" as Language,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			});

			expect(
				vi
					.mocked(listAvailableInstructions)
					.mock.calls.find(([cat]) => cat === InstructionCategory.LANGUAGE),
			).toBeTruthy();
			expect(
				vi
					.mocked(writeInstructionToFile)
					.mock.calls.find(
						([, , , , cat]) => cat === InstructionCategory.LANGUAGE,
					),
			).toBeUndefined();
		});

		it("should write instruction when config is complete", async () => {
			const metadata = {
				description: "TypeScript standards",
				paths: ["**/*.ts", "**/*.tsx"],
				alwaysApply: false,
			};
			vi.mocked(resolveTemplatesDir)
				.mockResolvedValueOnce("/templates/typescript") // lang
				.mockResolvedValueOnce("/templates/typescript/package") // project-spec
				.mockResolvedValueOnce("/templates/typescript/package/basic"); // template
			vi.mocked(readToolingInstructionsMapping).mockResolvedValue([]);
			vi.mocked(readSkillsMapping).mockResolvedValue([]);
			vi.mocked(listAvailableInstructions).mockImplementation(
				(category, context) => {
					if (
						category === InstructionCategory.LANGUAGE &&
						context?.lang === "typescript"
					) {
						return Promise.resolve(["typescript"]);
					}
					return Promise.resolve([]);
				},
			);
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# TS rules",
				frontmatter: metadata,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/target/.cursor/rules/typescript.mdc",
			);

			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			});

			expect(listAvailableInstructions).toHaveBeenCalledWith(
				InstructionCategory.LANGUAGE,
				{ lang: "typescript" },
			);
			expect(getInstructionWithFrontmatter).toHaveBeenCalledWith(
				InstructionCategory.LANGUAGE,
				"typescript",
				{ lang: "typescript" },
			);
			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/target",
				"typescript",
				"# TS rules",
				"cursor",
				InstructionCategory.LANGUAGE,
				metadata,
			);
		});

		it("should write essential instructions when available", async () => {
			const metadata = {
				description: "Essential rules",
				paths: ["**/*"],
				alwaysApply: true,
			};
			vi.mocked(resolveTemplatesDir)
				.mockResolvedValueOnce("/templates/typescript") // lang
				.mockResolvedValueOnce("/templates/typescript/package") // project-spec
				.mockResolvedValueOnce("/templates/typescript/package/basic"); // template
			vi.mocked(readToolingInstructionsMapping).mockResolvedValue([]);
			vi.mocked(readSkillsMapping).mockResolvedValue([]);
			vi.mocked(listAvailableInstructions).mockImplementation((category) => {
				if (category === InstructionCategory.ESSENTIAL) {
					return Promise.resolve(["essential-rule"]);
				}
				if (category === InstructionCategory.LANGUAGE) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.PROJECT_SPEC) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.TEMPLATE) {
					return Promise.resolve([]);
				}
				return Promise.resolve([]);
			});
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# Essential",
				frontmatter: metadata,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/target/.cursor/rules/essential-rule.mdc",
			);

			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			});

			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/target",
				"essential-rule",
				"# Essential",
				"cursor",
				InstructionCategory.ESSENTIAL,
				metadata,
			);
		});

		it("should write project-spec instructions when available", async () => {
			const metadata = {
				description: "Package rules",
				paths: ["package.json"],
				alwaysApply: false,
			};
			vi.mocked(resolveTemplatesDir)
				.mockResolvedValueOnce("/templates/typescript") // lang
				.mockResolvedValueOnce("/templates/typescript/package") // project-spec
				.mockResolvedValueOnce("/templates/typescript/package/basic"); // template
			vi.mocked(readToolingInstructionsMapping).mockResolvedValue([]);
			vi.mocked(readSkillsMapping).mockResolvedValue([]);
			vi.mocked(listAvailableInstructions).mockImplementation(
				(category, context) => {
					if (category === InstructionCategory.ESSENTIAL) {
						return Promise.resolve([]);
					}
					if (category === InstructionCategory.LANGUAGE) {
						return Promise.resolve([]);
					}
					if (
						category === InstructionCategory.PROJECT_SPEC &&
						context?.projectSpec === "package"
					) {
						return Promise.resolve(["package-rule"]);
					}
					if (category === InstructionCategory.TEMPLATE) {
						return Promise.resolve([]);
					}
					return Promise.resolve([]);
				},
			);
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# Package rules",
				frontmatter: metadata,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/target/.cursor/rules/package-rule.mdc",
			);

			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			});

			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/target",
				"package-rule",
				"# Package rules",
				"cursor",
				InstructionCategory.PROJECT_SPEC,
				metadata,
			);
		});

		it("should write template instructions when available", async () => {
			const metadata = {
				description: "Basic template rules",
				paths: ["src/**/*"],
				alwaysApply: false,
			};
			vi.mocked(listAvailableInstructions).mockImplementation((category) => {
				if (category === InstructionCategory.ESSENTIAL) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.LANGUAGE) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.PROJECT_SPEC) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.TEMPLATE) {
					return Promise.resolve(["basic-rule"]);
				}
				return Promise.resolve([]);
			});
			vi.mocked(resolveTemplatesDir).mockResolvedValue(
				"/templates/typescript/package/basic",
			);
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# Basic template",
				frontmatter: metadata,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/target/.cursor/rules/basic-rule.mdc",
			);

			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			});

			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/target",
				"basic-rule",
				"# Basic template",
				"cursor",
				InstructionCategory.TEMPLATE,
				metadata,
			);
		});

		it("should write tooling instructions from yehle.yaml across scopes when available", async () => {
			const metadata = {
				description: "Tooling rules",
				paths: ["**/*.ts"],
				alwaysApply: false,
			};
			vi.mocked(listAvailableInstructions).mockImplementation((category) => {
				if (category === InstructionCategory.ESSENTIAL) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.LANGUAGE) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.PROJECT_SPEC) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.TEMPLATE) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.TOOLING) {
					return Promise.resolve(["tooling-rule"]);
				}
				return Promise.resolve([]);
			});
			vi.mocked(resolveTemplatesDir)
				.mockResolvedValueOnce("/templates/typescript") // lang
				.mockResolvedValueOnce("/templates/typescript/package") // project-spec
				.mockResolvedValueOnce("/templates/typescript/package/basic"); // template
			vi.mocked(readToolingInstructionsMapping)
				.mockResolvedValueOnce(["tooling-rule"]) // lang
				.mockResolvedValueOnce([]) // project-spec
				.mockResolvedValueOnce(["tooling-rule"]); // template (duplicate)
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# Tooling",
				frontmatter: metadata,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/target/.cursor/rules/tooling-rule.mdc",
			);

			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			});

			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/target",
				"tooling-rule",
				"# Tooling",
				"cursor",
				InstructionCategory.TOOLING,
				metadata,
			);
		});

		it("should write skills instructions from template yehle.yaml when available", async () => {
			const metadata = {
				description: "Skills rules",
				paths: ["**/*.ts"],
				alwaysApply: false,
			};
			vi.mocked(listAvailableInstructions).mockImplementation((category) => {
				if (category === InstructionCategory.ESSENTIAL) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.LANGUAGE) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.PROJECT_SPEC) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.TEMPLATE) {
					return Promise.resolve([]);
				}
				if (category === InstructionCategory.SKILLS) {
					return Promise.resolve(["skills-react"]);
				}
				return Promise.resolve([]);
			});
			vi.mocked(resolveTemplatesDir).mockResolvedValue(
				"/templates/typescript/package/basic",
			);
			vi.mocked(readSkillsMapping).mockResolvedValue(["skills-react"]);
			vi.mocked(getInstructionWithFrontmatter).mockResolvedValue({
				content: "# React skills",
				frontmatter: metadata,
			});
			vi.mocked(writeInstructionToFile).mockResolvedValue(
				"/target/.cursor/rules/skills-react.mdc",
			);

			await addPackageInstructions("/target", {
				lang: Language.TYPESCRIPT,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			});

			expect(writeInstructionToFile).toHaveBeenCalledWith(
				"/target",
				"skills-react",
				"# React skills",
				"cursor",
				InstructionCategory.SKILLS,
				metadata,
			);
		});
	});

	describe("applyTemplateModifications", () => {
		it("should render mustache templates with metadata", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: true,
				authorName: "John Doe",
			};
			const packageManagerVersion = "pnpm@9.0.0";
			const expectedMetadata = {
				packageManagerVersion,
				templateHasPlayground: true,
				...generateConfig,
			};

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/template/dir");
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(renderMustacheTemplates).mockResolvedValue();

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(renderMustacheTemplates).toHaveBeenCalledWith(
				targetDir,
				expectedMetadata,
			);
		});

		it("should remove public files if package is not public", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "default",
				public: false,
			};
			const packageManagerVersion = "pnpm@9.0.0";

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/template/dir");
			vi.mocked(isDirAsync).mockResolvedValue(false);
			vi.mocked(renderMustacheTemplates).mockResolvedValue();
			vi.mocked(removeFilesByBasename).mockResolvedValue();

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(removeFilesByBasename).toHaveBeenCalledWith(targetDir, [
				"CODE_OF_CONDUCT.md",
				"CONTRIBUTING.md",
				"issue_template",
				"pull_request_template.md",
				"release.mustache.yml",
			]);
		});

		it("should handle lang not in templatePublicPaths when removing public files", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: "javascript" as unknown as Language,
				name: "test-package",
				template: "default",
				public: false,
			};
			const packageManagerVersion = "pnpm@9.0.0";

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/template/dir");
			vi.mocked(isDirAsync).mockResolvedValue(false);
			vi.mocked(renderMustacheTemplates).mockResolvedValue();
			vi.mocked(removeFilesByBasename).mockResolvedValue();

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(removeFilesByBasename).toHaveBeenCalledWith(targetDir, [
				"CODE_OF_CONDUCT.md",
				"CONTRIBUTING.md",
				"issue_template",
				"pull_request_template.md",
			]);
		});

		it("should not remove public files if package is public", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: true,
			};
			const packageManagerVersion = "pnpm@9.0.0";

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/template/dir");
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(renderMustacheTemplates).mockResolvedValue();

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(removeFilesByBasename).not.toHaveBeenCalled();
		});

		it("should remove the 'root' property from biome.json if it exists", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: true,
			};
			const packageManagerVersion = "pnpm@9.0.0";
			const biomeJsonPath = "/path/to/package/biome.json";

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/template/dir");
			vi.mocked(isDirAsync).mockResolvedValue(false);
			vi.mocked(renderMustacheTemplates).mockResolvedValue();
			vi.mocked(stripJsonKey).mockResolvedValue();

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(stripJsonKey).toHaveBeenCalledWith(biomeJsonPath, "root");
		});

		it("should call stripJsonKey for biome.json even when file does not exist", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: true,
			};
			const packageManagerVersion = "pnpm@9.0.0";

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/template/dir");
			vi.mocked(isDirAsync).mockResolvedValue(false);
			vi.mocked(renderMustacheTemplates).mockResolvedValue();
			vi.mocked(stripJsonKey).mockResolvedValue();

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(stripJsonKey).toHaveBeenCalledWith(
				"/path/to/package/biome.json",
				"root",
			);
		});
	});
});
