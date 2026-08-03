import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./schema";
import {
	parseRegistryDocument,
	parseRegistryItemTypes,
	validateRegistryItem,
} from "./validate";

describe("registry/validate", () => {
	it("parses a valid registry document", () => {
		const parsed = parseRegistryDocument({
			version: "1.2.3",
			schemaVersion: SCHEMA_VERSION,
			contentBaseUrl: "https://example.com/content/",
			conditions: {
				language: {
					label: "Language",
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			},
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
		});

		expect(parsed.contentBaseUrl).toBe("https://example.com/content");
		expect(parsed.items.button.type).toBe("component");
		expect(parsed.types).toEqual({
			component: { label: "Components" },
		});
	});

	it("rejects a future schema version", () => {
		expect(() =>
			parseRegistryDocument({
				version: "1.2.3",
				schemaVersion: SCHEMA_VERSION + 1,
				contentBaseUrl: "https://example.com/content",
				types: {
					component: { label: "Components" },
				},
				items: {},
			}),
		).toThrow(`Registry schema version ${SCHEMA_VERSION + 1} is newer`);
	});

	it("rejects malformed registry items", () => {
		expect(() =>
			parseRegistryDocument({
				version: "1.2.3",
				schemaVersion: SCHEMA_VERSION,
				contentBaseUrl: "https://example.com/content",
				types: {
					component: { label: "Components" },
				},
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
		const parsed = parseRegistryDocument({
			version: "1.2.3",
			schemaVersion: SCHEMA_VERSION,
			contentBaseUrl: "https://example.com/content",
			types: {
				component: {
					label: "Components",
					description: "Reusable UI primitives.",
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
		});

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
				version: "1.2.3",
				schemaVersion: SCHEMA_VERSION,
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
			parseRegistryDocument({
				version: "1.2.3",
				schemaVersion: SCHEMA_VERSION,
				contentBaseUrl: "https://example.com/content",
				types: {
					theme: { label: "Themes" },
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
			}),
		).toThrow(
			'Registry item "button" has undeclared type "component" (declared: theme).',
		);
	});
});
