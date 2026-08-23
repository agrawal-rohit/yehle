import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	assertSafeRemoteUrl,
	isAbsoluteHttpUrl,
	joinCatalogSource,
	joinRelativePathUnderRoot,
	publishedRegistryUrl,
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
		expect(isAbsoluteHttpUrl("prefixhttps://example.com/file.ts")).toBe(false);
	});
});

describe("assertSafeRemoteUrl", () => {
	it("accepts a public HTTPS hostname", () => {
		expect(() =>
			assertSafeRemoteUrl(new URL("https://example.com/registry.json")),
		).not.toThrow();
	});

	it("rejects non-HTTPS protocols", () => {
		expect(() =>
			assertSafeRemoteUrl(new URL("http://example.com/registry.json")),
		).toThrow("Remote registries must use HTTPS.");
	});

	it("rejects credentials in the URL", () => {
		expect(() =>
			assertSafeRemoteUrl(
				new URL("https://user:secret@example.com/registry.json"),
			),
		).toThrow("Remote registries must not include credentials.");
		expect(() =>
			assertSafeRemoteUrl(new URL("https://user@example.com/registry.json")),
		).toThrow("Remote registries must not include credentials.");
		expect(() =>
			assertSafeRemoteUrl(new URL("https://:secret@example.com/registry.json")),
		).toThrow("Remote registries must not include credentials.");
	});

	it("rejects localhost and .localhost hosts", () => {
		for (const location of [
			"https://localhost/registry.json",
			"https://localhost./registry.json",
			"https://registry.localhost/registry.json",
		]) {
			expect(() => assertSafeRemoteUrl(new URL(location))).toThrow(
				"Remote registries cannot target localhost.",
			);
		}
	});

	it("rejects literal IP hosts", () => {
		for (const location of [
			"https://127.0.0.1/registry.json",
			"https://[::1]/registry.json",
			"https://[2001:db8::1]/registry.json",
		]) {
			expect(() => assertSafeRemoteUrl(new URL(location))).toThrow(
				"Remote registries must use a hostname, not an IP address.",
			);
		}
	});

	it("does not treat bracket-like hostnames as IPv6 unless fully bracketed", () => {
		// Valid WHATWG URLs cannot end with a lone "]", so pass a URL-shaped object.
		expect(() =>
			assertSafeRemoteUrl({
				protocol: "https:",
				username: "",
				password: "",
				hostname: "example.com]",
			} as URL),
		).not.toThrow();
		expect(() =>
			assertSafeRemoteUrl({
				protocol: "https:",
				username: "",
				password: "",
				hostname: "[example.com",
			} as URL),
		).not.toThrow();
	});
});

describe("joinRelativePathUnderRoot", () => {
	it("joins a relative path under the root", () => {
		expect(
			joinRelativePathUnderRoot(
				"/tmp/root",
				"r/item.json",
				"Payload",
				"catalog directory",
			),
		).toBe(path.join("/tmp/root", "r/item.json"));
	});

	it("rejects empty, absolute, backslash, and escaping paths", () => {
		expect(() =>
			joinRelativePathUnderRoot(
				"/tmp/root",
				"  ",
				"Payload",
				"catalog directory",
			),
		).toThrow("Payload must not be empty.");
		expect(() =>
			joinRelativePathUnderRoot(
				"/tmp/root",
				"/etc/passwd",
				"Payload",
				"catalog directory",
			),
		).toThrow("must be a relative path under the catalog directory");
		expect(() =>
			joinRelativePathUnderRoot(
				"/tmp/root",
				"foo\\bar.txt",
				"Payload",
				"catalog directory",
			),
		).toThrow("must be a relative path under the catalog directory");
		expect(() =>
			joinRelativePathUnderRoot(
				"/tmp/root",
				"../secret.json",
				"Payload",
				"catalog directory",
			),
		).toThrow("must be a relative path under the catalog directory");
	});
});

describe("publishedRegistryUrl", () => {
	it("builds the release-tag catalog URL for a version", () => {
		expect(publishedRegistryUrl("1.2.3")).toBe(
			"https://raw.githubusercontent.com/agrawal-rohit/tuckshop/tuckshop@1.2.3/packages/registry/registry.json",
		);
	});
});

describe("joinCatalogSource", () => {
	it("passes absolute payload URLs through unchanged", () => {
		expect(
			joinCatalogSource(
				"https://example.com/registry.json",
				"https://cdn.example.com/payloads/button.json",
			),
		).toBe("https://cdn.example.com/payloads/button.json");
	});

	it("trims whitespace before treating a source as an absolute URL", () => {
		expect(
			joinCatalogSource(
				"/tmp/my-registry/registry.json",
				"  https://cdn.example.com/payloads/button.json  ",
			),
		).toBe("https://cdn.example.com/payloads/button.json");
	});

	it("joins relative payloads against an http(s) catalog URL", () => {
		expect(
			joinCatalogSource(
				"https://example.com/reg/registry.json",
				"r/button/react.json",
			),
		).toBe("https://example.com/reg/r/button/react.json");
	});

	it("joins relative payloads against a local catalog path", () => {
		const catalog = "/tmp/my-registry/registry.json";
		expect(joinCatalogSource(catalog, "r/button/react.json")).toBe(
			"/tmp/my-registry/r/button/react.json",
		);
	});

	it("rejects local path traversal", () => {
		expect(() =>
			joinCatalogSource("/tmp/my-registry/registry.json", "../secret.json"),
		).toThrow('Registry file source "../secret.json" must be a relative path');
	});

	it("rejects an empty file source", () => {
		expect(() =>
			joinCatalogSource("/tmp/my-registry/registry.json", "   "),
		).toThrow("Registry file source must not be empty.");
	});

	it("rejects an empty catalog location", () => {
		expect(() => joinCatalogSource("  ", "r/button/react.json")).toThrow(
			"Registry catalog location must not be empty.",
		);
	});

	it("rejects absolute local source paths", () => {
		expect(() =>
			joinCatalogSource("/tmp/my-registry/registry.json", "/etc/passwd"),
		).toThrow(
			'Registry file source "/etc/passwd" must be a relative path under the catalog directory.',
		);
	});

	it("rejects sources that escape the catalog directory after joining", () => {
		const relativeSpy = vi
			.spyOn(path, "relative")
			.mockReturnValueOnce("../escaped.json");

		try {
			expect(() =>
				joinCatalogSource(
					"/tmp/my-registry/registry.json",
					"r/button/react.json",
				),
			).toThrow(
				'Registry file source "r/button/react.json" escapes the catalog directory.',
			);
		} finally {
			relativeSpy.mockRestore();
		}
	});

	it("rejects sources whose joined relative path is absolute", () => {
		const relativeSpy = vi
			.spyOn(path, "relative")
			.mockReturnValueOnce("/absolute/escape.json");

		try {
			expect(() =>
				joinCatalogSource(
					"/tmp/my-registry/registry.json",
					"r/button/react.json",
				),
			).toThrow(
				'Registry file source "r/button/react.json" escapes the catalog directory.',
			);
		} finally {
			relativeSpy.mockRestore();
		}
	});
});
