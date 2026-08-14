import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import type { Registry } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrySourceKind } from "./source";

const mockHttpsRequest = vi.fn();
const mockResolveRegistrySource = vi.fn();
const mockReadJSONFileAsync = vi.fn();
const mockParseRegistryDocument = vi.fn();

vi.mock("node:https", () => ({
	default: {
		request: (
			url: URL,
			options: Record<string, unknown>,
			callback?: (response: IncomingMessage) => void,
		) => mockHttpsRequest(url, options, callback),
	},
}));

vi.mock("./source", () => ({
	RegistrySourceKind: {
		BUNDLED: "bundled",
		PATH: "path",
		URL: "url",
	},
	resolveRegistrySource: (options: unknown) =>
		mockResolveRegistrySource(options),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		readJSONFileAsync: (location: string) => mockReadJSONFileAsync(location),
		parseRegistryDocument: (raw: unknown) => mockParseRegistryDocument(raw),
	};
});

import { loadRuntimeRegistry } from "./load";

const sampleRegistry: Registry = {
	contentBaseUrl: "https://example.com/content",
	types: {},
	items: {},
};

const publicRegistryBody = JSON.stringify({
	contentBaseUrl: "https://example.com/content",
	types: {},
	items: {},
});

/**
 * Arrange a remote registry URL source for the next loadRuntimeRegistry call.
 * @param location - Absolute registry URL.
 */
function mockRemoteSource(location: string): void {
	mockResolveRegistrySource.mockResolvedValue({
		kind: RegistrySourceKind.URL,
		location,
	});
}

interface MockResponseOptions {
	statusCode?: number;
	statusMessage?: string;
	headers?: Record<string, string | string[] | undefined>;
	body?: string | Buffer;
	/** When true, leave statusCode/statusMessage unset on the response. */
	omitStatus?: boolean;
}

/**
 * Arrange https.request to deliver a response stream.
 * @param response - Fake response fields.
 */
function mockHttpsOk(response: MockResponseOptions = {}): void {
	mockHttpsRequest.mockImplementation(
		(
			_url: URL,
			_options: Record<string, unknown>,
			callback?: (response: IncomingMessage) => void,
		) => {
			const req = new EventEmitter() as EventEmitter & {
				end: () => void;
			};

			req.end = () => {
				const body = response.body ?? publicRegistryBody;
				const stream = Readable.from([body]) as IncomingMessage;
				if (!response.omitStatus) {
					stream.statusCode = response.statusCode ?? 200;
					stream.statusMessage = response.statusMessage ?? "OK";
				}
				stream.headers = response.headers ?? {
					"content-length": String(Buffer.byteLength(body)),
				};
				callback?.(stream);
			};

			return req;
		},
	);
}

/**
 * Arrange https.request to fail at the socket/request layer without a response.
 * @param error - Error emitted on the request.
 */
function mockHttpsRequestError(error: Error): void {
	mockHttpsRequest.mockImplementation(
		(
			_url: URL,
			_options: unknown,
			_callback?: (response: IncomingMessage) => void,
		) => {
			const req = new EventEmitter() as EventEmitter & {
				end: () => void;
			};
			req.end = () => {
				queueMicrotask(() => req.emit("error", error));
			};
			return req;
		},
	);
}

describe("registry/load", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParseRegistryDocument.mockReturnValue(sampleRegistry);
		mockHttpsOk();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("loads local registry sources from disk", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: RegistrySourceKind.PATH,
			location: "/workspace/registry.json",
		});
		mockReadJSONFileAsync.mockResolvedValue(sampleRegistry);

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(mockReadJSONFileAsync).toHaveBeenCalledWith(
			"/workspace/registry.json",
		);
		expect(mockParseRegistryDocument).toHaveBeenCalledWith(sampleRegistry);
		expect(mockHttpsRequest).not.toHaveBeenCalled();
	});

	it("forwards flag and saved registry sources to resolveRegistrySource", async () => {
		mockResolveRegistrySource.mockResolvedValue({
			kind: RegistrySourceKind.PATH,
			location: "/workspace/registry.json",
		});
		mockReadJSONFileAsync.mockResolvedValue(sampleRegistry);

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

	it("rejects non-HTTPS remote registries", async () => {
		mockRemoteSource("http://example.com/registry.json");

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries must use HTTPS.",
		);
		expect(mockHttpsRequest).not.toHaveBeenCalled();
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
			expect(mockHttpsRequest).not.toHaveBeenCalled();
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
			expect(mockHttpsRequest).not.toHaveBeenCalled();
		}
	});

	it("rejects literal IPv4 registry hosts", async () => {
		for (const host of ["127.0.0.1", "93.184.216.34", "192.168.0.1"]) {
			mockRemoteSource(`https://${host}/registry.json`);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries must use a hostname, not an IP address.",
			);
			expect(mockHttpsRequest).not.toHaveBeenCalled();
		}
	});

	it("rejects literal IPv6 registry hosts", async () => {
		for (const host of ["[::1]", "[2001:db8::1]", "[::ffff:127.0.0.1]"]) {
			mockRemoteSource(`https://${host}/registry.json`);

			await expect(loadRuntimeRegistry()).rejects.toThrow(
				"Remote registries must use a hostname, not an IP address.",
			);
			expect(mockHttpsRequest).not.toHaveBeenCalled();
		}
	});

	it("fetches and validates remote registries over HTTPS", async () => {
		mockRemoteSource("https://example.com/registry.json");
		mockHttpsOk();

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(mockParseRegistryDocument).toHaveBeenCalled();
		expect(mockHttpsRequest).toHaveBeenCalledWith(
			expect.any(URL),
			expect.objectContaining({
				method: "GET",
				headers: { accept: "application/json" },
			}),
			expect.any(Function),
		);
	});

	it("rejects redirect responses from remote registries", async () => {
		mockRemoteSource("https://example.com/redirect-registry.json");
		mockHttpsOk({
			statusCode: 302,
			statusMessage: "Found",
			headers: { location: "https://example.com/other.json" },
			body: "",
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registries must not redirect.",
		);
	});

	it("rejects failed remote registry HTTP responses", async () => {
		mockRemoteSource("https://example.com/missing-registry.json");
		mockHttpsOk({
			statusCode: 500,
			statusMessage: "Internal Server Error",
			headers: {},
			body: "server error",
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Failed to fetch registry (500 Internal Server Error).",
		);
	});

	it("treats missing status code and message as a failed fetch", async () => {
		mockRemoteSource("https://example.com/no-status-registry.json");
		mockHttpsOk({
			omitStatus: true,
			headers: {},
			body: "no status",
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Failed to fetch registry (0 ).",
		);
	});

	it("accepts Buffer chunks when reading a remote registry body", async () => {
		mockRemoteSource("https://example.com/buffer-registry.json");
		mockHttpsOk({
			headers: {},
			body: Buffer.from(publicRegistryBody),
		});

		await expect(loadRuntimeRegistry()).resolves.toEqual(sampleRegistry);
		expect(mockParseRegistryDocument).toHaveBeenCalledWith(
			JSON.parse(publicRegistryBody),
		);
	});

	it("rejects remote registries whose content-length exceeds the size limit", async () => {
		mockRemoteSource("https://example.com/large-header-registry.json");
		mockHttpsOk({
			headers: { "content-length": String(5_000_001) },
			body: publicRegistryBody,
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry is too large.",
		);
	});

	it("rejects remote registries whose body exceeds the size limit", async () => {
		mockRemoteSource("https://example.com/large-body-registry.json");
		mockHttpsOk({
			headers: {},
			body: "x".repeat(5_000_001),
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry is too large.",
		);
	});

	it("rejects remote registries that return invalid JSON", async () => {
		mockRemoteSource("https://example.com/invalid-registry.json");
		mockHttpsOk({
			headers: { "content-length": "12" },
			body: "{not-json",
		});

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Remote registry returned invalid JSON:",
		);
	});

	it("stringifies non-Error JSON parse failures from remote registries", async () => {
		mockRemoteSource("https://example.com/weird-json-registry.json");
		mockHttpsOk({
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
		mockHttpsRequestError(timeout);

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Timed out fetching registry from https://example.com/slow-registry.json after 10s.",
		);
	});

	it("wraps unexpected request failures with the registry URL", async () => {
		mockRemoteSource("https://example.com/down-registry.json");
		mockHttpsRequestError(new Error("socket hang up"));

		await expect(loadRuntimeRegistry()).rejects.toThrow(
			"Failed to fetch registry from https://example.com/down-registry.json.",
		);
	});
});
