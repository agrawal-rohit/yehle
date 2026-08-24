import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	NpmPackageManager,
	RegistryDependencyKind,
	type RegistryEcosystemDependencies,
} from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmInput = vi.fn();
const mockSelectInput = vi.fn();
const mockRunAsync = vi.fn();
const mockRunWithTasks = vi.fn();
const mockBuildPackageInstallCommands = vi.fn();
const mockMergeEcosystemMaps = vi.fn();

vi.mock("../cli/prompts", () => ({
	confirmInput: (...args: unknown[]) => mockConfirmInput(...args),
	selectInput: (...args: unknown[]) => mockSelectInput(...args),
}));

vi.mock("../cli/tasks", () => ({
	runWithTasks: (...args: unknown[]) => mockRunWithTasks(...args),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		buildPackageInstallCommands: (...args: unknown[]) =>
			mockBuildPackageInstallCommands(...args),
		mergeEcosystemMaps: (...args: unknown[]) => mockMergeEcosystemMaps(...args),
		runAsync: (...args: unknown[]) => mockRunAsync(...args),
	};
});

import {
	installDeclaredPackages,
	mergeProjectCommands,
	npmPackageManagerFromConditions,
} from "./packages";

describe("utils/packages", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		mockRunWithTasks.mockImplementation(
			async (_goal: string, task?: () => Promise<void>) => {
				if (task) await task();
			},
		);
		mockBuildPackageInstallCommands.mockReturnValue([
			"npm install -D vitest@^3",
		]);
		mockMergeEcosystemMaps.mockReturnValue({
			npm: { [RegistryDependencyKind.DEV]: ["vitest@^3"] },
		} satisfies RegistryEcosystemDependencies);
		mockConfirmInput.mockResolvedValue(true);
		mockSelectInput.mockResolvedValue(NpmPackageManager.NPM);
		mockRunAsync.mockResolvedValue("");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("npmPackageManagerFromConditions reads a supported manager from conditions", () => {
		expect(npmPackageManagerFromConditions({ packageManager: "pnpm" })).toBe(
			NpmPackageManager.PNPM,
		);
	});

	it("npmPackageManagerFromConditions fails when the condition is missing", () => {
		expect(() => npmPackageManagerFromConditions({})).toThrow(
			'Missing condition "packageManager"',
		);
	});

	it("npmPackageManagerFromConditions fails when the manager is unknown", () => {
		expect(() =>
			npmPackageManagerFromConditions({ packageManager: "pip" }),
		).toThrow('Unknown packageManager "pip"');
	});

	it("returns early when there are no package declarations", async () => {
		await expect(
			installDeclaredPackages([], "/project", { packageManager: "npm" }),
		).resolves.toEqual([]);
		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("returns early when merged packages are empty", async () => {
		mockMergeEcosystemMaps.mockReturnValue(undefined);

		await expect(
			installDeclaredPackages(
				[{ npm: { [RegistryDependencyKind.RUNTIME]: [] } }],
				"/project",
				{ packageManager: "npm" },
			),
		).resolves.toEqual([]);
		expect(mockConfirmInput).toHaveBeenCalled();
		expect(mockBuildPackageInstallCommands).not.toHaveBeenCalled();
	});

	it("installs with the packageManager condition and does not prompt for a manager", async () => {
		await expect(
			installDeclaredPackages(
				[{ npm: { [RegistryDependencyKind.DEV]: ["vitest@^3"] } }],
				"/project",
				{ packageManager: "npm" },
			),
		).resolves.toEqual([]);

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockBuildPackageInstallCommands).toHaveBeenCalledWith(
			"npm",
			NpmPackageManager.NPM,
			{ [RegistryDependencyKind.DEV]: ["vitest@^3"] },
		);
		expect(mockRunAsync).toHaveBeenCalledWith(
			"npm install -D vitest@^3",
			expect.objectContaining({ cwd: "/project" }),
		);
	});

	it("uses the packageManager condition for next-step commands when install is declined", async () => {
		mockConfirmInput.mockResolvedValue(false);
		mockBuildPackageInstallCommands.mockReturnValue(["pnpm add -D vitest@^3"]);

		await expect(
			installDeclaredPackages(
				[{ npm: { [RegistryDependencyKind.DEV]: ["vitest@^3"] } }],
				"/project",
				{ packageManager: "pnpm" },
			),
		).resolves.toEqual(["pnpm add -D vitest@^3"]);

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockBuildPackageInstallCommands).toHaveBeenCalledWith(
			"npm",
			NpmPackageManager.PNPM,
			{ [RegistryDependencyKind.DEV]: ["vitest@^3"] },
		);
		expect(mockRunAsync).not.toHaveBeenCalled();
	});

	it("throws when npm commands are declared but package.json is missing", async () => {
		mockMergeEcosystemMaps.mockReturnValue({ npm: { test: "vitest run" } });

		await expect(
			mergeProjectCommands("/missing-project", [
				{ files: [], commands: { npm: { test: "vitest run" } } },
			]),
		).rejects.toThrow(
			"Cannot merge package.json scripts: package.json was not found in the project root.",
		);
	});

	it("skips merging when there are no npm commands", async () => {
		mockMergeEcosystemMaps.mockReturnValue(undefined);

		await expect(
			mergeProjectCommands("/project", [{ files: [] }]),
		).resolves.toBe(undefined);
	});

	it("merges new scripts and skips identical existing scripts", async () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-packages-"));
		fs.writeFileSync(
			path.join(projectDir, "package.json"),
			JSON.stringify({ scripts: { test: "vitest run" } }),
			"utf8",
		);
		mockMergeEcosystemMaps.mockReturnValue({
			npm: { test: "vitest run", cov: "vitest run --coverage" },
		});

		try {
			await mergeProjectCommands(projectDir, [
				{
					files: [],
					commands: {
						npm: { test: "vitest run", cov: "vitest run --coverage" },
					},
				},
			]);
			const written = JSON.parse(
				fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
			) as { scripts: Record<string, string> };
			expect(written.scripts).toEqual({
				test: "vitest run",
				cov: "vitest run --coverage",
			});
			expect(mockConfirmInput).not.toHaveBeenCalled();
		} finally {
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});

	it("overwrites a conflicting script when the user confirms", async () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-packages-"));
		fs.writeFileSync(
			path.join(projectDir, "package.json"),
			JSON.stringify({ scripts: { test: "jest" } }),
			"utf8",
		);
		mockMergeEcosystemMaps.mockReturnValue({ npm: { test: "vitest run" } });
		mockConfirmInput.mockResolvedValue(true);

		try {
			await mergeProjectCommands(projectDir, [
				{ files: [], commands: { npm: { test: "vitest run" } } },
			]);
			const written = JSON.parse(
				fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
			) as { scripts: Record<string, string> };
			expect(written.scripts.test).toBe("vitest run");
		} finally {
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});

	it("keeps a conflicting script when the user declines overwrite", async () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-packages-"));
		fs.writeFileSync(
			path.join(projectDir, "package.json"),
			JSON.stringify({ scripts: { test: "jest" } }),
			"utf8",
		);
		mockMergeEcosystemMaps.mockReturnValue({ npm: { test: "vitest run" } });
		mockConfirmInput.mockResolvedValue(false);

		try {
			await mergeProjectCommands(projectDir, [
				{ files: [], commands: { npm: { test: "vitest run" } } },
			]);
			const written = JSON.parse(
				fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
			) as { scripts: Record<string, string> };
			expect(written.scripts.test).toBe("jest");
		} finally {
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});
});
