import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("chalk", () => ({
	default: {
		hex: () => (message: string) => `hex:${message}`,
		grey: (message: string) => `grey:${message}`,
		bgRed: (message: string) => `bgRed:${message}`,
	},
}));

import { dangerHighlight, defaultText, primaryText } from "./labels";

describe("cli/labels", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("primaryText", () => {
		it("applies the brand hex color", () => {
			expect(primaryText("hello")).toBe("hex:hello");
		});
	});

	describe("defaultText", () => {
		it("applies grey styling", () => {
			expect(defaultText("hello")).toBe("grey:hello");
		});
	});

	describe("dangerHighlight", () => {
		it("applies a red background", () => {
			expect(dangerHighlight("ERR")).toBe("bgRed:ERR");
		});
	});
});
