import type { Registry } from "@tuckshop/core";
import { RegistryConditionKind } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTextInput = vi.fn();
const mockConfirmInput = vi.fn();
const mockSelectInput = vi.fn();
const mockMultiselectInput = vi.fn();

vi.mock("../cli/prompts", () => ({
	textInput: (...args: unknown[]) => mockTextInput(...args),
	confirmInput: (...args: unknown[]) => mockConfirmInput(...args),
	selectInput: (...args: unknown[]) => mockSelectInput(...args),
	multiselectInput: (...args: unknown[]) => mockMultiselectInput(...args),
}));

import {
	captureItemLocalConditionsForPlan,
	captureRequiredConditions,
} from "./add-conditions";

describe("commands/add-conditions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTextInput.mockResolvedValue("Ada");
		mockConfirmInput.mockResolvedValue(true);
		mockSelectInput.mockResolvedValue("typescript");
		mockMultiselectInput.mockResolvedValue(["ios"]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("builds a default handler runtime when none is provided", async () => {
		const registry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				authorName: {
					kind: RegistryConditionKind.TEXT,
					label: "Author",
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["authorName"],
				},
			},
		};

		const context = await captureRequiredConditions(
			registry,
			"/tmp/registry.json",
			"/tmp/project",
			["demo"],
		);

		expect(context).toEqual({ authorName: "Ada" });
		expect(mockTextInput).toHaveBeenCalledWith(
			"Author",
			{ required: true },
			undefined,
		);
	});

	it("auto-selects a sole multiselect value without prompting", async () => {
		const registry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				tags: {
					kind: RegistryConditionKind.MULTISELECT,
					label: "Tags",
					values: [{ value: "docs", label: "Docs" }],
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["tags"],
				},
			},
		};

		const context = await captureRequiredConditions(
			registry,
			"/tmp/registry.json",
			"/tmp/project",
			["demo"],
		);

		expect(context).toEqual({ tags: ["docs"] });
		expect(mockMultiselectInput).not.toHaveBeenCalled();
	});

	it("omits skipped optional text conditions from context", async () => {
		mockTextInput.mockResolvedValue("");
		const registry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				coverageThreshold: {
					kind: RegistryConditionKind.TEXT,
					label: "Coverage",
					optional: true,
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["coverageThreshold"],
				},
			},
		};

		const context = await captureRequiredConditions(
			registry,
			"/tmp/registry.json",
			"/tmp/project",
			["demo"],
		);

		expect(context).toEqual({});
		expect(mockTextInput).toHaveBeenCalledWith(
			"Coverage",
			{ required: false },
			undefined,
		);
	});

	it("captures optional boolean conditions via Yes/No/Skip", async () => {
		mockSelectInput.mockResolvedValue("true");
		const registry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				enableCi: {
					kind: RegistryConditionKind.BOOLEAN,
					label: "Enable CI",
					optional: true,
					default: "true",
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["enableCi"],
				},
			},
		};

		await expect(
			captureRequiredConditions(
				registry,
				"/tmp/registry.json",
				"/tmp/project",
				["demo"],
			),
		).resolves.toEqual({ enableCi: true });
		expect(mockSelectInput).toHaveBeenCalledWith(
			"Enable CI",
			expect.any(Object),
			"true",
		);

		mockSelectInput.mockResolvedValue("__tuckshop_skip__");
		const skipRegistry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				enableCi: {
					kind: RegistryConditionKind.BOOLEAN,
					label: "Enable CI",
					optional: true,
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["enableCi"],
				},
			},
		};
		await expect(
			captureRequiredConditions(
				skipRegistry,
				"/tmp/registry.json",
				"/tmp/project",
				["demo"],
			),
		).resolves.toEqual({});
	});

	it("omits skipped optional multiselect conditions from context", async () => {
		mockMultiselectInput.mockResolvedValue([]);
		const registry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				platforms: {
					kind: RegistryConditionKind.MULTISELECT,
					label: "Platforms",
					optional: true,
					values: [
						{ value: "ios", label: "iOS" },
						{ value: "android", label: "Android" },
					],
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["platforms"],
				},
			},
		};

		await expect(
			captureRequiredConditions(
				registry,
				"/tmp/registry.json",
				"/tmp/project",
				["demo"],
			),
		).resolves.toEqual({});
	});

	it("omits skipped optional select conditions from context", async () => {
		mockSelectInput.mockResolvedValue("__tuckshop_skip__");
		const registry: Registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				language: {
					kind: RegistryConditionKind.SELECT,
					label: "Language",
					optional: true,
					values: [
						{ value: "typescript", label: "TypeScript" },
						{ value: "python", label: "Python" },
					],
				},
			},
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					requires: ["language"],
				},
			},
		};

		await expect(
			captureRequiredConditions(
				registry,
				"/tmp/registry.json",
				"/tmp/project",
				["demo"],
			),
		).resolves.toEqual({});
	});

	it("rebuilds the install plan after capturing item-local conditions", async () => {
		mockTextInput.mockResolvedValue("45");
		const registry: Registry = {
			types: { configuration: { label: "Configurations" } },
			items: {
				demo: {
					title: "Demo",
					description: "Demo",
					type: "configuration",
					source: "r/demo.json",
					conditions: {
						coverageThreshold: {
							kind: RegistryConditionKind.TEXT,
							label: "Coverage",
						},
					},
				},
			},
		};

		const result = await captureItemLocalConditionsForPlan(
			registry,
			"/tmp/registry.json",
			["demo"],
			[{ itemId: "demo", sources: ["r/demo.json"] }],
			{},
			{
				projectDir: "/tmp/project",
				isFile: async () => false,
				readFile: async () => "",
				run: async () => "",
			},
		);

		expect(result.context).toEqual({ coverageThreshold: "45" });
		expect(result.plan).toEqual([{ itemId: "demo", sources: ["r/demo.json"] }]);
	});
});
