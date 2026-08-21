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

import { captureRequiredConditions } from "./add-conditions";

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
					uses: ["authorName"],
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
					uses: ["tags"],
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
});
