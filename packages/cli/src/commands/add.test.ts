import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Registry, RegistryConditionKind } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockMultiselectInput = vi.fn();
const mockGroupedMultiselectInput = vi.fn();
const mockSelectInput = vi.fn();
const mockConfirmInput = vi.fn();
const mockTextInput = vi.fn();
const mockBuildInstallPlan = vi.fn();
const mockLoadCompiledItems = vi.fn();
const mockWriteFileAsync = vi.fn();
const mockIsFileAsync = vi.fn();
const mockRunAsync = vi.fn();
const mockRunWithTasks = vi.fn();

vi.mock("../cli/tasks", () => ({
	runWithTasks: (...args: unknown[]) => mockRunWithTasks(...args),
}));

vi.mock("../cli/prompts", () => ({
	multiselectInput: (...args: unknown[]) => mockMultiselectInput(...args),
	groupedMultiselectInput: (...args: unknown[]) =>
		mockGroupedMultiselectInput(...args),
	selectInput: (...args: unknown[]) => mockSelectInput(...args),
	confirmInput: (...args: unknown[]) => mockConfirmInput(...args),
	textInput: (...args: unknown[]) => mockTextInput(...args),
}));

vi.mock("../utils/registry", () => ({
	loadCompiledItems: (...args: unknown[]) => mockLoadCompiledItems(...args),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		buildInstallPlan: (...args: unknown[]) => mockBuildInstallPlan(...args),
		writeFileAsync: (...args: unknown[]) => mockWriteFileAsync(...args),
		isFileAsync: (...args: unknown[]) => mockIsFileAsync(...args),
		runAsync: (...args: unknown[]) => mockRunAsync(...args),
	};
});

import { addCommand } from "./add";

function makeRegistry(): Registry {
	return {
		types: { configuration: { label: "Configurations" } },
		conditions: {
			language: {
				kind: RegistryConditionKind.SELECT,
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
	const indexLocation = "/workspace/registry.json";

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-command-"));
		fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
		vi.spyOn(process, "cwd").mockReturnValue(tempDir);
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.clearAllMocks();

		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "pr-template-configuration",
				sources: ["r/pr-template-configuration.json"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
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

	it("installs a positional item and writes compiled item files", async () => {
		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
		});

		expect(mockMultiselectInput).not.toHaveBeenCalled();
		expect(mockLoadCompiledItems).toHaveBeenCalledWith(indexLocation, [
			"r/pr-template-configuration.json",
		]);
		expect(mockRunWithTasks).toHaveBeenCalledWith(
			"Fetching compiled items",
			expect.any(Function),
		);
		expect(mockWriteFileAsync).toHaveBeenCalledWith(
			path.join(tempDir, ".github/pull_request_template.md"),
			"# PR Template",
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Installed 1 item."),
		);
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("Registry items installed successfully!"),
		);
	});

	it("prompts for items grouped by type when none are provided", async () => {
		mockGroupedMultiselectInput.mockResolvedValue([
			"pr-template-configuration",
		]);

		await addCommand(registry, indexLocation, {});

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

	it("prompts when items is an empty array", async () => {
		mockGroupedMultiselectInput.mockResolvedValue([
			"pr-template-configuration",
		]);

		await addCommand(registry, indexLocation, { items: [] });

		expect(mockGroupedMultiselectInput).toHaveBeenCalled();
	});

	it("sorts grouped prompt options by title", async () => {
		const sortedRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				"zebra-configuration": {
					title: "Zebra Template",
					description: "Z",
					type: "configuration",
					source: "r/zebra.json",
				},
				"alpha-configuration": {
					title: "Alpha Template",
					description: "A",
					type: "configuration",
					source: "r/alpha.json",
				},
			},
		};
		mockGroupedMultiselectInput.mockResolvedValue(["alpha-configuration"]);
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "alpha-configuration",
				sources: ["r/alpha.json"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([["r/alpha.json", { files: [] }]]),
		);

		await addCommand(sortedRegistry, indexLocation, {});

		expect(mockGroupedMultiselectInput).toHaveBeenCalledWith(
			"Which registry items should be added?",
			{
				Configurations: [
					{
						label: "Alpha Template",
						value: "alpha-configuration",
						hint: "A",
					},
					{
						label: "Zebra Template",
						value: "zebra-configuration",
						hint: "Z",
					},
				],
			},
		);
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
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "pr-template-configuration",
				sources: ["r/pr-template-configuration.json"],
			},
			{
				itemId: "code-quality-workflow",
				sources: ["r/code-quality-workflow.json"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
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

		await addCommand(groupedRegistry, indexLocation, {});

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
		expect(mockBuildInstallPlan).toHaveBeenCalledWith(
			["pr-template-configuration", "code-quality-workflow"],
			groupedRegistry.items,
			{},
			"pnpm",
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Installed 2 items."),
		);
	});

	it("prompts before overwriting an existing file unless --overwrite is set", async () => {
		const existing = path.join(tempDir, ".github/pull_request_template.md");
		fs.mkdirSync(path.dirname(existing), { recursive: true });
		fs.writeFileSync(existing, "existing\n");
		mockConfirmInput.mockResolvedValueOnce(false);

		await expect(
			addCommand(registry, indexLocation, {
				items: ["pr-template-configuration"],
			}),
		).rejects.toThrow("Installation canceled before overwriting");

		mockConfirmInput.mockResolvedValueOnce(true);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
		});

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockConfirmInput).toHaveBeenCalledTimes(2);
		expect(mockWriteFileAsync).toHaveBeenCalledTimes(2);
	});

	it("rejects when a compiled item target exists as a directory", async () => {
		const targetDir = path.join(tempDir, ".github/pull_request_template.md");
		fs.mkdirSync(targetDir, { recursive: true });

		await expect(
			addCommand(registry, indexLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow("exists and is a directory");
	});

	it("rejects colliding compiled item targets across items", async () => {
		const multiRegistry: Registry = {
			...registry,
			items: {
				...registry.items,
				other: {
					title: "Other",
					description: "Other item",
					type: "configuration",
					source: "r/other.json",
				},
			},
		};
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "pr-template-configuration",
				sources: ["r/pr-template-configuration.json"],
			},
			{
				itemId: "other",
				sources: ["r/other.json"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# A",
							},
						],
					},
				],
				[
					"r/other.json",
					{
						files: [
							{
								target: ".github/pull_request_template.md",
								content: "# B",
							},
						],
					},
				],
			]),
		);

		await expect(
			addCommand(multiRegistry, indexLocation, {
				items: ["pr-template-configuration", "other"],
				overwrite: true,
			}),
		).rejects.toThrow("Multiple compiled items write to the same target");
	});

	it("merges duplicate package declarations into one install command", async () => {
		const multiRegistry: Registry = {
			...registry,
			items: {
				"pr-template-configuration": {
					...registry.items["pr-template-configuration"],
				},
				other: {
					title: "Other",
					description: "Other item",
					type: "configuration",
					source: "r/other.json",
				},
			},
		};
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "pr-template-configuration",
				sources: ["r/pr-template-configuration.json"],
			},
			{
				itemId: "other",
				sources: ["r/other.json"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([
				[
					"r/pr-template-configuration.json",
					{
						files: [
							{
								target: "a.md",
								content: "a",
							},
						],
						dependencies: {
							npm: { dev: ["vitest@^3"] },
						},
					},
				],
				[
					"r/other.json",
					{
						files: [
							{
								target: "b.md",
								content: "b",
							},
						],
						dependencies: {
							npm: { dev: ["vitest@^3", "zod"] },
						},
					},
				],
			]),
		);
		mockSelectInput.mockResolvedValue("npm");
		mockConfirmInput.mockResolvedValue(true);

		await addCommand(multiRegistry, indexLocation, {
			items: ["pr-template-configuration", "other"],
			overwrite: true,
		});

		expect(mockRunAsync).toHaveBeenCalledTimes(1);
		expect(mockRunAsync).toHaveBeenCalledWith(
			expect.stringContaining("pnpm add -D vitest@^3 zod"),
			expect.objectContaining({ cwd: tempDir, stdio: "inherit" }),
		);
	});

	it("auto-selects a sole select condition option without prompting", async () => {
		const conditionRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				language: {
					label: "Language",
					kind: RegistryConditionKind.SELECT,
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			},
			items: {
				"pr-template-configuration": {
					title: "Pull Request Template",
					description: "PR template",
					type: "configuration",
					source: "r/pr-template-configuration.json",
					packs: [
						{
							id: "ts",
							title: "TypeScript",
							source: "r/pr-template-configuration.json",
							when: { language: "typescript" },
						},
					],
				},
			},
		};

		await addCommand(conditionRegistry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockWriteFileAsync).toHaveBeenCalled();
	});

	it("rejects a missing payload document", async () => {
		mockLoadCompiledItems.mockResolvedValue(new Map());

		await expect(
			addCommand(registry, indexLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow(
			'Missing compiled item for registry item "pr-template-configuration"',
		);
	});

	it("rejects an empty registry when prompting for items", async () => {
		await expect(
			addCommand(
				{ types: { configuration: { label: "Configurations" } }, items: {} },
				indexLocation,
				{},
			),
		).rejects.toThrow("No registry items are available.");
	});

	it("rejects when the grouped item prompt selects nothing", async () => {
		mockGroupedMultiselectInput.mockResolvedValue([]);

		await expect(addCommand(registry, indexLocation, {})).rejects.toThrow(
			"Select at least one registry item to add.",
		);
	});

	it("omits empty type groups when prompting for items", async () => {
		const sparseRegistry: Registry = {
			types: {
				configuration: { label: "Configurations" },
				workflow: { label: "Workflows" },
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
		mockGroupedMultiselectInput.mockResolvedValue([
			"pr-template-configuration",
		]);

		await addCommand(sparseRegistry, indexLocation, {});

		expect(mockGroupedMultiselectInput).toHaveBeenCalledWith(
			"Which registry items should be added?",
			{
				Configurations: [
					expect.objectContaining({ value: "pr-template-configuration" }),
				],
			},
		);
	});

	it("prompts for text, boolean, select, and multiselect conditions", async () => {
		const conditionRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				authorName: {
					kind: RegistryConditionKind.TEXT,
					label: "Author",
					description: "Your name",
				},
				enableCi: {
					kind: RegistryConditionKind.BOOLEAN,
					label: "Enable CI",
				},
				language: {
					kind: RegistryConditionKind.SELECT,
					label: "Language",
					values: [
						{ value: "typescript", label: "TypeScript" },
						{ value: "javascript", label: "JavaScript" },
					],
				},
				platforms: {
					kind: RegistryConditionKind.MULTISELECT,
					label: "Platforms",
					values: [
						{ value: "ios", label: "iOS" },
						{ value: "android", label: "Android" },
					],
				},
			},
			items: {
				"pr-template-configuration": {
					title: "Pull Request Template",
					description: "PR template",
					type: "configuration",
					source: "r/pr-template-configuration.json",
					requires: ["authorName", "enableCi", "language", "platforms"],
				},
			},
		};
		mockTextInput.mockResolvedValue("Ada");
		mockConfirmInput.mockResolvedValue(true);
		mockSelectInput.mockResolvedValue("typescript");
		mockMultiselectInput.mockResolvedValue(["ios"]);

		await addCommand(conditionRegistry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockTextInput).toHaveBeenCalledWith(
			"Your name",
			{ required: true },
			undefined,
		);
		expect(mockConfirmInput).toHaveBeenCalledWith("Enable CI", {}, undefined);
		expect(mockSelectInput).toHaveBeenCalledWith(
			"Language",
			{
				options: [
					{ label: "TypeScript", value: "typescript" },
					{ label: "JavaScript", value: "javascript" },
				],
			},
			undefined,
		);
		expect(mockMultiselectInput).toHaveBeenCalledWith(
			"Platforms",
			{
				options: [
					{ label: "iOS", value: "ios" },
					{ label: "Android", value: "android" },
				],
			},
			undefined,
		);
	});

	it("auto-selects a sole multiselect option and seeds defaults from inferred values", async () => {
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "cond-handler-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const multiHandler = path.join(
			handlerDir,
			"r/_handlers/platforms.handler.js",
		);
		const selectHandler = path.join(
			handlerDir,
			"r/_handlers/language.handler.js",
		);
		fs.mkdirSync(path.dirname(multiHandler), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			multiHandler,
			"module.exports = { async infer() { return ['ios']; } };\n",
		);
		fs.writeFileSync(
			selectHandler,
			"module.exports = { async infer() { return 'typescript'; } };\n",
		);

		const conditionRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				tags: {
					kind: RegistryConditionKind.MULTISELECT,
					label: "Tags",
					values: [{ value: "docs", label: "Docs" }],
				},
				platforms: {
					kind: RegistryConditionKind.MULTISELECT,
					label: "Platforms",
					handler: "r/_handlers/platforms.handler.js",
					values: [
						{ value: "ios", label: "iOS" },
						{ value: "android", label: "Android" },
					],
				},
				language: {
					kind: RegistryConditionKind.SELECT,
					label: "Language",
					handler: "r/_handlers/language.handler.js",
					values: [
						{ value: "typescript", label: "TypeScript" },
						{ value: "javascript", label: "JavaScript" },
					],
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo item",
					type: "configuration",
					source: "r/pr-template-configuration.json",
					requires: ["tags", "platforms", "language"],
				},
			},
		};

		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "demo",
				sources: ["r/pr-template-configuration.json"],
			},
		]);
		mockMultiselectInput.mockResolvedValue(["ios"]);
		mockSelectInput.mockResolvedValue("typescript");

		try {
			await addCommand(conditionRegistry, catalogPath, {
				items: ["demo"],
				overwrite: true,
			});

			expect(mockMultiselectInput).toHaveBeenCalledWith(
				"Platforms",
				expect.any(Object),
				["ios"],
			);
			expect(mockMultiselectInput).not.toHaveBeenCalledWith(
				"Tags",
				expect.anything(),
				expect.anything(),
			);
			expect(mockSelectInput).toHaveBeenCalledWith(
				"Language",
				expect.any(Object),
				"typescript",
			);
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});

	it("seeds text and boolean prompt defaults from condition handlers", async () => {
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "cond-tb-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const textHandler = path.join(
			handlerDir,
			"r/_handlers/authorName.handler.js",
		);
		const boolHandler = path.join(
			handlerDir,
			"r/_handlers/enableCi.handler.js",
		);
		fs.mkdirSync(path.dirname(textHandler), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			textHandler,
			`
module.exports = {
  async infer(ctx) {
    await ctx.run("true");
    return "Ada";
  },
};
`,
		);
		fs.writeFileSync(
			boolHandler,
			"module.exports = { async infer() { return true; } };\n",
		);

		const conditionRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				authorName: {
					kind: RegistryConditionKind.TEXT,
					label: "Author",
					handler: "r/_handlers/authorName.handler.js",
				},
				enableCi: {
					kind: RegistryConditionKind.BOOLEAN,
					label: "Enable CI",
					handler: "r/_handlers/enableCi.handler.js",
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo item",
					type: "configuration",
					source: "r/pr-template-configuration.json",
					requires: ["authorName", "enableCi"],
				},
			},
		};

		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "demo",
				sources: ["r/pr-template-configuration.json"],
			},
		]);
		mockTextInput.mockResolvedValue("Ada");
		mockConfirmInput.mockResolvedValue(true);

		try {
			await addCommand(conditionRegistry, catalogPath, {
				items: ["demo"],
				overwrite: true,
			});

			expect(mockRunAsync).toHaveBeenCalledWith(
				"true",
				expect.objectContaining({ cwd: tempDir, stdio: "pipe" }),
			);
			expect(mockTextInput).toHaveBeenCalledWith(
				"Author",
				{ required: true },
				"Ada",
			);
			expect(mockConfirmInput).toHaveBeenCalledWith("Enable CI", {}, true);
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});

	it("ignores empty package maps that merge to nothing", async () => {
		mockLoadCompiledItems.mockResolvedValue(
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
						dependencies: {
							npm: {
								runtime: [],
								dev: [],
							},
						},
					},
				],
			]),
		);
		mockConfirmInput.mockResolvedValue(true);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockRunAsync).not.toHaveBeenCalled();
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("Next steps"),
		);
	});

	it("falls back to the item id when the index has no title", async () => {
		const untitledRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				"untitled-item": {
					title: undefined as unknown as string,
					description: "No title",
					type: "configuration",
					source: "r/pr-template-configuration.json",
				},
			},
		};
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "untitled-item",
				sources: ["r/pr-template-configuration.json"],
			},
		]);

		await addCommand(untitledRegistry, indexLocation, {
			items: ["untitled-item"],
			overwrite: true,
		});

		expect(mockRunWithTasks).toHaveBeenCalledWith(
			expect.stringContaining("untitled-item"),
			expect.any(Function),
		);
	});

	it("falls back to the item id when the index entry is missing", async () => {
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "ghost-item",
				sources: ["r/pr-template-configuration.json"],
			},
		]);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockRunWithTasks).toHaveBeenCalledWith(
			expect.stringContaining("ghost-item"),
			expect.any(Function),
		);
	});

	it("throws when the install plan contains no items", async () => {
		mockBuildInstallPlan.mockReturnValue([]);

		await expect(
			addCommand(registry, indexLocation, {
				items: ["pr-template-configuration"],
			}),
		).rejects.toThrow("No registry items were selected for installation.");
	});

	it("passes packIds into beforeInstall scripts when present", async () => {
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-variant-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const scriptPath = path.join(handlerDir, "r/hello.beforeInstall.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			scriptPath,
			`
module.exports = async function beforeInstall(ctx) {
  return {
    files: [{ target: "VARIANT.md", content: (ctx.packIds || []).join(",") || "none" }],
  };
};
`,
		);

		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "hello",
				packIds: ["typescript"],
				beforeInstallScripts: ["r/hello.beforeInstall.0.js"],
			},
		]);

		const handlerRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				hello: {
					title: "Hello",
					description: "Install script demo",
					type: "configuration",
					beforeInstall: ["r/hello.beforeInstall.0.js"],
				},
			},
		};

		try {
			await addCommand(handlerRegistry, catalogPath, {
				items: ["hello"],
				overwrite: true,
			});

			expect(mockWriteFileAsync).toHaveBeenCalledWith(
				path.join(tempDir, "VARIANT.md"),
				"typescript",
			);
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});

	it("passes packIds into afterInstall scripts when present", async () => {
		const handlerDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "add-after-variant-"),
		);
		const catalogPath = path.join(handlerDir, "registry.json");
		const logPath = path.join(tempDir, "after-variant.log");
		const scriptPath = path.join(handlerDir, "r/hello.afterInstall.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			scriptPath,
			`
const fs = require("node:fs");
module.exports = async function afterInstall(ctx) {
  fs.appendFileSync(${JSON.stringify(logPath)}, (ctx.packIds || []).join(",") || "none");
};
`,
		);

		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "hello",
				packIds: ["typescript"],
				sources: ["r/hello.json"],
				afterInstallScripts: ["r/hello.afterInstall.0.js"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([
				[
					"r/hello.json",
					{
						files: [{ target: "DONE.txt", content: "ok" }],
					},
				],
			]),
		);

		const handlerRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				hello: {
					title: "Hello",
					description: "After-install script demo",
					type: "configuration",
					source: "r/hello.json",
					afterInstall: ["r/hello.afterInstall.0.js"],
				},
			},
		};

		try {
			await addCommand(handlerRegistry, catalogPath, {
				items: ["hello"],
				overwrite: true,
			});

			expect(fs.readFileSync(logPath, "utf8")).toBe("typescript");
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});

	it("rejects an invalid compiled item with the item label", async () => {
		mockLoadCompiledItems.mockResolvedValue(
			new Map([["r/pr-template-configuration.json", { files: 1 }]]),
		);

		await expect(
			addCommand(registry, indexLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow('Compiled item for "pr-template-configuration"');
	});

	it("rejects path traversal in compiled item targets", async () => {
		mockLoadCompiledItems.mockResolvedValue(
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
			addCommand(registry, indexLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow(
			'Compiled item file target "../escape.txt" must be a relative path under the project directory.',
		);
	});

	it("installs npm packages using the selected package manager", async () => {
		fs.rmSync(path.join(tempDir, "pnpm-lock.yaml"));
		fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}\n");
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");
		mockLoadCompiledItems.mockResolvedValue(
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
						dependencies: {
							npm: {
								dev: ["vitest@^3"],
							},
						},
					},
				],
			]),
		);
		mockConfirmInput.mockResolvedValue(true);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockConfirmInput).toHaveBeenCalledWith(
			"Would you like to install the required dependencies?",
			{},
			true,
		);
		expect(mockSelectInput).not.toHaveBeenCalledWith(
			"Which package manager should be used for the project?",
			expect.anything(),
			expect.anything(),
		);
		expect(mockRunAsync).toHaveBeenCalledWith(
			expect.stringContaining("npm install -D vitest@^3"),
			expect.objectContaining({ cwd: tempDir, stdio: "inherit" }),
		);
	});

	it("uses the selected package manager for next-step commands when install is declined", async () => {
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");
		mockLoadCompiledItems.mockResolvedValue(
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
						dependencies: {
							npm: {
								dev: ["vitest@^3"],
							},
						},
					},
				],
			]),
		);
		mockConfirmInput.mockResolvedValue(false);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockRunAsync).not.toHaveBeenCalled();
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Next steps"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("pnpm add -D vitest@^3"),
		);
	});

	it("prompts for a package manager when no lockfile is present", async () => {
		fs.rmSync(path.join(tempDir, "pnpm-lock.yaml"));
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}\n");
		mockLoadCompiledItems.mockResolvedValue(
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
						dependencies: {
							npm: {
								dev: ["vitest@^3"],
							},
						},
					},
				],
			]),
		);
		mockSelectInput.mockResolvedValue("npm");
		mockConfirmInput.mockResolvedValue(true);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockSelectInput).toHaveBeenCalledWith(
			"Which package manager should be used for the project?",
			expect.objectContaining({
				options: expect.arrayContaining([
					{ label: "npm", value: "npm" },
					{ label: "Bun", value: "bun" },
				]),
			}),
			"npm",
		);
		expect(mockRunAsync).toHaveBeenCalledWith(
			expect.stringContaining("npm install -D vitest@^3"),
			expect.objectContaining({ cwd: tempDir, stdio: "inherit" }),
		);
	});

	it("runs a local beforeInstall script before writing files", async () => {
		const fs = await import("node:fs");
		const os = await import("node:os");
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-handler-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const scriptPath = path.join(handlerDir, "r/hello.beforeInstall.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			scriptPath,
			`
module.exports = async function beforeInstall(ctx) {
  const name = ctx.conditions.authorName || "world";
  return {
    bindings: { name },
    files: [{ target: "HELLO.md", content: "Hello " + name }],
  };
};
`,
		);

		mockTextInput.mockResolvedValue("Ada");
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "hello",
				beforeInstallScripts: ["r/hello.beforeInstall.0.js"],
			},
		]);

		const handlerRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				authorName: {
					kind: RegistryConditionKind.TEXT,
					label: "Author",
				},
			},
			items: {
				hello: {
					title: "Hello",
					description: "Install script demo",
					type: "configuration",
					requires: ["authorName"],
					beforeInstall: ["r/hello.beforeInstall.0.js"],
				},
			},
		};

		try {
			await addCommand(handlerRegistry, catalogPath, {
				items: ["hello"],
				overwrite: true,
			});

			expect(mockTextInput).toHaveBeenCalledWith(
				"Author",
				{ required: true },
				undefined,
			);
			expect(mockLoadCompiledItems).not.toHaveBeenCalled();
			expect(mockWriteFileAsync).toHaveBeenCalledWith(
				path.join(tempDir, "HELLO.md"),
				"Hello Ada",
			);
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});

	it("runs beforeInstall before writes and afterInstall after writes", async () => {
		const fs = await import("node:fs");
		const os = await import("node:os");
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-lifecycle-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const logPath = path.join(tempDir, "lifecycle-order.log");
		const beforePath = path.join(handlerDir, "r/lifecycle.beforeInstall.0.js");
		const afterPath = path.join(handlerDir, "r/lifecycle.afterInstall.0.js");
		fs.mkdirSync(path.dirname(beforePath), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			beforePath,
			`
const fs = require("node:fs");
module.exports = async function beforeInstall() {
  fs.appendFileSync(${JSON.stringify(logPath)}, "before\\n");
};
`,
		);
		fs.writeFileSync(
			afterPath,
			`
const fs = require("node:fs");
module.exports = async function afterInstall() {
  fs.appendFileSync(${JSON.stringify(logPath)}, "after\\n");
};
`,
		);

		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "lifecycle",
				sources: ["r/lifecycle.json"],
				beforeInstallScripts: ["r/lifecycle.beforeInstall.0.js"],
				afterInstallScripts: ["r/lifecycle.afterInstall.0.js"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([
				[
					"r/lifecycle.json",
					{
						files: [{ target: "DONE.txt", content: "ok" }],
					},
				],
			]),
		);

		const lifecycleRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				lifecycle: {
					title: "Lifecycle",
					description: "Lifecycle scripts",
					type: "configuration",
					source: "r/lifecycle.json",
					beforeInstall: ["r/lifecycle.beforeInstall.0.js"],
					afterInstall: ["r/lifecycle.afterInstall.0.js"],
				},
			},
		};

		try {
			await addCommand(lifecycleRegistry, catalogPath, {
				items: ["lifecycle"],
				overwrite: true,
			});

			expect(fs.readFileSync(logPath, "utf8")).toBe("before\nafter\n");
			expect(mockWriteFileAsync).toHaveBeenCalledWith(
				path.join(tempDir, "DONE.txt"),
				"ok",
			);
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});

	it("interpolates {{key}} in files and leaves GitHub Actions expressions intact", async () => {
		const local: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				defaultBranch: {
					kind: RegistryConditionKind.TEXT,
					label: "Default branch",
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["defaultBranch"],
				},
			},
		};
		mockTextInput.mockResolvedValue("main");
		mockBuildInstallPlan.mockReturnValue([
			{ itemId: "demo", sources: ["r/demo.json"] },
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([
				[
					"r/demo.json",
					{
						files: [
							{
								target: "ci.yml",
								content: "branch: {{defaultBranch}}\nsha: ${{ github.sha }}\n",
							},
						],
					},
				],
			]),
		);

		await addCommand(local, indexLocation, {
			items: ["demo"],
			overwrite: true,
		});

		expect(mockWriteFileAsync).toHaveBeenCalledWith(
			path.join(tempDir, "ci.yml"),
			"branch: main\nsha: ${{ github.sha }}\n",
		);
	});

	it("merges payload commands into package.json scripts", async () => {
		fs.writeFileSync(
			path.join(tempDir, "package.json"),
			`${JSON.stringify({ name: "app", scripts: { start: "node ." } }, null, 2)}\n`,
		);
		mockLoadCompiledItems.mockResolvedValue(
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
						commands: { npm: { test: "vitest run" } },
					},
				],
			]),
		);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockWriteFileAsync).toHaveBeenCalledWith(
			path.join(tempDir, "package.json"),
			expect.stringContaining('"test": "vitest run"'),
		);
	});

	it("logs repository secret names in Next steps", async () => {
		mockLoadCompiledItems.mockResolvedValue(
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
						secrets: ["GH_ADMIN_TOKEN"],
					},
				],
			]),
		);

		await addCommand(registry, indexLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Next steps"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("GH_ADMIN_TOKEN"),
		);
	});

	it("rejects duplicate compiled item targets across merged sources", async () => {
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "pr-template-configuration",
				sources: ["r/base.json", "r/pack.json"],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([
				["r/base.json", { files: [{ target: "README.md", content: "base" }] }],
				["r/pack.json", { files: [{ target: "README.md", content: "pack" }] }],
			]),
		);

		await expect(
			addCommand(registry, indexLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow(
			'Registry item "pr-template-configuration" has duplicate compiled item target "README.md".',
		);
	});

	it("folds beforeInstall hook dependencies into the working compiled item", async () => {
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-deps-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const scriptPath = path.join(handlerDir, "r/hello.beforeInstall.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			path.join(tempDir, "package.json"),
			JSON.stringify({ name: "demo", scripts: {} }),
			"utf8",
		);
		fs.writeFileSync(
			scriptPath,
			`
module.exports = async function beforeInstall() {
  return {
    files: [{ target: "HELLO.md", content: "hi" }],
    dependencies: { npm: { runtime: ["left-pad"] } },
    commands: { npm: { hello: "echo hi" } },
    secrets: ["HELLO_TOKEN"],
  };
};
`,
		);

		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "hello",
				beforeInstallScripts: ["r/hello.beforeInstall.0.js"],
			},
		]);

		const handlerRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				hello: {
					title: "Hello",
					description: "Hook deps",
					type: "configuration",
					beforeInstall: ["r/hello.beforeInstall.0.js"],
				},
			},
		};

		try {
			await addCommand(handlerRegistry, catalogPath, {
				items: ["hello"],
				overwrite: true,
			});
			expect(mockWriteFileAsync).toHaveBeenCalledWith(
				path.join(tempDir, "HELLO.md"),
				"hi",
			);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining("HELLO_TOKEN"),
			);
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});

	it("uses item-local condition values during interpolation", async () => {
		mockTextInput.mockResolvedValue("Ada");
		mockBuildInstallPlan.mockReturnValue([
			{
				itemId: "hello",
				sources: ["r/hello.json"],
			},
			{
				itemId: "ghost",
				sources: [],
			},
		]);
		mockLoadCompiledItems.mockResolvedValue(
			new Map([
				[
					"r/hello.json",
					{
						files: [
							{
								target: "HELLO.md",
								content: "Hello {{authorName}} {{pmRun}}",
							},
						],
					},
				],
			]),
		);

		const localRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				hello: {
					title: "Hello",
					description: "Local conditions",
					type: "configuration",
					source: "r/hello.json",
					conditions: {
						authorName: {
							kind: RegistryConditionKind.TEXT,
							label: "Author",
						},
					},
				},
			},
		};

		await addCommand(localRegistry, indexLocation, {
			items: ["hello"],
			overwrite: true,
		});

		expect(mockWriteFileAsync).toHaveBeenCalledWith(
			path.join(tempDir, "HELLO.md"),
			"Hello Ada pnpm",
		);
	});
});
