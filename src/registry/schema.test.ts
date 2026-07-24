import { describe, expect, it } from "vitest";
import {
	getRegistryItemTypes,
	type Registry,
	RegistryItemType,
} from "./schema";

function makeRegistry(items: Registry["items"] = {}): Registry {
	return {
		version: "0.0.0",
		contentBaseUrl: "https://example.com",
		items,
	};
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
				"block-a": {
					id: "block-a",
					title: "Block A",
					description: "A block",
					type: RegistryItemType.BLOCK,
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
				"block",
				"component",
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
});
