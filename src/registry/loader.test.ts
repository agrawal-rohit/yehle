import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "./schema";
import { RegistryItemType } from "./schema";

const mockIsRegularFileAsync = vi.fn();
const mockReadJSONFileAsync = vi.fn();

vi.mock("../core/fs", () => ({
	isRegularFileAsync: (...args: unknown[]) => mockIsRegularFileAsync(...args),
	readJSONFileAsync: (...args: unknown[]) => mockReadJSONFileAsync(...args),
}));

import { loadRegistry } from "./loader";

const sampleRegistry: Registry = {
	version: "1.0.0",
	contentBaseUrl: "https://example.com/content",
	items: {
		"sample-theme": {
			id: "sample-theme",
			title: "Sample Theme",
			description: "A sample theme",
			type: RegistryItemType.THEME,
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
	let tempDir: string;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loader-test-"));
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
	});

	afterEach(() => {
		cwdSpy.mockRestore();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads registry.json from the current working directory when present", async () => {
		const cwdRegistry = path.resolve(tempDir, "registry.json");
		mockIsRegularFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === cwdRegistry;
		});
		mockReadJSONFileAsync.mockResolvedValue(sampleRegistry);

		await expect(loadRegistry()).resolves.toEqual(sampleRegistry);

		expect(mockIsRegularFileAsync).toHaveBeenCalledWith(cwdRegistry);
		expect(mockReadJSONFileAsync).toHaveBeenCalledWith(cwdRegistry);
	});

	it("falls back to the packaged registry.json when cwd has none", async () => {
		const packagedRegistry = path.resolve(__dirname, "../../", "registry.json");
		mockIsRegularFileAsync.mockImplementation(async (candidate: string) => {
			return candidate === packagedRegistry;
		});
		mockReadJSONFileAsync.mockResolvedValue(sampleRegistry);

		await expect(loadRegistry()).resolves.toEqual(sampleRegistry);

		expect(mockReadJSONFileAsync).toHaveBeenCalledWith(packagedRegistry);
	});

	it("throws a clear error when no registry.json can be found", async () => {
		mockIsRegularFileAsync.mockResolvedValue(false);

		await expect(loadRegistry()).rejects.toThrow(
			"Registry not found (registry.json). Run `pnpm run build:registry` before using tuckshop.",
		);
		expect(mockReadJSONFileAsync).not.toHaveBeenCalled();
	});
});
