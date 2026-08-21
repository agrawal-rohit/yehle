import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Registry } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockMultiselectInput = vi.fn();
const mockGroupedMultiselectInput = vi.fn();
const mockSelectInput = vi.fn();
const mockConfirmInput = vi.fn();
const mockResolveInstallPlan = vi.fn();
const mockLoadRegistryPayloads = vi.fn();
const mockWriteFileAsync = vi.fn();
const mockIsFileAsync = vi.fn();
const mockRunAsync = vi.fn();
const mockRunWithTasks = vi.fn();

vi.mock("../cli/tasks", () => ({
	default: {
		runWithTasks: (...args: unknown[]) => mockRunWithTasks(...args),
	},
	conditionalTask: (condition: boolean, subtask: unknown) =>
		condition ? [subtask] : [],
}));

vi.mock("../cli/prompts", () => ({
	multiselectInput: (...args: unknown[]) => mockMultiselectInput(...args),
	groupedMultiselectInput: (...args: unknown[]) =>
		mockGroupedMultiselectInput(...args),
	selectInput: (...args: unknown[]) => mockSelectInput(...args),
	confirmInput: (...args: unknown[]) => mockConfirmInput(...args),
}));

vi.mock("../registry/load", () => ({
	loadRegistryPayloads: (...args: unknown[]) =>
		mockLoadRegistryPayloads(...args),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		resolveInstallPlan: (...args: unknown[]) => mockResolveInstallPlan(...args),
		writeFileAsync: (...args: unknown[]) => mockWriteFileAsync(...args),
		isFileAsync: (...args: unknown[]) => mockIsFileAsync(...args),
		runAsync: (...args: unknown[]) => mockRunAsync(...args),
	};
});

import addCommand from "./add";

function makeRegistry(): Registry {
	return {
		types: { configuration: { label: "Configurations" } },
		conditions: {
			language: {
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		},
		items: {
			"pr-template-configuration": {
				title: "Pull Request Template",
				description: "PR template",
				type: "configuration",
				source: "r/pr-template-configuration.json",
			},
		},
	};
}

describe("commands/add", () => {
	let tempDir: string;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	const registry = makeRegistry();
	const catalogLocation = "/workspace/registry.json";

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-command-"));
		vi.spyOn(process, "cwd").mockReturnValue(tempDir);
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.clearAllMocks();

		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "pr-template-configuration",
					source: "r/pr-template-configuration.json",
				},
			],
		});
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# PR Template",
							},
						],
					},
				],
			]),
		);
		mockIsFileAsync.mockResolvedValue(false);
		mockWriteFileAsync.mockResolvedValue(undefined);
		mockConfirmInput.mockResolvedValue(false);
		mockRunWithTasks.mockImplementation(
			async (
				_goal: string,
				task?: () => Promise<void>,
				subtasks: Array<{ task: () => Promise<void> }> = [],
			) => {
				if (task) await task();
				for (const subtask of subtasks) await subtask.task();
			},
		);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("installs a positional item and writes payload files", async () => {
		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
		});

		expect(mockMultiselectInput).not.toHaveBeenCalled();
		expect(mockLoadRegistryPayloads).toHaveBeenCalledWith(catalogLocation, [
			"r/pr-template-configuration.json",
		]);
		expect(mockWriteFileAsync).toHaveBeenCalledWith(
			path.join(tempDir, ".github/pull_request_template.md"),
			"# PR Template",
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Registry items installed successfully!"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("1 item(s) installed"),
		);
	});

	it("prompts for items grouped by type when none are provided", async () => {
		mockGroupedMultiselectInput.mockResolvedValue([
			"pr-template-configuration",
		]);

		await addCommand(registry, catalogLocation, {});

		expect(mockGroupedMultiselectInput).toHaveBeenCalledWith(
			"Which registry items should be added?",
			{
				Configurations: [
					{
						label: "Pull Request Template",
						value: "pr-template-configuration",
						hint: "PR template",
					},
				],
			},
		);
		expect(mockWriteFileAsync).toHaveBeenCalled();
	});

	it("places every type in one grouped prompt", async () => {
		const groupedRegistry: Registry = {
			types: {
				configuration: { label: "Configurations" },
				workflow: { label: "Workflows" },
			},
			items: {
				"code-quality-workflow": {
					title: "Code Quality",
					description: "CI workflow",
					type: "workflow",
					source: "r/code-quality-workflow.json",
				},
				"pr-template-configuration": {
					title: "Pull Request Template",
					description: "PR template",
					type: "configuration",
					source: "r/pr-template-configuration.json",
				},
			},
		};
		mockGroupedMultiselectInput.mockResolvedValue([
			"pr-template-configuration",
			"code-quality-workflow",
		]);
		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "pr-template-configuration",
					source: "r/pr-template-configuration.json",
				},
				{
					itemId: "code-quality-workflow",
					source: "r/code-quality-workflow.json",
				},
			],
		});
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# PR Template",
							},
						],
					},
				],
				[
					"r/code-quality-workflow.json",
					{
						files: [
							{
								target: ".github/workflows/code-quality.yml",
								content: "name: quality",
							},
						],
					},
				],
			]),
		);

		await addCommand(groupedRegistry, catalogLocation, {});

		expect(mockGroupedMultiselectInput).toHaveBeenCalledTimes(1);
		expect(mockGroupedMultiselectInput).toHaveBeenCalledWith(
			"Which registry items should be added?",
			{
				Configurations: [
					expect.objectContaining({ value: "pr-template-configuration" }),
				],
				Workflows: [
					expect.objectContaining({ value: "code-quality-workflow" }),
				],
			},
		);
		expect(mockResolveInstallPlan).toHaveBeenCalledWith(
			["pr-template-configuration", "code-quality-workflow"],
			groupedRegistry.items,
			expect.any(Object),
		);
	});

	it("prompts before overwriting an existing file unless --overwrite is set", async () => {
		mockIsFileAsync.mockResolvedValue(true);
		mockConfirmInput.mockResolvedValueOnce(false);

		await expect(
			addCommand(registry, catalogLocation, {
				items: ["pr-template-configuration"],
			}),
		).rejects.toThrow("Installation canceled before overwriting");

		mockIsFileAsync.mockResolvedValue(true);
		mockConfirmInput.mockResolvedValueOnce(true);

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
		});

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockConfirmInput).toHaveBeenCalledTimes(2);
		expect(mockWriteFileAsync).toHaveBeenCalledTimes(2);
	});

	it("rejects path traversal in payload targets", async () => {
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [{ target: "../escape.txt", content: "nope" }],
					},
				],
			]),
		);

		await expect(
			addCommand(registry, catalogLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow("must be a relative path under the project directory");
	});

	it("installs npm packages when the user selects a manager", async () => {
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");
		mockIsFileAsync.mockImplementation(async (filePath: string) =>
			filePath.endsWith("package.json"),
		);
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# PR Template",
							},
						],
						packages: {
							npm: {
								devDependencies: ["vitest@^3"],
							},
						},
					},
				],
			]),
		);
		mockSelectInput.mockResolvedValue("npm");
		mockConfirmInput.mockResolvedValue(true);

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockConfirmInput).toHaveBeenCalledWith(
			"Would you like to install the required dependencies?",
			{},
			true,
		);
		expect(mockSelectInput).toHaveBeenCalled();
		expect(mockRunAsync).toHaveBeenCalledWith(
			expect.stringContaining("npm install -D vitest@^3"),
			expect.objectContaining({ cwd: tempDir, stdio: "inherit" }),
		);
	});

	it("confirms a detected lockfile manager before installing", async () => {
		fs.writeFileSync(path.join(tempDir, "bun.lock"), "");
		mockIsFileAsync.mockImplementation(async (filePath: string) =>
			filePath.endsWith("bun.lock"),
		);
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# PR Template",
							},
						],
						packages: {
							npm: {
								devDependencies: ["vitest@^3"],
							},
						},
					},
				],
			]),
		);
		mockConfirmInput.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockConfirmInput).toHaveBeenNthCalledWith(
			1,
			"Would you like to install the required dependencies?",
			{},
			true,
		);
		expect(mockConfirmInput).toHaveBeenNthCalledWith(
			2,
			expect.stringMatching(/bun\.lock.*bun/),
			{},
			true,
		);
		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockRunAsync).toHaveBeenCalledWith(
			expect.stringContaining("bun add -D vitest@^3"),
			expect.objectContaining({ cwd: tempDir, stdio: "inherit" }),
		);
	});

	it("prompts for a package manager when the detected lockfile is declined", async () => {
		fs.writeFileSync(path.join(tempDir, "bun.lock"), "");
		mockIsFileAsync.mockImplementation(async (filePath: string) =>
			filePath.endsWith("bun.lock"),
		);
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# PR Template",
							},
						],
						packages: {
							npm: {
								devDependencies: ["vitest@^3"],
							},
						},
					},
				],
			]),
		);
		mockConfirmInput.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		mockSelectInput.mockResolvedValue("npm");

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockSelectInput).toHaveBeenCalledWith(
			"Which package manager should install these npm packages?",
			expect.objectContaining({
				options: expect.arrayContaining([
					{ label: "npm", value: "npm" },
					{ label: "bun", value: "bun" },
				]),
			}),
		);
		expect(mockRunAsync).toHaveBeenCalledWith(
			expect.stringContaining("npm install -D vitest@^3"),
			expect.objectContaining({ cwd: tempDir, stdio: "inherit" }),
		);
	});

	it("skips package installation when the user declines the prompt", async () => {
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# PR Template",
							},
						],
						packages: {
							npm: {
								devDependencies: ["vitest@^3"],
							},
						},
					},
				],
			]),
		);
		mockConfirmInput.mockResolvedValue(false);

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockRunAsync).not.toHaveBeenCalled();
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Next steps:"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("npm install -D vitest@^3"),
		);
	});
});
