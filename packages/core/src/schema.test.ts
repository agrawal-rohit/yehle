import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	authoredRegistryItemSchema,
	authoredRegistryVariantSchema,
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
		it("accepts inlined content", () => {
			expect(
				registryPayloadFileSchema.parse({
					source: "a.txt",
					target: "a.txt",
					content: "hello",
				}),
			).toEqual({
				source: "a.txt",
				target: "a.txt",
				content: "hello",
			});
		});

		it("rejects sources without content", () => {
			expect(
				registryPayloadFileSchema.safeParse({
					source: "a.txt",
					target: "a.txt",
				}).success,
			).toBe(false);
		});
	});

	describe("registryPayloadSchema", () => {
		it("accepts a payload with files", () => {
			expect(
				registryPayloadSchema.parse({
					id: "button",
					variantId: "react",
					files: [
						{
							source: "a.txt",
							target: "a.txt",
							content: "hello",
						},
					],
				}),
			).toMatchObject({ id: "button", variantId: "react" });
		});

		it("rejects unsafe ids", () => {
			expect(
				registryPayloadSchema.safeParse({
					id: "a/b",
					variantId: "react",
					files: [{ source: "a.txt", target: "a.txt", content: "x" }],
				}).success,
			).toBe(false);
		});
	});

	describe("registryVariantSchema", () => {
		it("requires a payload URI reference", () => {
			expect(registryVariantSchema.safeParse(validVariant()).success).toBe(
				false,
			);
			expect(
				registryVariantSchema.parse(
					validVariant({ payload: "r/button/react.json" }),
				),
			).toMatchObject({ payload: "r/button/react.json" });
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

	describe("authoredRegistryVariantSchema", () => {
		it("accepts required fields and omits absent optional lists", () => {
			expect(authoredRegistryVariantSchema.parse(validVariant())).toEqual({
				id: "react",
				title: "React",
				description: "React variant",
				files: [validFile()],
			});
		});

		it("keeps non-empty when, dependencies, and registryDependencies", () => {
			expect(
				authoredRegistryVariantSchema.parse(
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
				authoredRegistryVariantSchema.parse(
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
				authoredRegistryVariantSchema.safeParse(validVariant({ files: [] }))
					.success,
			).toBe(false);
		});

		it("rejects empty required strings, empty when values, and unknown keys", () => {
			expect(
				authoredRegistryVariantSchema.safeParse(validVariant({ id: "" }))
					.success,
			).toBe(false);
			expect(
				authoredRegistryVariantSchema.safeParse(validVariant({ id: "a/b" }))
					.success,
			).toBe(false);
			expect(
				authoredRegistryVariantSchema.safeParse(validVariant({ id: ".." }))
					.success,
			).toBe(false);
			expect(
				authoredRegistryVariantSchema.safeParse(
					validVariant({ when: { language: "" } }),
				).success,
			).toBe(false);
			expect(
				authoredRegistryVariantSchema.safeParse(validVariant({ extra: "nope" }))
					.success,
			).toBe(false);
		});
	});

	describe("authoredRegistryItemSchema", () => {
		it("accepts required fields and omits absent optional lists", () => {
			expect(authoredRegistryItemSchema.parse(validItem())).toEqual({
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				variants: [authoredRegistryVariantSchema.parse(validVariant())],
			});
		});

		it("rejects duplicate variant ids", () => {
			expect(
				rejectMessage(
					authoredRegistryItemSchema,
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
				authoredRegistryItemSchema.parse(
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
			const parsed = authoredRegistryItemSchema.parse(
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

		it("rejects an empty variants list", () => {
			expect(
				authoredRegistryItemSchema.safeParse(validItem({ variants: [] }))
					.success,
			).toBe(false);
		});

		it("rejects an empty files list when files are declared", () => {
			expect(
				authoredRegistryItemSchema.safeParse(validItem({ files: [] })).success,
			).toBe(false);
		});

		it("rejects unknown keys and empty required strings", () => {
			expect(
				authoredRegistryItemSchema.safeParse(validItem({ type: "" })).success,
			).toBe(false);
			expect(
				authoredRegistryItemSchema.safeParse(validItem({ typo: true })).success,
			).toBe(false);
		});
	});

	describe("registryItemSchema", () => {
		it("requires a payload URI on each variant", () => {
			expect(registryItemSchema.safeParse(validItem()).success).toBe(false);
			expect(
				registryItemSchema.parse(
					validItem({
						variants: [validVariant({ payload: "r/button/react.json" })],
					}),
				),
			).toMatchObject({
				id: "button",
				variants: [{ payload: "r/button/react.json" }],
			});
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
