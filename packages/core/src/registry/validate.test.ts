import { describe, expect, it } from "vitest";
import {
	parseRegistryDocument,
	parseRegistryItemTypes,
	validateRegistryItem,
} from "./validate";

/** Minimal valid registry document for parseRegistryDocument tests. */
function validDocument(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		contentBaseUrl: "https://example.com/content/",
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
								source: "registry/component/button/react/button.tsx",
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

describe("registry/validate", () => {
	it("parses a valid registry document", () => {
		const parsed = parseRegistryDocument(
			validDocument({
				contentBaseUrl: "https://example.com/content/",
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
										source: "registry/component/button/react/button.tsx",
										target: "src/components/ui/button.tsx",
									},
								],
							},
						],
					},
				},
			}),
		);

		expect(parsed.contentBaseUrl).toBe("https://example.com/content");
		expect(parsed.items.button.type).toBe("component");
		expect(parsed.types).toEqual({
			component: { label: "Components" },
		});
	});

	it("rejects malformed registry items", () => {
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
			'Registry items["button"].variants must declare at least one variant.',
		);
	});

	it("accepts unknown custom item types", () => {
		expect(
			validateRegistryItem({
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
			}),
		).toMatchObject({
			id: "legacy-item",
			type: "legacy",
		});
	});

	describe("unknown keys", () => {
		it("rejects an unknown top-level key", () => {
			expect(() =>
				parseRegistryDocument(validDocument({ version: "1.2.3" })),
			).toThrow("Registry has unknown key(s): version.");
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
												source: "a.tsx",
												target: "a.tsx",
											},
										],
									},
								],
							},
						},
					}),
				),
			).toThrow('Registry items["button"] has unknown key(s): typo.');
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
												source: "a.tsx",
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
				'Registry items["button"].variants[0] has unknown key(s): extra.',
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
				'Registry condition "language" has unknown key(s): unknownField.',
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
			).toThrow('Registry type "component" has unknown key(s): bogus.');
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
			).toThrow(
				'"Registry type "component" label" must be a non-empty string.',
			);
		});

		it("rejects an empty label", () => {
			expect(() =>
				parseRegistryItemTypes({
					component: { label: "" },
				}),
			).toThrow(
				'"Registry type "component" label" must be a non-empty string.',
			);
		});
	});

	it("round-trips types through parseRegistryDocument", () => {
		const parsed = parseRegistryDocument(
			validDocument({
				contentBaseUrl: "https://example.com/content",
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
				contentBaseUrl: "https://example.com/content",
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
										source: "registry/component/button/react/button.tsx",
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
});
