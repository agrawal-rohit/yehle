import { describe, expect, it } from "vitest";
import { renderMustacheContent, resolveRegistryInputs } from "./install";
import {
	collectRegistryFacets,
	collectRegistryInputs,
	listRegistryItems,
	registryFacetFromKebab,
	registryFacetToKebab,
	resolveRegistryPlan,
} from "./resolver";
import type {
	RegistryInput,
	RegistryInstallContext,
	RegistryItem,
	RegistryVariant,
} from "./schema";
import {
	evaluateRegistryCondition,
	parseRegistryCommandInputs,
	parseRegistryDependencyRef,
	parseRegistryItemManifest,
	RegistryInputOptionsFrom,
	RegistryInputType,
	RegistryItemType,
	RegistryVisibility,
	selectRegistryVariant,
	shouldInstallFileVisibility,
	validateRegistryCommandInputs,
} from "./schema";

/**
 * Build a test registry item with a single default variant unless overridden.
 * @param id - Item id.
 * @param overrides - Partial item fields.
 * @param files - Optional files for the default variant.
 * @returns Registry item.
 */
function makeItem(
	id: string,
	overrides: Partial<RegistryItem> = {},
	files: RegistryVariant["files"] = [],
): RegistryItem {
	return {
		id,
		title: id,
		description: `Description for ${id}`,
		type: RegistryItemType.CONVENTION,
		variants: [{ id: "default", files }],
		...overrides,
	};
}

describe("registry/schema", () => {
	it("parses a minimal manifest with single-variant sugar", () => {
		const manifest = parseRegistryItemManifest({
			id: "biome",
			title: "Biome",
			description: "Biome config",
			type: "convention",
			defaultVisibility: "public",
			files: [{ path: "biome.json", target: "biome.json" }],
		});

		expect(manifest.id).toBe("biome");
		expect(manifest.type).toBe(RegistryItemType.CONVENTION);
		expect(manifest.defaultVisibility).toBe(RegistryVisibility.PUBLIC);
		expect(manifest.variants).toHaveLength(1);
		expect(manifest.variants?.[0].id).toBe("default");
	});

	it("requires instructionName for agent-instruction items", () => {
		expect(() =>
			parseRegistryItemManifest({
				id: "principles",
				title: "Principles",
				description: "Core principles",
				type: "agent-instruction",
				files: [{ path: "principles.md", target: "principles.md" }],
			}),
		).toThrow(/instructionName/);

		const manifest = parseRegistryItemManifest({
			id: "principles",
			title: "Principles",
			description: "Core principles",
			type: "agent-instruction",
			instructionName: "principles",
			files: [{ path: "principles.md", target: "principles.md" }],
		});
		expect(manifest.instructionName).toBe("principles");
		expect(manifest.type).toBe(RegistryItemType.AGENT_INSTRUCTION);
	});

	it("parses ecosystem target facet", () => {
		const manifest = parseRegistryItemManifest({
			id: "build",
			title: "Build",
			description: "CI build",
			type: "convention",
			variants: [
				{
					id: "github-actions",
					targets: { ecosystem: "npm", tool: "github-actions" },
					files: [{ path: "ci.yml", target: ".github/workflows/ci.yml" }],
				},
			],
		});
		expect(manifest.variants?.[0].targets).toEqual({
			ecosystem: "npm",
			tool: "github-actions",
		});
	});

	it("parses dependency refs and selects variants", () => {
		expect(parseRegistryDependencyRef("button")).toEqual({ id: "button" });
		expect(parseRegistryDependencyRef("button@react")).toEqual({
			id: "button",
			variantId: "react",
		});

		const item = makeItem("button", {
			type: RegistryItemType.COMPONENT,
			variants: [
				{
					id: "react",
					targets: { framework: "react" },
					files: [{ source: "a", target: "a.tsx" }],
				},
				{
					id: "vue",
					targets: { framework: "vue" },
					files: [{ source: "b", target: "b.vue" }],
				},
			],
		});

		expect(
			selectRegistryVariant(item, undefined, {
				public: false,
				includeInstructions: false,
				framework: "vue",
			}).id,
		).toBe("vue");
		expect(
			selectRegistryVariant(item, "react", {
				public: false,
				includeInstructions: false,
			}).id,
		).toBe("react");
	});

	it("evaluates visibility and condition expressions", () => {
		expect(
			evaluateRegistryCondition("public", {
				public: true,
				includeInstructions: false,
			}),
		).toBe(true);
		expect(
			evaluateRegistryCondition("!public", {
				public: false,
				includeInstructions: false,
			}),
		).toBe(true);
		expect(
			evaluateRegistryCondition("framework:react", {
				public: false,
				includeInstructions: false,
				framework: "react",
			}),
		).toBe(true);
		expect(
			shouldInstallFileVisibility(RegistryVisibility.PUBLIC, {
				public: false,
				includeInstructions: false,
			}),
		).toBe(false);
	});
});

describe("registry/resolver", () => {
	it("resolves dependencies in order and deduplicates", () => {
		const index = new Map<string, RegistryItem>([
			[
				"shared-base",
				makeItem("shared-base", {}, [
					{ source: "shared/base/a", target: "a.txt" },
				]),
			],
			[
				"typescript-shared",
				makeItem(
					"typescript-shared",
					{ registryDependencies: ["shared-base"] },
					[{ source: "typescript/shared/b", target: "b.txt" }],
				),
			],
			[
				"typescript-package",
				makeItem(
					"typescript-package",
					{
						type: RegistryItemType.TEMPLATE,
						registryDependencies: ["typescript-shared"],
					},
					[{ source: "typescript/package/basic/c", target: "c.txt" }],
				),
			],
		]);

		const plan = resolveRegistryPlan("typescript-package", index, {
			public: false,
			includeInstructions: false,
		});

		expect(plan.items.map(({ item }) => item.id)).toEqual([
			"shared-base",
			"typescript-shared",
			"typescript-package",
		]);
	});

	it("skips conditional dependencies", () => {
		const index = new Map<string, RegistryItem>([
			["always", makeItem("always")],
			[
				"optional",
				makeItem("optional", {}, [
					{ source: "opt", target: "opt.txt", visibility: RegistryVisibility.PUBLIC },
				]),
			],
			[
				"root",
				makeItem("root", {
					registryDependencies: [
						"always",
						{ name: "optional", when: "public" },
					],
				}),
			],
		]);

		const plan = resolveRegistryPlan("root", index, {
			public: false,
			includeInstructions: false,
		});

		expect(plan.items.map(({ item }) => item.id)).toEqual(["always", "root"]);
	});

	it("detects dependency cycles", () => {
		const index = new Map<string, RegistryItem>([
			["a", makeItem("a", { registryDependencies: ["b"] })],
			["b", makeItem("b", { registryDependencies: ["a"] })],
		]);

		expect(() =>
			resolveRegistryPlan("a", index, {
				public: false,
				includeInstructions: false,
			}),
		).toThrow(/cycle/i);
	});

	it("merges package dependencies from selected variants", () => {
		const index = new Map<string, RegistryItem>([
			[
				"button",
				makeItem("button", {
					type: RegistryItemType.COMPONENT,
					variants: [
						{
							id: "react",
							targets: { framework: "react" },
							dependencies: ["react"],
							files: [{ source: "button.tsx", target: "button.tsx" }],
						},
					],
				}),
			],
			[
				"app",
				makeItem(
					"app",
					{
						type: RegistryItemType.TEMPLATE,
						registryDependencies: ["button@react"],
					},
					[{ source: "app", target: "app.tsx" }],
				),
			],
		]);

		const plan = resolveRegistryPlan("app", index, {
			public: false,
			includeInstructions: false,
			framework: "react",
		});

		expect(plan.dependencies).toEqual(["react"]);
	});

	it("collects inputs across resolved items", () => {
		const nameInput: RegistryInput = {
			name: "name",
			type: RegistryInputType.STRING,
			prompt: "Name?",
			required: true,
		};
		const index = new Map<string, RegistryItem>([
			["dep", makeItem("dep", { inputs: [nameInput] })],
			[
				"root",
				makeItem("root", {
					registryDependencies: ["dep"],
					inputs: [
						{
							name: "public",
							type: RegistryInputType.BOOLEAN,
							prompt: "Public?",
						},
					],
				}),
			],
		]);

		const plan = resolveRegistryPlan("root", index, {
			public: false,
			includeInstructions: false,
		});
		expect(collectRegistryInputs(plan.items).map((input) => input.name)).toEqual(
			["name", "public"],
		);
	});

	it("collects facets and lists items by type/language", () => {
		const index = new Map<string, RegistryItem>([
			[
				"typescript-react-app",
				makeItem("typescript-react-app", {
					type: RegistryItemType.TEMPLATE,
					projectSpec: "app",
					tags: ["ui"],
					variants: [
						{
							id: "default",
							targets: { language: "typescript", framework: "react" },
							files: [],
						},
					],
				}),
			],
			[
				"button",
				makeItem("button", {
					type: RegistryItemType.COMPONENT,
					tags: ["ui"],
					variants: [
						{
							id: "react",
							targets: { language: "typescript", framework: "react" },
							files: [],
						},
					],
				}),
			],
			[
				"principles",
				makeItem("principles", {
					type: RegistryItemType.AGENT_INSTRUCTION,
					instructionName: "principles",
				}),
			],
		]);

		const facets = collectRegistryFacets(index);
		expect(facets.type).toEqual([
			"agent-instruction",
			"component",
			"template",
		]);
		expect(facets.language).toEqual(["typescript"]);
		expect(facets.framework).toEqual(["react"]);
		expect(facets.projectSpec).toEqual(["app"]);
		expect(facets.tag).toEqual(["ui"]);
		expect(facets.ecosystem).toEqual([]);

		expect(registryFacetToKebab("projectSpec")).toBe("project-spec");
		expect(registryFacetFromKebab("project-spec")).toBe("projectSpec");

		expect(listRegistryItems(index, { type: "template" })).toEqual([
			"typescript-react-app",
		]);
		expect(listRegistryItems(index, { projectSpec: "app" })).toEqual([
			"typescript-react-app",
		]);
		expect(listRegistryItems(index, { tag: "ui" })).toEqual([
			"button",
			"typescript-react-app",
		]);
		expect(
			listRegistryItems(index, {
				type: ["template", "component"],
			}),
		).toEqual(["button", "typescript-react-app"]);
	});
});

describe("registry/install helpers", () => {
	it("renders mustache while preserving GitHub Actions expressions", () => {
		const rendered = renderMustacheContent(
			"hello {{ name }} ${{ github.actor }}",
			{ name: "world" },
		);
		expect(rendered).toBe("hello world ${{ github.actor }}");
	});

	it("resolves registry inputs into context", async () => {
		const context: RegistryInstallContext = {
			public: true,
			includeInstructions: false,
		};
		await resolveRegistryInputs(
			[
				{
					name: "name",
					type: RegistryInputType.STRING,
					prompt: "Name?",
					required: true,
				},
			],
			context,
			async () => "demo",
		);
		expect(context.name).toBe("demo");
	});
});

describe("registry/command inputs", () => {
	it("parses and validates command inputs", () => {
		const parsed = parseRegistryCommandInputs({
			add: [
				{
					name: "public",
					type: RegistryInputType.BOOLEAN,
					prompt: "Public?",
					default: false,
				},
				{
					name: "instructionsIdeFormat",
					type: RegistryInputType.SELECT,
					prompt: "IDE?",
					optionsFrom: RegistryInputOptionsFrom.IDE_FORMATS,
				},
			],
		});
		expect(parsed?.add).toHaveLength(2);
		expect(() =>
			validateRegistryCommandInputs({
				add: [
					{
						name: "public",
						type: RegistryInputType.BOOLEAN,
						prompt: "Public?",
					},
					{
						name: "public",
						type: RegistryInputType.BOOLEAN,
						prompt: "Again?",
					},
				],
			}),
		).toThrow(/Duplicate command input/);
	});
});
