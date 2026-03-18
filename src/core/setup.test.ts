/**
 * Tests for shared project setup utilities in core/setup.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./fs", () => ({
	copyDirSafeAsync: vi.fn(),
	ensureDirAsync: vi.fn(),
	isDirAsync: vi.fn(),
	removeFilesByBasename: vi.fn(),
	renderMustacheTemplates: vi.fn(),
	stripKeyFromJSONFile: vi.fn(),
	writeFileAsync: vi.fn(),
}));

vi.mock("./instructions", () => ({
	InstructionCategory: {
		ESSENTIAL: "essential",
		LANGUAGE: "language",
		PROJECT_SPEC: "project-spec",
		TEMPLATE: "template",
		TOOLING: "tooling",
		SKILLS: "skills",
	},
	getInstructionWithFrontmatter: vi.fn(),
	listAvailableInstructions: vi.fn(() => Promise.resolve([])),
	readSkillsMapping: vi.fn(() => Promise.resolve([])),
	readToolingInstructionsMapping: vi.fn(() => Promise.resolve([])),
}));

vi.mock("./templates", () => ({
	resolveTemplatesDir: vi.fn(),
}));

import { ensureDirAsync } from "./fs";
import { createProjectDirectory, getRequiredGithubSecrets } from "./setup";

describe("core/setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("createProjectDirectory", () => {
		it("creates the project directory and returns the absolute path", async () => {
			const cwd = "/home/user";
			const projectName = "my-project";
			const expectedPath = "/home/user/my-project";

			vi.mocked(ensureDirAsync).mockResolvedValue();

			const result = await createProjectDirectory(cwd, projectName);

			expect(ensureDirAsync).toHaveBeenCalledWith(expectedPath);
			expect(result).toBe(expectedPath);
		});
	});

	describe("getRequiredGithubSecrets", () => {
		it("returns an empty array if no workflows directory exists", async () => {
			const targetDir = "/path/to/project";

			vi.mocked(fs.promises.readdir).mockRejectedValue(new Error("ENOENT"));

			const result = await getRequiredGithubSecrets(targetDir);

			expect(result).toEqual([]);
		});

		it("extracts and returns sorted unique secrets from workflow files", async () => {
			const targetDir = "/path/to/project";
			const workflowsDir = path.join(targetDir, ".github", "workflows");

			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "ci.yml", isFile: () => true, isDirectory: () => false },
				{ name: "release.yml", isFile: () => true, isDirectory: () => false },
			] as never);
			vi.mocked(fs.promises.readFile)
				.mockResolvedValueOnce("secrets.NPM_TOKEN and secrets.GITHUB_TOKEN")
				.mockResolvedValueOnce("secrets.CODECOV_TOKEN");

			const result = await getRequiredGithubSecrets(targetDir);

			expect(fs.promises.readdir).toHaveBeenCalledWith(workflowsDir, {
				withFileTypes: true,
			});
			expect(result).toEqual(["CODECOV_TOKEN", "NPM_TOKEN"]);
		});

		it("ignores GITHUB_TOKEN secrets", async () => {
			const targetDir = "/path/to/project";

			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "ci.yml", isFile: () => true, isDirectory: () => false },
			] as never);
			vi.mocked(fs.promises.readFile).mockResolvedValue("secrets.GITHUB_TOKEN");

			const result = await getRequiredGithubSecrets(targetDir);

			expect(result).toEqual([]);
		});
	});
});
