import { type Registry, SCHEMA_VERSION } from "@tuckshop/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLookup = vi.fn();
const mockResolveRegistrySource = vi.fn();
const mockLoadRegistry = vi.fn();
const mockParseRegistryDocument = vi.fn();

vi.mock("node:dns/promises", () => ({
	lookup: (...args: unknown[]) => mockLookup(...args),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		resolveRegistrySource: (...args: unknown[]) =>
			mockResolveRegistrySource(...args),
		loadRegistry: (...args: unknown[]) => mockLoadRegistry(...args),
		parseRegistryDocument: (...args: unknown[]) =>
			mockParseRegistryDocument(...args),
	};
});

import { loadRuntimeRegistry } from "./registry-remote";

const sampleRegistry: Registry = {
	version: "1.0.0",
	schemaVersion: SCHEMA_VERSION,
	contentBaseUrl: "https://example.com/content",
	items: {},
};

describe("registry-remote", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParseRegistryDocument.mockReturnValue(sampleRegistry);
		vi.stubGlobal("fetch", vi.fn());
	});

	it("loads local registry sources through @tuckshop/core", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: "path",
			location: "/workspace/registry.json",
		});
		mockLoadRegistry.mockResolvedValue(sampleRegistry);

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(mockLoadRegistry).toHaveBeenCalledWith("/workspace/registry.json");
	});

	it("rejects private-network registry hosts", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: "url",
			location: "https://registry.internal/registry.json",
		});
		mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries cannot target private network hosts",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects IPv4-mapped IPv6 private addresses", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: "url",
			location: "https://registry.internal/registry.json",
		});
		mockLookup.mockResolvedValue([{ address: "::ffff:127.0.0.1", family: 6 }]);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries cannot target private network hosts",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects literal private IP hosts without DNS lookup success paths", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: "url",
			location: "https://0.0.0.0/registry.json",
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries cannot target private network hosts",
		);
		expect(mockLookup).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("fetches and validates remote registries over HTTPS", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: "url",
			location: "https://example.com/registry.json",
		});
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			headers: new Headers({ "content-length": "120" }),
			text: async () =>
				JSON.stringify({
					version: "1.0.0",
					schemaVersion: SCHEMA_VERSION,
					contentBaseUrl: "https://example.com/content",
					items: {},
				}),
		} as Response);

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(mockParseRegistryDocument).toHaveBeenCalled();
	});
});
