import { describe, expect, it } from "vitest";
import { Language } from "./constants";

describe("core/constants", () => {
	it("defines supported languages", () => {
		expect(Language.TYPESCRIPT).toBe("typescript");
	});
});
