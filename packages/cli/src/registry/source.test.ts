import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locateRegistry } from "./source";

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
			locateRegistry({
				registry: "https://example.com/registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe("https://example.com/registry.json");
		expect(mockIsFileAsync).not.toHaveBeenCalled();
	});

	it("rejects an explicit HTTP registry override", async () => {
		await expect(
			locateRegistry({
				registry: "http://example.com/registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).rejects.toThrow("Remote registries must use HTTPS.");
	});

	it("rejects an explicit localhost registry override", async () => {
		await expect(
			locateRegistry({
				registry: "https://localhost/registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).rejects.toThrow("Remote registries cannot target localhost.");
	});

	it("rejects an explicit registry override with credentials", async () => {
		await expect(
			locateRegistry({
				registry: "https://user:secret@example.com/registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).rejects.toThrow("Remote registries must not include credentials.");
	});

	it("joins an explicit file override relative to cwd", async () => {
		await expect(
			locateRegistry({
				registry: "./custom/registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe(path.resolve("/workspace", "./custom/registry.json"));
	});

	it("loads the current working directory registry before bundled fallbacks", async () => {
		const cwdRegistry = path.resolve("/workspace", "registry.json");
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === cwdRegistry;
		});

		await expect(
			locateRegistry({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe(cwdRegistry);
	});

	it("falls back to the bundled registry.json when cwd has none", async () => {
		const packagedRegistry = "/bundle/registry.json";
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === packagedRegistry;
		});

		await expect(
			locateRegistry({
				bundledRegistryPath: packagedRegistry,
			}),
		).resolves.toBe(packagedRegistry);
	});

	it("uses fallback registry probe paths before the bundled copy", async () => {
		const packagedRegistry = "/bundle/registry.json";
		const fallbackRegistry = "/workspace/packages/registry/registry.json";
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === packagedRegistry || candidate === fallbackRegistry;
		});

		await expect(
			locateRegistry({
				bundledRegistryPath: packagedRegistry,
				fallbackRegistryPaths: [fallbackRegistry],
			}),
		).resolves.toBe(fallbackRegistry);
	});

	it("uses fallback registry probe paths when the bundled copy is absent", async () => {
		const fallbackRegistry = "/workspace/packages/registry/registry.json";
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === fallbackRegistry;
		});

		await expect(
			locateRegistry({
				bundledRegistryPath: "/bundle/registry.json",
				fallbackRegistryPaths: [fallbackRegistry],
			}),
		).resolves.toBe(fallbackRegistry);
	});

	it("uses TUCKSHOP_REGISTRY from the environment when no flag is provided", async () => {
		vi.stubEnv("TUCKSHOP_REGISTRY", "https://example.com/env-registry.json");

		await expect(
			locateRegistry({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe("https://example.com/env-registry.json");
	});

	it("uses a saved registry config when flag and env are absent", async () => {
		await expect(
			locateRegistry({
				savedRegistry: "https://example.com/saved-registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe("https://example.com/saved-registry.json");
	});

	it("prefers TUCKSHOP_REGISTRY over a saved registry config", async () => {
		vi.stubEnv("TUCKSHOP_REGISTRY", "https://example.com/env-registry.json");

		await expect(
			locateRegistry({
				savedRegistry: "https://example.com/saved-registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe("https://example.com/env-registry.json");
	});

	it("prefers an explicit flag over env and saved registry config", async () => {
		vi.stubEnv("TUCKSHOP_REGISTRY", "https://example.com/env-registry.json");

		await expect(
			locateRegistry({
				registry: "https://example.com/flag-registry.json",
				savedRegistry: "https://example.com/saved-registry.json",
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe("https://example.com/flag-registry.json");
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

		await expect(locateRegistry()).resolves.toBe(defaultBundledPath);
	});

	it("defaults fallback registry paths relative to the workspace registry", async () => {
		const defaultFallbackPath = path.resolve(
			__dirname,
			"../../../registry/registry.json",
		);
		mockIsFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === defaultFallbackPath;
		});

		await expect(
			locateRegistry({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).resolves.toBe(defaultFallbackPath);
	});

	it("throws a clear error when no registry source can be found", async () => {
		mockIsFileAsync.mockResolvedValue(false);

		await expect(
			locateRegistry({
				bundledRegistryPath: "/bundle/registry.json",
			}),
		).rejects.toThrow(
			"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
		);
	});
});
