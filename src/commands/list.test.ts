import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "../registry/schema";
import { RegistryItemType } from "../registry/schema";

const mockMultiselectInput = vi.fn();
const mockParseMultiValueOption = vi.fn((value: string) =>
	value
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean),
);

vi.mock("../cli/prompts", () => ({
	default: {
		multiselectInput: (...args: unknown[]) => mockMultiselectInput(...args),
	},
}));

vi.mock("../cli/options", () => ({
	parseMultiValueOption: (value: string) => mockParseMultiValueOption(value),
}));

vi.mock("chalk", () => ({
	default: {
		bold: (text: string) => text,
		dim: (text: string) => text,
	},
}));

import listCommand from "./list";

function makeItem(
	overrides: Partial<Registry["items"][string]> & {
		id: string;
		type: RegistryItemType;
		title: string;
	},
): Registry["items"][string] {
	return {
		description: `${overrides.title} description`,
		variants: [
			{
				id: "default",
				title: "Default",
				description: "Default variant",
				files: [],
			},
		],
		...overrides,
	};
}

function makeRegistry(items: Registry["items"]): Registry {
	return {
		version: "0.0.0",
		contentBaseUrl: "https://example.com",
		items,
	};
}

describe("commands/list", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
	});

	it("lists items filtered by --type, sorted by title", async () => {
		const registry = makeRegistry({
			"theme-z": makeItem({
				id: "theme-z",
				title: "Zebra Theme",
				type: RegistryItemType.THEME,
			}),
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
			"block-a": makeItem({
				id: "block-a",
				title: "Alpha Block",
				type: RegistryItemType.BLOCK,
			}),
		});

		await listCommand(registry, ["block", "theme"], { type: "theme" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Themes");
		expect(output).toContain("Alpha Theme");
		expect(output).toContain("Zebra Theme");
		expect(output.indexOf("Alpha Theme")).toBeLessThan(
			output.indexOf("Zebra Theme"),
		);
		expect(output).not.toContain("Alpha Block");
		expect(output).toContain("2 item(s)");
	});

	it("lists all types when --type is all", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
			"block-a": makeItem({
				id: "block-a",
				title: "Alpha Block",
				type: RegistryItemType.BLOCK,
			}),
		});

		await listCommand(registry, ["block", "theme"], { type: "all" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Blocks");
		expect(output).toContain("Themes");
		expect(output).toContain("2 item(s)");
	});

	it("skips allowed types that have no matching registry items", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
		});

		await listCommand(registry, ["block", "theme"], { type: "all" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).not.toContain("Blocks");
		expect(output).toContain("Themes");
		expect(output).toContain("1 item(s)");
	});

	it("shows non-default variant ids as a suffix", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [],
					},
					{
						id: "dark",
						title: "Dark",
						description: "Dark",
						files: [],
					},
				],
			}),
		});

		await listCommand(registry, ["theme"], { type: "theme" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Alpha Theme [dark]");
	});

	it("prints an empty-state message when no items match", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
		});

		await listCommand(registry, ["theme", "block"], { type: "block" });

		expect(consoleLogSpy).toHaveBeenCalledWith(
			"No registry items match the requested types.",
		);
	});

	it("auto-selects the only available type when --type is omitted", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
		});

		await listCommand(registry, ["theme"], {});

		expect(mockMultiselectInput).not.toHaveBeenCalled();
		expect(
			consoleLogSpy.mock.calls.map((call) => call[0]).join("\n"),
		).toContain("Alpha Theme");
	});

	it("prompts for types when --type is omitted and multiple types exist", async () => {
		mockMultiselectInput.mockResolvedValue(["theme"]);
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
			"block-a": makeItem({
				id: "block-a",
				title: "Alpha Block",
				type: RegistryItemType.BLOCK,
			}),
		});

		await listCommand(registry, ["block", "theme"], {});

		expect(mockMultiselectInput).toHaveBeenCalledWith(
			"Which registry types would you like to list?",
			expect.objectContaining({
				options: expect.arrayContaining([
					{ label: "Blocks", value: "block" },
					{ label: "Themes", value: "theme" },
				]),
			}),
			["block", "theme"],
		);
		expect(
			consoleLogSpy.mock.calls.map((call) => call[0]).join("\n"),
		).toContain("Alpha Theme");
	});

	it("throws when the multiselect returns no types", async () => {
		mockMultiselectInput.mockResolvedValue([]);
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
			"block-a": makeItem({
				id: "block-a",
				title: "Alpha Block",
				type: RegistryItemType.BLOCK,
			}),
		});

		await expect(listCommand(registry, ["block", "theme"], {})).rejects.toThrow(
			"Select at least one registry type to list.",
		);
	});

	it("throws when no registry item types are available", async () => {
		await expect(listCommand(makeRegistry({}), [], {})).rejects.toThrow(
			"No registry item types found.",
		);
	});

	it('throws when combining "all" with specific types', async () => {
		await expect(
			listCommand(makeRegistry({}), ["theme"], { type: "all,theme" }),
		).rejects.toThrow('Cannot combine type "all" with specific --type values.');
	});

	it("throws for unsupported --type values", async () => {
		await expect(
			listCommand(makeRegistry({}), ["theme"], { type: "workflow" }),
		).rejects.toThrow(
			'Unsupported registry type "workflow" (available: theme).',
		);
	});

	it("formats every known registry item type label", async () => {
		const registry = makeRegistry({
			block: makeItem({
				id: "block",
				title: "Block",
				type: RegistryItemType.BLOCK,
			}),
			component: makeItem({
				id: "component",
				title: "Component",
				type: RegistryItemType.COMPONENT,
			}),
			convention: makeItem({
				id: "convention",
				title: "Convention",
				type: RegistryItemType.CONVENTION,
			}),
			"agent-instruction": makeItem({
				id: "agent-instruction",
				title: "Agent Instruction",
				type: RegistryItemType.AGENT_INSTRUCTION,
			}),
			"agent-skill": makeItem({
				id: "agent-skill",
				title: "Agent Skill",
				type: RegistryItemType.AGENT_SKILL,
			}),
			subagent: makeItem({
				id: "subagent",
				title: "Subagent",
				type: RegistryItemType.SUBAGENT,
			}),
			template: makeItem({
				id: "template",
				title: "Template",
				type: RegistryItemType.TEMPLATE,
			}),
			theme: makeItem({
				id: "theme",
				title: "Theme",
				type: RegistryItemType.THEME,
			}),
		});

		await listCommand(
			registry,
			[
				"agent-instruction",
				"agent-skill",
				"block",
				"component",
				"convention",
				"subagent",
				"template",
				"theme",
			],
			{ type: "all" },
		);

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Blocks");
		expect(output).toContain("Components");
		expect(output).toContain("Conventions");
		expect(output).toContain("Agent Instructions");
		expect(output).toContain("Agent Skills");
		expect(output).toContain("Subagents");
		expect(output).toContain("Templates");
		expect(output).toContain("Themes");
		expect(output).toContain("8 item(s)");
	});

	it("returns the raw type string for unknown registry item types at runtime", async () => {
		const unknownType = "legacy" as RegistryItemType;
		const registry = makeRegistry({
			"legacy-item": makeItem({
				id: "legacy-item",
				title: "Legacy Item",
				type: unknownType,
			}),
		});

		await listCommand(registry, ["legacy"], { type: "legacy" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("legacy");
		expect(output).toContain("Legacy Item");
		expect(output).toContain("1 item(s)");
	});
});
