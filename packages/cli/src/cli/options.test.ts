import { describe, expect, it } from "vitest";
import { parseMultiValueOption, pickStringOptions } from "./options";

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
			expect(pickStringOptions({}, ["type"])).toEqual({});
			expect(pickStringOptions({ type: "   " }, ["type"])).toEqual({});
			expect(pickStringOptions({ type: 1 }, ["type"])).toEqual({});
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
