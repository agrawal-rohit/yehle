import { describe, expect, it } from "vitest";
import { RegistryConditionKind } from "./condition-kind";
import { NpmPackageManager } from "./packages";
import {
	assumeContextFromSelectedItems,
	buildInstallPlan,
	catalogNeedsPackageManager,
	collectItemLocalConditions,
	collectRegistryDependencies,
	collectRequiredConditions,
	collectRequiredConditionWave,
	packageManagerDropsCandidateDependsOn,
	packWhenUsesCapturedKeys,
	parseItemId,
	selectRegistryPacks,
	uniqueKnownRegistryItems,
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
			expect(() => parseItemId("git-hooks@typescript@mobile")).toThrow(
				"Invalid registry item id",
			);
		});

		it("rejects prototype-polluting and path-escaping tokens", () => {
			expect(() => parseItemId("__proto__")).toThrow(
				'Registry item id "__proto__" is not allowed.',
			);
			expect(() => parseItemId("item@__proto__")).toThrow(
				'Registry pack id "__proto__" is not allowed.',
			);
			expect(() => parseItemId("../escape")).toThrow(
				String.raw`Registry item id "../escape" must be a single path segment (no "/", "\", or "..").`,
			);
			expect(() => parseItemId("item@../pack")).toThrow(
				String.raw`Registry pack id "../pack" must be a single path segment (no "/", "\", or "..").`,
			);
		});
	});

	describe("uniqueKnownRegistryItems", () => {
		it("returns unique tokens in original order", () => {
			const items = {
				alpha: makeItem({ source: "r/alpha.json" }),
				beta: makeItem({ source: "r/beta.json" }),
			};
			expect(
				uniqueKnownRegistryItems(["beta", "alpha", "beta", "alpha"], items),
			).toEqual(["beta", "alpha"]);
		});

		it("accepts a declared pack pin", () => {
			const items = {
				release: makeItem({
					source: "r/release.json",
					packs: [
						makePack({
							id: "typescript",
							title: "TypeScript",
							source: "r/release.typescript.json",
						}),
					],
				}),
			};
			expect(uniqueKnownRegistryItems(["release@typescript"], items)).toEqual([
				"release@typescript",
			]);
		});

		it("rejects a missing item id", () => {
			expect(() => uniqueKnownRegistryItems(["missing"], {})).toThrow(
				'Registry item not found: "missing"',
			);
		});

		it("does not treat Object.prototype names as catalog items", () => {
			expect(() => uniqueKnownRegistryItems(["toString"], {})).toThrow(
				'Registry item not found: "toString"',
			);
			expect(() =>
				uniqueKnownRegistryItems(["constructor"], {
					item: makeItem({ source: "r/item.json" }),
				}),
			).toThrow('Registry item not found: "constructor"');
		});

		it("rejects pinning a pack on a pack-less item", () => {
			expect(() =>
				uniqueKnownRegistryItems(["item@react"], {
					item: makeItem({ source: "r/item.json" }),
				}),
			).toThrow('Registry item "item" has no packs.');
		});

		it("rejects a missing pinned pack id", () => {
			expect(() =>
				uniqueKnownRegistryItems(["item@missing"], {
					item: makeItem({
						packs: [
							makePack({
								id: "default",
								title: "Default",
								source: "r/item/default.json",
							}),
						],
					}),
				}),
			).toThrow('Registry item "item" has no pack "missing".');
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
						beforeWrite: ["r/item.beforeWrite.0.js"],
					}),
					{},
				),
			).toEqual({
				sources: ["r/item.json"],
				beforeWriteScripts: ["r/item.beforeWrite.0.js"],
			});
		});

		it("returns install scripts only when a pack-less item has no compiled item source", () => {
			expect(
				selectRegistryPacks(
					"item",
					makeItem({ beforeWrite: ["r/item.beforeWrite.0.js"] }),
					{},
				),
			).toEqual({ beforeWriteScripts: ["r/item.beforeWrite.0.js"] });
		});

		it("includes item-level install scripts on matching packs", () => {
			const item = makeItem({
				beforeWrite: ["r/item.beforeWrite.0.js"],
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
				beforeWriteScripts: ["r/item.beforeWrite.0.js"],
			});
		});

		it("stacks item-level and selected-pack install scripts", () => {
			const item = makeItem({
				beforeWrite: ["r/item.beforeWrite.0.js"],
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						beforeWrite: ["r/item/typescript.beforeWrite.0.js"],
					}),
				],
			});

			expect(selectRegistryPacks("item", item, {})).toEqual({
				packIds: ["typescript"],
				sources: ["r/item/typescript.json"],
				beforeWriteScripts: [
					"r/item.beforeWrite.0.js",
					"r/item/typescript.beforeWrite.0.js",
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

		it("throws when no pack matches and the item has no base source", () => {
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
			expect(() => selectRegistryPacks("item", item, {})).toThrow(
				'Registry item "item" has packs but none match the current install context.',
			);
		});

		it("keeps the base source when no pack matches", () => {
			const item = makeItem({
				source: "r/item.json",
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
				sources: ["r/item.json"],
			});
		});

		it("keeps item-level install scripts when no pack matches", () => {
			const item = makeItem({
				beforeWrite: ["r/item.beforeWrite.0.js"],
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
				beforeWriteScripts: ["r/item.beforeWrite.0.js"],
			});
		});

		it("throws when two matching packs share the same when", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "strict",
						title: "Strict",
						source: "r/item/strict.json",
						when: { language: "typescript" },
					}),
					makePack({
						id: "loose",
						title: "Loose",
						source: "r/item/loose.json",
						when: { language: "typescript" },
					}),
				],
			});
			expect(() =>
				selectRegistryPacks("item", item, { language: "typescript" }),
			).toThrow(
				'Registry item "item" selected indistinguishable packs "strict", "loose" (same when).',
			);
		});

		it("treats multiselect when values as unordered", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "mobile",
						title: "Mobile",
						source: "r/item/mobile.json",
						when: { platforms: ["ios", "android"] },
					}),
					makePack({
						id: "mobile-alt",
						title: "Mobile alternative",
						source: "r/item/mobile-alt.json",
						when: { platforms: ["android", "ios"] },
					}),
				],
			});

			expect(() =>
				selectRegistryPacks("item", item, {
					platforms: ["android", "ios"],
				}),
			).toThrow(
				'Registry item "item" selected indistinguishable packs "mobile", "mobile-alt" (same when).',
			);
		});

		it("throws when two unconditional packs both match", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "css",
						title: "CSS",
						source: "r/item/css.json",
					}),
					makePack({
						id: "js",
						title: "JS",
						source: "r/item/js.json",
					}),
				],
			});
			expect(() => selectRegistryPacks("item", item, {})).toThrow(
				'Registry item "item" selected indistinguishable packs "css", "js" (same when).',
			);
		});

		it("layers packs whose when matchers are distinct", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/item/typescript.json",
						when: { language: "typescript" },
					}),
					makePack({
						id: "typescript-pnpm",
						title: "TypeScript pnpm",
						source: "r/item/typescript-pnpm.json",
						when: { language: "typescript", packageManager: "pnpm" },
					}),
				],
			});
			expect(
				selectRegistryPacks(
					"item",
					item,
					{ language: "typescript" },
					undefined,
					NpmPackageManager.PNPM,
				),
			).toEqual({
				packIds: ["typescript", "typescript-pnpm"],
				sources: ["r/item/typescript.json", "r/item/typescript-pnpm.json"],
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

		it("does not treat Object.prototype names as catalog items", () => {
			expect(() =>
				buildInstallPlan(
					["toString"],
					{
						item: makeItem({ source: "r/item.json" }),
					},
					{},
				),
			).toThrow('Registry item not found: "toString"');
		});

		it("includes script-only items without a compiled item source", () => {
			const license = makeItem({
				beforeWrite: ["r/license.beforeWrite.0.js"],
			});
			expect(buildInstallPlan(["license"], { license }, {})).toEqual([
				{
					itemId: "license",
					beforeWriteScripts: ["r/license.beforeWrite.0.js"],
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

		it("throws when a packed item has no matching pack and no base source", () => {
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
			expect(() => buildInstallPlan(["item"], { item }, {})).toThrow(
				'Registry item "item" has packs but none match the current install context.',
			);
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
						beforeWrite: ["r/template.beforeWrite.0.js"],
						afterInstall: ["r/template.afterInstall.0.js"],
					}),
					{},
				),
			).toEqual({
				beforeWriteScripts: ["r/template.beforeWrite.0.js"],
				afterInstallScripts: ["r/template.afterInstall.0.js"],
			});
		});

		it("orders dependsOn before the consumer and ignores phase item-like names", () => {
			const license = makeItem({ source: "r/license.json" });
			const gitInit = makeItem({
				afterInstall: ["r/git-init.afterInstall.0.js"],
			});
			const template = makeItem({
				source: "r/template.json",
				beforeWrite: ["r/template.beforeWrite.0.js"],
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
				beforeWriteScripts: ["r/template.beforeWrite.0.js"],
			});
		});

		it("places a shared dependsOn once before every consumer", () => {
			const gitInit = makeItem({
				afterInstall: ["r/git-init.afterInstall.0.js"],
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
				afterInstall: ["r/git-init.afterInstall.0.js"],
			});
			const template = makeItem({
				source: "r/template.json",
				dependsOn: ["git-init"],
				afterInstall: ["r/template.afterInstall.0.js"],
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

		it("detects dependency cycles", () => {
			const a = makeItem({ dependsOn: ["b"] });
			const b = makeItem({ dependsOn: ["a"] });

			expect(() => collectRegistryDependencies(["a"], { a, b })).toThrow(
				'Registry dependency cycle detected at "a".',
			);
		});

		it("skips dependsOn from packs ruled out by known context", () => {
			const typescriptSetup = makeItem({ source: "r/typescript-setup.json" });
			const pythonSetup = makeItem({ source: "r/python-setup.json" });
			const testing = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/testing/typescript.json",
						when: { language: "typescript" },
						dependsOn: ["typescript-setup"],
					}),
					makePack({
						id: "python",
						title: "Python",
						source: "r/testing/python.json",
						when: { language: "python" },
						dependsOn: ["python-setup"],
					}),
				],
			});

			const dependencies = collectRegistryDependencies(
				["testing-configuration"],
				{
					"testing-configuration": testing,
					"typescript-setup": typescriptSetup,
					"python-setup": pythonSetup,
				},
				{ language: "typescript" },
			);

			expect(dependencies.map((entry) => entry.itemId)).toEqual([
				"testing-configuration",
				"typescript-setup",
			]);
		});

		it("includes undecided pack dependsOn when context is empty", () => {
			const setup = makeItem({ source: "r/setup.json" });
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
	});

	describe("catalogNeedsPackageManager", () => {
		it("is true when a pack when mentions packageManager", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "pnpm",
						title: "pnpm",
						source: "r/item/pnpm.json",
						when: { packageManager: "pnpm" },
					}),
				],
			});
			expect(catalogNeedsPackageManager([{ itemId: "item", item }])).toBe(true);
		});

		it("is true when a shared condition when mentions packageManager", () => {
			expect(
				catalogNeedsPackageManager([], {
					lockfile: {
						kind: RegistryConditionKind.BOOLEAN,
						label: "Lockfile",
						when: { packageManager: "pnpm" },
					},
				}),
			).toBe(true);
		});

		it("is false when no when clause mentions packageManager", () => {
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
				catalogNeedsPackageManager([{ itemId: "item", item }], {
					language: {
						kind: RegistryConditionKind.SELECT,
						label: "Language",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				}),
			).toBe(false);
		});

		it("is true when an item-local condition when mentions packageManager", () => {
			const item = makeItem({
				conditions: {
					lockfile: {
						kind: RegistryConditionKind.BOOLEAN,
						label: "Lockfile",
						when: { packageManager: "pnpm" },
					},
				},
			});
			expect(catalogNeedsPackageManager([{ itemId: "item", item }])).toBe(true);
		});
	});

	describe("packageManagerDropsCandidateDependsOn", () => {
		it("is false when matching packs have no dependsOn", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "pnpm",
						title: "pnpm",
						source: "r/item/pnpm.json",
						when: { packageManager: "pnpm" },
					}),
					makePack({
						id: "npm",
						title: "npm",
						source: "r/item/npm.json",
						when: { packageManager: ["npm", "yarn", "bun"] },
					}),
				],
			});
			expect(
				packageManagerDropsCandidateDependsOn(
					[{ itemId: "item", item }],
					["item"],
					{},
					NpmPackageManager.PNPM,
				),
			).toBe(false);
		});

		it("is false when candidate items omit packs", () => {
			expect(
				packageManagerDropsCandidateDependsOn(
					[{ itemId: "item", item: makeItem({ packs: undefined }) }],
					["item"],
					{},
					NpmPackageManager.PNPM,
				),
			).toBe(false);
		});

		it("is true when a still-possible pack with dependsOn would be ruled out", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "npm",
						title: "npm",
						source: "r/item/npm.json",
						when: { packageManager: "npm" },
						dependsOn: ["eslint-npm"],
					}),
				],
			});
			expect(
				packageManagerDropsCandidateDependsOn(
					[{ itemId: "item", item }],
					["item"],
					{},
					NpmPackageManager.PNPM,
				),
			).toBe(true);
		});

		it("is false when the selected manager still matches the pack with dependsOn", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "pnpm",
						title: "pnpm",
						source: "r/item/pnpm.json",
						when: { packageManager: "pnpm" },
						dependsOn: ["eslint-pnpm"],
					}),
				],
			});
			expect(
				packageManagerDropsCandidateDependsOn(
					[{ itemId: "item", item }],
					["item"],
					{},
					NpmPackageManager.PNPM,
				),
			).toBe(false);
		});

		it("is false when the pack with dependsOn is already ruled out", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "python-npm",
						title: "Python npm",
						source: "r/item/python-npm.json",
						when: { language: "python", packageManager: "npm" },
						dependsOn: ["eslint-npm"],
					}),
				],
			});
			expect(
				packageManagerDropsCandidateDependsOn(
					[{ itemId: "item", item }],
					["item"],
					{ language: "typescript" },
					NpmPackageManager.PNPM,
				),
			).toBe(false);
		});

		it("is false when a pin keeps the pack even if the manager would not match", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "npm",
						title: "npm",
						source: "r/item/npm.json",
						when: { packageManager: "npm" },
						dependsOn: ["eslint-npm"],
					}),
				],
			});
			expect(
				packageManagerDropsCandidateDependsOn(
					[{ itemId: "item", item }],
					["item@npm"],
					{},
					NpmPackageManager.PNPM,
				),
			).toBe(false);
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

		it("does not treat Object.prototype names as declared conditions", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "yes",
						title: "Yes",
						source: "r/item/yes.json",
						when: { toString: "yes" },
					}),
				],
			});

			expect(() =>
				collectRequiredConditions([{ itemId: "item", item }], {}, {}),
			).toThrow('Install plan references undeclared condition "toString".');
		});

		it("prompts for a declared condition whose key is an Object.prototype name", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "yes",
						title: "Yes",
						source: "r/item/yes.json",
						when: { toString: "yes" },
					}),
				],
			});

			expect(
				collectRequiredConditions(
					[{ itemId: "item", item }],
					{
						toString: {
							kind: RegistryConditionKind.SELECT,
							label: "To string",
							values: [{ value: "yes", label: "Yes" }],
						},
					},
					{},
				).map((entry) => entry.key),
			).toEqual(["toString"]);
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

		it("omits when keys from packs ruled out by the selected package manager", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "pnpm",
						title: "pnpm",
						source: "r/item/pnpm.json",
						when: { packageManager: "pnpm", language: "typescript" },
					}),
					makePack({
						id: "python-npm",
						title: "Python npm",
						source: "r/item/python.json",
						when: {
							packageManager: "npm",
							language: "python",
							framework: "django",
						},
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
						framework: {
							kind: RegistryConditionKind.SELECT,
							label: "Framework",
							values: [
								{ value: "django", label: "Django" },
								{ value: "next", label: "Next" },
							],
						},
					},
					{},
					NpmPackageManager.PNPM,
				).map((entry) => entry.key),
			).toEqual(["language"]);
		});
	});

	describe("collectRequiredConditionWave", () => {
		it("asks item requires before pack-when keys", () => {
			const item = makeItem({
				requires: ["defaultBranch"],
				packs: [
					makePack({
						id: "next",
						title: "Next",
						source: "r/item/next.json",
						when: { language: "typescript", framework: "next" },
					}),
					makePack({
						id: "django",
						title: "Django",
						source: "r/item/django.json",
						when: { language: "python", framework: "django" },
					}),
				],
			});
			const conditions = {
				defaultBranch: {
					kind: RegistryConditionKind.TEXT,
					label: "Default branch",
				},
				language: {
					kind: RegistryConditionKind.SELECT,
					label: "Language",
					values: [
						{ value: "typescript", label: "TypeScript" },
						{ value: "python", label: "Python" },
					],
				},
				framework: {
					kind: RegistryConditionKind.SELECT,
					label: "Framework",
					values: [
						{ value: "next", label: "Next" },
						{ value: "django", label: "Django" },
					],
				},
			};

			expect(
				collectRequiredConditionWave(
					[{ itemId: "item", item }],
					conditions,
					{},
				).map((entry) => entry.key),
			).toEqual(["defaultBranch"]);

			expect(
				collectRequiredConditionWave(
					[
						{
							itemId: "pack-only",
							item: makeItem({
								packs: [
									makePack({
										id: "next",
										title: "Next",
										source: "r/item/next.json",
										when: { language: "typescript" },
									}),
								],
							}),
						},
					],
					conditions,
					{},
				).map((entry) => entry.key),
			).toEqual(["language"]);

			expect(
				collectRequiredConditionWave([{ itemId: "item", item }], conditions, {
					defaultBranch: "main",
				}).map((entry) => entry.key),
			).toEqual(["framework"]);

			expect(
				collectRequiredConditionWave([{ itemId: "item", item }], conditions, {
					defaultBranch: "main",
					framework: "next",
				}).map((entry) => ({
					key: entry.key,
					values: entry.values.map((value) => value.value),
				})),
			).toEqual([{ key: "language", values: ["typescript"] }]);
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

	describe("whenMatchesContext with allowUndecided", () => {
		it("treats unknown keys as still possible", () => {
			expect(
				whenMatchesContext({ language: "typescript" }, {}, undefined, {
					allowUndecided: true,
				}),
			).toBe(true);
			expect(
				whenMatchesContext(
					{ language: "typescript" },
					{ language: "python" },
					undefined,
					{ allowUndecided: true },
				),
			).toBe(false);
			expect(
				whenMatchesContext(
					{ language: "typescript" },
					{ language: "typescript" },
					undefined,
					{ allowUndecided: true },
				),
			).toBe(true);
		});

		it("rules out packs when the selected manager does not match", () => {
			expect(
				whenMatchesContext(
					{ packageManager: "npm" },
					{},
					NpmPackageManager.PNPM,
					{ allowUndecided: true },
				),
			).toBe(false);
			expect(
				whenMatchesContext(
					{ packageManager: "pnpm" },
					{},
					NpmPackageManager.PNPM,
					{ allowUndecided: true },
				),
			).toBe(true);
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

		it("skips packageManager keys when seeding pinned pack when maps", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "pnpm",
						title: "pnpm",
						source: "r/item/pnpm.json",
						when: { packageManager: "pnpm", language: "typescript" },
					}),
				],
			});

			expect(
				assumeContextFromSelectedItems(
					["item@pnpm"],
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

		it("rejects conflicting values from pinned packs", () => {
			const typescript = makeItem({
				packs: [
					makePack({
						id: "typescript",
						title: "TypeScript",
						source: "r/typescript.json",
						when: { language: "typescript" },
					}),
				],
			});
			const python = makeItem({
				packs: [
					makePack({
						id: "python",
						title: "Python",
						source: "r/python.json",
						when: { language: "python" },
					}),
				],
			});

			expect(() =>
				assumeContextFromSelectedItems(
					["typescript@typescript", "python@python"],
					{ typescript, python },
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
				),
			).toThrow(
				'Pinned pack "python@python" requires a conflicting value for condition "language".',
			);
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

		it("seeds from an item-local condition named in the pinned pack when", () => {
			const item = makeItem({
				conditions: {
					flavor: {
						kind: RegistryConditionKind.SELECT,
						label: "Flavor",
						values: [
							{ value: "basic", label: "Basic" },
							{ value: "advanced", label: "Advanced" },
						],
					},
				},
				packs: [
					makePack({
						id: "advanced",
						title: "Advanced",
						source: "r/item/advanced.json",
						when: { flavor: "advanced" },
					}),
				],
			});

			expect(
				assumeContextFromSelectedItems(["item@advanced"], { item }),
			).toEqual({ flavor: "advanced" });
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
			).toThrow(
				'Condition "language" has no selectable values for the current install set.',
			);
		});

		it("narrows local select options to values present on still-possible packs", () => {
			const item = makeItem({
				conditions: {
					flavor: {
						kind: RegistryConditionKind.SELECT,
						label: "Flavor",
						values: [
							{ value: "basic", label: "Basic" },
							{ value: "advanced", label: "Advanced" },
							{ value: "enterprise", label: "Enterprise" },
						],
					},
				},
				packs: [
					makePack({
						id: "basic",
						title: "Basic",
						source: "r/item/basic.json",
						when: { flavor: "basic" },
					}),
					makePack({
						id: "advanced",
						title: "Advanced",
						source: "r/item/advanced.json",
						when: { flavor: "advanced" },
					}),
				],
			});

			expect(
				collectItemLocalConditions([{ itemId: "item", item }], {}),
			).toEqual([
				{
					key: "flavor",
					label: "Flavor",
					kind: RegistryConditionKind.SELECT,
					values: [
						{ value: "basic", label: "Basic" },
						{ value: "advanced", label: "Advanced" },
					],
				},
			]);
		});

		it("keeps all local select values when no pack when uses the key", () => {
			const item = makeItem({
				source: "r/item.json",
				conditions: {
					flavor: {
						kind: RegistryConditionKind.SELECT,
						label: "Flavor",
						values: [
							{ value: "basic", label: "Basic" },
							{ value: "advanced", label: "Advanced" },
						],
					},
				},
			});

			expect(
				collectItemLocalConditions([{ itemId: "item", item }], {}),
			).toEqual([
				{
					key: "flavor",
					label: "Flavor",
					kind: RegistryConditionKind.SELECT,
					values: [
						{ value: "basic", label: "Basic" },
						{ value: "advanced", label: "Advanced" },
					],
				},
			]);
		});
	});

	describe("packWhenUsesCapturedKeys", () => {
		it("is true when a captured key appears in a planned pack when", () => {
			const item = makeItem({
				packs: [
					makePack({
						id: "advanced",
						title: "Advanced",
						source: "r/item/advanced.json",
						when: { flavor: "advanced" },
					}),
				],
			});
			expect(
				packWhenUsesCapturedKeys([{ itemId: "item", item }], ["flavor"]),
			).toBe(true);
		});

		it("is false when no captured keys are provided", () => {
			expect(
				packWhenUsesCapturedKeys([{ itemId: "item", item: makeItem() }], []),
			).toBe(false);
		});

		it("is false when planned items omit packs", () => {
			expect(
				packWhenUsesCapturedKeys(
					[{ itemId: "item", item: makeItem({ packs: undefined }) }],
					["flavor"],
				),
			).toBe(false);
		});

		it("is false for interpolation-only captured keys", () => {
			const item = makeItem({
				source: "r/item.json",
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
				packWhenUsesCapturedKeys(
					[{ itemId: "item", item }],
					["coverageThreshold"],
				),
			).toBe(false);
		});
	});
});
