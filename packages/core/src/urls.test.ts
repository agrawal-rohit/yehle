import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	isAbsoluteHttpUrl,
	normalizeOrigin,
	publishedRegistryUrl,
	resolveRegistryPayload,
} from "./urls";

describe("isAbsoluteHttpUrl", () => {
	it("accepts http and https URLs", () => {
		expect(isAbsoluteHttpUrl("https://example.com/file.ts")).toBe(true);
		expect(isAbsoluteHttpUrl("http://example.com/file.ts")).toBe(true);
		expect(isAbsoluteHttpUrl("HTTPS://EXAMPLE.COM/FILE.TS")).toBe(true);
	});

	it("rejects relative paths and non-http schemes", () => {
		expect(isAbsoluteHttpUrl("registry/file.ts")).toBe(false);
		expect(isAbsoluteHttpUrl("/absolute/path.ts")).toBe(false);
		expect(isAbsoluteHttpUrl("ftp://example.com/file.ts")).toBe(false);
	});
});

describe("normalizeOrigin", () => {
	it("strips trailing slashes", () => {
		expect(normalizeOrigin("https://example.com/content")).toBe(
			"https://example.com/content",
		);
		expect(normalizeOrigin("https://example.com/content/")).toBe(
			"https://example.com/content",
		);
		expect(normalizeOrigin("https://example.com/content///")).toBe(
			"https://example.com/content",
		);
	});
});

describe("publishedRegistryUrl", () => {
	it("builds the release-tag catalog URL for a version", () => {
		expect(publishedRegistryUrl("1.2.3")).toBe(
			"https://raw.githubusercontent.com/agrawal-rohit/tuckshop/tuckshop@1.2.3/packages/registry/registry.json",
		);
	});
});

describe("resolveRegistryPayload", () => {
	it("passes absolute payload URLs through unchanged", () => {
		expect(
			resolveRegistryPayload(
				"https://example.com/registry.json",
				"https://cdn.example.com/payloads/button.json",
			),
		).toBe("https://cdn.example.com/payloads/button.json");
	});

	it("resolves relative payloads against an http(s) catalog URL", () => {
		expect(
			resolveRegistryPayload(
				"https://example.com/reg/registry.json",
				"r/button/react.json",
			),
		).toBe("https://example.com/reg/r/button/react.json");
	});

	it("resolves relative payloads against a local catalog path", () => {
		const catalog = "/tmp/my-registry/registry.json";
		expect(resolveRegistryPayload(catalog, "r/button/react.json")).toBe(
			"/tmp/my-registry/r/button/react.json",
		);
	});

	it("rejects local path traversal", () => {
		expect(() =>
			resolveRegistryPayload(
				"/tmp/my-registry/registry.json",
				"../secret.json",
			),
		).toThrow('Registry payload "../secret.json" must be a relative path');
	});

	it("rejects an empty payload URI reference", () => {
		expect(() =>
			resolveRegistryPayload("/tmp/my-registry/registry.json", "   "),
		).toThrow("Registry payload URI reference must not be empty.");
	});

	it("rejects an empty catalog location", () => {
		expect(() => resolveRegistryPayload("  ", "r/button/react.json")).toThrow(
			"Registry catalog location must not be empty.",
		);
	});

	it("rejects absolute local payload paths", () => {
		expect(() =>
			resolveRegistryPayload("/tmp/my-registry/registry.json", "/etc/passwd"),
		).toThrow(
			'Registry payload "/etc/passwd" must be a relative path under the catalog directory.',
		);
	});

	it("rejects payloads that escape the catalog directory after resolution", () => {
		const relativeSpy = vi
			.spyOn(path, "relative")
			.mockReturnValueOnce("../escaped.json");

		try {
			expect(() =>
				resolveRegistryPayload(
					"/tmp/my-registry/registry.json",
					"r/button/react.json",
				),
			).toThrow(
				'Registry payload "r/button/react.json" escapes the catalog directory.',
			);
		} finally {
			relativeSpy.mockRestore();
		}
	});

	it("rejects payloads whose resolved relative path is absolute", () => {
		const relativeSpy = vi
			.spyOn(path, "relative")
			.mockReturnValueOnce("/absolute/escape.json");

		try {
			expect(() =>
				resolveRegistryPayload(
					"/tmp/my-registry/registry.json",
					"r/button/react.json",
				),
			).toThrow(
				'Registry payload "r/button/react.json" escapes the catalog directory.',
			);
		} finally {
			relativeSpy.mockRestore();
		}
	});
});
