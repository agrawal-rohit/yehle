import { describe, expect, it } from "vitest";
import { toSlug } from "./utils";

describe("core/utils", () => {
	describe("toSlug", () => {
		it("converts a simple name to a slug", () => {
			expect(toSlug("My Package")).toBe("my-package");
		});

		it("normalizes case and trims whitespace", () => {
			expect(toSlug("  My-Package  ")).toBe("my-package");
		});

		it("keeps dots and underscores", () => {
			expect(toSlug("My.package_name")).toBe("my.package_name");
		});

		it("replaces invalid characters with hyphens", () => {
			expect(toSlug("my@pkg!name?")).toBe("my-pkg-name");
		});

		it("collapses multiple separators into a single hyphen", () => {
			expect(toSlug("my   pkg   name")).toBe("my-pkg-name");
			expect(toSlug("my---pkg---name")).toBe("my-pkg-name");
		});

		it("trims leading and trailing hyphens", () => {
			expect(toSlug("---my-pkg-name---")).toBe("my-pkg-name");
		});

		it("handles npm scoped packages", () => {
			expect(toSlug("@scope/name")).toBe("name");
			expect(toSlug("@scope/complex-name")).toBe("complex-name");
		});

		it("handles repository-like URLs", () => {
			expect(toSlug("https://github.com/user/my-package")).toBe("my-package");
			expect(toSlug("git@github.com:user/my-package.git")).toBe("my-package");
		});

		it("handles Windows-style paths", () => {
			expect(toSlug(String.raw`C:\Users\me\my-package`)).toBe("my-package");
		});

		it("handles values that normalize to empty segments", () => {
			expect(toSlug("   ")).toBe("");
			expect(toSlug("///")).toBe("");
		});
	});
});
