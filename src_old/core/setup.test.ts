/**
 * Tests for shared project setup utilities in core/setup.
 */

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	default: {
		promises: {
			readdir: vi.fn(),
			readFile: vi.fn(),
		},
		existsSync: vi.fn(),
	},
}));

vi.mock("../registry/install", () => ({
	installRegistryItem: vi.fn(),
	templateHasPlayground: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("./fs", () => ({
	ensureDirAsync: vi.fn(),
}));

import fs from "node:fs";
import {
	installRegistryItem,
	templateHasPlayground,
} from "../registry/install";
import { ensureDirAsync } from "./fs";
import {
	createProjectDirectory,
	getRequiredGithubSecrets,
	installProjectTemplateFromRegistry,
} from "./setup";

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
	});

	describe("installProjectTemplateFromRegistry", () => {
		it("delegates to installRegistryItem with the given item name and merged context", async () => {
			vi.mocked(templateHasPlayground).mockResolvedValue(true);
			vi.mocked(installRegistryItem).mockResolvedValue({
				itemName: "typescript-package",
				dependencies: [],
				devDependencies: [],
				writtenPaths: [],
			});

			await installProjectTemplateFromRegistry({
				targetDir: "/target",
				itemName: "typescript-package",
				lang: "typescript",
				public: true,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
				authorName: "Author",
				name: "my-package",
				packageManagerVersion: "pnpm@10.0.0",
			});

			expect(templateHasPlayground).toHaveBeenCalledWith(
				"typescript-package",
			);
			expect(installRegistryItem).toHaveBeenCalledWith(
				expect.objectContaining({
					targetDir: "/target",
					itemName: "typescript-package",
					context: expect.objectContaining({
						public: true,
						includeInstructions: true,
						templateHasPlayground: true,
						packageManagerVersion: "pnpm@10.0.0",
					}),
				}),
			);
		});
	});
});
