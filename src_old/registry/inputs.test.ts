import { describe, expect, it } from "vitest";
import {
	collectInputsForSelection,
	parseCliInputValues,
	planNeedsInput,
	registryInputNameToKebab,
	registryInputToCliFlag,
	resolveInstallContext,
	resolvePermissivePlan,
} from "./inputs";
import {
	type RegistryIndex,
	resolveRegistryPlan,
} from "./resolver";
import {
	RegistryInputType,
	type RegistryItem,
	RegistryItemType,
	RegistryVisibility,
} from "./schema";

const nameInput = {
	name: "name",
	type: RegistryInputType.STRING,
	prompt: "Name?",
	required: true,
};

const authorInput = {
	name: "authorName",
	type: RegistryInputType.STRING,
	prompt: "Author?",
	when: "public",
};

/**
 * Build a test registry item.
 * @param id - Item id.
 * @param overrides - Partial overrides.
 * @returns Registry item.
 */
function makeItem(
	id: string,
	overrides: Partial<RegistryItem> = {},
): RegistryItem {
	return {
		id,
		title: id,
		description: `Description for ${id}`,
		type: RegistryItemType.CONVENTION,
		variants: [{ id: "default", files: [] }],
		...overrides,
	};
}

describe("registry/inputs", () => {
	it("maps registry input names to kebab-case CLI flags", () => {
		expect(registryInputNameToKebab("instructionsIdeFormat")).toBe(
			"instructions-ide-format",
		);
		expect(
			registryInputToCliFlag({
				name: "public",
				type: RegistryInputType.BOOLEAN,
				prompt: "Public?",
			}),
		).toEqual({ flag: "--public", description: "Public?" });
	});

	it("parses named flags and aliases only", () => {
		const declared = [
			{
				name: "public",
				type: RegistryInputType.BOOLEAN,
				prompt: "Public?",
			},
			{
				name: "name",
				type: RegistryInputType.STRING,
				prompt: "Name?",
				required: true,
			},
			{
				name: "instructionsIdeFormat",
				type: RegistryInputType.SELECT,
				prompt: "IDE?",
			},
		];

		expect(
			parseCliInputValues(
				{
					public: true,
					name: "demo",
					ideFormat: "cursor",
					unknown: "ignored",
				},
				declared,
			),
		).toEqual({
			public: true,
			name: "demo",
			instructionsIdeFormat: "cursor",
		});
	});

	it("collects inputs for a selection including command inputs", () => {
		const index: RegistryIndex = new Map([
			[
				"typescript-package",
				makeItem("typescript-package", {
					type: RegistryItemType.TEMPLATE,
					registryDependencies: ["dependency-updater"],
					inputs: [nameInput, authorInput],
				}),
			],
			[
				"dependency-updater",
				makeItem("dependency-updater", {
					variants: [
						{
							id: "default",
							files: [
								{
									source: "a",
									target: "a.yml",
									visibility: RegistryVisibility.PUBLIC,
								},
							],
						},
					],
				}),
			],
			[
				"button",
				makeItem("button", {
					type: RegistryItemType.COMPONENT,
					variants: [
						{
							id: "react",
							targets: { framework: "react" },
							files: [{ source: "b", target: "b.tsx" }],
						},
					],
				}),
			],
		]);

		const inputs = collectInputsForSelection(
			["typescript-package"],
			index,
			[
				{
					name: "public",
					type: RegistryInputType.BOOLEAN,
					prompt: "Public?",
					default: false,
				},
				{
					name: "framework",
					type: RegistryInputType.STRING,
					prompt: "Framework?",
				},
			],
		);

		expect(inputs.map((input) => input.name)).toEqual([
			"public",
			"name",
			"authorName",
		]);
	});

	it("walks permissive plans across all variant deps", () => {
		const index: RegistryIndex = new Map([
			[
				"template-a",
				makeItem("template-a", {
					type: RegistryItemType.TEMPLATE,
					registryDependencies: ["leaf"],
				}),
			],
			["leaf", makeItem("leaf")],
		]);

		expect(
			resolvePermissivePlan(["template-a"], index).map((item) => item.id),
		).toEqual(["template-a", "leaf"]);
	});

	it("detects when a plan needs public / framework / instructions", () => {
		const withPublic = [
			makeItem("a", {
				variants: [
					{
						id: "default",
						files: [
							{
								source: "x",
								target: "x",
								visibility: RegistryVisibility.PUBLIC,
							},
						],
					},
				],
			}),
		];
		expect(planNeedsInput(withPublic, "public")).toBe(true);

		const withFramework = [
			makeItem("button", {
				type: RegistryItemType.COMPONENT,
				variants: [
					{
						id: "react",
						targets: { framework: "react" },
						files: [{ source: "b", target: "b.tsx" }],
					},
				],
			}),
		];
		expect(planNeedsInput(withFramework, "framework")).toBe(true);

		const withInstruction = [
			makeItem("principles", {
				type: RegistryItemType.AGENT_INSTRUCTION,
				instructionName: "principles",
			}),
		];
		expect(planNeedsInput(withInstruction, "includeInstructions")).toBe(true);
		expect(planNeedsInput(withInstruction, "instructionsIdeFormat")).toBe(true);
	});

	it("resolves install context in two phases", async () => {
		const index: RegistryIndex = new Map([
			[
				"typescript-package",
				makeItem("typescript-package", {
					type: RegistryItemType.TEMPLATE,
					registryDependencies: [
						{ name: "principles", when: "includeInstructions" },
					],
					inputs: [nameInput],
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

		const withoutInstructions = resolveRegistryPlan(
			"typescript-package",
			index,
			{ public: false, includeInstructions: false },
		);
		expect(withoutInstructions.items.map(({ item }) => item.id)).toEqual([
			"typescript-package",
		]);

		const withInstructions = resolveRegistryPlan("typescript-package", index, {
			public: false,
			includeInstructions: true,
		});
		expect(withInstructions.items.map(({ item }) => item.id)).toEqual([
			"principles",
			"typescript-package",
		]);

		const answers = new Map<string, string | boolean>([
			["includeInstructions", true],
			["name", "demo"],
		]);

		const context = await resolveInstallContext({
			rootItemNames: ["typescript-package"],
			index,
			commandInputs: [
				{
					name: "includeInstructions",
					type: RegistryInputType.BOOLEAN,
					prompt: "Instructions?",
					default: false,
				},
			],
			resolveInput: async (input) => {
				const value = answers.get(input.name);
				if (value === undefined)
					throw new Error(`Unexpected prompt for ${input.name}`);
				return value;
			},
			command: "create",
			lang: "typescript",
		});

		expect(context.includeInstructions).toBe(true);
		expect(context.name).toBe("demo");
		expect(context.lang).toBe("typescript");
	});
});
