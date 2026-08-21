import { describe, expect, it } from "vitest";
import {
	getBooleanOption,
	parseMultiValueOption,
	pickStringOptions,
} from "./options";

describe("cli/options", () => {
	describe("pickStringOptions", () => {
		it("returns only present non-empty string options", () => {
			expect(
				pickStringOptions(
					{ type: "component", framework: "  ", lang: "typescript" },
					["type", "framework", "lang"],
				),
			).toEqual({
				type: "component",
				lang: "typescript",
			});
		});

		it("trims whitespace from string values", () => {
			expect(pickStringOptions({ type: " component " }, ["type"])).toEqual({
				type: "component",
			});
		});

		it("ignores missing, blank, or non-string values", () => {
			expect(Object.keys(pickStringOptions({}, ["type"]))).toEqual([]);
			expect(
				Object.hasOwn(pickStringOptions({ type: "   " }, ["type"]), "type"),
			).toBe(false);
			expect(pickStringOptions({ type: 1 }, ["type"])).toEqual({});
		});
	});

	describe("getBooleanOption", () => {
		it("returns true only when the flag is explicitly true", () => {
			expect(getBooleanOption({ overwrite: true }, "overwrite")).toBe(true);
			expect(getBooleanOption({ overwrite: false }, "overwrite")).toBe(false);
			expect(getBooleanOption({}, "overwrite")).toBe(false);
		});
	});

	describe("parseMultiValueOption", () => {
		it("splits comma-separated values and trims whitespace", () => {
			expect(parseMultiValueOption("component, template ,workflow")).toEqual([
				"component",
				"template",
				"workflow",
			]);
		});

		it("returns an empty array for blank input", () => {
			expect(parseMultiValueOption("  ,  , ")).toEqual([]);
		});
	});
});
