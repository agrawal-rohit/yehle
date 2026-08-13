import { describe, expect, it } from "vitest";
import * as common from "./index";
import * as labels from "./labels";

describe("index", () => {
	it("re-exports all label helpers from labels", () => {
		expect(common.primaryText).toBe(labels.primaryText);
		expect(common.defaultText).toBe(labels.defaultText);
		expect(common.dangerHighlight).toBe(labels.dangerHighlight);
	});
});
