import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "../registry/schema";
import { RegistryItemType } from "../registry/schema";

const mockParseMultiValueOption = vi.fn((value: string) =>
	value
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean),
);

vi.mock("../cli/options", () => ({
	parseMultiValueOption: (value: string) => mockParseMultiValueOption(value),
}));

vi.mock("chalk", () => ({
	default: {
		bold: (text: string) => text,
		cyan: (text: string) => text,
		dim: (text: string) => text,
		grey: (text: string) => text,
		hex: () => (text: string) => text,
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
			"component-a": makeItem({
				id: "component-a",
				title: "Alpha Component",
				type: RegistryItemType.COMPONENT,
			}),
		});

		await listCommand(registry, ["component", "theme"], { type: "theme" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Themes");
		expect(output).toContain("Alpha Theme");
		expect(output).toContain("Zebra Theme");
		expect(output.indexOf("Alpha Theme")).toBeLessThan(
			output.indexOf("Zebra Theme"),
		);
		expect(output).not.toContain("Alpha Component");
		expect(output).toContain("2 item(s)");
	});

	it("lists all types when --type is all", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
			"component-a": makeItem({
				id: "component-a",
				title: "Alpha Component",
				type: RegistryItemType.COMPONENT,
			}),
		});

		await listCommand(registry, ["component", "theme"], { type: "all" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Components");
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

		await listCommand(registry, ["component", "theme"], { type: "all" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).not.toContain("Components");
		expect(output).toContain("Themes");
		expect(output).toContain("1 item(s)");
	});

	it("shows variant titles as a suffix", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
				variants: [
					{
						id: "light",
						title: "Light",
						description: "Light",
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
		expect(output).toContain("Alpha Theme [Light, Dark]");
	});

	it("prints an empty-state message when no items match", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
		});

		await listCommand(registry, ["theme", "component"], {
			type: "component",
		});

		expect(consoleLogSpy).toHaveBeenCalledWith(
			"No registry items match the requested types.",
		);
	});

	it("lists the only available type when --type is omitted", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
		});

		await listCommand(registry, ["theme"], {});

		expect(
			consoleLogSpy.mock.calls.map((call) => call[0]).join("\n"),
		).toContain("Alpha Theme");
	});

	it("lists every type when --type is omitted and multiple types exist", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: RegistryItemType.THEME,
			}),
			"component-a": makeItem({
				id: "component-a",
				title: "Alpha Component",
				type: RegistryItemType.COMPONENT,
			}),
		});

		await listCommand(registry, ["component", "theme"], {});

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Components");
		expect(output).toContain("Alpha Component");
		expect(output).toContain("Themes");
		expect(output).toContain("Alpha Theme");
		expect(output).toContain("2 item(s)");
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
				"component",
				"convention",
				"subagent",
				"template",
				"theme",
			],
			{ type: "all" },
		);

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Components");
		expect(output).toContain("Conventions");
		expect(output).toContain("Agent Instructions");
		expect(output).toContain("Agent Skills");
		expect(output).toContain("Subagents");
		expect(output).toContain("Templates");
		expect(output).toContain("Themes");
		expect(output).toContain("7 item(s)");
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
