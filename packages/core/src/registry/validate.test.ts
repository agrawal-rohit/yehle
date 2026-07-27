import { describe, expect, it } from "vitest";
import { RegistryItemType, SCHEMA_VERSION } from "./schema";
import { parseRegistryDocument, validateRegistryItem } from "./validate";

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
			items: {
				button: {
					id: "button",
					title: "Button",
					description: "A button",
					type: RegistryItemType.COMPONENT,
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
	});

	it("rejects a future schema version", () => {
		expect(() =>
			parseRegistryDocument({
				version: "1.2.3",
				schemaVersion: SCHEMA_VERSION + 1,
				contentBaseUrl: "https://example.com/content",
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
});
