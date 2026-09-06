import { describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import { conditionKindPolicy, RegistryConditionKind } from "./condition-kind";
import { reservedInterpolationKeys } from "./packages";
import {
	parseKeyedRecord,
	parseRegistryDocument,
	parseWithSchema,
} from "./parse";
import {
	assertConditionMapBindingKeys,
	compiledItemSchema,
	indexItemSchema,
	registryConditionSchema,
	registryItemSchema,
	registryItemTypeSchema,
} from "./schema";

/** Parse conditions the same way build/document parsing does. */
function parseRegistryConditions(raw: unknown) {
	const parsed = parseKeyedRecord(
		registryConditionSchema,
		raw,
		"Registry conditions",
		(key) => `Registry condition "${key}"`,
	);
	assertConditionMapBindingKeys([parsed], reservedInterpolationKeys());
	return parsed;
}

/** Parse types the same way build/document parsing does. */
function parseRegistryItemTypes(raw: unknown) {
	return parseKeyedRecord(
		registryItemTypeSchema,
		raw,
		"Registry types",
		(key) => `Registry type "${key}"`,
		{
			absent: "Registry types must be declared.",
			empty: "Registry types must declare at least one type.",
		},
		["all"],
	);
}

/** Minimal valid index item for parseRegistryDocument tests. */
function validIndexItem(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		title: "Button",
		description: "A button",
		type: "component",
		packs: [validIndexPack()],
		...overrides,
	};
}

/** Minimal valid index pack. */
function validIndexPack(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "react",
		title: "React",
		source: "r/button/react.json",
		...overrides,
	};
}

/** Minimal valid registry document for parseRegistryDocument tests. */
function validDocument(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		types: {
			component: { label: "Components" },
		},
		items: {
			button: validIndexItem(),
		},
		...overrides,
	};
}

describe("registry/parse", () => {
	it("parses a valid registry document", () => {
		const parsed = parseRegistryDocument(
			validDocument({
				conditions: {
					language: {
						kind: "select",
						label: "Language",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				},
				items: {
					button: validIndexItem({
						packs: [validIndexPack({ when: { language: "typescript" } })],
					}),
				},
			}),
		);

		expect(parsed.items.button.type).toBe("component");
		expect(parsed.types).toEqual({
			component: { label: "Components" },
		});
	});

	it("rejects items with neither source nor packs", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validIndexItem({ packs: [] }),
					},
				}),
			),
		).toThrow(
			'Registry items["button"] must declare source, an install script (beforeWrite/afterInstall), or at least one pack.',
		);
	});

	it("accepts an item that declares source together with packs", () => {
		expect(
			parseRegistryDocument(
				validDocument({
					items: {
						button: validIndexItem({ source: "r/button.json" }),
					},
				}),
			).items.button,
		).toEqual({
			title: "Button",
			description: "A button",
			type: "component",
			source: "r/button.json",
			packs: [
				{
					id: "react",
					title: "React",
					source: "r/button/react.json",
				},
			],
		});
	});

	it("accepts a pack-less item with a compiled item source", () => {
		expect(
			parseRegistryDocument(
				validDocument({
					items: {
						"assign-owner": validIndexItem({
							title: "Assign Owner",
							description: "Assigns the owner",
							packs: undefined,
							source: "r/assign-owner.json",
						}),
					},
				}),
			).items["assign-owner"],
		).toEqual({
			title: "Assign Owner",
			description: "Assigns the owner",
			type: "component",
			source: "r/assign-owner.json",
		});
	});

	it("omits item id from catalog entries", () => {
		expect(
			parseRegistryDocument(validDocument()).items.button,
		).not.toHaveProperty("id");
	});

	it("rejects a index item that declares id", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validIndexItem({ id: "button" }),
					},
				}),
			),
		).toThrow('Registry items["button"] has an unknown key: id.');
	});

	it("accepts unknown custom item types", () => {
		expect(
			parseWithSchema(
				registryItemSchema,
				{
					id: "legacy-item",
					title: "Legacy Item",
					description: "Legacy",
					type: "legacy",
					packs: [
						{
							id: "default",
							title: "Default",
							files: [{ source: "legacy.txt", target: "legacy.txt" }],
						},
					],
				},
				"Registry item",
			),
		).toMatchObject({
			id: "legacy-item",
			type: "legacy",
		});
	});

	it("parses index items with indexItemSchema", () => {
		expect(
			parseWithSchema(
				indexItemSchema,
				validIndexItem(),
				'Registry items["button"]',
			),
		).toEqual({
			title: "Button",
			description: "A button",
			type: "component",
			packs: [
				{
					id: "react",
					title: "React",
					source: "r/button/react.json",
				},
			],
		});
	});

	describe("unknown keys", () => {
		it("rejects an unknown top-level key", () => {
			expect(() =>
				parseRegistryDocument(validDocument({ version: "1.2.3" })),
			).toThrow("Registry has an unknown key: version.");
		});

		it("rejects an unknown item key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							button: validIndexItem({ typo: true }),
						},
					}),
				),
			).toThrow('Registry items["button"] has an unknown key: typo.');
		});

		it("rejects an unknown pack key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							button: validIndexItem({
								packs: [validIndexPack({ extra: "nope" })],
							}),
						},
					}),
				),
			).toThrow('Registry items["button"].packs[0] has an unknown key: extra.');
		});

		it("rejects an unknown condition key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							language: {
								kind: "select",
								label: "Language",
								unknownField: true,
								values: [{ value: "typescript", label: "TypeScript" }],
							},
						},
					}),
				),
			).toThrow(
				'Registry condition "language" has an unknown key: unknownField.',
			);
		});

		it("rejects an unknown type key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						types: {
							component: { label: "Components", bogus: 1 },
						},
					}),
				),
			).toThrow('Registry type "component" has an unknown key: bogus.');
		});
	});

	describe("parseRegistryItemTypes", () => {
		it("rejects absent types", () => {
			expect(() => parseRegistryItemTypes(undefined)).toThrow(
				"Registry types must be declared.",
			);
			expect(() => parseRegistryItemTypes(null)).toThrow(
				"Registry types must be declared.",
			);
		});

		it("rejects an empty types object", () => {
			expect(() => parseRegistryItemTypes({})).toThrow(
				"Registry types must declare at least one type.",
			);
		});

		it("parses a valid types map", () => {
			expect(
				parseRegistryItemTypes({
					component: {
						label: "Components",
						description: "Reusable UI primitives.",
					},
					theme: {
						label: "Themes",
					},
				}),
			).toEqual({
				component: {
					label: "Components",
					description: "Reusable UI primitives.",
				},
				theme: {
					label: "Themes",
				},
			});
		});

		it("rejects a missing label", () => {
			expect(() =>
				parseRegistryItemTypes({
					component: { description: "No label" },
				}),
			).toThrow('Registry type "component" label must be a non-empty string.');
		});

		it("rejects an empty label", () => {
			expect(() =>
				parseRegistryItemTypes({
					component: { label: "" },
				}),
			).toThrow('Registry type "component" label must be a non-empty string.');
		});

		it("rejects reserved type key all", () => {
			expect(() =>
				parseRegistryItemTypes({
					all: { label: "All items" },
				}),
			).toThrow('Registry type "all" is reserved.');
		});

		it("rejects a __proto__ type key", () => {
			expect(() =>
				parseRegistryItemTypes(JSON.parse('{"__proto__":{"label":"X"}}')),
			).toThrow('Registry types key "__proto__" is not allowed.');
		});

		it("rejects an empty type key", () => {
			expect(() =>
				parseRegistryItemTypes({
					"": { label: "Empty" },
				}),
			).toThrow("Registry types key must be a non-empty string.");
		});

		it("rejects a path-escaping type key", () => {
			expect(() =>
				parseRegistryItemTypes({
					"../escape": { label: "Escape" },
				}),
			).toThrow(
				String.raw`Registry type "../escape" must be a single path segment (no "/", "\", or "..").`,
			);
		});
	});

	it("round-trips types through parseRegistryDocument", () => {
		const parsed = parseRegistryDocument(
			validDocument({
				types: {
					component: {
						label: "Components",
						description: "Reusable UI primitives.",
					},
				},
			}),
		);

		expect(parsed.types).toEqual({
			component: {
				label: "Components",
				description: "Reusable UI primitives.",
			},
		});
	});

	it("rejects documents with items but no types", () => {
		expect(() =>
			parseRegistryDocument({
				items: {
					button: validIndexItem(),
				},
			}),
		).toThrow("Registry types must be declared.");
	});

	it("throws when an item declares an undeclared type", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					types: {
						theme: { label: "Themes" },
					},
				}),
			),
		).toThrow('Registry item "button" has undeclared type "component".');
	});

	it("throws when an item type matches an Object.prototype name", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validIndexItem({ type: "toString" }),
					},
				}),
			),
		).toThrow('Registry item "button" has undeclared type "toString".');
	});

	it("rejects reserved catalog type all", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					types: {
						component: { label: "Components" },
						all: { label: "All items" },
					},
				}),
			),
		).toThrow('Registry type "all" is reserved.');
	});

	it("rejects a path-escaping item map key", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						"../escape": validIndexItem(),
					},
				}),
			),
		).toThrow(
			String.raw`Registry item "../escape" must be a single path segment (no "/", "\", or "..").`,
		);
	});

	it("omits an empty conditions map from the parsed document", () => {
		expect(
			parseRegistryDocument(validDocument({ conditions: {} })),
		).not.toHaveProperty("conditions");
	});

	it("rejects a document that is not an object", () => {
		expect(() => parseRegistryDocument("nope")).toThrow(
			"Registry must be an object.",
		);
	});

	it("rejects packs that are not an array", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validIndexItem({ packs: "react" }),
					},
				}),
			),
		).toThrow('Registry items["button"].packs must be an array.');
	});

	it("rejects a pack without a compiled item source", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validIndexItem({
							packs: [
								{
									id: "react",
									title: "React",
								},
							],
						}),
					},
				}),
			),
		).toThrow(
			'Registry items["button"].packs[0].source must be a non-empty string.',
		);
	});

	it("rejects multiple unknown keys", () => {
		expect(() =>
			parseRegistryDocument(validDocument({ foo: 1, bar: 2 })),
		).toThrow("Registry has unknown keys: foo, bar.");
	});

	describe("parseRegistryConditions", () => {
		it("returns undefined when conditions are absent", () => {
			expect(parseRegistryConditions(undefined)).toBeUndefined();
			expect(parseRegistryConditions(null)).toBeUndefined();
		});

		it("returns undefined for an empty conditions object", () => {
			expect(parseRegistryConditions({})).toBeUndefined();
		});

		it("parses a valid conditions map", () => {
			expect(
				parseRegistryConditions({
					language: {
						kind: "select",
						label: "Language",
						description: "Pick a language.",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				}),
			).toEqual({
				language: {
					kind: "select",
					label: "Language",
					description: "Pick a language.",
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			});
		});

		it("rejects option bindings that reuse the condition key", () => {
			expect(() =>
				parseRegistryConditions({
					toolchain: {
						kind: "select",
						label: "Toolchain",
						values: [
							{
								value: "pnpm",
								label: "pnpm",
								bindings: { toolchain: "pnpm" },
							},
						],
					},
				}),
			).toThrow(
				'Registry condition "toolchain" value "pnpm" cannot declare bindings.toolchain (collides with a condition key).',
			);
		});

		it("rejects option bindings that reuse another condition key", () => {
			expect(() =>
				parseRegistryConditions({
					defaultBranch: {
						kind: "text",
						label: "Default branch",
					},
					language: {
						kind: "select",
						label: "Language",
						values: [
							{
								value: "typescript",
								label: "TypeScript",
								bindings: { defaultBranch: "main" },
							},
						],
					},
				}),
			).toThrow(
				'Registry condition "language" value "typescript" cannot declare bindings.defaultBranch (collides with a condition key).',
			);
		});

		it("rejects option bindings that reuse a reserved interpolation key", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
						kind: "select",
						label: "Language",
						values: [
							{
								value: "typescript",
								label: "TypeScript",
								bindings: { pmExec: "npx" },
							},
						],
					},
				}),
			).toThrow(
				'Registry condition "language" value "typescript" cannot declare bindings.pmExec (reserved interpolation key).',
			);
		});

		it("allows a shared condition named packageManager", () => {
			expect(
				parseRegistryConditions({
					packageManager: {
						kind: "select",
						label: "Package manager",
						values: [{ value: "pnpm", label: "pnpm" }],
					},
				}),
			).toEqual({
				packageManager: {
					kind: "select",
					label: "Package manager",
					values: [{ value: "pnpm", label: "pnpm" }],
				},
			});
		});

		it("rejects a conditions value that is not an object", () => {
			expect(() => parseRegistryConditions("nope")).toThrow(
				"Registry conditions must be an object.",
			);
		});

		it("rejects a condition entry that is not an object", () => {
			expect(() => parseRegistryConditions({ language: "typescript" })).toThrow(
				'Registry condition "language" must be an object.',
			);
		});

		it("rejects an empty condition values list", () => {
			expect(() =>
				parseRegistryConditions({
					language: { kind: "select", label: "Language", values: [] },
				}),
			).toThrow(
				'Registry condition "language" must declare at least one value.',
			);
		});

		it("rejects a select condition that omits values", () => {
			expect(() =>
				parseRegistryConditions({
					language: { kind: "select", label: "Language" },
				}),
			).toThrow(
				'Registry condition "language" must declare at least one value.',
			);
		});

		it("rejects a text condition that declares values", () => {
			expect(() =>
				parseRegistryConditions({
					author: {
						kind: "text",
						label: "Author",
						values: [{ value: "ada", label: "Ada" }],
					},
				}),
			).toThrow(
				'Registry condition "author" of kind "text" cannot declare values.',
			);
		});

		it("rejects duplicate condition values", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
						kind: "select",
						label: "Language",
						values: [
							{ value: "ts", label: "TS" },
							{ value: "ts", label: "TypeScript" },
						],
					},
				}),
			).toThrow('Registry condition "language" has duplicate value "ts".');
		});

		it("rejects a path-escaping condition key", () => {
			expect(() =>
				parseRegistryConditions({
					"../escape": {
						kind: "text",
						label: "Escape",
					},
				}),
			).toThrow(
				String.raw`Registry condition "../escape" must be a single path segment (no "/", "\", or "..").`,
			);
		});

		it("rejects an empty nested condition value", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
						kind: "select",
						label: "Language",
						values: [{ value: "", label: "TypeScript" }],
					},
				}),
			).toThrow(
				'Registry condition "language" values[0].value must be a non-empty string.',
			);
		});
	});

	describe("when matching", () => {
		it("rejects a when key that is not a declared condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							button: validIndexItem({
								packs: [validIndexPack({ when: { language: "typescript" } })],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "button" pack "react" references unknown when key "language".',
			);
		});

		it("rejects a when key that matches an Object.prototype name", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							language: {
								kind: "select",
								label: "Language",
								values: [{ value: "typescript", label: "TypeScript" }],
							},
						},
						items: {
							button: validIndexItem({
								packs: [validIndexPack({ when: { toString: "typescript" } })],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "button" pack "react" references unknown when key "toString".',
			);
		});

		it("rejects a when value that is not declared for the condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							language: {
								kind: "select",
								label: "Language",
								values: [{ value: "typescript", label: "TypeScript" }],
							},
						},
						items: {
							button: validIndexItem({
								packs: [validIndexPack({ when: { language: "javascript" } })],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "button" pack "react" uses undeclared when value "javascript" for key "language".',
			);
		});

		it("rejects an unrecognized item-level when key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							"assign-owner": validIndexItem({
								title: "Assign Owner",
								description: "Assigns the owner",
								when: { language: "typescript" },
								packs: undefined,
								source: "r/assign-owner.json",
							}),
						},
					}),
				),
			).toThrow('Registry items["assign-owner"] has an unknown key: when.');
		});

		it("rejects an item requires key that is not a declared condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							license: validIndexItem({
								title: "License",
								description: "License file",
								requires: ["authorName"],
								packs: undefined,
								beforeWrite: ["r/license.beforeWrite.0.js"],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "license" requires unknown condition "authorName".',
			);
		});

		it("rejects requiring an Object.prototype name as a condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							language: {
								kind: "select",
								label: "Language",
								values: [{ value: "typescript", label: "TypeScript" }],
							},
						},
						items: {
							license: validIndexItem({
								title: "License",
								description: "License file",
								requires: ["toString"],
								packs: undefined,
								beforeWrite: ["r/license.beforeWrite.0.js"],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "license" requires unknown condition "toString".',
			);
		});

		it("rejects requiring the reserved packageManager condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							button: validIndexItem({
								requires: ["packageManager"],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "button" cannot require reserved condition "packageManager" (built-in install context).',
			);
		});

		it("rejects declaring packageManager as a shared condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							packageManager: {
								kind: "select",
								label: "Package manager",
								values: [
									{ value: "pnpm", label: "pnpm" },
									{ value: "npm", label: "npm" },
								],
							},
						},
						items: {
							button: validIndexItem(),
						},
					}),
				),
			).toThrow(
				'Registry conditions cannot declare reserved condition "packageManager" (built-in install context).',
			);
		});

		it("allows pack when to reference the built-in packageManager key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							button: validIndexItem({
								packs: [
									validIndexPack({
										when: { packageManager: "pnpm" },
									}),
								],
							}),
						},
					}),
				),
			).not.toThrow();
		});

		it("rejects an invalid built-in packageManager when value", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							button: validIndexItem({
								packs: [
									validIndexPack({
										when: { packageManager: "pip" },
									}),
								],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "button" pack "react" uses undeclared when value "pip" for key "packageManager".',
			);
		});

		it("rejects item-local option bindings that reuse a shared condition key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							defaultBranch: { kind: "text", label: "Default branch" },
						},
						items: {
							button: validIndexItem({
								conditions: {
									language: {
										kind: "select",
										label: "Language",
										values: [
											{
												value: "typescript",
												label: "TypeScript",
												bindings: { defaultBranch: "main" },
											},
										],
									},
								},
							}),
						},
					}),
				),
			).toThrow(
				'Registry condition "language" value "typescript" cannot declare bindings.defaultBranch (collides with a condition key).',
			);
		});

		it("rejects an item-level condition that collides with a shared condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							authorName: { kind: "text", label: "Author" },
						},
						items: {
							license: validIndexItem({
								title: "License",
								description: "License file",
								conditions: {
									authorName: { kind: "text", label: "Author" },
								},
								packs: undefined,
								source: "r/license.json",
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "license" condition "authorName" collides with a shared condition.',
			);
		});

		it("rejects requires and local conditions that share a key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							coverageThreshold: { kind: "text", label: "Coverage" },
						},
						items: {
							button: validIndexItem({
								requires: ["coverageThreshold"],
								conditions: {
									coverageThreshold: { kind: "text", label: "Coverage" },
								},
							}),
						},
					}),
				),
			).toThrow(
				'Registry items["button"] lists "coverageThreshold" in both requires and local conditions.',
			);
		});

		it("rejects duplicate local condition keys across items", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							left: validIndexItem({
								title: "Left",
								description: "Left item",
								packs: undefined,
								source: "r/left.json",
								conditions: {
									coverageThreshold: { kind: "text", label: "Coverage" },
								},
							}),
							right: validIndexItem({
								title: "Right",
								description: "Right item",
								packs: undefined,
								source: "r/right.json",
								conditions: {
									coverageThreshold: { kind: "text", label: "Coverage" },
								},
							}),
						},
					}),
				),
			).toThrow(
				'Item-level condition "coverageThreshold" is declared by both "left" and "right".',
			);
		});

		it("rejects text conditions used in when", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							authorName: { kind: "text", label: "Author" },
						},
						items: {
							license: validIndexItem({
								title: "License",
								description: "License file",
								packs: [
									validIndexPack({
										id: "default",
										when: { authorName: "Ada" },
									}),
								],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "license" pack "default" references text condition "authorName" in when (text conditions cannot be used in when).',
			);
		});

		it("rejects invalid boolean when values", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							enableCi: { kind: "boolean", label: "Enable CI" },
						},
						items: {
							ci: validIndexItem({
								title: "CI",
								description: "CI workflow",
								packs: [
									validIndexPack({
										id: "default",
										when: { enableCi: "yes" },
									}),
								],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "ci" pack "default" uses invalid when value "yes" for boolean key "enableCi" (expected true or false).',
			);
		});

		it("accepts boolean and multiselect when values", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							enableCi: { kind: "boolean", label: "Enable CI" },
							platforms: {
								kind: "multiselect",
								label: "Platforms",
								values: [
									{ value: "ios", label: "iOS" },
									{ value: "android", label: "Android" },
								],
							},
						},
						items: {
							mobile: validIndexItem({
								title: "Mobile",
								description: "Mobile app",
								packs: [
									validIndexPack({
										id: "ios",
										when: { enableCi: true, platforms: "ios" },
									}),
								],
							}),
						},
					}),
				),
			).not.toThrow();
		});
	});

	describe("mapped custom schema messages", () => {
		it("rejects invalid path-segment ids", () => {
			expect(() =>
				parseWithSchema(
					registryItemSchema,
					{
						id: "../escape",
						title: "Bad",
						description: "Bad id",
						type: "configuration",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
					"Registry item",
				),
			).toThrow(
				String.raw`Registry item.id must be a single path segment (no "/", "\", or "..").`,
			);
		});

		it("rejects unsafe install script paths", () => {
			expect(() =>
				parseWithSchema(
					registryItemSchema,
					{
						id: "license",
						title: "License",
						description: "License",
						type: "configuration",
						beforeWrite: "/abs/handler.ts",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
					"Registry item",
				),
			).toThrow(
				"Registry item.beforeWrite must be a relative path under the registry (no absolute paths or URLs).",
			);
		});

		it("rejects items with neither files, install scripts, nor packs", () => {
			expect(() =>
				parseWithSchema(
					registryItemSchema,
					{
						id: "empty",
						title: "Empty",
						description: "Empty",
						type: "configuration",
					},
					"Registry item",
				),
			).toThrow(
				"Registry item must declare files, an install script (beforeWrite/afterInstall), or at least one pack.",
			);
		});

		it("rejects duplicate install scripts with a readable message", () => {
			expect(() =>
				parseWithSchema(
					registryItemSchema,
					{
						id: "license",
						title: "License",
						description: "License",
						type: "configuration",
						files: [{ source: "a.txt", target: "a.txt" }],
						afterInstall: ["cleanup:linux.ts", "cleanup:linux.ts"],
					},
					"Registry item",
				),
			).toThrow(
				'Registry item lists "cleanup:linux.ts" more than once in afterInstall.',
			);
		});

		it("rejects min on a non-multiselect condition", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
						kind: "select",
						label: "Language",
						min: 1,
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				}),
			).toThrow(
				'Registry condition "language" can only declare min for kind "multiselect".',
			);
		});

		it("maps item-local option bindings that reuse the condition key", () => {
			expect(() =>
				parseWithSchema(
					indexItemSchema,
					{
						title: "Testing",
						description: "Tests",
						type: "configuration",
						source: "r/testing.json",
						conditions: {
							toolchain: {
								label: "Toolchain",
								kind: "select",
								values: [
									{
										value: "pnpm",
										label: "pnpm",
										bindings: { toolchain: "pnpm" },
									},
								],
							},
						},
					},
					'Registry items["testing"]',
				),
			).toThrow(
				'Registry condition "toolchain" option bindings cannot reuse the condition key "toolchain".',
			);
		});

		it("rejects boolean conditions that declare values", () => {
			expect(() =>
				parseRegistryConditions({
					enableCi: {
						kind: "boolean",
						label: "Enable CI",
						values: [{ value: "true", label: "Yes" }],
					},
				}),
			).toThrow(
				'Registry condition "enableCi" of kind "boolean" cannot declare values.',
			);
		});

		it("rejects empty option bindings with a readable message", () => {
			expect(() =>
				parseRegistryConditions({
					toolchain: {
						kind: "select",
						label: "Toolchain",
						values: [{ value: "pnpm", label: "pnpm", bindings: {} }],
					},
				}),
			).toThrow(
				'Registry condition "toolchain" values[0].bindings must declare at least one binding.',
			);
		});

		it("rejects option bindings on multiselect conditions", () => {
			expect(() =>
				parseRegistryConditions({
					tools: {
						kind: "multiselect",
						label: "Tools",
						values: [
							{
								value: "biome",
								label: "Biome",
								bindings: { checkCmd: "biome check" },
							},
						],
					},
				}),
			).toThrow(
				'Registry condition "tools" of kind "multiselect" cannot declare option bindings.',
			);
		});

		it("rejects escaping file targets with a readable message", () => {
			expect(() =>
				parseWithSchema(
					registryItemSchema,
					{
						id: "license",
						title: "License",
						description: "License",
						type: "configuration",
						files: [{ source: "a.txt", target: "../outside.txt" }],
					},
					"Registry item",
				),
			).toThrow(
				'Registry item.files[0].target must be a relative path (no absolute paths, URLs, or "..").',
			);
		});

		it("rejects a __proto__ item id with a readable message", () => {
			expect(() =>
				parseWithSchema(
					registryItemSchema,
					{
						id: "__proto__",
						title: "Bad",
						description: "Bad",
						type: "configuration",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
					"Registry item",
				),
			).toThrow('Registry item key "__proto__" is not allowed.');
		});

		it("rejects the reserved select value None with a readable message", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
						kind: "select",
						label: "Language",
						values: [{ value: "None", label: "None" }],
					},
				}),
			).toThrow('Registry condition "language" value "None" is reserved.');
		});

		it("rejects an undeclared select default with a readable message", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
						kind: "select",
						label: "Language",
						default: "python",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				}),
			).toThrow(
				'Registry condition "language" default "python" is not a declared value.',
			);
		});

		it("rejects reserved item type all with a readable message", () => {
			expect(() =>
				parseWithSchema(
					registryItemSchema,
					{
						id: "license",
						title: "License",
						description: "License",
						type: "all",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
					"Registry item",
				),
			).toThrow('Registry item type "all" is reserved.');
		});

		it("rejects duplicate compiled file targets with a readable message", () => {
			expect(() =>
				parseWithSchema(
					compiledItemSchema,
					{
						files: [
							{ target: "a.txt", content: "one" },
							{ target: "a.txt", content: "two" },
						],
					},
					"Compiled item",
				),
			).toThrow('Compiled item declares duplicate file target "a.txt".');
		});

		it("rejects an invalid integrity digest with a readable message", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						scriptIntegrity: { "r/hook.js": "md5-not-sha256" },
					}),
				),
			).toThrow(
				"Registry.scriptIntegrity.r/hook.js must be a sha256 integrity digest.",
			);
		});

		it("falls through for unmapped array too_small paths", () => {
			expect(() =>
				parseWithSchema(
					z.object({ tags: z.array(z.string()).min(1) }),
					{ tags: [] },
					"Thing",
				),
			).toThrow(/Thing\.tags/);
		});

		it("maps empty files arrays and root array too_small issues", () => {
			expect(() =>
				parseWithSchema(
					z.object({
						id: z.string(),
						title: z.string(),
						description: z.string(),
						files: z
							.array(z.object({ source: z.string(), target: z.string() }))
							.min(1),
					}),
					{
						id: "x",
						title: "X",
						description: "X",
						files: [],
					},
					"Registry item",
				),
			).toThrow("Registry item.files must declare at least one file.");

			expect(() =>
				parseWithSchema(z.array(z.string()).min(1), [], "Tags"),
			).toThrow(/Tags/);
		});

		it("falls through for non-array too_small origins", () => {
			expect(() => parseWithSchema(z.number().min(5), 1, "Count")).toThrow(
				/Count/,
			);
		});

		it("rethrows unrecognized when-assertion failures", () => {
			const assertWhenValue =
				conditionKindPolicy[RegistryConditionKind.SELECT].assertWhenValue;
			conditionKindPolicy[RegistryConditionKind.SELECT].assertWhenValue =
				() => {
					throw "unexpected-failure";
				};

			try {
				expect(() =>
					parseRegistryDocument(
						validDocument({
							conditions: {
								language: {
									kind: "select",
									label: "Language",
									values: [{ value: "typescript", label: "TypeScript" }],
								},
							},
							items: {
								button: validIndexItem({
									packs: [validIndexPack({ when: { language: "typescript" } })],
								}),
							},
						}),
					),
				).toThrow("unexpected-failure");
			} finally {
				conditionKindPolicy[RegistryConditionKind.SELECT].assertWhenValue =
					assertWhenValue;
			}
		});
	});

	describe("parseWithSchema", () => {
		it("rethrows non-Zod errors from the schema", () => {
			const schema = {
				parse(): never {
					throw new Error("disk full");
				},
			} as unknown as ZodType<unknown>;

			expect(() => parseWithSchema(schema, {}, "Registry")).toThrow(
				"disk full",
			);
		});

		it("rethrows a ZodError that has no issues", () => {
			const schema = {
				parse(): never {
					throw new z.ZodError([]);
				},
			} as unknown as ZodType<unknown>;

			expect(() => parseWithSchema(schema, {}, "Registry")).toThrow(z.ZodError);
		});

		it("surfaces unprefixed custom schema messages", () => {
			expect(() =>
				parseWithSchema(
					z.string().refine(() => false, { message: "not allowed" }),
					"x",
					"Field",
				),
			).toThrow("not allowed");
		});

		it("surfaces stock Zod messages for unmapped issue codes", () => {
			expect(() =>
				parseWithSchema(z.string().email(), "not-an-email", "Email"),
			).toThrow("Email: Invalid email address");
		});
	});

	describe("compiled item parsing", () => {
		it("parses a payload with inlined content", () => {
			expect(
				parseWithSchema(
					compiledItemSchema,
					{
						files: [
							{
								target: "a.txt",
								content: "hello",
							},
						],
					},
					"Compiled item",
				),
			).toEqual({
				files: [
					{
						target: "a.txt",
						content: "hello",
					},
				],
			});
		});

		it("rejects files without content", () => {
			expect(() =>
				parseWithSchema(
					compiledItemSchema,
					{
						files: [{ target: "a.txt" }],
					},
					"Compiled item",
				),
			).toThrow("Compiled item.files[0].content must be a non-empty string.");
		});
	});

	it("rejects types that are not an object", () => {
		expect(() => parseRegistryItemTypes("nope")).toThrow(
			"Registry types must be an object.",
		);
	});
});
