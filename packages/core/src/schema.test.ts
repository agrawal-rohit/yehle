import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	catalogItemSchema,
	catalogVariantSchema,
	RegistryConditionInference,
	registryConditionSchema,
	registryConditionValueSchema,
	registryDocumentFieldsSchema,
	registryFileSchema,
	registryItemSchema,
	registryItemTypeSchema,
	registryPayloadFileSchema,
	registryPayloadSchema,
	registryVariantSchema,
} from "./schema";

/** Minimal valid registry file entry. */
function validFile(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		source: "registry/component/button/react/button.tsx",
		target: "src/components/ui/button.tsx",
		...overrides,
	};
}

/** Minimal valid condition value entry. */
function validConditionValue(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		value: "typescript",
		label: "TypeScript",
		...overrides,
	};
}

/** Minimal valid shared condition. */
function validCondition(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		label: "Language",
		values: [validConditionValue()],
		...overrides,
	};
}

/** Minimal valid registry variant. */
function validVariant(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "react",
		title: "React",
		description: "React variant",
		files: [validFile()],
		...overrides,
	};
}

/** Minimal valid registry item. */
function validItem(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "button",
		title: "Button",
		description: "A button",
		type: "component",
		variants: [validVariant()],
		...overrides,
	};
}

/**
 * Assert that a schema rejects the given input.
 * @param schema - Schema under test.
 * @param input - Value expected to fail validation.
 * @returns First Zod issue message from the failed parse.
 */
function rejectMessage(schema: ZodType, input: unknown): string {
	const result = schema.safeParse(input);
	expect(result.success).toBe(false);
	if (result.success) return "";
	return result.error.issues[0]?.message ?? "";
}

describe("core/schema", () => {
	describe("registryFileSchema", () => {
		it("accepts a file with non-empty source and target", () => {
			expect(registryFileSchema.parse(validFile())).toEqual({
				source: "registry/component/button/react/button.tsx",
				target: "src/components/ui/button.tsx",
			});
		});

		it("rejects empty source or target", () => {
			expect(
				registryFileSchema.safeParse(validFile({ source: "" })).success,
			).toBe(false);
			expect(
				registryFileSchema.safeParse(validFile({ target: "" })).success,
			).toBe(false);
		});

		it("rejects unknown keys", () => {
			expect(
				registryFileSchema.safeParse(validFile({ extra: "nope" })).success,
			).toBe(false);
		});
	});

	describe("registryPayloadFileSchema", () => {
		it("accepts inlined content without an authoring source", () => {
			expect(
				registryPayloadFileSchema.parse({
					target: "a.txt",
					content: "hello",
				}),
			).toEqual({
				target: "a.txt",
				content: "hello",
			});
		});

		it("rejects files without content and leftover authoring source", () => {
			expect(
				registryPayloadFileSchema.safeParse({
					target: "a.txt",
				}).success,
			).toBe(false);
			expect(
				registryPayloadFileSchema.safeParse({
					source: "a.txt",
					target: "a.txt",
					content: "hello",
				}).success,
			).toBe(false);
		});
	});

	describe("registryPayloadSchema", () => {
		it("accepts a payload with files", () => {
			expect(
				registryPayloadSchema.parse({
					files: [
						{
							target: "a.txt",
							content: "hello",
						},
					],
				}),
			).toEqual({
				files: [
					{
						target: "a.txt",
						content: "hello",
					},
				],
			});
		});

		it("rejects leftover identity fields", () => {
			expect(
				registryPayloadSchema.safeParse({
					id: "button",
					files: [{ target: "a.txt", content: "hello" }],
				}).success,
			).toBe(false);
			expect(
				registryPayloadSchema.safeParse({
					variantId: "react",
					files: [{ target: "a.txt", content: "hello" }],
				}).success,
			).toBe(false);
		});

		it("keeps non-empty npm dependency lists and omits empty ones", () => {
			expect(
				registryPayloadSchema.parse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: ["react"],
					devDependencies: ["typescript"],
				}),
			).toMatchObject({
				dependencies: ["react"],
				devDependencies: ["typescript"],
			});

			expect(
				registryPayloadSchema.parse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: [],
					devDependencies: [],
				}),
			).not.toHaveProperty("dependencies");
		});
	});

	describe("RegistryConditionInference", () => {
		it("exposes the files inference mode", () => {
			expect(RegistryConditionInference.FILES).toBe("files");
		});
	});

	describe("registryConditionValueSchema", () => {
		it("accepts a labelled value without files", () => {
			expect(registryConditionValueSchema.parse(validConditionValue())).toEqual(
				{
					value: "typescript",
					label: "TypeScript",
				},
			);
		});

		it("keeps a non-empty files list", () => {
			expect(
				registryConditionValueSchema.parse(
					validConditionValue({ files: ["button.tsx"] }),
				),
			).toEqual({
				value: "typescript",
				label: "TypeScript",
				files: ["button.tsx"],
			});
		});

		it("omits an empty files list", () => {
			expect(
				registryConditionValueSchema.parse(validConditionValue({ files: [] })),
			).toEqual({
				value: "typescript",
				label: "TypeScript",
			});
		});

		it("rejects empty value, label, or file path entries", () => {
			expect(
				registryConditionValueSchema.safeParse(
					validConditionValue({ value: "" }),
				).success,
			).toBe(false);
			expect(
				registryConditionValueSchema.safeParse(
					validConditionValue({ label: "" }),
				).success,
			).toBe(false);
			expect(
				registryConditionValueSchema.safeParse(
					validConditionValue({ files: [""] }),
				).success,
			).toBe(false);
		});
	});

	describe("registryConditionSchema", () => {
		it("accepts a labelled condition and omits absent optional fields", () => {
			expect(registryConditionSchema.parse(validCondition())).toEqual({
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			});
		});

		it("keeps a non-empty description and omits a blank one", () => {
			expect(
				registryConditionSchema.parse(
					validCondition({ description: "Pick a language." }),
				),
			).toMatchObject({ description: "Pick a language." });

			expect(
				registryConditionSchema.parse(validCondition({ description: "" })),
			).not.toHaveProperty("description");
		});

		it("keeps a valid files inference mode", () => {
			expect(
				registryConditionSchema.parse(
					validCondition({ inference: RegistryConditionInference.FILES }),
				),
			).toMatchObject({ inference: RegistryConditionInference.FILES });
		});

		it("rejects an unknown inference mode", () => {
			expect(
				rejectMessage(
					registryConditionSchema,
					validCondition({ inference: "guess" }),
				),
			).toBe("invalid_inference:guess");
		});

		it("rejects duplicate condition values", () => {
			expect(
				rejectMessage(
					registryConditionSchema,
					validCondition({
						values: [
							validConditionValue({ value: "ts", label: "TS" }),
							validConditionValue({ value: "ts", label: "TypeScript" }),
						],
					}),
				),
			).toBe("duplicate:ts");
		});

		it("rejects an empty values list", () => {
			expect(
				registryConditionSchema.safeParse(validCondition({ values: [] }))
					.success,
			).toBe(false);
		});

		it("rejects unknown keys", () => {
			expect(
				registryConditionSchema.safeParse(validCondition({ extra: true }))
					.success,
			).toBe(false);
		});
	});

	describe("registryItemTypeSchema", () => {
		it("accepts a label and omits an absent description", () => {
			expect(registryItemTypeSchema.parse({ label: "Components" })).toEqual({
				label: "Components",
			});
		});

		it("keeps a non-empty description and omits a blank one", () => {
			expect(
				registryItemTypeSchema.parse({
					label: "Components",
					description: "Reusable UI primitives.",
				}),
			).toEqual({
				label: "Components",
				description: "Reusable UI primitives.",
			});

			expect(
				registryItemTypeSchema.parse({ label: "Components", description: "" }),
			).toEqual({ label: "Components" });
		});

		it("rejects an empty label or unknown keys", () => {
			expect(registryItemTypeSchema.safeParse({ label: "" }).success).toBe(
				false,
			);
			expect(
				registryItemTypeSchema.safeParse({ label: "Components", bogus: 1 })
					.success,
			).toBe(false);
		});
	});

	describe("registryVariantSchema", () => {
		it("accepts required fields and omits absent optional lists", () => {
			expect(registryVariantSchema.parse(validVariant())).toEqual({
				id: "react",
				title: "React",
				description: "React variant",
				files: [validFile()],
			});
		});

		it("keeps non-empty when, dependencies, and registryDependencies", () => {
			expect(
				registryVariantSchema.parse(
					validVariant({
						when: { language: "typescript" },
						dependencies: ["react"],
						devDependencies: ["typescript"],
						registryDependencies: ["utils"],
					}),
				),
			).toEqual({
				id: "react",
				title: "React",
				description: "React variant",
				files: [validFile()],
				when: { language: "typescript" },
				dependencies: ["react"],
				devDependencies: ["typescript"],
				registryDependencies: ["utils"],
			});
		});

		it("omits empty when maps and empty dependency lists", () => {
			expect(
				registryVariantSchema.parse(
					validVariant({
						when: {},
						dependencies: [],
						devDependencies: [],
						registryDependencies: [],
					}),
				),
			).toEqual({
				id: "react",
				title: "React",
				description: "React variant",
				files: [validFile()],
			});
		});

		it("rejects an empty files list", () => {
			expect(
				registryVariantSchema.safeParse(validVariant({ files: [] })).success,
			).toBe(false);
		});

		it("rejects empty required strings, empty when values, and unknown keys", () => {
			expect(
				registryVariantSchema.safeParse(validVariant({ id: "" })).success,
			).toBe(false);
			expect(
				registryVariantSchema.safeParse(validVariant({ id: "a/b" })).success,
			).toBe(false);
			expect(
				registryVariantSchema.safeParse(validVariant({ id: ".." })).success,
			).toBe(false);
			expect(
				registryVariantSchema.safeParse(
					validVariant({ when: { language: "" } }),
				).success,
			).toBe(false);
			expect(
				registryVariantSchema.safeParse(validVariant({ extra: "nope" }))
					.success,
			).toBe(false);
		});
	});

	describe("registryItemSchema", () => {
		it("accepts required fields and omits absent optional lists", () => {
			expect(registryItemSchema.parse(validItem())).toEqual({
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				variants: [registryVariantSchema.parse(validVariant())],
			});
		});

		it("rejects duplicate variant ids", () => {
			expect(
				rejectMessage(
					registryItemSchema,
					validItem({
						variants: [
							validVariant({ id: "default" }),
							validVariant({ id: "default", title: "Also" }),
						],
					}),
				),
			).toBe("duplicate_variant:default");
		});

		it("keeps item-level files and non-empty dependency lists", () => {
			expect(
				registryItemSchema.parse(
					validItem({
						files: [validFile()],
						dependencies: ["clsx"],
						devDependencies: ["vitest"],
						registryDependencies: ["utils"],
					}),
				),
			).toMatchObject({
				files: [validFile()],
				dependencies: ["clsx"],
				devDependencies: ["vitest"],
				registryDependencies: ["utils"],
			});
		});

		it("omits empty dependency lists", () => {
			const parsed = registryItemSchema.parse(
				validItem({
					dependencies: [],
					devDependencies: [],
					registryDependencies: [],
				}),
			);

			expect(parsed).not.toHaveProperty("files");
			expect(parsed).not.toHaveProperty("dependencies");
			expect(parsed).not.toHaveProperty("devDependencies");
			expect(parsed).not.toHaveProperty("registryDependencies");
		});

		it("accepts a variant-less item with top-level files", () => {
			const { variants: _variants, ...withoutVariants } = validItem();
			expect(
				registryItemSchema.parse({
					...withoutVariants,
					files: [validFile()],
					when: { language: "typescript" },
				}),
			).toEqual({
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				files: [validFile()],
				when: { language: "typescript" },
			});
		});

		it("omits an empty variants list when files are present", () => {
			const parsed = registryItemSchema.parse(
				validItem({ variants: [], files: [validFile()] }),
			);

			expect(parsed).not.toHaveProperty("variants");
			expect(parsed.files).toEqual([validFile()]);
		});

		it("rejects an item with neither files nor variants", () => {
			expect(
				rejectMessage(registryItemSchema, validItem({ variants: [] })),
			).toBe("missing_files_or_variants");
		});

		it("rejects an empty files list when files are declared", () => {
			expect(
				registryItemSchema.safeParse(validItem({ files: [] })).success,
			).toBe(false);
		});

		it("rejects unknown keys and empty required strings", () => {
			expect(
				registryItemSchema.safeParse(validItem({ type: "" })).success,
			).toBe(false);
			expect(
				registryItemSchema.safeParse(validItem({ typo: true })).success,
			).toBe(false);
		});
	});

	describe("catalogVariantSchema", () => {
		it("accepts an index variant with a payload source", () => {
			expect(
				catalogVariantSchema.parse({
					id: "react",
					title: "React",
					source: "r/button/react.json",
				}),
			).toEqual({
				id: "react",
				title: "React",
				source: "r/button/react.json",
			});
		});

		it("keeps when and registryDependencies and rejects files", () => {
			expect(
				catalogVariantSchema.parse({
					id: "react",
					title: "React",
					source: "r/button/react.json",
					when: { language: "typescript" },
					registryDependencies: ["utils"],
				}),
			).toMatchObject({
				when: { language: "typescript" },
				registryDependencies: ["utils"],
			});

			expect(
				catalogVariantSchema.safeParse({
					id: "react",
					title: "React",
					source: "r/button/react.json",
					files: [{ source: "a.txt", target: "a.txt" }],
				}).success,
			).toBe(false);
		});
	});

	describe("catalogItemSchema", () => {
		it("accepts a variant index without an item id", () => {
			expect(
				catalogItemSchema.parse({
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
				}),
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

		it("accepts a variant-less item with a payload source", () => {
			expect(
				catalogItemSchema.parse({
					title: "Assign Owner",
					description: "Assigns the owner",
					type: "workflow",
					source: "r/assign-owner.json",
				}),
			).toEqual({
				title: "Assign Owner",
				description: "Assigns the owner",
				type: "workflow",
				source: "r/assign-owner.json",
			});
		});

		it("rejects an item with neither source nor variants", () => {
			expect(
				rejectMessage(catalogItemSchema, {
					title: "Button",
					description: "A button",
					type: "component",
				}),
			).toBe("missing_source_or_variants");
		});

		it("rejects an item that declares source together with variants", () => {
			expect(
				rejectMessage(catalogItemSchema, {
					title: "Button",
					description: "A button",
					type: "component",
					source: "r/button.json",
					variants: [
						{
							id: "react",
							title: "React",
							source: "r/button/react.json",
						},
					],
				}),
			).toBe("source_with_variants");
		});

		it("rejects duplicate variant ids and unknown keys including id", () => {
			expect(
				rejectMessage(catalogItemSchema, {
					title: "Button",
					description: "A button",
					type: "component",
					variants: [
						{
							id: "default",
							title: "One",
							source: "r/button/default.json",
						},
						{
							id: "default",
							title: "Two",
							source: "r/button/default.json",
						},
					],
				}),
			).toBe("duplicate_variant:default");

			expect(
				catalogItemSchema.safeParse({
					id: "button",
					title: "Button",
					description: "A button",
					type: "component",
					source: "r/button.json",
				}).success,
			).toBe(false);
		});
	});

	describe("registryDocumentFieldsSchema", () => {
		it("leaves nested items, types, and conditions unparsed", () => {
			const parsed = registryDocumentFieldsSchema.parse({
				types: "not-an-object",
				conditions: { language: { label: "" } },
				items: { button: { id: "" } },
			});

			expect(parsed.types).toBe("not-an-object");
			expect(parsed.conditions).toEqual({ language: { label: "" } });
			expect(parsed.items).toEqual({ button: { id: "" } });
		});

		it("omits absent optional conditions and types", () => {
			const parsed = registryDocumentFieldsSchema.parse({
				items: {},
			});

			expect(parsed).not.toHaveProperty("conditions");
			expect(parsed).not.toHaveProperty("types");
			expect(parsed.items).toEqual({});
		});

		it("rejects a missing items map or unknown keys", () => {
			expect(registryDocumentFieldsSchema.safeParse({}).success).toBe(false);
			expect(
				registryDocumentFieldsSchema.safeParse({
					items: {},
					version: "1",
				}).success,
			).toBe(false);
			expect(
				registryDocumentFieldsSchema.safeParse({
					items: {},
					baseUrl: "https://example.com/content",
				}).success,
			).toBe(false);
		});
	});
});
