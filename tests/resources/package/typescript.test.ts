import { describe, expect, it } from "vitest";
import { validateTypescriptPackageName } from "../../../src/resources/package/typescript";

describe("validateTypescriptPackageName", () => {
	it("should return true for a simple valid package name", () => {
		const result = validateTypescriptPackageName("my-package");
		expect(result).toBe(true);
	});

	it("should return true for a valid package name with multiple hyphens", () => {
		const result = validateTypescriptPackageName("my-super-package");
		expect(result).toBe(true);
	});

	it("should return true for a valid scoped package name", () => {
		const result = validateTypescriptPackageName("@scope/my-package");
		expect(result).toBe(true);
	});

	it("should return an error string for a package name with spaces", () => {
		const result = validateTypescriptPackageName("my package");
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^Invalid package name:/);
	});

	it("should return an error string for a package name starting with a dot", () => {
		const result = validateTypescriptPackageName(".my-package");
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^Invalid package name:/);
	});

	it("should return an error string for a package name with uppercase letters", () => {
		const result = validateTypescriptPackageName("My-Package");
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^Invalid package name:/);
	});

	it("should return an error string for an empty string", () => {
		const result = validateTypescriptPackageName("");
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^Invalid package name:/);
	});

	it("should return an error string for a package name with special characters", () => {
		const result = validateTypescriptPackageName("my@package");
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^Invalid package name:/);
	});
});
