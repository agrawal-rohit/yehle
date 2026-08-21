import { describe, expect, it } from "vitest";
import {
	assumeContextFromSelectedItems,
	collectRegistryDependencies,
	collectRequiredConditions,
	parseItemId,
	resolveInstallPlan,
	selectRegistryVariant,
} from "./plan";
import type { RegistryItem } from "./schema";

function makeVariant(
	overrides: Partial<NonNullable<RegistryItem["variants"]>[number]> &
		Pick<
			NonNullable<RegistryItem["variants"]>[number],
			"id" | "title" | "source"
		>,
): NonNullable<RegistryItem["variants"]>[number] {
	return {
		...overrides,
	};
}

function makeItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
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
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			]);
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
				assumeContextFromSelectedItems(["item@typescript"], { item }),
			).toEqual({ language: "typescript" });
		});

		it("seeds from a variant-less item when map", () => {
			const item = makeItem({
				source: "r/tsconfig.json",
				when: { language: "typescript" },
			});

			expect(assumeContextFromSelectedItems(["item"], { item })).toEqual({
				language: "typescript",
			});
		});

		it("does not seed item-level when when the item has variants", () => {
			const item = makeItem({
				when: { language: "typescript" },
				variants: [
					makeVariant({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});

			expect(assumeContextFromSelectedItems(["item"], { item })).toEqual({});
		});
	});
});
