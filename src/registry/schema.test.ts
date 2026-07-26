import { describe, expect, it } from "vitest";
import {
	collectConditionKeys,
	collectConditionValues,
	collectRequiredConditions,
	getRegistryItemTypes,
	parseRegistryDependencyRef,
	type Registry,
	type RegistryCondition,
	type RegistryIndex,
	type RegistryItem,
	RegistryItemType,
	type RegistryVariant,
	resolveRegistryPlan,
	selectRegistryVariant,
	variantMatchesContext,
} from "./schema";

function makeRegistry(items: Registry["items"] = {}): Registry {
	return {
		version: "0.0.0",
		contentBaseUrl: "https://example.com",
		items,
	};
}

function makeVariant(
	partial: Partial<RegistryVariant> & Pick<RegistryVariant, "id">,
): RegistryVariant {
	return {
		title: partial.title ?? partial.id,
		description: partial.description ?? partial.id,
		files: partial.files ?? [{ source: "a", target: "a" }],
		...partial,
	};
}

function makeItem(
	partial: Partial<RegistryItem> & Pick<RegistryItem, "id" | "variants">,
): RegistryItem {
	return {
		title: partial.title ?? partial.id,
		description: partial.description ?? partial.id,
		type: partial.type ?? RegistryItemType.CONVENTION,
		...partial,
	};
}

function makeIndex(items: RegistryItem[]): RegistryIndex {
	return new Map(items.map((item) => [item.id, item]));
}

describe("registry/schema", () => {
	describe("getRegistryItemTypes", () => {
		it("returns an empty array when the registry has no items", () => {
			expect(getRegistryItemTypes(makeRegistry())).toEqual([]);
		});

		it("returns unique types sorted alphabetically", () => {
			const registry = makeRegistry({
				"theme-a": {
					id: "theme-a",
					title: "Theme A",
					description: "A theme",
					type: RegistryItemType.THEME,
					variants: [],
				},
				"convention-a": {
					id: "convention-a",
					title: "Convention A",
					description: "A convention",
					type: RegistryItemType.CONVENTION,
					variants: [],
				},
				"theme-b": {
					id: "theme-b",
					title: "Theme B",
					description: "Another theme",
					type: RegistryItemType.THEME,
					variants: [],
				},
				"component-a": {
					id: "component-a",
					title: "Component A",
					description: "A component",
					type: RegistryItemType.COMPONENT,
					variants: [],
				},
			});

			expect(getRegistryItemTypes(registry)).toEqual([
				"component",
				"convention",
				"theme",
			]);
		});

		it("includes every RegistryItemType value when all are present", () => {
			const types = Object.values(RegistryItemType);
			const items = Object.fromEntries(
				types.map((type) => [
					type,
					{
						id: type,
						title: type,
						description: type,
						type,
						variants: [],
					},
				]),
			);

			expect(getRegistryItemTypes(makeRegistry(items))).toEqual(
				[...types].sort((a, b) => a.localeCompare(b)),
			);
		});
	});

	describe("variantMatchesContext", () => {
		it("matches when the variant has no when clause", () => {
			expect(variantMatchesContext(makeVariant({ id: "default" }), {})).toBe(
				true,
			);
		});

		it("matches when every when key equals the context value", () => {
			expect(
				variantMatchesContext(
					makeVariant({
						id: "ts",
						when: { language: "typescript" },
					}),
					{ language: "typescript" },
				),
			).toBe(true);
		});

		it("fails when a when key is missing from the context", () => {
			expect(
				variantMatchesContext(
					makeVariant({
						id: "ts",
						when: { language: "typescript" },
					}),
					{},
				),
			).toBe(false);
		});

		it("fails when a when key has a different context value", () => {
			expect(
				variantMatchesContext(
					makeVariant({
						id: "ts",
						when: { language: "typescript" },
					}),
					{ language: "python" },
				),
			).toBe(false);
		});

		it("ignores extra context keys not listed in when", () => {
			expect(
				variantMatchesContext(
					makeVariant({
						id: "ts",
						when: { language: "typescript" },
					}),
					{ language: "typescript", framework: "react" },
				),
			).toBe(true);
		});
	});

	describe("selectRegistryVariant", () => {
		it("throws when the item has no variants", () => {
			expect(() =>
				selectRegistryVariant(makeItem({ id: "empty", variants: [] }), {}),
			).toThrow('Registry item "empty" has no variants.');
		});

		it("returns a pinned variant regardless of when", () => {
			const item = makeItem({
				id: "hooks",
				variants: [
					makeVariant({
						id: "typescript",
						when: { language: "typescript" },
					}),
					makeVariant({ id: "default" }),
				],
			});

			expect(
				selectRegistryVariant(item, { language: "python" }, "typescript").id,
			).toBe("typescript");
		});

		it("throws when a pinned variant id is missing", () => {
			const item = makeItem({
				id: "hooks",
				variants: [makeVariant({ id: "default" })],
			});

			expect(() => selectRegistryVariant(item, {}, "missing")).toThrow(
				'Registry item "hooks" has no variant "missing".',
			);
		});

		it("prefers the most specific matching variant", () => {
			const item = makeItem({
				id: "hooks",
				variants: [
					makeVariant({ id: "default" }),
					makeVariant({
						id: "ts",
						when: { language: "typescript" },
					}),
					makeVariant({
						id: "ts-react",
						when: { language: "typescript", framework: "react" },
					}),
				],
			});

			expect(
				selectRegistryVariant(item, {
					language: "typescript",
					framework: "react",
				}).id,
			).toBe("ts-react");
		});

		it("falls back to an unconditional variant when nothing matches", () => {
			const item = makeItem({
				id: "hooks",
				variants: [
					makeVariant({
						id: "typescript",
						when: { language: "typescript" },
					}),
					makeVariant({ id: "base" }),
				],
			});

			expect(selectRegistryVariant(item, { language: "python" }).id).toBe(
				"base",
			);
		});

		it("throws when nothing matches and no unconditional fallback exists", () => {
			const item = makeItem({
				id: "hooks",
				variants: [
					makeVariant({
						id: "typescript",
						when: { language: "typescript" },
					}),
				],
			});

			expect(() => selectRegistryVariant(item, { language: "python" })).toThrow(
				'Registry item "hooks" has no variant matching the current context and no unconditional fallback.',
			);
		});
	});

	describe("collectConditionKeys", () => {
		it("returns sorted unique when keys across items", () => {
			const items = [
				makeItem({
					id: "a",
					variants: [
						makeVariant({
							id: "ts",
							when: { language: "typescript" },
						}),
					],
				}),
				makeItem({
					id: "b",
					variants: [
						makeVariant({
							id: "react",
							when: { framework: "react", language: "typescript" },
						}),
						makeVariant({ id: "default" }),
					],
				}),
			];

			expect(collectConditionKeys(items)).toEqual(["framework", "language"]);
		});

		it("returns an empty array when no variants declare when", () => {
			expect(
				collectConditionKeys([
					makeItem({
						id: "a",
						variants: [makeVariant({ id: "default" })],
					}),
				]),
			).toEqual([]);
		});
	});

	describe("collectConditionValues", () => {
		it("returns sorted unique values for a key", () => {
			const items = [
				makeItem({
					id: "a",
					variants: [
						makeVariant({
							id: "ts",
							when: { language: "typescript" },
						}),
						makeVariant({
							id: "py",
							when: { language: "python" },
						}),
					],
				}),
				makeItem({
					id: "b",
					variants: [
						makeVariant({
							id: "ts",
							when: { language: "typescript" },
						}),
					],
				}),
			];

			expect(collectConditionValues(items, "language")).toEqual([
				"python",
				"typescript",
			]);
		});

		it("returns an empty array when the key is unused", () => {
			expect(
				collectConditionValues(
					[
						makeItem({
							id: "a",
							variants: [makeVariant({ id: "default" })],
						}),
					],
					"language",
				),
			).toEqual([]);
		});
	});

	describe("parseRegistryDependencyRef", () => {
		it("parses a bare item id", () => {
			expect(parseRegistryDependencyRef("git-hooks")).toEqual({
				id: "git-hooks",
			});
		});

		it("parses an id@variant pin", () => {
			expect(parseRegistryDependencyRef("git-hooks@typescript")).toEqual({
				id: "git-hooks",
				variantId: "typescript",
			});
		});

		it("throws on an empty reference", () => {
			expect(() => parseRegistryDependencyRef("")).toThrow(
				"Registry dependency reference must be non-empty.",
			);
		});

		it("throws on a malformed reference", () => {
			expect(() => parseRegistryDependencyRef("@typescript")).toThrow(
				'Invalid registry dependency reference "@typescript"',
			);
			expect(() => parseRegistryDependencyRef("git-hooks@")).toThrow(
				'Invalid registry dependency reference "git-hooks@"',
			);
		});
	});

	describe("resolveRegistryPlan", () => {
		it("resolves a single item with merged shared and variant files", () => {
			const item = makeItem({
				id: "git-hooks",
				files: [{ source: "shared/commit-msg", target: ".husky/commit-msg" }],
				variants: [
					makeVariant({
						id: "typescript",
						when: { language: "typescript" },
						files: [
							{
								source: "typescript/lint-staged.config.js",
								target: "lint-staged.config.js",
							},
						],
						devDependencies: ["lint-staged"],
					}),
				],
			});

			const plan = resolveRegistryPlan("git-hooks", makeIndex([item]), {
				language: "typescript",
			});

			expect(plan.items).toHaveLength(1);
			expect(plan.items[0].variant.id).toBe("typescript");
			expect(plan.items[0].files).toEqual([
				{ source: "shared/commit-msg", target: ".husky/commit-msg" },
				{
					source: "typescript/lint-staged.config.js",
					target: "lint-staged.config.js",
				},
			]);
			expect(plan.devDependencies).toEqual(["lint-staged"]);
			expect(plan.dependencies).toEqual([]);
		});

		it("walks registryDependencies depth-first and dedupes by id", () => {
			const leaf = makeItem({
				id: "leaf",
				variants: [makeVariant({ id: "default" })],
			});
			const mid = makeItem({
				id: "mid",
				registryDependencies: ["leaf"],
				variants: [makeVariant({ id: "default" })],
			});
			const root = makeItem({
				id: "root",
				registryDependencies: ["mid", "leaf"],
				variants: [makeVariant({ id: "default" })],
			});

			const plan = resolveRegistryPlan(
				"root",
				makeIndex([root, mid, leaf]),
				{},
			);

			expect(plan.items.map((entry) => entry.item.id)).toEqual([
				"leaf",
				"mid",
				"root",
			]);
		});

		it("throws on a dependency cycle", () => {
			const a = makeItem({
				id: "a",
				registryDependencies: ["b"],
				variants: [makeVariant({ id: "default" })],
			});
			const b = makeItem({
				id: "b",
				registryDependencies: ["a"],
				variants: [makeVariant({ id: "default" })],
			});

			expect(() => resolveRegistryPlan("a", makeIndex([a, b]), {})).toThrow(
				'Registry dependency cycle detected at "a".',
			);
		});

		it("throws when a dependency is missing", () => {
			const root = makeItem({
				id: "root",
				registryDependencies: ["missing"],
				variants: [makeVariant({ id: "default" })],
			});

			expect(() => resolveRegistryPlan("root", makeIndex([root]), {})).toThrow(
				'Registry item not found: "missing".',
			);
		});

		it("honours a pinned variant on the root ref", () => {
			const item = makeItem({
				id: "hooks",
				variants: [
					makeVariant({
						id: "typescript",
						when: { language: "typescript" },
					}),
					makeVariant({ id: "default" }),
				],
			});

			const plan = resolveRegistryPlan("hooks@typescript", makeIndex([item]), {
				language: "python",
			});

			expect(plan.items[0].variant.id).toBe("typescript");
		});

		it("merges npm dependencies from selected variants", () => {
			const a = makeItem({
				id: "a",
				variants: [
					makeVariant({
						id: "default",
						dependencies: ["react"],
						devDependencies: ["vitest"],
					}),
				],
			});
			const b = makeItem({
				id: "b",
				registryDependencies: ["a"],
				variants: [
					makeVariant({
						id: "default",
						dependencies: ["react", "clsx"],
						devDependencies: ["@types/node"],
					}),
				],
			});

			const plan = resolveRegistryPlan("b", makeIndex([a, b]), {});

			expect(plan.dependencies).toEqual(["clsx", "react"]);
			expect(plan.devDependencies).toEqual(["@types/node", "vitest"]);
		});

		it("merges item-level and variant-level npm dependencies", () => {
			const item = makeItem({
				id: "hooks",
				dependencies: ["shared-runtime"],
				devDependencies: ["husky@^9"],
				variants: [
					makeVariant({
						id: "typescript",
						when: { language: "typescript" },
						devDependencies: ["lint-staged@^16"],
					}),
				],
			});

			const plan = resolveRegistryPlan("hooks", makeIndex([item]), {
				language: "typescript",
			});

			expect(plan.dependencies).toEqual(["shared-runtime"]);
			expect(plan.devDependencies).toEqual(["husky@^9", "lint-staged@^16"]);
		});
	});

	describe("collectRequiredConditions", () => {
		const languageCondition: RegistryCondition = {
			label: "Language",
			description: "Which language is this project?",
			values: [
				{ value: "typescript", label: "TypeScript" },
				{ value: "python", label: "Python" },
				{ value: "rust", label: "Rust" },
			],
		};

		it("returns unresolved conditions with declared ∩ present values", () => {
			const items = [
				makeItem({
					id: "git-hooks",
					variants: [
						makeVariant({
							id: "typescript",
							when: { language: "typescript" },
						}),
					],
				}),
				makeItem({
					id: "mutation-testing",
					variants: [
						makeVariant({
							id: "typescript",
							when: { language: "typescript" },
						}),
					],
				}),
			];

			const required = collectRequiredConditions(
				items,
				{ language: languageCondition },
				{},
			);

			expect(required).toEqual([
				{
					key: "language",
					label: "Language",
					description: "Which language is this project?",
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			]);
		});

		it("skips keys already present in the context", () => {
			const items = [
				makeItem({
					id: "git-hooks",
					variants: [
						makeVariant({
							id: "typescript",
							when: { language: "typescript" },
						}),
					],
				}),
			];

			expect(
				collectRequiredConditions(
					items,
					{ language: languageCondition },
					{ language: "typescript" },
				),
			).toEqual([]);
		});

		it("throws when a used key has no condition definition", () => {
			const items = [
				makeItem({
					id: "git-hooks",
					variants: [
						makeVariant({
							id: "typescript",
							when: { language: "typescript" },
						}),
					],
				}),
			];

			expect(() => collectRequiredConditions(items, {}, {})).toThrow(
				'Condition key "language" is used by registry items but is not defined in registry conditions.',
			);
		});

		it("accepts resolved plan items", () => {
			const item = makeItem({
				id: "git-hooks",
				variants: [
					makeVariant({
						id: "typescript",
						when: { language: "typescript" },
					}),
				],
			});
			const plan = resolveRegistryPlan("git-hooks", makeIndex([item]), {
				language: "typescript",
			});

			expect(
				collectRequiredConditions(
					plan.items,
					{ language: languageCondition },
					{ language: "typescript" },
				),
			).toEqual([]);
		});
	});
});
