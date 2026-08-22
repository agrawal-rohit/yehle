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
const mockDetectPackageManagerFromLockfile = vi.fn();
const mockBuildPackageInstallCommands = vi.fn();
const mockMergeEcosystemDependencies = vi.fn();

const FakeEcosystem = {
	NPM: "npm",
	PYTHON: "python",
} as const;

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
	const FakeEcosystem = {
		NPM: "npm",
		PYTHON: "python",
	} as const;
	return {
		...actual,
		RegistryEcosystem: FakeEcosystem,
		detectPackageManagerFromLockfile: (...args: unknown[]) =>
			mockDetectPackageManagerFromLockfile(...args),
		buildPackageInstallCommands: (...args: unknown[]) =>
			mockBuildPackageInstallCommands(...args),
		mergeEcosystemDependencies: (...args: unknown[]) =>
			mockMergeEcosystemDependencies(...args),
		runAsync: (...args: unknown[]) => mockRunAsync(...args),
		ecosystemManagers: {
			[FakeEcosystem.NPM]: [
				{
					manager: actual.NpmPackageManager.NPM,
					lockfiles: ["package-lock.json"],
					[actual.RegistryDependencyKind.RUNTIME]: "npm install",
					[actual.RegistryDependencyKind.DEV]: "npm install -D",
				},
			],
			[FakeEcosystem.PYTHON]: [
				{
					manager: "pip",
					lockfiles: ["requirements.txt"],
					[actual.RegistryDependencyKind.RUNTIME]: "pip install",
					[actual.RegistryDependencyKind.DEV]: "pip install",
				},
			],
		},
	};
});

import { installDeclaredPackages } from "./add-packages";

describe("commands/add-packages", () => {
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
		mockMergeEcosystemDependencies.mockReturnValue({
			npm: { [RegistryDependencyKind.DEV]: ["vitest@^3"] },
		} satisfies RegistryEcosystemDependencies);
		mockDetectPackageManagerFromLockfile.mockReturnValue(undefined);
		mockConfirmInput.mockResolvedValue(true);
		mockSelectInput.mockResolvedValue(NpmPackageManager.NPM);
		mockRunAsync.mockResolvedValue("");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns early when there are no package declarations", async () => {
		await expect(installDeclaredPackages([], "/project")).resolves.toEqual([]);
		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("returns early when merged packages are empty", async () => {
		mockMergeEcosystemDependencies.mockReturnValue(undefined);

		await expect(
			installDeclaredPackages(
				[{ npm: { [RegistryDependencyKind.RUNTIME]: [] } }],
				"/project",
			),
		).resolves.toEqual([]);
		expect(mockConfirmInput).toHaveBeenCalled();
		expect(mockBuildPackageInstallCommands).not.toHaveBeenCalled();
	});

	it("auto-selects the sole ecosystem manager when no lockfile is detected", async () => {
		await expect(
			installDeclaredPackages(
				[{ npm: { [RegistryDependencyKind.DEV]: ["vitest@^3"] } }],
				"/project",
			),
		).resolves.toEqual([]);

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockBuildPackageInstallCommands).toHaveBeenCalledWith(
			FakeEcosystem.NPM,
			NpmPackageManager.NPM,
			{ [RegistryDependencyKind.DEV]: ["vitest@^3"] },
		);
		expect(mockRunAsync).toHaveBeenCalledWith(
			"npm install -D vitest@^3",
			expect.objectContaining({ cwd: "/project" }),
		);
	});

	it("uses a detected lockfile manager for next-step commands when install is declined", async () => {
		mockConfirmInput.mockResolvedValue(false);
		mockDetectPackageManagerFromLockfile.mockReturnValue({
			manager: NpmPackageManager.NPM,
			lockfile: "package-lock.json",
		});

		await expect(
			installDeclaredPackages(
				[{ npm: { [RegistryDependencyKind.DEV]: ["vitest@^3"] } }],
				"/project",
			),
		).resolves.toEqual(["npm install -D vitest@^3"]);

		expect(mockDetectPackageManagerFromLockfile).toHaveBeenCalled();
		expect(mockRunAsync).not.toHaveBeenCalled();
	});

	it("skips ecosystems that are absent from the merged package map", async () => {
		await installDeclaredPackages(
			[{ npm: { dev: ["vitest@^3"] } }],
			"/project",
		);

		// FakeEcosystem has npm + python; merge only returns npm, so python is skipped.
		expect(mockBuildPackageInstallCommands).toHaveBeenCalledTimes(1);
		expect(mockBuildPackageInstallCommands).toHaveBeenCalledWith(
			FakeEcosystem.NPM,
			NpmPackageManager.NPM,
			{ [RegistryDependencyKind.DEV]: ["vitest@^3"] },
		);
	});
});
