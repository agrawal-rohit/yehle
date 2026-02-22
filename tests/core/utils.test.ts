import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	capitalizeFirstLetter,
	sleep,
	toSlug,
	truncate,
} from "../../src/core/utils";

describe("core/utils", () => {
	describe("capitalizeFirstLetter", () => {
		it("capitalizes the first letter of a simple word", () => {
			expect(capitalizeFirstLetter("hello")).toBe("Hello");
		});

		it("leaves an already-capitalized first letter unchanged", () => {
			expect(capitalizeFirstLetter("Hello")).toBe("Hello");
		});

		it("handles single-character strings", () => {
			expect(capitalizeFirstLetter("h")).toBe("H");
			expect(capitalizeFirstLetter("H")).toBe("H");
		});

		it("does not alter other characters in the string", () => {
			expect(capitalizeFirstLetter("hELLO world")).toBe("HELLO world");
		});

		it("handles non-alphabetic first characters", () => {
			expect(capitalizeFirstLetter("1hello")).toBe("1hello");
			expect(capitalizeFirstLetter("_hello")).toBe("_hello");
		});
	});

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
			expect(toSlug("C:\\Users\\me\\my-package")).toBe("my-package");
		});

		it("handles values that normalize to empty segments", () => {
			expect(toSlug("   ")).toBe("");
			expect(toSlug("///")).toBe("");
		});
	});

	describe("sleep", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it("resolves after approximately the requested time using real timers", async () => {
			const ms = 50;
			const start = Date.now();
			await sleep(ms);
			const end = Date.now();
			expect(end - start).toBeGreaterThanOrEqual(ms - 10);
		});

		it("can be used with fake timers and advances when timers run", async () => {
			vi.useFakeTimers();

			const promise = sleep(100);

			// Should not resolve before timers advance
			let resolved = false;
			promise.then(() => {
				resolved = true;
			});

			expect(resolved).toBe(false);

			vi.advanceTimersByTime(100);

			await promise;
			expect(resolved).toBe(true);
		});
	});

	describe("truncate", () => {
		it("returns the original string when length is within max", () => {
			expect(truncate("hello", 10)).toBe("hello");
			expect(truncate("hello", 5)).toBe("hello");
		});

		it("truncates and appends ellipsis when longer than max", () => {
			expect(truncate("hello world", 8)).toBe("hello...");
			expect(truncate("hello world", 6)).toBe("hel...");
		});

		it("returns only ellipsis when max is 3", () => {
			expect(truncate("hello world", 3)).toBe("...");
		});

		it("handles very small max values", () => {
			expect(truncate("hello", 2)).toBe("...");
			expect(truncate("hello", 0)).toBe("...");
		});

		it("respects visible length when ANSI codes are present", () => {
			const colored = "\u001b[31mhello world\u001b[0m";
			const result = truncate(colored, 8);
			expect(result).toBe("hello...");
		});

		it("does not modify already short ANSI strings", () => {
			const colored = "\u001b[32mok\u001b[0m";
			expect(truncate(colored, 5)).toBe(colored);
		});
	});
});
