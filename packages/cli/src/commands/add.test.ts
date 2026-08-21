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
const mockResolveInstallPlan = vi.fn();
const mockLoadRegistryPayloads = vi.fn();
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

import { addCommand } from "./add";

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
		expect(mockRunWithTasks).toHaveBeenCalledWith(
			"Fetching payloads",
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

	it("prompts when items is an empty array", async () => {
		mockGroupedMultiselectInput.mockResolvedValue([
			"pr-template-configuration",
		]);

		await addCommand(registry, catalogLocation, { items: [] });

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
		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "alpha-configuration",
					source: "r/alpha.json",
				},
			],
		});
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([["r/alpha.json", { files: [] }]]),
		);

		await addCommand(sortedRegistry, catalogLocation, {});

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
			addCommand(registry, catalogLocation, {
				items: ["pr-template-configuration"],
			}),
		).rejects.toThrow("Installation canceled before overwriting");

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

	it("rejects when a payload target exists as a directory", async () => {
		const targetDir = path.join(tempDir, ".github/pull_request_template.md");
		fs.mkdirSync(targetDir, { recursive: true });

		await expect(
			addCommand(registry, catalogLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow("exists and is a directory");
	});

	it("rejects colliding payload targets across items", async () => {
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
		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "pr-template-configuration",
					source: "r/pr-template-configuration.json",
				},
				{
					itemId: "other",
					source: "r/other.json",
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
			addCommand(multiRegistry, catalogLocation, {
				items: ["pr-template-configuration", "other"],
				overwrite: true,
			}),
		).rejects.toThrow("Multiple registry payloads write to the same target");
	});

	it("merges duplicate package declarations into one install command", async () => {
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
		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "pr-template-configuration",
					source: "r/pr-template-configuration.json",
				},
				{
					itemId: "other",
					source: "r/other.json",
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
								target: "a.md",
								content: "a",
							},
						],
						packages: {
							npm: { devDependencies: ["vitest@^3"] },
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
						packages: {
							npm: { devDependencies: ["vitest@^3", "zod"] },
						},
					},
				],
			]),
		);
		mockSelectInput.mockResolvedValue("npm");
		mockConfirmInput.mockResolvedValue(true);

		await addCommand(multiRegistry, catalogLocation, {
			items: ["pr-template-configuration", "other"],
			overwrite: true,
		});

		expect(mockRunAsync).toHaveBeenCalledTimes(1);
		expect(mockRunAsync).toHaveBeenCalledWith(
			expect.stringContaining("npm install -D vitest@^3 zod"),
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
					variants: [
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

		await addCommand(conditionRegistry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockWriteFileAsync).toHaveBeenCalled();
	});

	it("rejects a missing payload document", async () => {
		mockLoadRegistryPayloads.mockResolvedValue(new Map());

		await expect(
			addCommand(registry, catalogLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow(
			'Missing payload for registry item "pr-template-configuration"',
		);
	});

	it("rejects an empty registry when prompting for items", async () => {
		await expect(
			addCommand(
				{ types: { configuration: { label: "Configurations" } }, items: {} },
				catalogLocation,
				{},
			),
		).rejects.toThrow("No registry items are available.");
	});

	it("rejects when the grouped item prompt selects nothing", async () => {
		mockGroupedMultiselectInput.mockResolvedValue([]);

		await expect(addCommand(registry, catalogLocation, {})).rejects.toThrow(
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

		await addCommand(sparseRegistry, catalogLocation, {});

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
					uses: ["authorName", "enableCi", "language", "platforms"],
				},
			},
		};
		mockTextInput.mockResolvedValue("Ada");
		mockConfirmInput.mockResolvedValue(true);
		mockSelectInput.mockResolvedValue("typescript");
		mockMultiselectInput.mockResolvedValue(["ios"]);

		await addCommand(conditionRegistry, catalogLocation, {
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
					uses: ["tags", "platforms", "language"],
				},
			},
		};

		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "demo",
					source: "r/pr-template-configuration.json",
				},
			],
		});
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
					uses: ["authorName", "enableCi"],
				},
			},
		};

		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "demo",
					source: "r/pr-template-configuration.json",
				},
			],
		});
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
								dependencies: [],
								devDependencies: [],
							},
						},
					},
				],
			]),
		);
		mockConfirmInput.mockResolvedValue(true);

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockSelectInput).not.toHaveBeenCalled();
		expect(mockRunAsync).not.toHaveBeenCalled();
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("Next steps"),
		);
	});

	it("uses a lockfile manager for next-step commands when install is declined", async () => {
		fs.writeFileSync(path.join(tempDir, "bun.lock"), "");
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

		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("bun add -D vitest@^3"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringMatching(/^\s+1\. Install dependencies with/),
		);
		expect(consoleLogSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("-1."),
		);
	});

	it("falls back to the item id when the catalog has no title", async () => {
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
		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "untitled-item",
					source: "r/pr-template-configuration.json",
				},
			],
		});

		await addCommand(untitledRegistry, catalogLocation, {
			items: ["untitled-item"],
			overwrite: true,
		});

		expect(mockRunWithTasks).toHaveBeenCalledWith(
			expect.stringContaining("untitled-item"),
			expect.any(Function),
		);
	});

	it("falls back to the item id when the catalog entry is missing", async () => {
		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "ghost-item",
					source: "r/pr-template-configuration.json",
				},
			],
		});

		await addCommand(registry, catalogLocation, {
			items: ["pr-template-configuration"],
			overwrite: true,
		});

		expect(mockRunWithTasks).toHaveBeenCalledWith(
			expect.stringContaining("ghost-item"),
			expect.any(Function),
		);
	});

	it("throws when the install plan resolves to no items", async () => {
		mockResolveInstallPlan.mockReturnValue({ items: [] });

		await expect(
			addCommand(registry, catalogLocation, {
				items: ["pr-template-configuration"],
			}),
		).rejects.toThrow("No registry items were selected for installation.");
	});

	it("passes variantId into item handlers when present", async () => {
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-variant-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const handlerPath = path.join(handlerDir, "r/hello.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			handlerPath,
			`
module.exports = {
  async files(ctx) {
    return [{ target: "VARIANT.md", content: ctx.variantId || "none" }];
  },
};
`,
		);

		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "hello",
					variantId: "typescript",
					handler: "r/hello.handler.js",
				},
			],
		});

		const handlerRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				hello: {
					title: "Hello",
					description: "Handler demo",
					type: "configuration",
					handler: "r/hello.handler.js",
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

	it("rejects an invalid registry payload with the item label", async () => {
		mockLoadRegistryPayloads.mockResolvedValue(
			new Map([["r/pr-template-configuration.json", { files: 1 }]]),
		);

		await expect(
			addCommand(registry, catalogLocation, {
				items: ["pr-template-configuration"],
				overwrite: true,
			}),
		).rejects.toThrow('Registry payload for "pr-template-configuration"');
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
		).rejects.toThrow(
			'Payload file target "../escape.txt" must be a relative path under the project directory.',
		);
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
			expect.stringContaining("Next steps"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("npm install -D vitest@^3"),
		);
	});

	it("runs a local item handler before writing files", async () => {
		const fs = await import("node:fs");
		const os = await import("node:os");
		const handlerDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-handler-"));
		const catalogPath = path.join(handlerDir, "registry.json");
		const handlerPath = path.join(handlerDir, "r/hello.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(catalogPath, "{}\n");
		fs.writeFileSync(
			handlerPath,
			`
module.exports = {
  async prompts(ctx) {
    const name = await ctx.prompts.text("Name", {}, "world");
    return { name };
  },
  async files(ctx) {
    return [{ target: "HELLO.md", content: "Hello " + ctx.variables.name }];
  },
};
`,
		);

		mockTextInput.mockResolvedValue("Ada");
		mockResolveInstallPlan.mockReturnValue({
			items: [
				{
					itemId: "hello",
					handler: "r/hello.handler.js",
				},
			],
		});

		const handlerRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				hello: {
					title: "Hello",
					description: "Handler demo",
					type: "configuration",
					handler: "r/hello.handler.js",
				},
			},
		};

		try {
			await addCommand(handlerRegistry, catalogPath, {
				items: ["hello"],
				overwrite: true,
			});

			expect(mockTextInput).toHaveBeenCalled();
			expect(mockLoadRegistryPayloads).not.toHaveBeenCalled();
			expect(mockWriteFileAsync).toHaveBeenCalledWith(
				path.join(tempDir, "HELLO.md"),
				"Hello Ada",
			);
		} finally {
			fs.rmSync(handlerDir, { recursive: true, force: true });
		}
	});
});
