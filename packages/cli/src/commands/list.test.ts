import type { Registry } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const DEFAULT_TYPES: NonNullable<Registry["types"]> = {
	component: {
		label: "Components",
		description: "Reusable UI primitives for building interfaces.",
	},
	configuration: {
		label: "Configurations",
		description: "Project workflows and tooling configuration.",
	},
	"agent-instruction": {
		label: "Agent Instructions",
		description: "Instruction files that guide coding agents.",
	},
	"agent-skill": {
		label: "Agent Skills",
		description: "Reusable skills that extend coding agents.",
	},
	subagent: {
		label: "Subagents",
		description: "Specialised agents for focused tasks.",
	},
	template: {
		label: "Templates",
		description: "Starter scaffolds for new projects.",
	},
	theme: {
		label: "Themes",
		description: "Design tokens and styling presets.",
	},
};

function makeItem(
	overrides: Partial<Registry["items"][string]> & {
		id: string;
		type: string;
		title: string;
	},
): Registry["items"][string] {
	const { id, ...rest } = overrides;
	return {
		description: `${overrides.title} description`,
		variants: [
			{
				id: "default",
				title: "Default",
				source: `r/${id}/default.json`,
			},
		],
		...rest,
	};
}

function makeRegistry(
	items: Registry["items"],
	types: Registry["types"] = DEFAULT_TYPES,
): Registry {
	return {
		types,
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
				type: "theme",
			}),
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: "theme",
			}),
			"component-a": makeItem({
				id: "component-a",
				title: "Alpha Component",
				type: "component",
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
				type: "theme",
			}),
			"component-a": makeItem({
				id: "component-a",
				title: "Alpha Component",
				type: "component",
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
				type: "theme",
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
				type: "theme",
				variants: [
					{
						id: "light",
						title: "Light",
						source: "r/theme-a/light.json",
					},
					{
						id: "dark",
						title: "Dark",
						source: "r/theme-a/dark.json",
					},
				],
			}),
		});

		await listCommand(registry, ["theme"], { type: "theme" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Alpha Theme [Light, Dark]");
	});

	it("omits the variant suffix when an item has no variants", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: "theme",
				variants: [],
			}),
		});

		await listCommand(registry, ["theme"], { type: "theme" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Alpha Theme: Alpha Theme description");
		expect(output).not.toContain("Alpha Theme [");
	});

	it("omits the variant suffix when variants are omitted", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: "theme",
				variants: undefined,
				source: "r/theme-a.json",
			}),
		});

		await listCommand(registry, ["theme"], { type: "theme" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Alpha Theme: Alpha Theme description");
		expect(output).not.toContain("Alpha Theme [");
	});

	it("prints an empty-state message when no items match", async () => {
		const registry = makeRegistry({
			"theme-a": makeItem({
				id: "theme-a",
				title: "Alpha Theme",
				type: "theme",
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
				type: "theme",
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
				type: "theme",
			}),
			"component-a": makeItem({
				id: "component-a",
				title: "Alpha Component",
				type: "component",
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

	it("formats labels from registry.types", async () => {
		const registry = makeRegistry({
			component: makeItem({
				id: "component",
				title: "Component",
				type: "component",
			}),
			configuration: makeItem({
				id: "configuration",
				title: "Configuration",
				type: "configuration",
			}),
			"agent-instruction": makeItem({
				id: "agent-instruction",
				title: "Agent Instruction",
				type: "agent-instruction",
			}),
			"agent-skill": makeItem({
				id: "agent-skill",
				title: "Agent Skill",
				type: "agent-skill",
			}),
			subagent: makeItem({
				id: "subagent",
				title: "Subagent",
				type: "subagent",
			}),
			template: makeItem({
				id: "template",
				title: "Template",
				type: "template",
			}),
			theme: makeItem({
				id: "theme",
				title: "Theme",
				type: "theme",
			}),
		});

		await listCommand(
			registry,
			[
				"component",
				"configuration",
				"agent-instruction",
				"agent-skill",
				"subagent",
				"template",
				"theme",
			],
			{ type: "all" },
		);

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("Components");
		expect(output).toContain("Configurations");
		expect(output).toContain("Agent Instructions");
		expect(output).toContain("Agent Skills");
		expect(output).toContain("Subagents");
		expect(output).toContain("Templates");
		expect(output).toContain("Themes");
		expect(output).toContain("7 item(s)");
	});

	it("falls back to the raw type string when a type has no display metadata", async () => {
		const registry = makeRegistry(
			{
				"legacy-item": makeItem({
					id: "legacy-item",
					title: "Legacy Item",
					type: "legacy",
				}),
			},
			{
				theme: {
					label: "Themes",
					description: "Design tokens and styling presets.",
				},
			},
		);

		await listCommand(registry, ["legacy"], { type: "legacy" });

		const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
		expect(output).toContain("legacy");
		expect(output).toContain("Legacy Item");
		expect(output).toContain("1 item(s)");
	});
});
