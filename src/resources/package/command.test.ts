import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node modules
vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn(),
		readdirSync: vi.fn(),
	},
}));

vi.mock("node:path", () => ({
	default: {
		resolve: vi.fn(),
	},
}));

vi.mock("chalk", () => ({
	default: {
		bold: vi.fn((text) => text),
		magentaBright: vi.fn((text) => text),
	},
}));

// Mock internal modules
vi.mock("../../cli/logger", () => ({
	default: {
		intro: vi.fn(),
	},
	primaryText: vi.fn((text) => text),
}));

vi.mock("../../cli/tasks", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../cli/tasks")>();
	const mockRunWithTasks = vi.fn(
		async (
			_goal: string,
			task?: () => Promise<void>,
			subtasks?: { task?: () => Promise<void> }[],
		) => {
			if (task) await task();
			if (subtasks) {
				for (const sub of subtasks) {
					if (sub.task) await sub.task();
				}
			}
		},
	);
	return {
		...actual,
		default: {
			runWithTasks: mockRunWithTasks,
			task: actual.default.task,
			conditionalTask: actual.default.conditionalTask,
		},
	};
});

vi.mock("../../core/git", () => ({
	initGitRepo: vi.fn(),
	makeInitialCommit: vi.fn(),
}));

vi.mock("../../core/pkg-manager", () => ({
	ensurePackageManager: vi.fn(),
	getInstallScript: vi.fn(),
	LANGUAGE_PACKAGE_MANAGER: {
		js: "npm",
		ts: "npm",
	},
}));

vi.mock("../../core/utils", () => ({
	toSlug: vi.fn(),
}));

vi.mock("../../resources/package/config", () => ({
	getGeneratePackageConfiguration: vi.fn(),
	Language: { TYPESCRIPT: "typescript" },
}));

vi.mock("../../core/setup", () => ({
	createProjectDirectory: vi.fn(),
	getRequiredGithubSecrets: vi.fn(),
	writeTemplateFiles: vi.fn(),
}));

vi.mock("../../resources/package/setup", () => ({
	addPackageInstructions: vi.fn(),
	applyTemplateModifications: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import logger from "../../cli/logger";
import tasks from "../../cli/tasks";
import { Language } from "../../core/constants";
import { initGitRepo, makeInitialCommit } from "../../core/git";
import { ensurePackageManager, getInstallScript } from "../../core/pkg-manager";
import {
	createProjectDirectory,
	getRequiredGithubSecrets,
	writeTemplateFiles,
} from "../../core/setup";
import { toSlug } from "../../core/utils";
// Import after mocks
import { generatePackage } from "./command";
import {
	type GeneratePackageConfiguration,
	getGeneratePackageConfiguration,
} from "./config";
import { addPackageInstructions, applyTemplateModifications } from "./setup";

describe("resources/package/command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("generatePackage", () => {
		it("should call logger.intro to start the process", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};

			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage({});

			// Assert
			expect(logger.intro).toHaveBeenCalledWith("generating package...");
		});

		it("should retrieve package configuration", async () => {
			// Arrange
			const options: Partial<GeneratePackageConfiguration> = {
				lang: Language.TYPESCRIPT,
				name: "my-package",
			};
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "my-package",
				template: "advanced",
				public: true,
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("my-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/my-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/my-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage(options);

			// Assert
			expect(getGeneratePackageConfiguration).toHaveBeenCalledWith(options);
		});

		it("should include LICENSE info when generating a public package with authorName", async () => {
			// Arrange
			const options: Partial<GeneratePackageConfiguration> = {
				lang: Language.TYPESCRIPT,
				name: "my-package",
			};
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "my-package",
				template: "advanced",
				public: true,
				authorName: "Jane Doe",
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("my-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/my-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/my-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage(options);

			// Assert
			expect(writeTemplateFiles).toHaveBeenCalledWith(
				"/path/to/my-package",
				expect.objectContaining({
					lang: mockConfig.lang,
					projectSpec: "package",
					template: mockConfig.template,
					license: { public: true, authorName: "Jane Doe" },
				}),
			);
		});

		it("should throw an error if target directory is not empty", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["existing-file.txt"] as never);

			// Act & Assert
			await expect(generatePackage({})).rejects.toThrow(
				"Target directory is not empty: /path/to/test-package",
			);
		});

		it("should not throw an error if target directory exists but readdirSync throws", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockImplementation(() => {
				throw new Error("Permission denied");
			});
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act & Assert
			await expect(generatePackage({})).resolves.not.toThrow();
		});

		it("should perform preflight checks including package manager availability", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage({});

			// Assert
			expect(tasks.runWithTasks).toHaveBeenCalledWith(
				"Preflight checks",
				expect.any(Function),
			);
			expect(ensurePackageManager).toHaveBeenCalled();
		});

		it("should prepare the package by creating directory, writing template files, and applying modifications", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage({});

			// Assert
			expect(tasks.runWithTasks).toHaveBeenCalledWith(
				"Preparing package",
				undefined,
				expect.arrayContaining([
					expect.objectContaining({ title: "Create package directory" }),
					expect.objectContaining({ title: 'Add "basic" template' }),
					expect.objectContaining({
						title: "Modify template with user preferences",
					}),
				]),
			);
			expect(createProjectDirectory).toHaveBeenCalledWith(
				process.cwd(),
				"test-package",
			);
			expect(writeTemplateFiles).toHaveBeenCalledWith(
				"/path/to/test-package",
				expect.objectContaining({
					lang: mockConfig.lang,
					projectSpec: "package",
					template: mockConfig.template,
				}),
			);
			expect(applyTemplateModifications).toHaveBeenCalledWith(
				"/path/to/test-package",
				mockConfig,
				"1.0.0",
			);
		});

		it("should finish up by initializing git, making initial commit, and fetching github secrets", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage({});

			// Assert
			expect(tasks.runWithTasks).toHaveBeenCalledWith(
				"Finishing up",
				undefined,
				expect.arrayContaining([
					expect.objectContaining({ title: "Initialize git" }),
					expect.objectContaining({ title: "Make initial commit" }),
					expect.objectContaining({ title: "Fetch github secrets list" }),
				]),
			);
			expect(initGitRepo).toHaveBeenCalledWith("/path/to/test-package");
			expect(makeInitialCommit).toHaveBeenCalledWith("/path/to/test-package");
			expect(getRequiredGithubSecrets).toHaveBeenCalledWith(
				"/path/to/test-package",
			);
		});

		it("should print next steps including cd, git push, secrets, and install command", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};

			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage({});

			// Assert
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				chalk.bold("Package generated successfully! Next steps:"),
			);
			expect(vi.mocked(console.log)).toHaveBeenCalledWith();
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				expect.stringContaining("cd test-package"),
			);
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				expect.stringContaining("git push -u origin main"),
			);
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				expect.stringContaining("npm install"),
			);
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				expect.stringContaining("Happy building"),
			);
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				expect.stringContaining("Stuck?"),
			);
		});

		it("should call addPackageInstructions when includeInstructions is true", async () => {
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			};
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue([]);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			await generatePackage({});

			expect(addPackageInstructions).toHaveBeenCalledWith(
				"/path/to/test-package",
				mockConfig,
			);
		});

		it("should include github secrets in next steps when secrets are required", async () => {
			// Arrange
			const mockConfig: GeneratePackageConfiguration = {
				lang: Language.TYPESCRIPT,
				name: "test-package",
				template: "basic",
				public: false,
			};
			const mockSecrets = ["SECRET_KEY", "API_TOKEN"];
			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createProjectDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writeTemplateFiles).mockResolvedValue(undefined);
			vi.mocked(applyTemplateModifications).mockResolvedValue(undefined);
			vi.mocked(initGitRepo).mockResolvedValue(undefined);
			vi.mocked(makeInitialCommit).mockResolvedValue(undefined);
			vi.mocked(getRequiredGithubSecrets).mockResolvedValue(mockSecrets);
			vi.mocked(getInstallScript).mockReturnValue("npm install");

			// Act
			await generatePackage({});

			// Assert
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				expect.stringContaining("Configure the following repository secrets"),
			);
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				`    - ${chalk.magentaBright("SECRET_KEY")}`,
			);
			expect(vi.mocked(console.log)).toHaveBeenCalledWith(
				`    - ${chalk.magentaBright("API_TOKEN")}`,
			);
		});
	});
});
