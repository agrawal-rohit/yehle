import type { Registry } from "@tuckshop/core";
import { InvalidJsonError } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLocateRegistry = vi.fn();
const mockReadJsonFileAsync = vi.fn();
const mockParseRegistryDocument = vi.fn();
const mockFetch = vi.fn();

vi.mock("./source", () => ({
	locateRegistry: (options: unknown) => mockLocateRegistry(options),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		readJsonFileAsync: (location: string, label: string) =>
			mockReadJsonFileAsync(location, label),
		parseRegistryDocument: (raw: unknown) => mockParseRegistryDocument(raw),
	};
});

import { loadRegistryPayloads, loadRuntimeRegistry } from "./load";

const sampleRegistry: Registry = {
	types: {},
	items: {},
};

const publicRegistryBody = JSON.stringify({
	types: {},
	items: {},
});

/**
 * Arrange a remote registry URL source for the next loadRuntimeRegistry call.
 * @param location - Absolute registry URL.
 */
function mockRemoteSource(location: string): void {
	mockLocateRegistry.mockResolvedValue(location);
}

interface MockFetchOptions {
	status?: number;
	statusText?: string;
	headers?: Record<string, string>;
	body?: string | Buffer;
	/** Reject the fetch promise instead of returning a Response. */
	rejectWith?: Error;
}

/**
 * Arrange global fetch to return a Response (or reject).
 * @param response - Fake response fields.
 */
function mockFetchOk(response: MockFetchOptions = {}): void {
	mockFetch.mockImplementation(async () => {
		if (response.rejectWith) throw response.rejectWith;

		const body = response.body ?? publicRegistryBody;
		const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
		const headers = new Headers(
			response.headers ?? {
				"content-length": String(bytes.length),
			},
		);

		// Response BodyInit accepts Uint8Array; Node Buffer is not in the DOM typings.
		return new Response(new Uint8Array(bytes), {
			status: response.status ?? 200,
			statusText: response.statusText ?? "OK",
			headers,
		});
	});
}

describe("registry/load", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", mockFetch);
		mockParseRegistryDocument.mockReturnValue(sampleRegistry);
		mockFetchOk();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("loads local registry sources from disk", async () => {
		mockLocateRegistry.mockResolvedValue("/workspace/registry.json");
		mockReadJsonFileAsync.mockResolvedValue(sampleRegistry);

		await expect(loadRuntimeRegistry()).resolves.toEqual({
			registry: sampleRegistry,
			catalogLocation: "/workspace/registry.json",
		});
		expect(mockReadJsonFileAsync).toHaveBeenCalledWith(
			"/workspace/registry.json",
			"registry at /workspace/registry.json",
		);
		expect(mockParseRegistryDocument).toHaveBeenCalledWith(sampleRegistry);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("forwards flag and saved registry sources to locateRegistry", async () => {
		mockLocateRegistry.mockResolvedValue("/workspace/registry.json");
		mockReadJsonFileAsync.mockResolvedValue(sampleRegistry);

		await loadRuntimeRegistry(
			"https://example.com/flag-registry.json",
			"https://example.com/saved-registry.json",
		);

		expect(mockLocateRegistry).toHaveBeenCalledWith(
			expect.objectContaining({
				registry: "https://example.com/flag-registry.json",
				savedRegistry: "https://example.com/saved-registry.json",
			}),
		);
	});

	it("rejects non-HTTPS remote registries", async () => {
		mockRemoteSource("http://example.com/registry.json");

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries must use HTTPS.",
		);
		expect(mockFetch).not.toHaveBeenCalled();
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
			expect(mockFetch).not.toHaveBeenCalled();
		}
	});

	it("rejects localhost remote registries including trailing-dot and .localhost", async () => {
		for (const location of [
			"https://localhost/registry.json",
			"https://localhost./registry.json",
			"https://registry.localhost/registry.json",
		]) {
			mockRemoteSource(location);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries cannot target localhost.",
			);
			expect(mockFetch).not.toHaveBeenCalled();
		}
	});

	it("rejects literal IPv4 registry hosts", async () => {
		for (const host of ["127.0.0.1", "93.184.216.34", "192.168.0.1"]) {
			mockRemoteSource(`https://${host}/registry.json`);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries must use a hostname, not an IP address.",
			);
			expect(mockFetch).not.toHaveBeenCalled();
		}
	});

	it("rejects literal IPv6 registry hosts", async () => {
		for (const host of ["[::1]", "[2001:db8::1]", "[::ffff:127.0.0.1]"]) {
			mockRemoteSource(`https://${host}/registry.json`);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries must use a hostname, not an IP address.",
			);
			expect(mockFetch).not.toHaveBeenCalled();
		}
	});

	it("fetches and validates remote registries over HTTPS", async () => {
		mockRemoteSource("https://example.com/registry.json");
		mockFetchOk();

		await expect(loadRuntimeRegistry()).resolves.toEqual({
			registry: sampleRegistry,
			catalogLocation: "https://example.com/registry.json",
		});
		expect(mockParseRegistryDocument).toHaveBeenCalled();
		expect(mockFetch).toHaveBeenCalledWith(
			expect.any(URL),
			expect.objectContaining({
				method: "GET",
				redirect: "error",
				headers: { accept: "application/json" },
			}),
		);
	});

	it("rejects redirect responses from remote registries", async () => {
		mockRemoteSource("https://example.com/redirect-registry.json");
		const redirectError = new TypeError(
			"fetch failed: redirect mode is set to error",
		);
		mockFetchOk({ rejectWith: redirectError });

		await expect(loadRuntimeRegistry()).rejects.toMatchObject({
			message: "Remote registries must not redirect.",
			cause: redirectError,
		});
	});

	it("rejects failed remote registry HTTP responses", async () => {
		mockRemoteSource("https://example.com/missing-registry.json");
		mockFetchOk({
			status: 500,
			statusText: "Internal Server Error",
			headers: {},
			body: "server error",
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Failed to fetch registry (500 Internal Server Error).",
		);
	});

	it("accepts Buffer bodies when reading a remote registry", async () => {
		mockRemoteSource("https://example.com/buffer-registry.json");
		mockFetchOk({
			headers: {},
			body: Buffer.from(publicRegistryBody),
		});

		await expect(loadRuntimeRegistry()).resolves.toEqual({
			registry: sampleRegistry,
			catalogLocation: "https://example.com/buffer-registry.json",
		});
	});

	it("rejects remote registries whose content-length exceeds the size limit", async () => {
		mockRemoteSource("https://example.com/large-header-registry.json");
		mockFetchOk({
			headers: { "content-length": String(5_000_001) },
			body: publicRegistryBody,
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry is too large.",
		);
	});

	it("accepts remote registries whose content-length equals the size limit", async () => {
		mockRemoteSource("https://example.com/exact-header-registry.json");
		mockFetchOk({
			headers: { "content-length": String(5_000_000) },
			body: publicRegistryBody,
		});

		await expect(loadRuntimeRegistry()).resolves.toEqual({
			registry: sampleRegistry,
			catalogLocation: "https://example.com/exact-header-registry.json",
		});
	});

	it("rejects remote registries whose body exceeds the size limit", async () => {
		mockRemoteSource("https://example.com/large-body-registry.json");
		mockFetchOk({
			headers: {},
			body: "x".repeat(5_000_001),
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry is too large.",
		);
	});

	it("accepts remote registries whose body length equals the size limit", async () => {
		const exactBody = "x".repeat(5_000_000);
		mockRemoteSource("https://example.com/exact-body-registry.json");
		mockFetchOk({
			headers: {},
			body: exactBody,
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry returned invalid JSON:",
		);
	});

	it("rejects remote registries that return invalid JSON", async () => {
		mockRemoteSource("https://example.com/invalid-registry.json");
		mockFetchOk({
			headers: { "content-length": "12" },
			body: "{not-json",
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry returned invalid JSON:",
		);
	});

	it("stringifies non-Error JSON parse failures from remote registries", async () => {
		mockRemoteSource("https://example.com/weird-json-registry.json");
		mockFetchOk({
			headers: { "content-length": "2" },
			body: "{}",
		});
		vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
			throw "not-an-error";
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry returned invalid JSON: not-an-error",
		);
	});

	it("maps request timeouts to an actionable error", async () => {
		mockRemoteSource("https://example.com/slow-registry.json");
		const timeout = new Error("The operation was aborted");
		timeout.name = "TimeoutError";
		mockFetchOk({ rejectWith: timeout });

		await expect(loadRuntimeRegistry()).rejects.toMatchObject({
			message:
				"Timed out fetching registry from https://example.com/slow-registry.json after 10s.",
			cause: timeout,
		});
	});

	it("maps abort errors to the same timeout message", async () => {
		mockRemoteSource("https://example.com/aborted-registry.json");
		const aborted = new Error("The operation was aborted");
		aborted.name = "AbortError";
		mockFetchOk({ rejectWith: aborted });

		await expect(loadRuntimeRegistry()).rejects.toMatchObject({
			message:
				"Timed out fetching registry from https://example.com/aborted-registry.json after 10s.",
			cause: aborted,
		});
	});

	it("wraps unexpected request failures with the registry URL", async () => {
		mockRemoteSource("https://example.com/down-registry.json");
		const failure = new Error("socket hang up");
		mockFetchOk({ rejectWith: failure });

		await expect(loadRuntimeRegistry()).rejects.toMatchObject({
			message:
				"Failed to fetch registry from https://example.com/down-registry.json.",
			cause: failure,
		});
	});

	it("wraps local registry read failures with a labeled error", async () => {
		mockLocateRegistry.mockResolvedValue("/workspace/registry.json");
		const failure = new Error("ENOENT");
		mockReadJsonFileAsync.mockRejectedValue(failure);

		await expect(loadRuntimeRegistry()).rejects.toMatchObject({
			message: "Failed to read registry at /workspace/registry.json: ENOENT",
			cause: failure,
		});
	});

	it("stringifies non-Error local registry read failures", async () => {
		mockLocateRegistry.mockResolvedValue("/workspace/registry.json");
		mockReadJsonFileAsync.mockRejectedValue("disk-full");

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Failed to read registry at /workspace/registry.json: disk-full",
		);
	});

	it("propagates labeled local registry JSON parse failures", async () => {
		mockLocateRegistry.mockResolvedValue("/workspace/registry.json");
		const failure = new InvalidJsonError(
			"registry at /workspace/registry.json",
			new SyntaxError("Unexpected token"),
		);
		mockReadJsonFileAsync.mockRejectedValue(failure);

		await expect(loadRuntimeRegistry()).rejects.toBe(failure);
	});

	it("loads unique payloads relative to the given catalog location", async () => {
		mockReadJsonFileAsync.mockResolvedValueOnce({
			files: [{ target: "a.txt", content: "hello" }],
		});

		const payloads = await loadRegistryPayloads("/workspace/registry.json", [
			"r/item.json",
			"r/item.json",
		]);

		expect(payloads.size).toBe(1);
		expect(payloads.get("r/item.json")).toEqual({
			files: [{ target: "a.txt", content: "hello" }],
		});
		expect(mockReadJsonFileAsync).toHaveBeenCalledWith(
			"/workspace/r/item.json",
			"registry payload at /workspace/r/item.json",
		);
	});

	it("returns an empty map when no payload sources are provided", async () => {
		const payloads = await loadRegistryPayloads("/workspace/registry.json", []);

		expect(payloads.size).toBe(0);
		expect(mockReadJsonFileAsync).not.toHaveBeenCalled();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("loads remote payloads relative to an HTTPS catalog", async () => {
		mockFetchOk({
			body: JSON.stringify({
				files: [{ target: "b.txt", content: "remote" }],
			}),
		});

		const payloads = await loadRegistryPayloads(
			"https://example.com/registry.json",
			["r/item.json"],
		);

		expect(payloads.get("r/item.json")).toEqual({
			files: [{ target: "b.txt", content: "remote" }],
		});
		expect(mockFetch).toHaveBeenCalledWith(
			new URL("https://example.com/r/item.json"),
			expect.objectContaining({ method: "GET", redirect: "error" }),
		);
	});

	it("loads mixed local-relative and absolute HTTPS payload sources", async () => {
		mockReadJsonFileAsync.mockResolvedValueOnce({
			files: [{ target: "local.txt", content: "a" }],
		});
		mockFetchOk({
			body: JSON.stringify({ files: [{ target: "abs.txt", content: "b" }] }),
		});

		const payloads = await loadRegistryPayloads("/workspace/registry.json", [
			"r/local.json",
			"https://cdn.example.com/abs.json",
		]);

		expect(payloads.get("r/local.json")).toEqual({
			files: [{ target: "local.txt", content: "a" }],
		});
		expect(payloads.get("https://cdn.example.com/abs.json")).toEqual({
			files: [{ target: "abs.txt", content: "b" }],
		});
		expect(mockReadJsonFileAsync).toHaveBeenCalledWith(
			"/workspace/r/local.json",
			"registry payload at /workspace/r/local.json",
		);
		expect(mockFetch).toHaveBeenCalledWith(
			new URL("https://cdn.example.com/abs.json"),
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("surfaces the payload label when a remote payload fetch fails", async () => {
		mockFetchOk({
			status: 404,
			statusText: "Not Found",
			headers: {},
			body: "missing",
		});

		await expect(
			loadRegistryPayloads("https://example.com/registry.json", [
				"r/missing.json",
			]),
		).rejects.toThrow("Failed to fetch registry payload (404 Not Found).");
	});

	it("propagates labeled local payload JSON parse failures", async () => {
		const failure = new InvalidJsonError(
			"registry payload at /workspace/r/bad.json",
			new SyntaxError("Unexpected token"),
		);
		mockReadJsonFileAsync.mockRejectedValueOnce(failure);

		await expect(
			loadRegistryPayloads("/workspace/registry.json", ["r/bad.json"]),
		).rejects.toBe(failure);
	});
});
