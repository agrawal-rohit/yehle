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
vi.mock("../../../src/cli/logger", () => ({
	default: {
		intro: vi.fn(),
	},
	primaryText: vi.fn((text) => text),
}));

vi.mock("../../../src/cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(async (goal, task, subtasks) => {
			if (task) await task();
			if (subtasks) {
				for (const sub of subtasks) {
					if (sub.task) await sub.task();
				}
			}
		}),
	},
}));

vi.mock("../../../src/core/git", () => ({
	initGitRepo: vi.fn(),
	makeInitialCommit: vi.fn(),
}));

vi.mock("../../../src/core/pkg-manager", () => ({
	ensurePackageManager: vi.fn(),
	getInstallScript: vi.fn(),
	LANGUAGE_PACKAGE_MANAGER: {
		js: "npm",
		ts: "npm",
	},
}));

vi.mock("../../../src/core/utils", () => ({
	toSlug: vi.fn(),
}));

vi.mock("../../../src/resources/package/config", () => ({
	getGeneratePackageConfiguration: vi.fn(),
	Language: { TYPESCRIPT: "typescript" },
}));

vi.mock("../../../src/resources/package/setup", () => ({
	applyTemplateModifications: vi.fn(),
	createPackageDirectory: vi.fn(),
	getRequiredGithubSecrets: vi.fn(),
	writePackageTemplateFiles: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import logger from "../../../src/cli/logger";
import tasks from "../../../src/cli/tasks";
import { initGitRepo, makeInitialCommit } from "../../../src/core/git";
import {
	ensurePackageManager,
	getInstallScript,
} from "../../../src/core/pkg-manager";
import { toSlug } from "../../../src/core/utils";
// Import after mocks
import { generatePackage } from "../../../src/resources/package/command";
import {
	type GeneratePackageConfiguration,
	getGeneratePackageConfiguration,
	Language,
} from "../../../src/resources/package/config";
import {
	applyTemplateModifications,
	createPackageDirectory,
	getRequiredGithubSecrets,
	writePackageTemplateFiles,
} from "../../../src/resources/package/setup";

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
				lang: "typescript" as any,
				name: "test-package",
				template: "basic",
				public: false,
			};

			vi.mocked(getGeneratePackageConfiguration).mockResolvedValue(mockConfig);
			vi.mocked(toSlug).mockReturnValue("test-package");
			vi.mocked(path.resolve).mockReturnValue("/path/to/test-package");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			vi.mocked(ensurePackageManager).mockResolvedValue("1.0.0");
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/my-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
			vi.mocked(fs.readdirSync).mockReturnValue(["existing-file.txt"] as any);

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
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
			expect(createPackageDirectory).toHaveBeenCalledWith(
				process.cwd(),
				"test-package",
			);
			expect(writePackageTemplateFiles).toHaveBeenCalledWith(
				"/path/to/test-package",
				mockConfig,
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
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
			vi.mocked(createPackageDirectory).mockResolvedValue(
				"/path/to/test-package",
			);
			vi.mocked(writePackageTemplateFiles).mockResolvedValue(undefined);
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
