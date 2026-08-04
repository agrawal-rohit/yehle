import { isIP } from "node:net";
import { type Registry, SCHEMA_VERSION } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLookup = vi.fn();
const mockResolveRegistrySource = vi.fn();
const mockLoadRegistry = vi.fn();
const mockParseRegistryDocument = vi.fn();
const actualIsIP = await vi
	.importActual<typeof import("node:net")>("node:net")
	.then((mod) => mod.isIP);

vi.mock("node:dns/promises", () => ({
	lookup: (hostname: string, options: unknown) => mockLookup(hostname, options),
}));

vi.mock("node:net", async () => {
	const actual = await vi.importActual<typeof import("node:net")>("node:net");
	return {
		...actual,
		isIP: vi.fn((address: string) => actual.isIP(address)),
	};
});

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		resolveRegistrySource: (options: unknown) =>
			mockResolveRegistrySource(options),
		loadRegistry: (location: string) => mockLoadRegistry(location),
		parseRegistryDocument: (raw: unknown) => mockParseRegistryDocument(raw),
	};
});

import { loadRuntimeRegistry } from "./registry-remote";

const sampleRegistry: Registry = {
	version: "1.0.0",
	schemaVersion: SCHEMA_VERSION,
	contentBaseUrl: "https://example.com/content",
	items: {},
};

const publicRegistryBody = JSON.stringify({
	version: "1.0.0",
	schemaVersion: SCHEMA_VERSION,
	contentBaseUrl: "https://example.com/content",
	items: {},
});

/**
 * Arrange a remote registry URL source for the next loadRuntimeRegistry call.
 * @param location - Absolute registry URL.
 */
function mockRemoteSource(location: string): void {
	mockResolveRegistrySource.mockResolvedValue({
		kind: "url",
		location,
	});
}

/**
 * Arrange a successful HTTPS fetch response.
 * @param overrides - Partial Response fields to override.
 */
function mockOkFetch(overrides: Partial<Response> = {}): void {
	vi.mocked(fetch).mockResolvedValue({
		ok: true,
		status: 200,
		statusText: "OK",
		headers: new Headers({ "content-length": "120" }),
		text: async () => publicRegistryBody,
		...overrides,
	} as Response);
}

describe("registry-remote", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isIP).mockImplementation((address) => actualIsIP(address));
		mockParseRegistryDocument.mockReturnValue(sampleRegistry);
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.restoreAllMocks();
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

	it("forwards flag and saved registry sources to resolveRegistrySource", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: "path",
			location: "/workspace/registry.json",
		});
		mockLoadRegistry.mockResolvedValue(sampleRegistry);

		await loadRuntimeRegistry(
			"https://example.com/flag-registry.json",
			"https://example.com/saved-registry.json",
		);

		expect(mockResolveRegistrySource).toHaveBeenCalledWith(
			expect.objectContaining({
				registry: "https://example.com/flag-registry.json",
				savedRegistry: "https://example.com/saved-registry.json",
			}),
		);
	});

	it("rejects private-network registry hosts", async () => {
		mockRemoteSource("https://registry.internal/registry.json");
		mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries cannot target private network hosts",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects each private IPv4 range as a literal host", async () => {
		for (const host of [
			"100.64.0.1",
			"169.254.1.1",
			"172.16.0.1",
			"192.168.0.1",
			"127.0.0.1",
		]) {
			mockRemoteSource(`https://${host}/registry.json`);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries cannot target private network hosts",
			);
			expect(mockLookup).not.toHaveBeenCalled();
			mockLookup.mockClear();
		}
	});

	it("allows near-miss public IPv4 hosts that sit outside private ranges", async () => {
		for (const host of [
			"100.63.0.1",
			"172.15.0.1",
			"172.32.0.1",
			"192.169.0.1",
		]) {
			mockRemoteSource(`https://${host}/near-miss-registry.json`);
			mockLookup.mockResolvedValue([{ address: host, family: 4 }]);
			mockOkFetch();

			await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
			expect(fetch).toHaveBeenCalled();
			vi.mocked(fetch).mockClear();
		}
	});

	it("rejects malformed IPv4 answers that pass a forged isIP check", async () => {
		vi.mocked(isIP).mockImplementation((address) => {
			if (address === "1.2.3" || address === "1.2.3.999") return 4;
			return actualIsIP(address);
		});

		for (const [label, address] of [
			["short", "1.2.3"],
			["out-of-range", "1.2.3.999"],
		] as const) {
			mockRemoteSource(`https://${label}.malformed.example/registry.json`);
			mockLookup.mockResolvedValue([{ address, family: 4 }]);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries cannot target private network hosts",
			);
			expect(fetch).not.toHaveBeenCalled();
			vi.mocked(fetch).mockClear();
		}
	});

	it("rejects IPv4-mapped IPv6 private addresses", async () => {
		mockRemoteSource("https://mapped.example/registry.json");
		mockLookup.mockResolvedValue([{ address: "::ffff:127.0.0.1", family: 6 }]);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries cannot target private network hosts",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects loopback IPv6 registry hosts", async () => {
		for (const address of ["::1", "::"]) {
			mockRemoteSource(
				`https://loopback-${address === "::" ? "unspecified" : "one"}.example/registry.json`,
			);
			mockLookup.mockResolvedValue([{ address, family: 6 }]);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries cannot target private network hosts",
			);
			expect(fetch).not.toHaveBeenCalled();
			vi.mocked(fetch).mockClear();
		}
	});

	it("rejects unique-local and link-local IPv6 registry hosts", async () => {
		for (const [hostLabel, address] of [
			["ula-fc", "fc00::1"],
			["ula-fd", "fd12:3456::1"],
			["link-local", "fe80::1"],
		] as const) {
			mockRemoteSource(`https://${hostLabel}.example/registry.json`);
			mockLookup.mockResolvedValue([{ address, family: 6 }]);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries cannot target private network hosts",
			);
			expect(fetch).not.toHaveBeenCalled();
			vi.mocked(fetch).mockClear();
		}
	});

	it("rejects literal private IP hosts without DNS lookup success paths", async () => {
		mockRemoteSource("https://0.0.0.0/registry.json");

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries cannot target private network hosts",
		);
		expect(mockLookup).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects non-HTTPS remote registries", async () => {
		mockRemoteSource("http://example.com/registry.json");

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries must use HTTPS.",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects remote registries that include credentials", async () => {
		for (const location of [
			"https://user:secret@example.com/registry.json",
			"https://user@example.com/registry.json",
			"https://:secret@example.com/registry.json",
		]) {
			mockRemoteSource(location);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries must not include credentials.",
			);
			expect(fetch).not.toHaveBeenCalled();
		}
	});

	it("rejects localhost remote registries", async () => {
		mockRemoteSource("https://localhost/registry.json");

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries cannot target localhost.",
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects hosts that resolve to zero addresses", async () => {
		mockRemoteSource("https://empty-dns.example/registry.json");
		mockLookup.mockResolvedValue([]);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			'Could not resolve registry host "empty-dns.example".',
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("treats non-IP DNS answers as non-private and continues fetching", async () => {
		mockRemoteSource("https://odd-dns.example/registry.json");
		mockLookup.mockResolvedValue([{ address: "not-an-ip", family: 0 }]);
		mockOkFetch();

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(fetch).toHaveBeenCalled();
	});

	it("fetches and validates remote registries over HTTPS", async () => {
		mockRemoteSource("https://example.com/registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		mockOkFetch();

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(mockParseRegistryDocument).toHaveBeenCalled();
	});

	it("returns a cached remote registry on subsequent loads", async () => {
		mockRemoteSource("https://example.com/cached-registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		mockOkFetch();

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(mockLookup).toHaveBeenCalledTimes(1);
	});

	it("rejects redirect responses from remote registries", async () => {
		mockRemoteSource("https://example.com/redirect-registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 302,
			statusText: "Found",
			headers: new Headers({ location: "https://example.com/other.json" }),
			text: async () => "",
		} as Response);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries must not redirect.",
		);
	});

	it("rejects failed remote registry HTTP responses", async () => {
		mockRemoteSource("https://example.com/missing-registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			headers: new Headers(),
			text: async () => "server error",
		} as Response);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Failed to fetch registry (500 Internal Server Error).",
		);
	});

	it("rejects remote registries whose content-length exceeds the size limit", async () => {
		mockRemoteSource("https://example.com/large-header-registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			headers: new Headers({ "content-length": String(1_000_001) }),
			text: async () => publicRegistryBody,
		} as Response);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry is too large.",
		);
	});

	it("rejects remote registries whose body exceeds the size limit", async () => {
		mockRemoteSource("https://example.com/large-body-registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			headers: new Headers(),
			text: async () => "x".repeat(1_000_001),
		} as Response);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry is too large.",
		);
	});

	it("rejects remote registries that return invalid JSON", async () => {
		mockRemoteSource("https://example.com/invalid-registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			headers: new Headers({ "content-length": "12" }),
			text: async () => "{not-json",
		} as Response);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry returned invalid JSON:",
		);
	});

	it("stringifies non-Error JSON parse failures from remote registries", async () => {
		mockRemoteSource("https://example.com/weird-json-registry.json");
		mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		mockOkFetch({
			headers: new Headers({ "content-length": "2" }),
			text: async () => "{}",
		});
		vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
			throw "not-an-error";
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry returned invalid JSON: not-an-error",
		);
	});
});
