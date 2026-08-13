import { beforeEach, describe, expect, it, vi } from "vitest";

const hexStyler = vi.fn((message: string) => `hex:${message}`);
const hex = vi.fn(() => hexStyler);
const grey = vi.fn((message: string) => `grey:${message}`);
const bgRed = vi.fn((message: string) => `bgRed:${message}`);

vi.mock("chalk", () => ({
	default: {
		hex: (...args: unknown[]) => hex(...args),
		grey: (...args: unknown[]) => grey(...args),
		bgRed: (...args: unknown[]) => bgRed(...args),
	},
}));

import { dangerHighlight, defaultText, primaryText } from "./labels";

describe("labels", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hex.mockImplementation(() => hexStyler);
		hexStyler.mockImplementation((message: string) => `hex:${message}`);
		grey.mockImplementation((message: string) => `grey:${message}`);
		bgRed.mockImplementation((message: string) => `bgRed:${message}`);
	});

	describe("primaryText", () => {
		it("styles the message with the brand hex color", () => {
			expect(primaryText("hello")).toBe("hex:hello");
			expect(hex).toHaveBeenCalledWith("#DFAD8D");
			expect(hexStyler).toHaveBeenCalledWith("hello");
		});
	});

	describe("defaultText", () => {
		it("styles the message as muted grey", () => {
			expect(defaultText("hello")).toBe("grey:hello");
			expect(grey).toHaveBeenCalledWith("hello");
		});
	});

	describe("dangerHighlight", () => {
		it("highlights the message with a red background", () => {
			expect(dangerHighlight("ERR")).toBe("bgRed:ERR");
			expect(bgRed).toHaveBeenCalledWith("ERR");
		});
	});
});
