import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("package entry", () => {
	it("re-exports the public core API", () => {
		expect(core.RegistryConditionInference).toBeDefined();
		expect(typeof core.isRegularFileAsync).toBe("function");
		expect(typeof core.readJSONFileAsync).toBe("function");
		expect(typeof core.primaryText).toBe("function");
		expect(typeof core.defaultText).toBe("function");
		expect(typeof core.dangerHighlight).toBe("function");
		expect(typeof core.parseRegistryDocument).toBe("function");
		expect(typeof core.parseWithSchema).toBe("function");
	});
});
