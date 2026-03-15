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

vi.mock("../../../src/core/constants", () => ({
	IS_LOCAL_MODE: false,
}));

vi.mock("../../../src/core/fs", () => ({
	copyDirSafeAsync: vi.fn(),
	ensureDirAsync: vi.fn(),
	isDirAsync: vi.fn(),
	removeFilesByBasename: vi.fn(),
	renderMustacheTemplates: vi.fn(),
	writeFileAsync: vi.fn(),
}));

vi.mock("../../../src/core/template-registry", () => ({
	resolveTemplatesDir: vi.fn(),
}));

vi.mock("../../../src/core/git", () => ({
	getGitEmail: vi.fn(),
	getGitUsername: vi.fn(),
}));

vi.mock("../../../src/core/pkg-manager", () => ({
	LANGUAGE_PACKAGE_REGISTRY: {
		typescript: "npm",
	},
	validatePackageName: vi.fn(),
}));

vi.mock("../../../src/core/template-registry", () => ({
	listAvailableTemplates: vi.fn(),
	resolveTemplatesDir: vi.fn(),
}));

vi.mock("../../../src/core/instructions-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/core/instructions-registry")>();
	return {
		...actual,
		getInstructionWithFrontmatter: vi.fn(),
		listAvailableInstructions: vi.fn(() => Promise.resolve([])),
		readOptionalInstructionsMapping: vi.fn(() => Promise.resolve([])),
	};
});

vi.mock("../../../src/core/utils", () => ({
	capitalizeFirstLetter: vi.fn(),
	toSlug: vi.fn(),
}));

vi.mock("../../../src/cli/prompts", () => ({
	default: {
		selectInput: vi.fn(),
		textInput: vi.fn(),
		confirmInput: vi.fn(),
	},
}));

vi.mock("../../../src/cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(async (goal, task) => {
			if (task) await task();
		}),
	},
}));

import fs from "node:fs";
import {
	copyDirSafeAsync,
	ensureDirAsync,
	isDirAsync,
	removeFilesByBasename,
	renderMustacheTemplates,
	writeFileAsync,
} from "../../../src/core/fs";
import { resolveTemplatesDir } from "../../../src/core/template-registry";
import { Language } from "../../../src/resources/package/config";

vi.mock("../../../src/resources/instructions/config", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/resources/instructions/config")>();
	return { ...actual };
});

vi.mock("../../../src/resources/instructions/ide-formats", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/resources/instructions/ide-formats")>();
	return {
		...actual,
		writeInstructionToFile: vi.fn(),
	};
});

// Import after mocks
import {
	addPackageInstructions,
	applyTemplateModifications,
	createPackageDirectory,
	getRequiredGithubSecrets,
	writePackageTemplateFiles,
} from "../../../src/resources/package/setup";
import {
	getInstructionWithFrontmatter,
	InstructionCategory,
	listAvailableInstructions,
} from "../../../src/core/instructions-registry";
import { writeInstructionToFile } from "../../../src/resources/instructions/ide-formats";

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
			} as any);

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
			} as any);

			expect(listAvailableInstructions).not.toHaveBeenCalled();
		});

		it("should no-op when language has no instruction", async () => {
			// No language instructions for this lang (list returns [])
			vi.mocked(listAvailableInstructions).mockResolvedValue([]);

			await addPackageInstructions("/target", {
				lang: "python" as any,
				name: "pkg",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor" as any,
			} as any);

			expect(getInstructionWithFrontmatter).not.toHaveBeenCalled();
			expect(writeInstructionToFile).not.toHaveBeenCalled();
		});

		it("should write instruction when config is complete", async () => {
			const metadata = {
				description: "TypeScript standards",
				paths: ["**/*.ts", "**/*.tsx"],
				alwaysApply: false,
			};
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
				instructionsIdeFormat: "cursor" as any,
			} as any);

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
	});

	describe("createPackageDirectory", () => {
		it("should create the package directory and return the absolute path", async () => {
			const cwd = "/home/user";
			const packageName = "my-package";
			const expectedPath = "/home/user/my-package";

			vi.mocked(ensureDirAsync).mockResolvedValue();

			const result = await createPackageDirectory(cwd, packageName);

			expect(ensureDirAsync).toHaveBeenCalledWith(expectedPath);
			expect(result).toBe(expectedPath);
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
				lang: "javascript" as any,
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
			const originalConfig = {
				root: false,
				$schema: "https://biomejs.dev/schemas/2.3.10/schema.json",
				formatter: { enabled: true },
			};
			const expectedConfig = {
				$schema: "https://biomejs.dev/schemas/2.3.10/schema.json",
				formatter: { enabled: true },
			};

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/template/dir");
			vi.mocked(isDirAsync).mockResolvedValue(false);
			vi.mocked(renderMustacheTemplates).mockResolvedValue();
			vi.mocked(fs.promises.access).mockResolvedValue();
			vi.mocked(fs.promises.readFile).mockResolvedValue(
				JSON.stringify(originalConfig, null, "\t"),
			);
			vi.mocked(fs.promises.writeFile).mockResolvedValue();

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(fs.promises.access).toHaveBeenCalledWith(biomeJsonPath);
			expect(fs.promises.readFile).toHaveBeenCalledWith(biomeJsonPath, "utf8");
			expect(fs.promises.writeFile).toHaveBeenCalledWith(
				biomeJsonPath,
				JSON.stringify(expectedConfig, null, "\t") + "\n",
			);
		});

		it("should do nothing if biome.json does not exist", async () => {
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
			vi.mocked(fs.promises.access).mockRejectedValue(new Error("ENOENT"));

			await applyTemplateModifications(
				targetDir,
				generateConfig,
				packageManagerVersion,
			);

			expect(fs.promises.access).toHaveBeenCalledWith(
				"/path/to/package/biome.json",
			);
			expect(fs.promises.readFile).not.toHaveBeenCalled();
			expect(fs.promises.writeFile).not.toHaveBeenCalled();
		});
	});

	describe("getRequiredGithubSecrets", () => {
		it("should return an empty array if no workflows directory exists", async () => {
			const targetDir = "/path/to/package";

			vi.mocked(fs.promises.readdir).mockRejectedValue(new Error("ENOENT"));

			const result = await getRequiredGithubSecrets(targetDir);

			expect(result).toEqual([]);
		});

		it("should extract and return sorted unique secrets from workflow files", async () => {
			const targetDir = "/path/to/package";
			const workflowsDir = "/path/to/package/.github/workflows";

			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "ci.yml", isFile: () => true, isDirectory: () => false },
				{ name: "release.yml", isFile: () => true, isDirectory: () => false },
			] as any);
			vi.mocked(fs.promises.readFile)
				.mockResolvedValueOnce("secrets.NPM_TOKEN and secrets.GITHUB_TOKEN")
				.mockResolvedValueOnce("secrets.CODECOV_TOKEN");

			const result = await getRequiredGithubSecrets(targetDir);

			expect(fs.promises.readdir).toHaveBeenCalledWith(workflowsDir, {
				withFileTypes: true,
			});
			expect(fs.promises.readFile).toHaveBeenCalledTimes(2);
			expect(result).toEqual(["CODECOV_TOKEN", "NPM_TOKEN"]);
		});

		it("should ignore GITHUB_TOKEN secrets", async () => {
			const targetDir = "/path/to/package";

			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "ci.yml", isFile: () => true, isDirectory: () => false },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("secrets.GITHUB_TOKEN");

			const result = await getRequiredGithubSecrets(targetDir);

			expect(result).toEqual([]);
		});
	});

	describe("writePackageTemplateFiles", () => {
		it("should copy template directories", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};

			vi.mocked(resolveTemplatesDir)
				.mockResolvedValueOnce("/templates/shared")
				.mockResolvedValueOnce("/templates/typescript/shared")
				.mockResolvedValueOnce("/templates/typescript/package/shared")
				.mockResolvedValueOnce("/templates/typescript/package/basic");
			vi.mocked(copyDirSafeAsync).mockResolvedValue();

			await writePackageTemplateFiles(targetDir, generateConfig);

			expect(resolveTemplatesDir).toHaveBeenCalledWith("shared");
			expect(resolveTemplatesDir).toHaveBeenCalledWith(
				Language.TYPESCRIPT,
				"shared",
			);
			expect(resolveTemplatesDir).toHaveBeenCalledWith(
				Language.TYPESCRIPT,
				"package/shared",
			);
			expect(resolveTemplatesDir).toHaveBeenCalledWith(
				Language.TYPESCRIPT,
				"package/basic",
			);
			expect(copyDirSafeAsync).toHaveBeenCalledTimes(4);
		});

		it("should add MIT license if package is public and authorName is provided", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: true,
				authorName: "John Doe",
			};

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/templates/dir");
			vi.mocked(copyDirSafeAsync).mockResolvedValue();
			vi.mocked(writeFileAsync).mockResolvedValue();

			// Mock Date
			const mockDate = new Date(2023, 0, 1);
			vi.spyOn(globalThis, "Date").mockImplementation(() => mockDate as any);

			await writePackageTemplateFiles(targetDir, generateConfig);

			expect(writeFileAsync).toHaveBeenCalledWith(
				"/path/to/package/LICENSE",
				"MIT License\n\nCopyright (c) 2023 John Doe\n\nPermission is hereby granted...",
			);

			vi.restoreAllMocks();
		});

		it("should not add license if package is not public", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/templates/dir");
			vi.mocked(copyDirSafeAsync).mockResolvedValue();

			await writePackageTemplateFiles(targetDir, generateConfig);

			expect(writeFileAsync).not.toHaveBeenCalled();
		});

		it("should not add license if authorName is not provided", async () => {
			const targetDir = "/path/to/package";
			const generateConfig = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: true,
				authorName: undefined,
			};

			vi.mocked(resolveTemplatesDir).mockResolvedValue("/templates/dir");
			vi.mocked(copyDirSafeAsync).mockResolvedValue();

			await writePackageTemplateFiles(targetDir, generateConfig);

			expect(writeFileAsync).not.toHaveBeenCalled();
		});
	});
});
