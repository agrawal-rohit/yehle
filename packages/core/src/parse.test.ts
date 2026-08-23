import { describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import { conditionKindPolicy, RegistryConditionKind } from "./condition-kind";
import {
	parseKeyedRecord,
	parseRegistryDocument,
	parseWithSchema,
} from "./parse";
import {
	catalogItemSchema,
	registryConditionSchema,
	registryItemSchema,
	registryItemTypeSchema,
	registryPayloadSchema,
} from "./schema";

/** Parse conditions the same way build/document parsing does. */
function parseRegistryConditions(raw: unknown) {
	return parseKeyedRecord(
		registryConditionSchema,
		raw,
		"Registry conditions",
		(key) => `Registry condition "${key}"`,
	);
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
	);
}

/** Minimal valid catalog item for parseRegistryDocument tests. */
function validCatalogItem(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		title: "Button",
		description: "A button",
		type: "component",
		variants: [validCatalogVariant()],
		...overrides,
	};
}

/** Minimal valid catalog variant. */
function validCatalogVariant(
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
			button: validCatalogItem(),
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
						label: "Language",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				},
				items: {
					button: validCatalogItem({
						variants: [
							validCatalogVariant({ when: { language: "typescript" } }),
						],
					}),
				},
			}),
		);

		expect(parsed.items.button.type).toBe("component");
		expect(parsed.types).toEqual({
			component: { label: "Components" },
		});
	});

	it("rejects items with neither source nor variants", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validCatalogItem({ variants: [] }),
					},
				}),
			),
		).toThrow(
			'Registry items["button"] must declare source, an install script (beforeInstall/afterInstall), or at least one variant.',
		);
	});

	it("rejects items that declare source together with variants", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validCatalogItem({ source: "r/button.json" }),
					},
				}),
			),
		).toThrow(
			'Registry items["button"] cannot declare source together with variants.',
		);
	});

	it("accepts a variant-less item with a payload source", () => {
		expect(
			parseRegistryDocument(
				validDocument({
					items: {
						"assign-owner": validCatalogItem({
							title: "Assign Owner",
							description: "Assigns the owner",
							variants: undefined,
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

	it("rejects a catalog item that declares id", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validCatalogItem({ id: "button" }),
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
					variants: [
						{
							id: "default",
							title: "Default",
							description: "Default",
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

	it("parses catalog items with catalogItemSchema", () => {
		expect(
			parseWithSchema(
				catalogItemSchema,
				validCatalogItem(),
				'Registry items["button"]',
			),
		).toEqual({
			title: "Button",
			description: "A button",
			type: "component",
			variants: [
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
							button: validCatalogItem({ typo: true }),
						},
					}),
				),
			).toThrow('Registry items["button"] has an unknown key: typo.');
		});

		it("rejects an unknown variant key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							button: validCatalogItem({
								variants: [validCatalogVariant({ extra: "nope" })],
							}),
						},
					}),
				),
			).toThrow(
				'Registry items["button"].variants[0] has an unknown key: extra.',
			);
		});

		it("rejects an unknown condition key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							language: {
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
					button: validCatalogItem(),
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

	it("rejects variants that are not an array", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validCatalogItem({ variants: "react" }),
					},
				}),
			),
		).toThrow('Registry items["button"].variants must be an array.');
	});

	it("rejects a variant without a payload source", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: validCatalogItem({
							variants: [
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
			'Registry items["button"].variants[0].source must be a non-empty string.',
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
						label: "Language",
						description: "Pick a language.",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				}),
			).toEqual({
				language: {
					label: "Language",
					description: "Pick a language.",
					values: [{ value: "typescript", label: "TypeScript" }],
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
					language: { label: "Language", values: [] },
				}),
			).toThrow(
				'Registry condition "language" must declare at least one value.',
			);
		});

		it("rejects a select condition that omits values", () => {
			expect(() =>
				parseRegistryConditions({
					language: { label: "Language" },
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
						label: "Language",
						values: [
							{ value: "ts", label: "TS" },
							{ value: "ts", label: "TypeScript" },
						],
					},
				}),
			).toThrow('Registry condition "language" has duplicate value "ts".');
		});

		it("rejects an empty nested condition value", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
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
							button: validCatalogItem({
								variants: [
									validCatalogVariant({ when: { language: "typescript" } }),
								],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "button" variant "react" references unknown when key "language".',
			);
		});

		it("rejects a when value that is not declared for the condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							language: {
								label: "Language",
								values: [{ value: "typescript", label: "TypeScript" }],
							},
						},
						items: {
							button: validCatalogItem({
								variants: [
									validCatalogVariant({ when: { language: "javascript" } }),
								],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "button" variant "react" uses undeclared when value "javascript" for key "language".',
			);
		});

		it("rejects an unrecognized item-level when key", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							"assign-owner": validCatalogItem({
								title: "Assign Owner",
								description: "Assigns the owner",
								when: { language: "typescript" },
								variants: undefined,
								source: "r/assign-owner.json",
							}),
						},
					}),
				),
			).toThrow('Registry items["assign-owner"] has an unknown key: when.');
		});

		it("rejects an item uses key that is not a declared condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							license: validCatalogItem({
								title: "License",
								description: "License file",
								uses: ["authorName"],
								variants: undefined,
								beforeInstall: ["r/license.beforeInstall.0.js"],
							}),
						},
					}),
				),
			).toThrow('Registry item "license" uses unknown condition "authorName".');
		});

		it("rejects text conditions used in when", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						conditions: {
							authorName: { kind: "text", label: "Author" },
						},
						items: {
							license: validCatalogItem({
								title: "License",
								description: "License file",
								variants: [
									validCatalogVariant({
										id: "default",
										when: { authorName: "Ada" },
									}),
								],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "license" variant "default" references text condition "authorName" in when (text conditions cannot be used in when).',
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
							ci: validCatalogItem({
								title: "CI",
								description: "CI workflow",
								variants: [
									validCatalogVariant({
										id: "default",
										when: { enableCi: "yes" },
									}),
								],
							}),
						},
					}),
				),
			).toThrow(
				'Registry item "ci" variant "default" uses invalid when value "yes" for boolean key "enableCi" (expected "true" or "false").',
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
							mobile: validCatalogItem({
								title: "Mobile",
								description: "Mobile app",
								variants: [
									validCatalogVariant({
										id: "ios",
										when: { enableCi: "true", platforms: "ios" },
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
						beforeInstall: "/abs/handler.ts",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
					"Registry item",
				),
			).toThrow(
				'Registry item.beforeInstall must be a relative path under the registry (no absolute paths, URLs, or "..").',
			);
		});

		it("rejects items with neither files, install scripts, nor variants", () => {
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
				"Registry item must declare files, an install script (beforeInstall/afterInstall), or at least one variant.",
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
						afterInstall: ["cleanup.ts", "cleanup.ts"],
					},
					"Registry item",
				),
			).toThrow(
				'Registry item lists "cleanup.ts" more than once in afterInstall.',
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
									label: "Language",
									values: [{ value: "typescript", label: "TypeScript" }],
								},
							},
							items: {
								button: validCatalogItem({
									variants: [
										validCatalogVariant({ when: { language: "typescript" } }),
									],
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

	describe("registry payload parsing", () => {
		it("parses a payload with inlined content", () => {
			expect(
				parseWithSchema(
					registryPayloadSchema,
					{
						files: [
							{
								target: "a.txt",
								content: "hello",
							},
						],
					},
					"Registry payload",
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
					registryPayloadSchema,
					{
						files: [{ target: "a.txt" }],
					},
					"Registry payload",
				),
			).toThrow(
				"Registry payload.files[0].content must be a non-empty string.",
			);
		});
	});

	it("rejects types that are not an object", () => {
		expect(() => parseRegistryItemTypes("nope")).toThrow(
			"Registry types must be an object.",
		);
	});
});
