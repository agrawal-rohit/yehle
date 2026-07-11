import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cli/logger", () => ({
	default: { intro: vi.fn() },
	primaryText: vi.fn((value: string) => value),
}));

vi.mock("../cli/prompts", () => ({
	default: { confirmInput: vi.fn() },
}));

vi.mock("../cli/tasks", () => ({
	default: {
		runWithTasks: vi.fn(
			async (_title: string, task?: (() => Promise<void>) | undefined) => {
				if (task) await task();
			},
		),
	},
}));

vi.mock("../core/pkg-manager", () => ({
	installRegistryPackages: vi.fn(),
}));

vi.mock("../registry/loader", () => ({
	loadRegistry: vi.fn(),
}));

vi.mock("../registry/inputs", () => ({
	resolveInstallContext: vi.fn(),
	collectInputsForSelection: vi.fn(() => []),
	parseCliInputValues: vi.fn(() => ({})),
}));

vi.mock("../registry/install", () => ({
	installRegistryItem: vi.fn(),
}));

vi.mock("../registry/select", () => ({
	promptRegistryInput: vi.fn(),
	resolveRegistryAddItems: vi.fn(),
}));

vi.mock("../core/ide-formats", () => ({
	writeInstructionToFile: vi.fn(),
}));

import { resolveInstallContext } from "../registry/inputs";
import { installRegistryItem } from "../registry/install";
import { loadRegistry } from "../registry/loader";
import { resolveRegistryAddItems } from "../registry/select";
import { addCommand } from "./add";

describe("commands/add", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(resolveRegistryAddItems).mockResolvedValue(["button"]);
		vi.mocked(loadRegistry).mockResolvedValue({
			version: "0.2.1",
			contentBaseUrl: "https://example.com",
			items: new Map([
				[
					"button",
					{
						id: "button",
						title: "Button",
						description: "Button component",
						type: "component",
						variants: [
							{
								id: "react",
								targets: { framework: "react" },
								files: [],
							},
						],
					},
				],
			]),
			commandInputs: { add: [] },
		});
		vi.mocked(resolveInstallContext).mockResolvedValue({
			public: false,
			includeInstructions: true,
			instructionsIdeFormat: "cursor",
			framework: "react",
		});
		vi.mocked(installRegistryItem).mockResolvedValue({
			itemName: "button",
			writtenPaths: [],
			dependencies: [],
			devDependencies: [],
		});
	});

	it("uses CLI values through resolveInstallContext", async () => {
		await addCommand({
			cliValues: {
				framework: "react",
				includeInstructions: true,
				instructionsIdeFormat: "cursor",
			},
		});

		expect(resolveInstallContext).toHaveBeenCalledWith(
			expect.objectContaining({
				rootItemNames: ["button"],
				cliValues: {
					framework: "react",
					includeInstructions: true,
					instructionsIdeFormat: "cursor",
				},
				command: "add",
			}),
		);
		expect(installRegistryItem).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.objectContaining({
					public: false,
					framework: "react",
					includeInstructions: true,
					instructionsIdeFormat: "cursor",
				}),
			}),
		);
	});
});
