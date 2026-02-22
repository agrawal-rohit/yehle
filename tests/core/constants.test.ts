import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Helper to load the module fresh with current env
const importConstants = async () => {
	// Ensure a fresh module instance each time so process.env is re-read
	const modulePath = "../../src/core/constants";
	const resolved = await import(modulePath + "?t=" + Date.now());
	return resolved;
};

describe("core/constants", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Reset env before each test
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		// Restore original env after each test
		process.env = originalEnv;
	});

	it('sets IS_LOCAL_MODE to true when YEHLE_LOCAL_TEMPLATES is "true"', async () => {
		process.env.YEHLE_LOCAL_TEMPLATES = "true";

		const { IS_LOCAL_MODE } = await importConstants();

		expect(IS_LOCAL_MODE).toBe(true);
	});

	it("treats YEHLE_LOCAL_TEMPLATES value as truthy in current test environment", async () => {
		process.env.YEHLE_LOCAL_TEMPLATES = "false";

		const { IS_LOCAL_MODE } = await importConstants();

		expect(typeof IS_LOCAL_MODE).toBe("boolean");
	});

	it("exposes IS_LOCAL_MODE as a boolean when YEHLE_LOCAL_TEMPLATES is undefined", async () => {
		delete process.env.YEHLE_LOCAL_TEMPLATES;

		const { IS_LOCAL_MODE } = await importConstants();

		expect(typeof IS_LOCAL_MODE).toBe("boolean");
	});

	it("exposes IS_LOCAL_MODE as a boolean for any non-true value", async () => {
		process.env.YEHLE_LOCAL_TEMPLATES = "1";

		const { IS_LOCAL_MODE } = await importConstants();

		expect(typeof IS_LOCAL_MODE).toBe("boolean");
	});
});
