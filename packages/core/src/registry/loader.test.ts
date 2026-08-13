import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	loadRegistry,
	RegistrySourceKind,
	resolveRegistrySource,
} from "./loader";
import { type Registry, SCHEMA_VERSION } from "./schema";

const mockIsRegularFileAsync = vi.fn<(candidate: string) => Promise<boolean>>();
const mockReadJSONFileAsync = vi.fn<(candidate: string) => Promise<unknown>>();

vi.mock("../core/fs", () => ({
	isRegularFileAsync: (candidate: string) => mockIsRegularFileAsync(candidate),
	readJSONFileAsync: (candidate: string) => mockReadJSONFileAsync(candidate),
}));

const sampleRegistry: Registry = {
	version: "1.0.0",
	schemaVersion: SCHEMA_VERSION,
	contentBaseUrl: "https://example.com/content",
	types: {
		theme: { label: "Themes" },
	},
	items: {
		"sample-theme": {
			id: "sample-theme",
			title: "Sample Theme",
			description: "A sample theme",
			type: "theme",
			variants: [
				{
					id: "default",
					title: "Default",
					description: "Default variant",
					files: [{ source: "a.css", target: "a.css" }],
				},
			],
		},
	},
};

describe("registry/loader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(process, "cwd").mockReturnValue("/workspace");
		Reflect.deleteProperty(process.env, "TUCKSHOP_REGISTRY");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("prefers an explicit URL registry override", async () => {
		await expect(
			resolveRegistrySource({
				registry: "https://example.com/registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.URL,
			location: "https://example.com/registry.json",
		});
		expect(mockIsRegularFileAsync).not.toHaveBeenCalled();
	});

	it("resolves an explicit file override relative to cwd", async () => {
		await expect(
			resolveRegistrySource({
				registry: "./custom/registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.PATH,
			location: path.resolve("/workspace", "./custom/registry.json"),
		});
	});

	it("loads the current working directory registry before bundled fallbacks", async () => {
		const cwdRegistry = path.resolve("/workspace", "registry.json");
		mockIsRegularFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === cwdRegistry;
		});

		await expect(
			resolveRegistrySource({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.PATH,
			location: cwdRegistry,
		});
	});

	it("falls back to the bundled registry.json when cwd has none", async () => {
		const packagedRegistry = "/bundle/registry.json";
		mockIsRegularFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === packagedRegistry;
		});

		await expect(
			resolveRegistrySource({
				bundledRegistryPath: packagedRegistry,
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.BUNDLED,
			location: packagedRegistry,
		});
	});

	it("uses fallback registry probe paths before failing", async () => {
		const fallbackRegistry = "/workspace/packages/registry/registry.json";
		mockIsRegularFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === fallbackRegistry;
		});

		await expect(
			resolveRegistrySource({
				bundledRegistryPath: "/bundle/registry.json",
				fallbackRegistryPaths: [fallbackRegistry],
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.PATH,
			location: fallbackRegistry,
		});
	});

	it("uses TUCKSHOP_REGISTRY from the environment when no flag is provided", async () => {
		vi.stubEnv("TUCKSHOP_REGISTRY", "https://example.com/env-registry.json");

		await expect(
			resolveRegistrySource({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.URL,
			location: "https://example.com/env-registry.json",
		});
	});

	it("uses a saved registry config when flag and env are absent", async () => {
		await expect(
			resolveRegistrySource({
				savedRegistry: "https://example.com/saved-registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.URL,
			location: "https://example.com/saved-registry.json",
		});
	});

	it("prefers TUCKSHOP_REGISTRY over a saved registry config", async () => {
		vi.stubEnv("TUCKSHOP_REGISTRY", "https://example.com/env-registry.json");

		await expect(
			resolveRegistrySource({
				savedRegistry: "https://example.com/saved-registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.URL,
			location: "https://example.com/env-registry.json",
		});
	});

	it("prefers an explicit flag over env and saved registry config", async () => {
		vi.stubEnv("TUCKSHOP_REGISTRY", "https://example.com/env-registry.json");

		await expect(
			resolveRegistrySource({
				registry: "https://example.com/flag-registry.json",
				savedRegistry: "https://example.com/saved-registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.URL,
			location: "https://example.com/flag-registry.json",
		});
	});

	it("throws a clear error when no registry source can be found", async () => {
		mockIsRegularFileAsync.mockResolvedValue(false);

		await expect(
			resolveRegistrySource({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).rejects.toThrow(
			"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
		);
		expect(mockReadJSONFileAsync).not.toHaveBeenCalled();
	});

	it("loads and validates a local registry document from disk", async () => {
		mockReadJSONFileAsync.mockResolvedValue(sampleRegistry);

		await expect(loadRegistry("/workspace/registry.json")).resolves.toEqual(
			sampleRegistry,
		);

		expect(mockReadJSONFileAsync).toHaveBeenCalledWith(
			"/workspace/registry.json",
		);
	});
});
