import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	catalogItemSchema,
	catalogPackSchema,
	registryConditionSchema,
	registryConditionValueSchema,
	registryDocumentFieldsSchema,
	registryFileSchema,
	registryItemSchema,
	registryItemTypeSchema,
	registryPackSchema,
	registryPayloadFileSchema,
	registryPayloadSchema,
	registryWhenSchema,
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

/** Minimal valid registry pack. */
function validPack(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "typescript",
		title: "TypeScript",
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
		packs: [validPack()],
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

		it("accepts a payload with an empty files list", () => {
			expect(registryPayloadSchema.parse({ files: [] })).toEqual({
				files: [],
			});
			expect(registryPayloadSchema.parse({})).toEqual({ files: [] });
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

		it("keeps non-empty dependency maps and omits empty ones", () => {
			expect(
				registryPayloadSchema.parse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: {
						npm: {
							runtime: ["react"],
							dev: ["typescript"],
						},
					},
				}),
			).toMatchObject({
				dependencies: {
					npm: {
						runtime: ["react"],
						dev: ["typescript"],
					},
				},
			});

			expect(
				registryPayloadSchema.parse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: {
						npm: {
							runtime: ["react"],
						},
					},
				}),
			).toMatchObject({
				dependencies: {
					npm: {
						runtime: ["react"],
					},
				},
			});

			expect(
				registryPayloadSchema.parse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: {
						npm: {
							dev: ["typescript"],
						},
					},
				}),
			).toMatchObject({
				dependencies: {
					npm: {
						dev: ["typescript"],
					},
				},
			});

			expect(
				registryPayloadSchema.parse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: {
						npm: {
							runtime: [],
							dev: [],
						},
					},
				}),
			).not.toHaveProperty("dependencies");
		});

		it("keeps commands and secrets on payloads", () => {
			expect(
				registryPayloadSchema.parse({
					files: [{ target: "a.txt", content: "x" }],
					commands: { npm: { test: "vitest run" } },
					secrets: ["GH_ADMIN_TOKEN"],
				}),
			).toEqual({
				files: [{ target: "a.txt", content: "x" }],
				commands: { npm: { test: "vitest run" } },
				secrets: ["GH_ADMIN_TOKEN"],
			});
		});

		it("rejects untagged dependency lists", () => {
			expect(
				registryPayloadSchema.safeParse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: ["react"],
				}).success,
			).toBe(false);
		});

		it("rejects unknown ecosystem keys", () => {
			expect(
				registryPayloadSchema.safeParse({
					files: [{ target: "a.txt", content: "x" }],
					dependencies: { pypi: { runtime: ["ruff"] } },
				}).success,
			).toBe(false);
		});
	});

	describe("registryConditionValueSchema", () => {
		it("accepts a labelled value", () => {
			expect(registryConditionValueSchema.parse(validConditionValue())).toEqual(
				{
					value: "typescript",
					label: "TypeScript",
				},
			);
		});

		it("rejects empty value or label", () => {
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
		});

		it("rejects unknown keys", () => {
			expect(
				registryConditionValueSchema.safeParse(
					validConditionValue({ files: ["button.tsx"] }),
				).success,
			).toBe(false);
		});

		it("accepts non-empty option bindings", () => {
			expect(
				registryConditionValueSchema.parse(
					validConditionValue({
						bindings: { pmRun: "pnpm", pmExec: "pnpm exec" },
					}),
				),
			).toEqual({
				value: "typescript",
				label: "TypeScript",
				bindings: { pmRun: "pnpm", pmExec: "pnpm exec" },
			});
		});

		it("rejects an empty bindings map", () => {
			expect(
				rejectMessage(
					registryConditionValueSchema,
					validConditionValue({ bindings: {} }),
				),
			).toBe("empty_bindings");
		});
	});

	describe("registryConditionSchema", () => {
		it("accepts a labelled condition and omits absent optional fields", () => {
			expect(
				registryConditionSchema.parse(validCondition({ kind: "select" })),
			).toEqual({
				label: "Language",
				kind: "select",
				values: [{ value: "typescript", label: "TypeScript" }],
			});
		});

		it("keeps a non-empty description and omits a blank one", () => {
			expect(
				registryConditionSchema.parse(
					validCondition({ kind: "select", description: "Pick a language." }),
				),
			).toMatchObject({ description: "Pick a language." });

			expect(
				registryConditionSchema.parse(
					validCondition({ kind: "select", description: "" }),
				),
			).not.toHaveProperty("description");
		});

		it("keeps a text condition default", () => {
			expect(
				registryConditionSchema.parse(
					validCondition({
						kind: "text",
						default: "45",
						values: undefined,
					}),
				),
			).toMatchObject({ kind: "text", default: "45" });
		});

		it("rejects duplicate condition values", () => {
			expect(
				rejectMessage(
					registryConditionSchema,
					validCondition({
						kind: "select",
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
				registryConditionSchema.safeParse(
					validCondition({ kind: "select", values: [] }),
				).success,
			).toBe(false);
		});

		it("accepts a text condition without values", () => {
			expect(
				registryConditionSchema.parse({
					label: "Author",
					kind: "text",
					handler: "conditions/author.ts",
				}),
			).toEqual({
				label: "Author",
				kind: "text",
				handler: "conditions/author.ts",
			});
		});

		it("rejects a text condition that declares values", () => {
			expect(
				rejectMessage(
					registryConditionSchema,
					validCondition({ kind: "text" }),
				),
			).toBe("text_with_values");
		});

		it("accepts a multiselect condition with values", () => {
			expect(
				registryConditionSchema.parse(validCondition({ kind: "multiselect" })),
			).toEqual({
				label: "Language",
				kind: "multiselect",
				values: [{ value: "typescript", label: "TypeScript" }],
			});
		});

		it("rejects a multiselect condition without values", () => {
			expect(
				rejectMessage(registryConditionSchema, {
					label: "Language",
					kind: "multiselect",
				}),
			).toBe("select_requires_values");
		});

		it("rejects option bindings on a multiselect condition", () => {
			expect(
				rejectMessage(
					registryConditionSchema,
					validCondition({
						kind: "multiselect",
						values: [
							validConditionValue({
								bindings: { pmRun: "pnpm" },
							}),
						],
					}),
				),
			).toBe("bindings_on_multiselect");
		});

		it("accepts option bindings on a select condition", () => {
			expect(
				registryConditionSchema.parse(
					validCondition({
						kind: "select",
						values: [
							validConditionValue({
								bindings: { pmRun: "pnpm" },
							}),
						],
					}),
				),
			).toMatchObject({
				values: [
					{
						value: "typescript",
						label: "TypeScript",
						bindings: { pmRun: "pnpm" },
					},
				],
			});
		});

		it("accepts condition-level when and multiselect min", () => {
			expect(
				registryConditionSchema.parse({
					label: "Quality tools",
					kind: "multiselect",
					when: { language: "typescript" },
					min: 1,
					values: [validConditionValue({ value: "biome", label: "Biome" })],
				}),
			).toEqual({
				label: "Quality tools",
				kind: "multiselect",
				when: { language: "typescript" },
				min: 1,
				values: [{ value: "biome", label: "Biome" }],
			});
		});

		it("rejects a condition without kind", () => {
			expect(rejectMessage(registryConditionSchema, validCondition())).toBe(
				'Invalid option: expected one of "text"|"select"|"boolean"|"multiselect"',
			);
		});

		it("rejects min on non-multiselect conditions", () => {
			expect(
				rejectMessage(registryConditionSchema, {
					label: "Language",
					kind: "select",
					min: 1,
					values: [validConditionValue()],
				}),
			).toBe("min_on_non_multiselect");
		});

		it("accepts a boolean condition without values", () => {
			expect(
				registryConditionSchema.parse({
					label: "Enable CI",
					kind: "boolean",
				}),
			).toEqual({
				label: "Enable CI",
				kind: "boolean",
			});
		});

		it("rejects a boolean condition that declares values", () => {
			expect(
				rejectMessage(
					registryConditionSchema,
					validCondition({ kind: "boolean" }),
				),
			).toBe("boolean_with_values");
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

	describe("registryWhenSchema", () => {
		it("accepts string, string-array, and boolean matchers", () => {
			expect(
				registryWhenSchema.parse({
					language: "typescript",
					packageManager: ["npm", "pnpm"],
					ci: true,
				}),
			).toEqual({
				language: "typescript",
				packageManager: ["npm", "pnpm"],
				ci: true,
			});
		});
	});

	describe("registryPackSchema", () => {
		it("accepts required fields and omits absent optional lists", () => {
			expect(registryPackSchema.parse(validPack())).toEqual({
				id: "typescript",
				title: "TypeScript",
				files: [validFile()],
			});
		});

		it("keeps non-empty when, dependencies, and dependsOn", () => {
			expect(
				registryPackSchema.parse(
					validPack({
						when: { language: "typescript" },
						dependencies: {
							npm: {
								runtime: ["react"],
								dev: ["typescript"],
							},
						},
						dependsOn: ["utils"],
					}),
				),
			).toEqual({
				id: "typescript",
				title: "TypeScript",
				files: [validFile()],
				when: { language: "typescript" },
				dependencies: {
					npm: {
						runtime: ["react"],
						dev: ["typescript"],
					},
				},
				dependsOn: ["utils"],
			});
		});

		it("omits empty when maps and empty dependency lists", () => {
			expect(
				registryPackSchema.parse(
					validPack({
						when: {},
						dependencies: {
							npm: {
								runtime: [],
								dev: [],
							},
						},
						dependsOn: [],
					}),
				),
			).toEqual({
				id: "typescript",
				title: "TypeScript",
				files: [validFile()],
			});
		});

		it("allows command-only packs without files", () => {
			expect(
				registryPackSchema.parse(
					validPack({
						files: undefined,
						commands: { npm: { test: "vitest run" } },
					}),
				),
			).toEqual({
				id: "typescript",
				title: "TypeScript",
				commands: { npm: { test: "vitest run" } },
			});
		});

		it("rejects an empty files list", () => {
			expect(
				registryPackSchema.safeParse(validPack({ files: [] })).success,
			).toBe(false);
		});

		it("rejects empty required strings, empty when values, and unknown keys", () => {
			expect(registryPackSchema.safeParse(validPack({ id: "" })).success).toBe(
				false,
			);
			expect(
				registryPackSchema.safeParse(validPack({ id: "a/b" })).success,
			).toBe(false);
			expect(
				registryPackSchema.safeParse(validPack({ id: ".." })).success,
			).toBe(false);
			expect(
				registryPackSchema.safeParse(validPack({ when: { language: "" } }))
					.success,
			).toBe(false);
			expect(
				registryPackSchema.safeParse(validPack({ extra: "nope" })).success,
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
				packs: [registryPackSchema.parse(validPack())],
			});
		});

		it("rejects duplicate pack ids", () => {
			expect(
				rejectMessage(
					registryItemSchema,
					validItem({
						packs: [
							validPack({ id: "default" }),
							validPack({ id: "default", title: "Also" }),
						],
					}),
				),
			).toBe("duplicate_pack:default");
		});

		it("keeps item-level files and non-empty dependency lists", () => {
			expect(
				registryItemSchema.parse(
					validItem({
						files: [validFile()],
						dependencies: {
							npm: {
								runtime: ["clsx"],
								dev: ["vitest"],
							},
						},
						dependsOn: ["utils"],
					}),
				),
			).toMatchObject({
				files: [validFile()],
				dependencies: {
					npm: {
						runtime: ["clsx"],
						dev: ["vitest"],
					},
				},
				dependsOn: ["utils"],
			});
		});

		it("omits empty dependency lists", () => {
			const parsed = registryItemSchema.parse(
				validItem({
					dependencies: {
						npm: {
							runtime: [],
							dev: [],
						},
					},
					dependsOn: [],
				}),
			);

			expect(parsed).not.toHaveProperty("files");
			expect(parsed).not.toHaveProperty("dependencies");
			expect(parsed).not.toHaveProperty("dependsOn");
		});

		it("accepts a pack-less item with top-level files", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			expect(
				registryItemSchema.parse({
					...withoutPacks,
					files: [validFile()],
				}),
			).toEqual({
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				files: [validFile()],
			});
		});

		it("rejects item-level when", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			expect(
				registryItemSchema.safeParse({
					...withoutPacks,
					files: [validFile()],
					when: { language: "typescript" },
				}).success,
			).toBe(false);
		});

		it("omits an empty packs list when files are present", () => {
			const parsed = registryItemSchema.parse(
				validItem({ packs: [], files: [validFile()] }),
			);

			expect(parsed).not.toHaveProperty("packs");
			expect(parsed.files).toEqual([validFile()]);
		});

		it("rejects an item with neither files, packs, nor install scripts", () => {
			expect(rejectMessage(registryItemSchema, validItem({ packs: [] }))).toBe(
				"missing_files_or_packs",
			);
		});

		it("accepts a script-only item without files or packs", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			expect(
				registryItemSchema.parse({
					...withoutPacks,
					beforeInstall: "handler.ts",
				}),
			).toEqual({
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				beforeInstall: ["handler.ts"],
			});
		});

		it("accepts afterInstall-only script items without beforeInstall", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			expect(
				registryItemSchema.parse({
					...withoutPacks,
					afterInstall: "cleanup.ts",
				}),
			).toEqual({
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				afterInstall: ["cleanup.ts"],
			});
		});

		it("rejects absolute, URL, and parent-escape install script paths", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			for (const script of [
				"/abs/handler.ts",
				"https://evil.example/h.js",
				"../evil.ts",
				"r\\x.ts",
			]) {
				expect(
					rejectMessage(registryItemSchema, {
						...withoutPacks,
						beforeInstall: script,
					}),
				).toBe(`invalid_script:${script}`);
			}
		});

		it("keeps requires and item-level conditions maps", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			expect(
				registryItemSchema.parse({
					...withoutPacks,
					beforeInstall: "handler.ts",
					requires: ["authorName"],
					conditions: {
						coverageThreshold: {
							kind: "text",
							label: "Coverage",
							optional: true,
						},
					},
				}),
			).toEqual({
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				beforeInstall: ["handler.ts"],
				requires: ["authorName"],
				conditions: {
					coverageThreshold: {
						kind: "text",
						label: "Coverage",
						optional: true,
					},
				},
			});
			expect(
				registryItemSchema.safeParse({
					...withoutPacks,
					beforeInstall: "handler.ts",
					conditions: ["authorName"],
				}).success,
			).toBe(false);
		});

		it("rejects a key listed in both requires and local conditions", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			expect(
				rejectMessage(registryItemSchema, {
					...withoutPacks,
					beforeInstall: "handler.ts",
					requires: ["coverageThreshold"],
					conditions: {
						coverageThreshold: { kind: "text", label: "Coverage" },
					},
				}),
			).toBe("requires_and_local:coverageThreshold");
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

		it("keeps beforeInstall and afterInstall scripts and rejects duplicates", () => {
			const { packs: _packs, ...withoutPacks } = validItem();
			expect(
				registryItemSchema.parse({
					...withoutPacks,
					files: [validFile()],
					beforeInstall: ["handler.ts"],
					afterInstall: ["./commit.ts"],
					dependsOn: ["shared"],
				}),
			).toMatchObject({
				beforeInstall: ["handler.ts"],
				afterInstall: ["./commit.ts"],
				dependsOn: ["shared"],
			});
			expect(
				rejectMessage(
					registryItemSchema,
					validItem({
						files: [validFile()],
						packs: [],
						beforeInstall: ["handler.ts", "handler.ts"],
					}),
				),
			).toBe("duplicate_hook:beforeInstall:handler.ts");
		});
	});

	describe("catalogPackSchema", () => {
		it("accepts an index pack with a payload source", () => {
			expect(
				catalogPackSchema.parse({
					id: "typescript",
					title: "TypeScript",
					source: "r/button/typescript.json",
				}),
			).toEqual({
				id: "typescript",
				title: "TypeScript",
				source: "r/button/typescript.json",
			});
		});

		it("keeps when and dependsOn and rejects files", () => {
			expect(
				catalogPackSchema.parse({
					id: "typescript",
					title: "TypeScript",
					source: "r/button/typescript.json",
					when: { language: "typescript" },
					dependsOn: ["utils"],
				}),
			).toMatchObject({
				when: { language: "typescript" },
				dependsOn: ["utils"],
			});

			expect(
				catalogPackSchema.safeParse({
					id: "typescript",
					title: "TypeScript",
					source: "r/button/typescript.json",
					files: [{ source: "a.txt", target: "a.txt" }],
				}).success,
			).toBe(false);
		});
	});

	describe("catalogItemSchema", () => {
		it("accepts a pack index without an item id", () => {
			expect(
				catalogItemSchema.parse({
					title: "Button",
					description: "A button",
					type: "component",
					packs: [
						{
							id: "typescript",
							title: "TypeScript",
							source: "r/button/typescript.json",
						},
					],
				}),
			).toEqual({
				title: "Button",
				description: "A button",
				type: "component",
				packs: [
					{
						id: "typescript",
						title: "TypeScript",
						source: "r/button/typescript.json",
					},
				],
			});
		});

		it("accepts a pack-less item with a payload source", () => {
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

		it("accepts item-local select values that do not declare bindings", () => {
			expect(
				catalogItemSchema.parse({
					title: "Testing",
					description: "Tests",
					type: "configuration",
					source: "r/testing.json",
					conditions: {
						language: {
							kind: "select",
							label: "Language",
							values: [{ value: "typescript", label: "TypeScript" }],
						},
					},
				}).conditions,
			).toEqual({
				language: {
					kind: "select",
					label: "Language",
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			});
		});

		it("rejects item-local option bindings that reuse the condition key", () => {
			expect(
				rejectMessage(catalogItemSchema, {
					title: "Testing",
					description: "Tests",
					type: "configuration",
					source: "r/testing.json",
					conditions: {
						packageManager: {
							label: "Package manager",
							kind: "select",
							values: [
								{
									value: "pnpm",
									label: "pnpm",
									bindings: { packageManager: "pnpm" },
								},
							],
						},
					},
				}),
			).toBe("binding_parent_key:packageManager");
		});

		it("rejects an item with neither source, packs, nor install scripts", () => {
			expect(
				rejectMessage(catalogItemSchema, {
					title: "Button",
					description: "A button",
					type: "component",
				}),
			).toBe("missing_source_or_packs");
		});

		it("accepts a script-only catalog item", () => {
			expect(
				catalogItemSchema.parse({
					title: "License",
					description: "SPDX license",
					type: "configuration",
					beforeInstall: ["r/license-configuration.beforeInstall.0.js"],
					requires: ["authorName"],
				}),
			).toEqual({
				title: "License",
				description: "SPDX license",
				type: "configuration",
				beforeInstall: ["r/license-configuration.beforeInstall.0.js"],
				requires: ["authorName"],
			});
		});

		it("accepts afterInstall-only catalog items", () => {
			expect(
				catalogItemSchema.parse({
					title: "Cleanup",
					description: "Post-install cleanup",
					type: "configuration",
					afterInstall: ["r/cleanup.afterInstall.0.js"],
				}),
			).toEqual({
				title: "Cleanup",
				description: "Post-install cleanup",
				type: "configuration",
				afterInstall: ["r/cleanup.afterInstall.0.js"],
			});
		});

		it("accepts an item that declares source together with packs", () => {
			expect(
				catalogItemSchema.parse({
					title: "Button",
					description: "A button",
					type: "component",
					source: "r/button.json",
					packs: [
						{
							id: "typescript",
							title: "TypeScript",
							source: "r/button/typescript.json",
						},
					],
				}),
			).toEqual({
				title: "Button",
				description: "A button",
				type: "component",
				source: "r/button.json",
				packs: [
					{
						id: "typescript",
						title: "TypeScript",
						source: "r/button/typescript.json",
					},
				],
			});
		});

		it("rejects duplicate pack ids and unknown keys including id", () => {
			expect(
				rejectMessage(catalogItemSchema, {
					title: "Button",
					description: "A button",
					type: "component",
					packs: [
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
			).toBe("duplicate_pack:default");

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
