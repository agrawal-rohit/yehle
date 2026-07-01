import type { CAC } from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cli/logger", () => ({
	default: {
		error: vi.fn(),
		intro: vi.fn(),
	},
}));

vi.mock("./create", () => ({
	default: vi.fn(),
}));

vi.mock("./add", () => ({
	default: vi.fn(),
}));

vi.mock("./list", () => ({
	default: vi.fn(),
}));

vi.mock("../registry/loader", () => ({
	loadRegistry: vi.fn(),
}));

import logger from "../cli/logger";
import { loadRegistry } from "../registry/loader";
import {
	RegistryInputOptionsFrom,
	RegistryInputType,
	RegistryItemType,
} from "../registry/schema";
import addCommand from "./add";
import createCommand from "./create";
import { registerCommandsCli } from "./index";
import listCommand from "./list";

type MockCommand = {
	option: ReturnType<typeof vi.fn>;
	action: ReturnType<typeof vi.fn>;
};

describe("commands/index", () => {
	let mockApp: CAC;
	let mockCommands: MockCommand[];
	let mockCommandFn: ReturnType<typeof vi.fn>;
	let originalArgv: string[];

	beforeEach(() => {
		vi.clearAllMocks();
		originalArgv = process.argv;
		process.argv = ["node", "tuckshop"];
		mockCommands = [];
		mockCommandFn = vi.fn(() => {
			const mockCommand = {
				option: vi.fn().mockReturnThis(),
				action: vi.fn(),
			};
			mockCommands.push(mockCommand);
			return mockCommand;
		});
		const appLike = {
			usage: vi.fn(),
			command: mockCommandFn,
		};
		mockApp = appLike as unknown as CAC;

		vi.mocked(loadRegistry).mockResolvedValue({
			version: "0.0.1",
			contentBaseUrl: "https://example.com",
			items: new Map([
				[
					"template/typescript-react-app",
					{
						name: "template/typescript-react-app",
						type: RegistryItemType.TEMPLATE,
						lang: "typescript",
						framework: "react",
						projectSpec: "app",
						inputs: [
							{
								name: "name",
								type: RegistryInputType.STRING,
								prompt: "Project name?",
								required: true,
							},
							{
								name: "public",
								type: RegistryInputType.BOOLEAN,
								prompt: "Public?",
							},
							{
								name: "includeInstructions",
								type: RegistryInputType.BOOLEAN,
								prompt: "Include instructions?",
							},
							{
								name: "instructionsIdeFormat",
								type: RegistryInputType.SELECT,
								prompt: "IDE format?",
								optionsFrom: RegistryInputOptionsFrom.IDE_FORMATS,
							},
						],
						files: [],
					},
				],
				[
					"component/button/vue",
					{
						name: "component/button/vue",
						type: RegistryItemType.COMPONENT,
						lang: "typescript",
						framework: "vue",
						files: [],
					},
				],
				[
					"instruction/essential/workflow",
					{
						name: "instruction/essential/workflow",
						type: RegistryItemType.INSTRUCTION,
						instructionCategory: "essential",
						instructionName: "workflow",
						files: [],
					},
				],
			]),
			commandInputs: {
				add: [
					{
						name: "framework",
						type: RegistryInputType.STRING,
						prompt: "Framework?",
					},
					{
						name: "public",
						type: RegistryInputType.BOOLEAN,
						prompt: "Public?",
					},
					{
						name: "includeInstructions",
						type: RegistryInputType.BOOLEAN,
						prompt: "Include instructions?",
					},
					{
						name: "instructionsIdeFormat",
						type: RegistryInputType.SELECT,
						prompt: "IDE format?",
						optionsFrom: RegistryInputOptionsFrom.IDE_FORMATS,
					},
				],
			},
		});
	});

	afterEach(() => {
		process.argv = originalArgv;
		vi.restoreAllMocks();
	});

	describe("registerCommandsCli", () => {
		it("registers create, add, and list commands without input flags when selection is unknown", async () => {
			await registerCommandsCli(mockApp);

			expect(mockApp.usage).toHaveBeenCalledWith("<command> [options]");
			expect(mockApp.command).toHaveBeenCalledWith(
				"create [template]",
				"Create a new project from a registry template item",
			);
			expect(mockApp.command).toHaveBeenCalledWith(
				"add [...items]",
				"Add one or more registry items to the current project",
			);

			expect(mockCommands[0]?.option).not.toHaveBeenCalled();
			expect(mockCommands[1]?.option).not.toHaveBeenCalled();
		});

		it("registers create input flags only for the peeked template", async () => {
			process.argv = [
				"node",
				"tuckshop",
				"create",
				"template/typescript-react-app",
				"--name",
				"test-app",
			];

			await registerCommandsCli(mockApp);

			const createOptions = mockCommands[0]?.option.mock.calls.map(
				(call) => call[0],
			);
			expect(createOptions).toEqual([
				"--name <name>",
				"--public",
				"--include-instructions",
				"--instructions-ide-format <instructions-ide-format>",
			]);
			expect(mockCommands[1]?.option).not.toHaveBeenCalled();
		});

		it("registers add input flags only for the peeked items", async () => {
			process.argv = [
				"node",
				"tuckshop",
				"add",
				"component/button/vue",
				"instruction/essential/workflow",
			];

			await registerCommandsCli(mockApp);

			expect(mockCommands[0]?.option).not.toHaveBeenCalled();
			const addOptions = mockCommands[1]?.option.mock.calls.map(
				(call) => call[0],
			);
			expect(addOptions).toEqual([
				"--framework <framework>",
				"--include-instructions",
				"--instructions-ide-format <instructions-ide-format>",
			]);
		});

		it("forwards raw cliOptions to createCommand", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(createCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const createAction = mockCommands[0]?.action.mock.calls[0]?.[0];
			const cliOptions = {
				name: "test-app",
				public: true,
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			};
			if (createAction) {
				await createAction("template/typescript-react-app", cliOptions);
			}

			expect(logger.intro).toHaveBeenCalledWith("fresh order coming up");
			expect(createCommand).toHaveBeenCalledWith({
				template: "template/typescript-react-app",
				cliOptions,
			});
		});

		it("forwards raw cliOptions to addCommand", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(addCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const addAction = mockCommands[1]?.action.mock.calls[0]?.[0];
			const cliOptions = {
				framework: "react",
				includeInstructions: true,
				ideFormat: "cursor",
			};
			if (addAction) {
				await addAction(
					["component/button/vue", "instruction/essential/workflow"],
					cliOptions,
				);
			}

			expect(logger.intro).toHaveBeenCalledWith("adding to the bag");
			expect(addCommand).toHaveBeenCalledWith({
				items: ["component/button/vue", "instruction/essential/workflow"],
				cliOptions,
			});
		});

		it("normalizes a single string item into an array for addCommand", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(addCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const addAction = mockCommands[1]?.action.mock.calls[0]?.[0];
			if (addAction) {
				await addAction("component/button/vue", {});
			}

			expect(addCommand).toHaveBeenCalledWith({
				items: ["component/button/vue"],
				cliOptions: {},
			});
		});

		it("passes an empty items array when add receives no items", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(addCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const addAction = mockCommands[1]?.action.mock.calls[0]?.[0];
			if (addAction) {
				await addAction(undefined, {});
			}

			expect(addCommand).toHaveBeenCalledWith({
				items: [],
				cliOptions: {},
			});
		});

		it("registers list filters from registry facets", async () => {
			await registerCommandsCli(mockApp);

			const listOptions = mockCommands[2]?.option.mock.calls.map(
				(call) => call[0],
			);
			expect(listOptions).toEqual(
				expect.arrayContaining([
					"--all",
					"--type <types>",
					"--lang <lang>",
					"--framework <framework>",
					"--project-spec <project-spec>",
					"--instruction-category <instruction-category>",
					"--values [facet]",
				]),
			);

			const typeDescription = mockCommands[2]?.option.mock.calls.find(
				(call) => call[0] === "--type <types>",
			)?.[1];
			expect(typeDescription).toContain("all");
			expect(typeDescription).toContain("component");
			expect(typeDescription).toContain("template");
			expect(typeDescription).toMatch(/prompted when omitted/i);
		});

		it("calls listCommand with facet filters and values mode", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(listCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const listAction = mockCommands[2]?.action.mock.calls[0]?.[0];
			if (listAction) {
				await listAction({
					type: "component",
					framework: "vue",
					values: "framework",
				});
			}

			expect(logger.intro).toHaveBeenCalledWith("here's the menu");
			expect(listCommand).toHaveBeenCalledWith({
				type: "component",
				framework: "vue",
				values: "framework",
			});
		});

		it("passes --all through to listCommand", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(listCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const listAction = mockCommands[2]?.action.mock.calls[0]?.[0];
			if (listAction) {
				await listAction({ all: true });
			}

			expect(listCommand).toHaveBeenCalledWith({ all: true });
		});

		it("passes type all through to listCommand", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(listCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const listAction = mockCommands[2]?.action.mock.calls[0]?.[0];
			if (listAction) {
				await listAction({ type: "all" });
			}

			expect(listCommand).toHaveBeenCalledWith({ type: "all" });
		});

		it("passes values=true when --values is set without a facet", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(listCommand).mockResolvedValue();

			await registerCommandsCli(mockApp);
			const listAction = mockCommands[2]?.action.mock.calls[0]?.[0];
			if (listAction) {
				await listAction({ values: true });
			}

			expect(listCommand).toHaveBeenCalledWith({ values: true });
		});

		it("skips list facet flags that have no values in the registry", async () => {
			vi.mocked(loadRegistry).mockResolvedValue({
				version: "0.0.1",
				contentBaseUrl: "https://example.com",
				items: new Map([
					[
						"convention/dependabot",
						{
							name: "convention/dependabot",
							type: RegistryItemType.CONVENTION,
							files: [],
						},
					],
				]),
				commandInputs: {},
			});

			await registerCommandsCli(mockApp);

			const listOptions = mockCommands[2]?.option.mock.calls.map(
				(call) => call[0],
			);
			expect(listOptions).toEqual([
				"--all",
				"--type <types>",
				"--values [facet]",
			]);

			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(listCommand).mockResolvedValue();
			const listAction = mockCommands[2]?.action.mock.calls[0]?.[0];
			if (listAction) {
				// Empty facets are ignored even if present on the options object.
				await listAction({
					type: "convention",
					lang: "typescript",
					framework: true,
				});
			}

			expect(listCommand).toHaveBeenCalledWith({ type: "convention" });
		});

		it("logs error when createCommand throws", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(createCommand).mockRejectedValue(new Error("Test error"));

			await registerCommandsCli(mockApp);
			const createAction = mockCommands[0]?.action.mock.calls[0]?.[0];
			if (createAction) await createAction(undefined, {});

			expect(logger.error).toHaveBeenCalledWith("Test error");
		});

		it("logs non-Error values when createCommand throws", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(createCommand).mockRejectedValue("create blew up");

			await registerCommandsCli(mockApp);
			const createAction = mockCommands[0]?.action.mock.calls[0]?.[0];
			if (createAction) await createAction(undefined, {});

			expect(logger.error).toHaveBeenCalledWith("create blew up");
		});

		it("logs error when addCommand throws", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(addCommand).mockRejectedValue(new Error("Add failed"));

			await registerCommandsCli(mockApp);
			const addAction = mockCommands[1]?.action.mock.calls[0]?.[0];
			if (addAction) await addAction([], {});

			expect(logger.error).toHaveBeenCalledWith("Add failed");
		});

		it("logs non-Error values when addCommand throws", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(addCommand).mockRejectedValue("add blew up");

			await registerCommandsCli(mockApp);
			const addAction = mockCommands[1]?.action.mock.calls[0]?.[0];
			if (addAction) await addAction([], {});

			expect(logger.error).toHaveBeenCalledWith("add blew up");
		});

		it("logs error when listCommand throws", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(listCommand).mockRejectedValue(new Error("List failed"));

			await registerCommandsCli(mockApp);
			const listAction = mockCommands[2]?.action.mock.calls[0]?.[0];
			if (listAction) await listAction({});

			expect(logger.error).toHaveBeenCalledWith("List failed");
		});

		it("logs non-Error values when listCommand throws", async () => {
			vi.mocked(logger.intro).mockResolvedValue();
			vi.mocked(listCommand).mockRejectedValue("list blew up");

			await registerCommandsCli(mockApp);
			const listAction = mockCommands[2]?.action.mock.calls[0]?.[0];
			if (listAction) await listAction({});

			expect(logger.error).toHaveBeenCalledWith("list blew up");
		});
	});
});
