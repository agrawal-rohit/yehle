import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("package entry", () => {
	it("re-exports the public core API", () => {
		expect(core.SCHEMA_VERSION).toBe(1);
		expect(core.RegistryConditionInference).toBeDefined();
		expect(typeof core.isRegularFileAsync).toBe("function");
		expect(typeof core.readJSONFileAsync).toBe("function");
		expect(typeof core.writeFileAsync).toBe("function");
		expect(typeof core.buildRegistry).toBe("function");
		expect(typeof core.resolveRegistrySource).toBe("function");
		expect(typeof core.loadRegistry).toBe("function");
		expect(typeof core.parseRegistryDocument).toBe("function");
		expect(typeof core.validateRegistryItem).toBe("function");
		expect(typeof core.parseRegistryConditions).toBe("function");
		expect(typeof core.parseRegistryItemTypes).toBe("function");
	});
});
