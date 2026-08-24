import { describe, expect, it } from "vitest";
import { RegistryConditionKind } from "./condition-kind";
import { NpmPackageManager } from "./packages";
import {
	assumeContextFromSelectedItems,
	buildInstallPlan,
	collectItemLocalConditions,
	collectRegistryDependencies,
	collectRequiredConditions,
	parseItemId,
	selectRegistryPacks,
	whenMatchesContext,
} from "./plan";
import type { IndexItem, IndexPack } from "./schema";

/**
 * Build a index pack fixture.
 * @param overrides - Pack fields including required id, title, and source.
 * @returns Catalog pack.
 */
function makePack(
	overrides: Partial<IndexPack> & Pick<IndexPack, "id" | "title" | "source">,
): IndexPack {
	return {
		...overrides,
	};
}

/**
 * Build a index item fixture.
 * @param overrides - Item fields to merge over defaults.
 * @returns Catalog item.
 */
function makeItem(overrides: Partial<IndexItem> = {}): IndexItem {
	return {
		title: "Item",
		description: "An item",
		type: "configuration",
		...overrides,
	};
}

describe("core/plan", () => {
	describe("parseItemId", () => {
		it("parses bare ids and id@pack values", () => {
			expect(parseItemId("git-hooks")).toEqual({ id: "git-hooks" });
			expect(parseItemId("git-hooks@typescript")).toEqual({
				id: "git-hooks",
				packId: "typescript",
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

	describe("selectRegistryPacks", () => {
		it("selects every pack whose when matches, including unconditional packs", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				selectRegistryPacks("item", item, { language: "typescript" }),
			).toEqual({
				packIds: ["default", "typescript"],
				sources: ["r/item/default.json", "r/item/typescript.json"],
			});
		});

		it("returns source and/or install scripts for a pack-less item", () => {
			expect(
				selectRegistryPacks(
					"item",
					makeItem({
						source: "r/item.json",
						prepare: ["r/item.prepare.0.js"],
					}),
					{},
				),
			).toEqual({
				sources: ["r/item.json"],
				prepareScripts: ["r/item.prepare.0.js"],
			});
		});

		it("returns install scripts only when a pack-less item has no compiled item source", () => {
			expect(
				selectRegistryPacks(
					"item",
					makeItem({ prepare: ["r/item.prepare.0.js"] }),
					{},
				),
			).toEqual({ prepareScripts: ["r/item.prepare.0.js"] });
		});

		it("includes item-level install scripts on matching packs", () => {
			const item = makeItem({
				prepare: ["r/item.prepare.0.js"],
				packs: [
					makePack({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});

			expect(selectRegistryPacks("item", item, {})).toEqual({
				packIds: ["default"],
				sources: ["r/item/default.json"],
				prepareScripts: ["r/item.prepare.0.js"],
			});
		});

		it("stacks item-level and selected-pack install scripts", () => {
			const item = makeItem({
				prepare: ["r/item.prepare.0.js"],
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						prepare: ["r/item/typescript.prepare.0.js"],
					}),
				],
			});

			expect(selectRegistryPacks("item", item, {})).toEqual({
				packIds: ["typescript"],
				sources: ["r/item/typescript.json"],
				prepareScripts: [
					"r/item.prepare.0.js",
					"r/item/typescript.prepare.0.js",
				],
			});
		});

		it("layers a base item source under matching pack sources", () => {
			const item = makeItem({
				source: "r/item.json",
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
					}),
				],
			});

			expect(selectRegistryPacks("item", item, {})).toEqual({
				packIds: ["typescript"],
				sources: ["r/item.json", "r/item/typescript.json"],
			});
		});

		it("rejects pinning a pack on a pack-less item", () => {
			expect(() =>
				selectRegistryPacks(
					"item",
					makeItem({ source: "r/item.json" }),
					{},
					"react",
				),
			).toThrow('Registry item "item" has no packs.');
		});

		it("rejects a missing pinned pack id", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});
			expect(() => selectRegistryPacks("item", item, {}, "missing")).toThrow(
				'Registry item "item" has no pack "missing".',
			);
		});

		it("returns empty sources when no pack matches and the item has no base source", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});
			expect(selectRegistryPacks("item", item, {})).toEqual({
				sources: [],
			});
		});

		it("rejects a pack-less item with neither source nor install phases", () => {
			expect(() => selectRegistryPacks("item", makeItem(), {})).toThrow(
				"missing a compiled item source or install phase",
			);
		});

		it("keeps unconditional packs when a conditional pack does not match", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(selectRegistryPacks("item", item, { language: "python" })).toEqual(
				{
					packIds: ["default"],
					sources: ["r/item/default.json"],
				},
			);
		});

		it("returns a pack-less item source", () => {
			const item = makeItem({ source: "r/assign-owner.json" });

			expect(selectRegistryPacks("assign-owner", item, {})).toEqual({
				sources: ["r/assign-owner.json"],
			});
		});

		it("honors a pinned pack even when its when does not match", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				selectRegistryPacks("item", item, { language: "python" }, "typescript"),
			).toEqual({
				packIds: ["typescript"],
				sources: ["r/item/typescript.json"],
			});
		});
	});

	describe("buildInstallPlan", () => {
		it("orders dependencies depth-first and deduplicates shared deps", () => {
			const shared = makeItem({ source: "r/shared.json" });
			const root = makeItem({
				source: "r/root.json",
				dependsOn: ["shared"],
			});

			const plan = buildInstallPlan(["root"], { root, shared }, {});

			expect(plan.map((node) => node.itemId)).toEqual(["shared", "root"]);
		});

		it("walks item-level and selected-pack dependsOn", () => {
			const shared = makeItem({ source: "r/shared.json" });
			const eslint = makeItem({ source: "r/eslint.json" });
			const item = makeItem({
				dependsOn: ["shared"],
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						dependsOn: ["eslint"],
					}),
				],
			});

			expect(
				buildInstallPlan(["item"], { item, shared, eslint }, {}).map(
					(node) => node.itemId,
				),
			).toEqual(["shared", "eslint", "item"]);
		});

		it("throws when a selected item is missing from the catalog", () => {
			expect(() => buildInstallPlan(["missing"], {}, {})).toThrow(
				'Registry item not found: "missing"',
			);
		});

		it("includes script-only items without a compiled item source", () => {
			const license = makeItem({
				prepare: ["r/license.prepare.0.js"],
			});
			expect(buildInstallPlan(["license"], { license }, {})).toEqual([
				{
					itemId: "license",
					prepareScripts: ["r/license.prepare.0.js"],
				},
			]);
		});

		it("records selected pack ids and sources on planned items", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(
				buildInstallPlan(["item"], { item }, { language: "typescript" }),
			).toEqual([
				{
					itemId: "item",
					packIds: ["typescript"],
					sources: ["r/item/typescript.json"],
				},
			]);
		});

		it("detects dependency cycles", () => {
			const a = makeItem({
				source: "r/a.json",
				dependsOn: ["b"],
			});
			const b = makeItem({
				source: "r/b.json",
				dependsOn: ["a"],
			});

			expect(() => buildInstallPlan(["a"], { a, b }, {})).toThrow(
				"dependency cycle",
			);
		});

		it("walks multiple selections once without duplicating shared dependencies", () => {
			const shared = makeItem({ source: "r/shared.json" });
			const a = makeItem({
				source: "r/a.json",
				dependsOn: ["shared"],
			});
			const b = makeItem({
				source: "r/b.json",
				dependsOn: ["shared"],
			});

			const plan = buildInstallPlan(["a", "b"], { a, b, shared }, {});

			expect(plan.map((node) => node.itemId)).toEqual(["shared", "a", "b"]);
		});

		it("throws when the same item selects conflicting packs across selections", () => {
			const shared = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/shared/typescript.json",
						when: { language: "typescript" },
					}),
					makePack({
						id: "python",
						title: "Python",
						source: "r/shared/python.json",
						when: { language: "python" },
					}),
				],
			});
			const a = makeItem({
				source: "r/a.json",
				dependsOn: ["shared@typescript"],
			});
			const b = makeItem({
				source: "r/b.json",
				dependsOn: ["shared@python"],
			});

			expect(() => buildInstallPlan(["a", "b"], { a, b, shared }, {})).toThrow(
				"conflicting packs",
			);
		});

		it("allows revisiting a shared dependency with the same pinned pack", () => {
			const shared = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/shared/typescript.json",
						when: { language: "typescript" },
					}),
					makePack({
						id: "python",
						title: "Python",
						source: "r/shared/python.json",
						when: { language: "python" },
					}),
				],
			});
			const a = makeItem({
				source: "r/a.json",
				dependsOn: ["shared@typescript"],
			});
			const b = makeItem({
				source: "r/b.json",
				dependsOn: ["shared@typescript"],
			});

			const plan = buildInstallPlan(["a", "b"], { a, b, shared }, {});

			expect(plan.map((node) => node.itemId)).toEqual(["shared", "a", "b"]);
			expect(plan[0]).toMatchObject({
				itemId: "shared",
				packIds: ["typescript"],
			});
		});

		it("treats phase lists as this item's scripts, not other registry items", () => {
			expect(
				selectRegistryPacks(
					"template",
					makeItem({
						prepare: ["r/template.prepare.0.js"],
						finalize: ["r/template.finalize.0.js"],
					}),
					{},
				),
			).toEqual({
				prepareScripts: ["r/template.prepare.0.js"],
				finalizeScripts: ["r/template.finalize.0.js"],
			});
		});

		it("orders dependsOn before the consumer and ignores phase item-like names", () => {
			const license = makeItem({ source: "r/license.json" });
			const gitInit = makeItem({
				finalize: ["r/git-init.finalize.0.js"],
			});
			const template = makeItem({
				source: "r/template.json",
				prepare: ["r/template.prepare.0.js"],
				dependsOn: ["license", "git-init"],
			});

			const plan = buildInstallPlan(
				["template"],
				{ template, license, "git-init": gitInit },
				{},
			);

			expect(plan.map((node) => node.itemId)).toEqual([
				"license",
				"git-init",
				"template",
			]);
			expect(plan[2]).toMatchObject({
				itemId: "template",
				prepareScripts: ["r/template.prepare.0.js"],
			});
		});

		it("places a shared dependsOn once before every consumer", () => {
			const gitInit = makeItem({
				finalize: ["r/git-init.finalize.0.js"],
			});
			const left = makeItem({
				source: "r/left.json",
				dependsOn: ["git-init"],
			});
			const right = makeItem({
				source: "r/right.json",
				dependsOn: ["git-init"],
			});

			const plan = buildInstallPlan(
				["left", "right"],
				{ left, right, "git-init": gitInit },
				{},
			);

			expect(plan.map((node) => node.itemId)).toEqual([
				"git-init",
				"left",
				"right",
			]);
		});

		it("allows an unpinned revisit of an already-planned item", () => {
			const shared = makeItem({ source: "r/shared.json" });
			const a = makeItem({
				source: "r/a.json",
				dependsOn: ["shared"],
			});
			const b = makeItem({
				source: "r/b.json",
				dependsOn: ["shared", "a"],
			});

			const plan = buildInstallPlan(["b"], { a, b, shared }, {});
			expect(plan.map((node) => node.itemId)).toEqual(["shared", "a", "b"]);
		});
	});

	describe("collectRegistryDependencies", () => {
		it("walks dependsOn and ignores install-phase scripts", () => {
			const gitInit = makeItem({
				finalize: ["r/git-init.finalize.0.js"],
			});
			const template = makeItem({
				source: "r/template.json",
				dependsOn: ["git-init"],
				finalize: ["r/template.finalize.0.js"],
			});

			const dependencies = collectRegistryDependencies(["template"], {
				template,
				"git-init": gitInit,
			});

			expect(dependencies.map((entry) => entry.itemId)).toEqual([
				"template",
				"git-init",
			]);
		});

		it("includes selected items and walks dependsOn from all packs", () => {
			const setup = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/setup/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});
			const testing = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/testing/typescript.json",
						when: { language: "typescript" },
						dependsOn: ["setup-workspace"],
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
				dependsOn: ["shared", "shared@default"],
			});
			const right = makeItem({
				source: "r/right.json",
				dependsOn: ["shared"],
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
		it("returns missing keys with intersected prompt values", () => {
			const item = makeItem({
				packs: [
					makePack({
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
						kind: RegistryConditionKind.SELECT,
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
				packs: [
					makePack({
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
						kind: RegistryConditionKind.SELECT,
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
			expect(Object.hasOwn(required, "description")).toBe(false);
			expect(Object.hasOwn(required, "handler")).toBe(false);
		});

		it("includes default and optional flags when declared", () => {
			const item = makeItem({
				source: "r/item.json",
				requires: ["authorName"],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						authorName: {
							kind: RegistryConditionKind.TEXT,
							label: "Author",
							default: "Ada",
							optional: true,
						},
					},
					{},
				),
			).toEqual([
				{
					key: "authorName",
					label: "Author",
					kind: "text",
					values: [],
					default: "Ada",
					optional: true,
				},
			]);
		});

		it("sorts required conditions by key", () => {
			const item = makeItem({
				requires: ["zebra", "alpha"],
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

		it("includes text conditions listed in item requires", () => {
			const item = makeItem({
				source: "r/item.json",
				requires: ["authorName"],
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
				packs: [
					makePack({
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
							kind: RegistryConditionKind.SELECT,
							label: "Language",
							values: [{ value: "typescript", label: "TypeScript" }],
						},
					},
					{ language: "typescript" },
				),
			).toEqual([]);
		});

		it("skips conditions whose own when is not satisfied", () => {
			const item = makeItem({
				source: "r/item.json",
				requires: ["coverage"],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						coverage: {
							kind: RegistryConditionKind.TEXT,
							label: "Coverage",
							when: { enableCi: true },
						},
					},
					{},
				),
			).toEqual([]);
		});

		it("returns full select values when a key comes only from requires", () => {
			const item = makeItem({
				source: "r/item.json",
				requires: ["language"],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						language: {
							kind: RegistryConditionKind.SELECT,
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

		it("includes boolean and multiselect conditions listed in item requires", () => {
			const item = makeItem({
				source: "r/item.json",
				requires: ["enableCi", "platforms"],
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

		it("collects distinct when values from string and array matchers", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "ios",
						title: "iOS",
						source: "r/item/ios.json",
						when: { platforms: "ios" },
					}),
					makePack({
						id: "mobile",
						title: "Mobile",
						source: "r/item/mobile.json",
						when: { platforms: ["android", "ios"] },
					}),
				],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						platforms: {
							kind: RegistryConditionKind.MULTISELECT,
							label: "Platforms",
							values: [
								{ value: "ios", label: "iOS" },
								{ value: "android", label: "Android" },
								{ value: "web", label: "Web" },
							],
						},
					},
					{},
				),
			).toEqual([
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

		it("ignores boolean when values when intersecting select options", () => {
			const item = makeItem({
				source: "r/item.json",
				requires: ["language"],
				packs: [
					makePack({
						id: "ci",
						title: "CI",
						source: "r/item/ci.json",
						when: { enableCi: true },
					}),
				],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						language: {
							kind: RegistryConditionKind.SELECT,
							label: "Language",
							values: [
								{ value: "typescript", label: "TypeScript" },
								{ value: "python", label: "Python" },
							],
						},
						enableCi: {
							kind: RegistryConditionKind.BOOLEAN,
							label: "Enable CI",
						},
					},
					{},
				),
			).toEqual([
				{
					key: "enableCi",
					label: "Enable CI",
					kind: "boolean",
					values: [],
				},
				{
					key: "language",
					label: "Language",
					kind: "select",
					values: [
						{ value: "typescript", label: "TypeScript" },
						{ value: "python", label: "Python" },
					],
				},
			]);
		});

		it("walks packs that omit when without recording present values", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
					makePack({
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
							kind: RegistryConditionKind.SELECT,
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
					kind: "select",
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			]);
		});

		it("rejects undeclared condition keys", () => {
			const item = makeItem({
				packs: [
					makePack({
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
				packs: [
					makePack({
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
							kind: RegistryConditionKind.SELECT,
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
				requires: ["language"],
			});

			expect(() =>
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						language: {
							kind: RegistryConditionKind.SELECT,
							label: "Language",
						},
					},
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
			expect(
				whenMatchesContext({ language: "typescript" }, { language: "python" }),
			).toBe(false);
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

		it("matches when both the matcher and captured value are arrays", () => {
			expect(
				whenMatchesContext(
					{ platforms: ["web", "ios"] },
					{ platforms: ["ios", "android"] },
				),
			).toBe(true);
			expect(
				whenMatchesContext({ platforms: ["web"] }, { platforms: ["ios"] }),
			).toBe(false);
		});

		it("matches a string context value against an array matcher", () => {
			expect(
				whenMatchesContext({ platforms: ["ios", "web"] }, { platforms: "ios" }),
			).toBe(true);
			expect(
				whenMatchesContext({ platforms: ["web"] }, { platforms: "ios" }),
			).toBe(false);
		});

		it("matches boolean when against boolean context values", () => {
			expect(whenMatchesContext({ enableCi: true }, { enableCi: true })).toBe(
				true,
			);
			expect(whenMatchesContext({ enableCi: false }, { enableCi: true })).toBe(
				false,
			);
		});

		it("does not match a boolean context against a non-boolean matcher", () => {
			expect(whenMatchesContext({ enableCi: "true" }, { enableCi: true })).toBe(
				false,
			);
		});

		it("matches when.packageManager against the runtime manager", () => {
			expect(
				whenMatchesContext(
					{ packageManager: "pnpm" },
					{},
					NpmPackageManager.PNPM,
				),
			).toBe(true);
			expect(
				whenMatchesContext(
					{ packageManager: ["npm", "yarn"] },
					{},
					NpmPackageManager.NPM,
				),
			).toBe(true);
			expect(
				whenMatchesContext(
					{ packageManager: "pnpm" },
					{},
					NpmPackageManager.NPM,
				),
			).toBe(false);
			expect(whenMatchesContext({ packageManager: "pnpm" }, {})).toBe(false);
		});
	});

	describe("assumeContextFromSelectedItems", () => {
		it("seeds from a pinned pack when map", () => {
			const item = makeItem({
				packs: [
					makePack({
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
							kind: RegistryConditionKind.SELECT,
							label: "Language",
							values: [{ value: "typescript", label: "TypeScript" }],
						},
					},
				),
			).toEqual({ language: "typescript" });
		});

		it("does not seed context without a pinned pack", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
						when: { language: "typescript" },
					}),
				],
			});

			expect(assumeContextFromSelectedItems(["item"], { item })).toEqual({});
		});

		it("skips a pinned pack that has no when map", () => {
			const item = makeItem({
				packs: [
					makePack({
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

		it("skips a pinned pack id that is not on the item", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "default",
						title: "Default",
						source: "r/item/default.json",
					}),
				],
			});

			expect(
				assumeContextFromSelectedItems(["item@missing"], { item }),
			).toEqual({});
		});

		it("rejects a pinned item missing from the catalog", () => {
			expect(() =>
				assumeContextFromSelectedItems(["missing@typescript"], {}),
			).toThrow('Registry item not found: "missing".');
		});

		it("rejects undeclared condition keys on a pinned pack", () => {
			const item = makeItem({
				packs: [
					makePack({
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
				'Pinned pack "item@typescript" references undeclared condition "language".',
			);
		});

		it("coerces boolean and multiselect when values when conditions are provided", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "mobile",
						title: "Mobile",
						source: "r/mobile.json",
						when: { enableCi: true, platforms: "ios" },
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

	describe("collectItemLocalConditions", () => {
		it("returns missing item-level conditions sorted by key", () => {
			const item = makeItem({
				conditions: {
					coverageThreshold: {
						kind: RegistryConditionKind.TEXT,
						label: "Coverage",
						optional: true,
					},
					qualityTools: {
						kind: RegistryConditionKind.MULTISELECT,
						label: "Tools",
						values: [
							{ value: "biome", label: "Biome" },
							{ value: "sonar", label: "Sonar" },
						],
					},
				},
			});

			expect(
				collectItemLocalConditions([{ itemId: "item", item }], {}),
			).toEqual([
				{
					key: "coverageThreshold",
					label: "Coverage",
					kind: RegistryConditionKind.TEXT,
					values: [],
					optional: true,
				},
				{
					key: "qualityTools",
					label: "Tools",
					kind: RegistryConditionKind.MULTISELECT,
					values: [
						{ value: "biome", label: "Biome" },
						{ value: "sonar", label: "Sonar" },
					],
				},
			]);
		});

		it("skips keys already present in context", () => {
			const item = makeItem({
				conditions: {
					coverageThreshold: {
						kind: RegistryConditionKind.TEXT,
						label: "Coverage",
					},
				},
			});

			expect(
				collectItemLocalConditions([{ itemId: "item", item }], {
					coverageThreshold: "45",
				}),
			).toEqual([]);
		});

		it("skips local conditions whose when is not satisfied", () => {
			const item = makeItem({
				conditions: {
					coverageThreshold: {
						kind: RegistryConditionKind.TEXT,
						label: "Coverage",
						when: { enableCi: true },
					},
				},
			});

			expect(
				collectItemLocalConditions([{ itemId: "item", item }], {}),
			).toEqual([]);
		});

		it("skips items without local conditions", () => {
			expect(
				collectItemLocalConditions(
					[{ itemId: "item", item: makeItem({ source: "r/item.json" }) }],
					{},
				),
			).toEqual([]);
		});

		it("rejects a local select condition with no values", () => {
			const item = makeItem({
				conditions: {
					language: {
						kind: RegistryConditionKind.SELECT,
						label: "Language",
					},
				},
			});

			expect(() =>
				collectItemLocalConditions([{ itemId: "item", item }], {}),
			).toThrow('Item-level condition "language" has no selectable values.');
		});
	});
});
