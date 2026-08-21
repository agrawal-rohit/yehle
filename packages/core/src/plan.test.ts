import { describe, expect, it } from "vitest";
import { RegistryConditionKind } from "./condition-kind";
import {
	assumeContextFromSelectedItems,
	collectRegistryDependencies,
	collectRequiredConditions,
	parseItemId,
	resolveInstallPlan,
	selectRegistryVariant,
	whenMatchesContext,
} from "./plan";
import type { CatalogItem } from "./schema";

function makeVariant(
	overrides: Partial<NonNullable<CatalogItem["variants"]>[number]> &
		Pick<
			NonNullable<CatalogItem["variants"]>[number],
			"id" | "title" | "source"
		>,
): NonNullable<CatalogItem["variants"]>[number] {
	return {
		...overrides,
	};
}

function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
	return {
		title: "Item",
		description: "An item",
		type: "configuration",
		...overrides,
	};
}

describe("core/plan", () => {
	describe("parseItemId", () => {
		it("parses bare ids and id@variant values", () => {
			expect(parseItemId("git-hooks")).toEqual({ id: "git-hooks" });
			expect(parseItemId("git-hooks@typescript")).toEqual({
				id: "git-hooks",
				variantId: "typescript",
			});
		});

		it("rejects empty or malformed values", () => {
			expect(() => parseItemId("")).toThrow("non-empty");
			expect(() => parseItemId("@typescript")).toThrow(
				"Invalid registry item id",
			);
			expect(() => parseItemId("git-hooks@")).toThrow(
				"Invalid registry item id",
			);
		});
	});

	describe("selectRegistryVariant", () => {
		it("selects the most specific matching variant", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				selectRegistryVariant("item", item, { language: "typescript" }),
			).toEqual({
				variantId: "typescript",
				source: "r/item/typescript.json",
			});
		});

		it("returns source and/or handler for a variant-less item", () => {
			expect(
				selectRegistryVariant(
					"item",
					makeItem({
						source: "r/item.json",
						handler: "r/item.handler.js",
					}),
					{},
				),
			).toEqual({
				source: "r/item.json",
				handler: "r/item.handler.js",
			});
		});

		it("returns handler only when a variant-less item has no payload source", () => {
			expect(
				selectRegistryVariant(
					"item",
					makeItem({ handler: "r/item.handler.js" }),
					{},
				),
			).toEqual({ handler: "r/item.handler.js" });
		});

		it("includes an item-level handler on a matched variant", () => {
			const item = makeItem({
				handler: "r/item.handler.js",
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});

			expect(selectRegistryVariant("item", item, {})).toEqual({
				variantId: "default",
				source: "r/item/default.json",
				handler: "r/item.handler.js",
			});
		});

		it("rejects pinning a variant on a variant-less item", () => {
			expect(() =>
				selectRegistryVariant(
					"item",
					makeItem({ source: "r/item.json" }),
					{},
					"react",
				),
			).toThrow('Registry item "item" has no variants.');
		});

		it("rejects a missing pinned variant id", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});
			expect(() => selectRegistryVariant("item", item, {}, "missing")).toThrow(
				'Registry item "item" has no variant "missing".',
			);
		});

		it("rejects when no variant matches and no unconditional fallback exists", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});
			expect(() => selectRegistryVariant("item", item, {})).toThrow(
				"no variant matching the current context",
			);
		});

		it("rejects a variant-less item with neither source nor handler", () => {
			expect(() => selectRegistryVariant("item", makeItem(), {})).toThrow(
				"missing a payload source or handler",
			);
		});

		it("falls back to an unconditional variant", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				selectRegistryVariant("item", item, { language: "python" }),
			).toEqual({
				variantId: "default",
				source: "r/item/default.json",
			});
		});

		it("prefers a more specific matcher when an unconditional variant also matches", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				selectRegistryVariant("item", item, { language: "typescript" }),
			).toEqual({
				variantId: "typescript",
				source: "r/item/typescript.json",
			});
		});

		it("returns a variant-less item source", () => {
			const item = makeItem({ source: "r/assign-owner.json" });

			expect(selectRegistryVariant("assign-owner", item, {})).toEqual({
				source: "r/assign-owner.json",
			});
		});

		it("honors a pinned variant regardless of when", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				selectRegistryVariant(
					"item",
					item,
					{ language: "python" },
					"typescript",
				),
			).toEqual({
				variantId: "typescript",
				source: "r/item/typescript.json",
			});
		});
	});

	describe("resolveInstallPlan", () => {
		it("orders dependencies depth-first and deduplicates shared deps", () => {
			const shared = makeItem({ source: "r/shared.json" });
			const root = makeItem({
				source: "r/root.json",
				registryDependencies: ["shared"],
			});

			const plan = resolveInstallPlan(["root"], { root, shared }, {});

			expect(plan.items.map((node) => node.itemId)).toEqual(["shared", "root"]);
		});

		it("throws when a selected item is missing from the catalog", () => {
			expect(() => resolveInstallPlan(["missing"], {}, {})).toThrow(
				'Registry item not found: "missing"',
			);
		});

		it("includes handler-only items without a payload source", () => {
			const license = makeItem({ handler: "r/license.handler.js" });
			expect(resolveInstallPlan(["license"], { license }, {})).toEqual({
				items: [{ itemId: "license", handler: "r/license.handler.js" }],
			});
		});

		it("records selected variant id and source on resolved items", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				resolveInstallPlan(["item"], { item }, { language: "typescript" }),
			).toEqual({
				items: [
					{
						itemId: "item",
						variantId: "typescript",
						source: "r/item/typescript.json",
					},
				],
			});
		});

		it("detects dependency cycles", () => {
			const a = makeItem({
				source: "r/a.json",
				registryDependencies: ["b"],
			});
			const b = makeItem({
				source: "r/b.json",
				registryDependencies: ["a"],
			});

			expect(() => resolveInstallPlan(["a"], { a, b }, {})).toThrow(
				"dependency cycle",
			);
		});

		it("walks multiple selections once without duplicating shared dependencies", () => {
			const shared = makeItem({ source: "r/shared.json" });
			const a = makeItem({
				source: "r/a.json",
				registryDependencies: ["shared"],
			});
			const b = makeItem({
				source: "r/b.json",
				registryDependencies: ["shared"],
			});

			const plan = resolveInstallPlan(["a", "b"], { a, b, shared }, {});

			expect(plan.items.map((node) => node.itemId)).toEqual([
				"shared",
				"a",
				"b",
			]);
		});

		it("throws when the same item resolves to conflicting variants across selections", () => {
			const shared = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/shared/typescript.json",
						when: { language: "typescript" },
					}),
					makeVariant({
						id: "python",
						title: "Python",
						source: "r/shared/python.json",
						when: { language: "python" },
					}),
				],
			});
			const a = makeItem({
				source: "r/a.json",
				registryDependencies: ["shared@typescript"],
			});
			const b = makeItem({
				source: "r/b.json",
				registryDependencies: ["shared@python"],
			});

			expect(() =>
				resolveInstallPlan(["a", "b"], { a, b, shared }, {}),
			).toThrow("conflicting variants");
		});

		it("allows revisiting a shared dependency with the same pinned variant", () => {
			const shared = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/shared/typescript.json",
						when: { language: "typescript" },
					}),
					makeVariant({
						id: "python",
						title: "Python",
						source: "r/shared/python.json",
						when: { language: "python" },
					}),
				],
			});
			const a = makeItem({
				source: "r/a.json",
				registryDependencies: ["shared@typescript"],
			});
			const b = makeItem({
				source: "r/b.json",
				registryDependencies: ["shared@typescript"],
			});

			const plan = resolveInstallPlan(["a", "b"], { a, b, shared }, {});

			expect(plan.items.map((node) => node.itemId)).toEqual([
				"shared",
				"a",
				"b",
			]);
			expect(plan.items[0]).toMatchObject({
				itemId: "shared",
				variantId: "typescript",
			});
		});
	});

	describe("collectRegistryDependencies", () => {
		it("includes selected items and walks registryDependencies from all variants", () => {
			const setup = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/setup/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});
			const testing = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/testing/typescript.json",
						when: { language: "typescript" },
						registryDependencies: ["setup-workspace"],
					}),
				],
			});

			const dependencies = collectRegistryDependencies(
				["testing-configuration"],
				{
					"testing-configuration": testing,
					"setup-workspace": setup,
				},
			);

			expect(dependencies.map((entry) => entry.itemId)).toEqual([
				"testing-configuration",
				"setup-workspace",
			]);
		});

		it("walks item-level dependencies and skips already-visited ids", () => {
			const shared = makeItem({ source: "r/shared.json" });
			const left = makeItem({
				source: "r/left.json",
				registryDependencies: ["shared", "shared@default"],
			});
			const right = makeItem({
				source: "r/right.json",
				registryDependencies: ["shared"],
			});

			const dependencies = collectRegistryDependencies(["left", "right"], {
				left,
				right,
				shared,
			});

			expect(dependencies.map((entry) => entry.itemId)).toEqual([
				"left",
				"shared",
				"right",
			]);
		});

		it("throws when a dependency is missing from the catalog", () => {
			expect(() => collectRegistryDependencies(["missing"], {})).toThrow(
				'Registry item not found: "missing"',
			);
		});
	});

	describe("collectRequiredConditions", () => {
		it("returns unresolved keys with intersected prompt values", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			const required = collectRequiredConditions(
				[{ itemId: "item", item }],
				{
					language: {
						label: "Language",
						description: "Pick a language",
						values: [
							{ value: "typescript", label: "TypeScript" },
							{ value: "python", label: "Python" },
						],
					},
				},
				{},
			);

			expect(required).toEqual([
				{
					key: "language",
					label: "Language",
					description: "Pick a language",
					kind: "select",
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			]);
		});

		it("omits description and handler when the condition does not declare them", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			const [required] = collectRequiredConditions(
				[{ itemId: "item", item }],
				{
					language: {
						label: "Language",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				},
				{},
			);

			expect(required).toMatchObject({
				key: "language",
				label: "Language",
				kind: "select",
				values: [{ value: "typescript", label: "TypeScript" }],
			});
			// toEqual treats explicit undefined like a missing key; assert absence directly.
			expect(Object.hasOwn(required, "description")).toBe(false);
			expect(Object.hasOwn(required, "handler")).toBe(false);
		});

		it("sorts required conditions by key", () => {
			const item = makeItem({
				uses: ["zebra", "alpha"],
				source: "r/item.json",
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						zebra: {
							kind: RegistryConditionKind.TEXT,
							label: "Zebra",
						},
						alpha: {
							kind: RegistryConditionKind.TEXT,
							label: "Alpha",
						},
					},
					{},
				).map((entry) => entry.key),
			).toEqual(["alpha", "zebra"]);
		});

		it("includes text conditions listed in item uses", () => {
			const item = makeItem({
				source: "r/item.json",
				uses: ["authorName"],
			});

			const required = collectRequiredConditions(
				[{ itemId: "item", item }],
				{
					authorName: {
						kind: RegistryConditionKind.TEXT,
						label: "Author name",
						handler: "r/_handlers/authorName.handler.js",
					},
				},
				{},
			);

			expect(required).toEqual([
				{
					key: "authorName",
					label: "Author name",
					kind: "text",
					values: [],
					handler: "r/_handlers/authorName.handler.js",
				},
			]);
		});

		it("skips conditions already present in context", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						language: {
							label: "Language",
							values: [{ value: "typescript", label: "TypeScript" }],
						},
					},
					{ language: "typescript" },
				),
			).toEqual([]);
		});

		it("returns full select values when a key comes only from uses", () => {
			const item = makeItem({
				source: "r/item.json",
				uses: ["language"],
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						language: {
							label: "Language",
							values: [
								{ value: "typescript", label: "TypeScript" },
								{ value: "python", label: "Python" },
							],
						},
					},
					{},
				),
			).toEqual([
				{
					key: "language",
					label: "Language",
					kind: RegistryConditionKind.SELECT,
					values: [
						{ value: "typescript", label: "TypeScript" },
						{ value: "python", label: "Python" },
					],
				},
			]);
		});

		it("includes boolean and multiselect conditions listed in item uses", () => {
			const item = makeItem({
				source: "r/item.json",
				uses: ["enableCi", "platforms"],
			});

			const required = collectRequiredConditions(
				[{ itemId: "item", item }],
				{
					enableCi: {
						kind: RegistryConditionKind.BOOLEAN,
						label: "Enable CI",
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
				{},
			);

			expect(required).toEqual([
				{
					key: "enableCi",
					label: "Enable CI",
					kind: "boolean",
					values: [],
				},
				{
					key: "platforms",
					label: "Platforms",
					kind: "multiselect",
					values: [
						{ value: "ios", label: "iOS" },
						{ value: "android", label: "Android" },
					],
				},
			]);
		});

		it("rejects undeclared condition keys", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(() =>
				collectRequiredConditions([{ itemId: "item", item }], {}, {}),
			).toThrow('Install plan references undeclared condition "language".');
		});

		it("rejects select conditions whose intersected values are empty", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "python",
						title: "Python",
						source: "r/item/python.json",
						when: { language: "python" },
					}),
				],
			});

			expect(() =>
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						language: {
							label: "Language",
							values: [{ value: "typescript", label: "TypeScript" }],
						},
					},
					{},
				),
			).toThrow(
				'Condition "language" has no selectable values for the current install set.',
			);
		});

		it("rejects select conditions that declare no values list", () => {
			const item = makeItem({
				source: "r/item.json",
				uses: ["language"],
			});

			expect(() =>
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{ language: { label: "Language" } },
					{},
				),
			).toThrow(
				'Condition "language" has no selectable values for the current install set.',
			);
		});
	});

	describe("whenMatchesContext", () => {
		it("treats a missing when map as a match", () => {
			expect(whenMatchesContext(undefined, {})).toBe(true);
		});

		it("matches string equality and rejects missing context keys", () => {
			expect(
				whenMatchesContext(
					{ language: "typescript" },
					{ language: "typescript" },
				),
			).toBe(true);
			expect(whenMatchesContext({ language: "typescript" }, {})).toBe(false);
		});

		it("matches multiselect when the expected value is selected", () => {
			expect(
				whenMatchesContext(
					{ platforms: "ios" },
					{ platforms: ["ios", "android"] },
				),
			).toBe(true);
			expect(
				whenMatchesContext({ platforms: "web" }, { platforms: ["ios"] }),
			).toBe(false);
		});

		it("matches boolean when against true/false strings", () => {
			expect(whenMatchesContext({ enableCi: "true" }, { enableCi: true })).toBe(
				true,
			);
			expect(
				whenMatchesContext({ enableCi: "false" }, { enableCi: true }),
			).toBe(false);
		});
	});

	describe("assumeContextFromSelectedItems", () => {
		it("seeds from a pinned variant when map", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				assumeContextFromSelectedItems(
					["item@typescript"],
					{ item },
					{
						language: {
							label: "Language",
							values: [{ value: "typescript", label: "TypeScript" }],
						},
					},
				),
			).toEqual({ language: "typescript" });
		});

		it("does not seed context without a pinned variant", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(assumeContextFromSelectedItems(["item"], { item })).toEqual({});
		});

		it("skips a pinned variant that has no when map", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});

			expect(
				assumeContextFromSelectedItems(["item@default"], { item }),
			).toEqual({});
		});

		it("rejects a pinned item missing from the catalog", () => {
			expect(() =>
				assumeContextFromSelectedItems(["missing@typescript"], {}),
			).toThrow('Registry item not found: "missing".');
		});

		it("rejects undeclared condition keys on a pinned variant", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(() =>
				assumeContextFromSelectedItems(["item@typescript"], { item }, {}),
			).toThrow(
				'Pinned variant "item@typescript" references undeclared condition "language".',
			);
		});

		it("coerces boolean and multiselect when values when conditions are provided", () => {
			const item = makeItem({
				variants: [
					makeVariant({
						id: "mobile",
						title: "Mobile",
						source: "r/mobile.json",
						when: { enableCi: "true", platforms: "ios" },
					}),
				],
			});

			expect(
				assumeContextFromSelectedItems(
					["item@mobile"],
					{ item },
					{
						enableCi: {
							kind: RegistryConditionKind.BOOLEAN,
							label: "Enable CI",
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
				),
			).toEqual({
				enableCi: true,
				platforms: ["ios"],
			});
		});
	});
});
