import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrySourceKind, resolveRegistrySource } from "./source";

const mockIsFileAsync = vi.fn<(candidate: string) => Promise<boolean>>();

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		isFileAsync: (candidate: string) => mockIsFileAsync(candidate),
	};
});

describe("registry/source", () => {
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
		expect(mockIsFileAsync).not.toHaveBeenCalled();
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
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
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
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
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

	it("uses fallback registry probe paths before the bundled copy", async () => {
		const packagedRegistry = "/bundle/registry.json";
		const fallbackRegistry = "/workspace/packages/registry/registry.json";
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === packagedRegistry || candidate === fallbackRegistry;
		});

		await expect(
			resolveRegistrySource({
				bundledRegistryPath: packagedRegistry,
				fallbackRegistryPaths: [fallbackRegistry],
			}),
		).resolves.toEqual({
			kind: RegistrySourceKind.PATH,
			location: fallbackRegistry,
		});
	});

	it("uses fallback registry probe paths when the bundled copy is absent", async () => {
		const fallbackRegistry = "/workspace/packages/registry/registry.json";
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
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

	it("defaults bundledRegistryPath relative to the module when omitted", async () => {
		const defaultBundledPath = path.resolve(
			__dirname,
			"../../",
			"registry.json",
		);
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === defaultBundledPath;
		});

		await expect(resolveRegistrySource()).resolves.toEqual({
			kind: RegistrySourceKind.BUNDLED,
			location: defaultBundledPath,
		});
	});

	it("throws a clear error when no registry source can be found", async () => {
		mockIsFileAsync.mockResolvedValue(false);

		await expect(
			resolveRegistrySource({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).rejects.toThrow(
			"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
		);
	});
});
