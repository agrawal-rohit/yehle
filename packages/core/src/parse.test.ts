import { describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import {
	parseRegistryConditions,
	parseRegistryDocument,
	parseRegistryItemTypes,
	parseWithSchema,
} from "./parse";
import {
	RegistryConditionInference,
	registryItemSchema,
	registryPayloadSchema,
} from "./schema";

/** Minimal valid registry document for parseRegistryDocument tests. */
function validDocument(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		types: {
			component: { label: "Components" },
		},
		items: {
			button: {
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				variants: [
					{
						id: "react",
						title: "React",
						description: "React button",
						files: [
							{
								source: "r/button/react.json",
								target: "src/components/ui/button.tsx",
							},
						],
					},
				],
			},
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
					button: {
						id: "button",
						title: "Button",
						description: "A button",
						type: "component",
						variants: [
							{
								id: "react",
								title: "React",
								description: "React button",
								when: { language: "typescript" },
								files: [
									{
										source: "r/button/react.json",
										target: "src/components/ui/button.tsx",
									},
								],
							},
						],
					},
				},
			}),
		);

		expect(parsed.items.button.type).toBe("component");
		expect(parsed.types).toEqual({
			component: { label: "Components" },
		});
	});

	it("rejects items with neither files nor variants", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: {
							id: "button",
							title: "Button",
							description: "A button",
							type: "component",
							variants: [],
						},
					},
				}),
			),
		).toThrow(
			'Registry items["button"] must declare files or at least one variant.',
		);
	});

	it("accepts a variant-less item with top-level files", () => {
		expect(
			parseRegistryDocument(
				validDocument({
					items: {
						"assign-owner": {
							id: "assign-owner",
							title: "Assign Owner",
							description: "Assigns the owner",
							type: "component",
							files: [
								{
									source: "r/assign-owner.json",
									target: ".github/workflows/assign-owner.yml",
								},
							],
						},
					},
				}),
			).items["assign-owner"],
		).toEqual({
			id: "assign-owner",
			title: "Assign Owner",
			description: "Assigns the owner",
			type: "component",
			files: [
				{
					source: "r/assign-owner.json",
					target: ".github/workflows/assign-owner.yml",
				},
			],
		});
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
							button: {
								id: "button",
								title: "Button",
								description: "A button",
								type: "component",
								typo: true,
								variants: [
									{
										id: "react",
										title: "React",
										description: "React button",
										files: [
											{
												source: "r/button/react.json",
												target: "a.tsx",
											},
										],
									},
								],
							},
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
							button: {
								id: "button",
								title: "Button",
								description: "A button",
								type: "component",
								variants: [
									{
										id: "react",
										title: "React",
										description: "React button",
										extra: "nope",
										files: [
											{
												source: "r/button/react.json",
												target: "a.tsx",
											},
										],
									},
								],
							},
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
					button: {
						id: "button",
						title: "Button",
						description: "A button",
						type: "component",
						variants: [
							{
								id: "react",
								title: "React",
								description: "React button",
								files: [
									{
										source: "r/button/react.json",
										target: "src/components/ui/button.tsx",
									},
								],
							},
						],
					},
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
						button: {
							id: "button",
							title: "Button",
							description: "A button",
							type: "component",
							variants: "react",
						},
					},
				}),
			),
		).toThrow('Registry items["button"].variants must be an array.');
	});

	it("rejects an empty variant files list", () => {
		expect(() =>
			parseRegistryDocument(
				validDocument({
					items: {
						button: {
							id: "button",
							title: "Button",
							description: "A button",
							type: "component",
							variants: [
								{
									id: "react",
									title: "React",
									description: "React button",
									files: [],
								},
							],
						},
					},
				}),
			),
		).toThrow(
			'Registry items["button"].variants[0].files must declare at least one file.',
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
						inference: RegistryConditionInference.FILES,
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				}),
			).toEqual({
				language: {
					label: "Language",
					description: "Pick a language.",
					inference: RegistryConditionInference.FILES,
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

		it("rejects an unknown inference mode", () => {
			expect(() =>
				parseRegistryConditions({
					language: {
						label: "Language",
						inference: "guess",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				}),
			).toThrow(
				'Registry condition "language" has invalid inference "guess" (expected one of: files).',
			);
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
							button: {
								id: "button",
								title: "Button",
								description: "A button",
								type: "component",
								variants: [
									{
										id: "react",
										title: "React",
										description: "React button",
										when: { language: "typescript" },
										files: [
											{
												source: "r/button/react.json",
												target: "a.tsx",
											},
										],
									},
								],
							},
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
							button: {
								id: "button",
								title: "Button",
								description: "A button",
								type: "component",
								variants: [
									{
										id: "react",
										title: "React",
										description: "React button",
										when: { language: "javascript" },
										files: [
											{
												source: "r/button/react.json",
												target: "a.tsx",
											},
										],
									},
								],
							},
						},
					}),
				),
			).toThrow(
				'Registry item "button" variant "react" uses undeclared when value "javascript" for key "language".',
			);
		});

		it("rejects an item-level when key that is not a declared condition", () => {
			expect(() =>
				parseRegistryDocument(
					validDocument({
						items: {
							"assign-owner": {
								id: "assign-owner",
								title: "Assign Owner",
								description: "Assigns the owner",
								type: "component",
								when: { language: "typescript" },
								files: [
									{
										source: "r/assign-owner.json",
										target: "a.yml",
									},
								],
							},
						},
					}),
				),
			).toThrow(
				'Registry item "assign-owner" references unknown when key "language".',
			);
		});

		it("rejects an item-level when value that is not declared for the condition", () => {
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
							"assign-owner": {
								id: "assign-owner",
								title: "Assign Owner",
								description: "Assigns the owner",
								type: "component",
								when: { language: "javascript" },
								files: [
									{
										source: "r/assign-owner.json",
										target: "a.yml",
									},
								],
							},
						},
					}),
				),
			).toThrow(
				'Registry item "assign-owner" uses undeclared when value "javascript" for key "language".',
			);
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

		it("falls back to a non-empty-string message for unmapped issue codes", () => {
			expect(() =>
				parseWithSchema(z.string().email(), "not-an-email", "Email"),
			).toThrow("Email must be a non-empty string.");
		});
	});

	describe("registry payload parsing", () => {
		it("parses a payload with inlined content", () => {
			expect(
				parseWithSchema(
					registryPayloadSchema,
					{
						id: "button",
						variantId: "react",
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
				id: "button",
				variantId: "react",
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
						id: "button",
						variantId: "react",
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
