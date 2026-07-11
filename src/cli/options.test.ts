import { describe, expect, it } from "vitest";
import {
	getBooleanOption,
	getStringOption,
	parseMultiValueOption,
	pickStringOptions,
} from "./options";

describe("cli/options", () => {
	describe("getStringOption", () => {
		it("returns a trimmed string when present", () => {
			expect(getStringOption({ type: " component " }, "type")).toBe(
				"component",
			);
		});

		it("returns undefined when missing, blank, or not a string", () => {
			expect(getStringOption({}, "type")).toBeUndefined();
			expect(getStringOption({ type: "   " }, "type")).toBeUndefined();
			expect(getStringOption({ type: 1 }, "type")).toBeUndefined();
		});
	});

	describe("getBooleanOption", () => {
		it("returns true only when the flag is explicitly true", () => {
			expect(getBooleanOption({ all: true }, "all")).toBe(true);
			expect(getBooleanOption({ all: false }, "all")).toBe(false);
			expect(getBooleanOption({}, "all")).toBe(false);
		});
	});

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
