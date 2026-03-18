import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Toggled by tests to switch between local and remote mode. */
let isLocalMode = false;

vi.mock("./constants", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./constants")>();
	return {
		...actual,
		get IS_LOCAL_MODE() {
			return isLocalMode;
		},
	};
});

vi.mock("./fs", () => ({
	isDirAsync: vi.fn(),
}));

vi.mock("./registry.local", () => ({
	getLocalRoot: vi.fn(),
	listLocalChildDirs: vi.fn(),
	resolveLocalTemplatesSubpath: vi.fn(),
}));

vi.mock("./registry.remote", () => ({
	listRemoteChildDirsViaAPI: vi.fn(),
	resolveRemoteSubpath: vi.fn(),
}));

// Import after mocks
import { Language } from "./constants";
import { isDirAsync } from "./fs";
import {
	getLocalRoot,
	listLocalChildDirs,
	resolveLocalTemplatesSubpath,
} from "./registry.local";
import {
	listRemoteChildDirsViaAPI,
	resolveRemoteSubpath,
} from "./registry.remote";
import {
	listAvailableTemplates,
	listLanguageNames,
	listProjectSpecNames,
	NON_TEMPLATE_DIR_NAMES,
	resolveTemplatesDir,
} from "./templates";

describe("core/templates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isLocalMode = false;
	});

	describe("NON_TEMPLATE_DIR_NAMES", () => {
		it("should contain shared and instructions (lowercase)", () => {
			expect(NON_TEMPLATE_DIR_NAMES).toContain("shared");
			expect(NON_TEMPLATE_DIR_NAMES).toContain("instructions");
		});
	});

	describe("listLanguageNames", () => {
		it("should call getLocalRoot with templates", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue("/test/templates");
			vi.mocked(listLocalChildDirs).mockResolvedValue([]);

			await listLanguageNames();

			expect(getLocalRoot).toHaveBeenCalledWith("templates");
		});

		it("should return empty array when no templates root exists", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue(null);

			const result = await listLanguageNames();

			expect(result).toEqual([]);
		});

		it("should return sorted language names when templates root exists", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue("/test/templates");
			vi.mocked(listLocalChildDirs).mockResolvedValue([
				"python",
				"typescript",
				"go",
			]);

			const result = await listLanguageNames();

			expect(result).toEqual(["go", "python", "typescript"]);
		});

		it("should exclude non-template directories", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue("/test/templates");
			// listLocalChildDirs filters using NON_TEMPLATE_DIR_NAMES; mock returns already-filtered list
			vi.mocked(listLocalChildDirs).mockResolvedValue(["typescript"]);

			const result = await listLanguageNames();

			expect(listLocalChildDirs).toHaveBeenCalledWith(
				"/test/templates",
				NON_TEMPLATE_DIR_NAMES,
			);
			expect(result).toEqual(["typescript"]);
		});
	});

	describe("listProjectSpecNames", () => {
		it("should call getLocalRoot and isDirAsync with correct paths", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue("/test/templates");
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(listLocalChildDirs).mockResolvedValue(["package"]);

			await listProjectSpecNames("typescript");

			expect(getLocalRoot).toHaveBeenCalledWith("templates");
			expect(isDirAsync).toHaveBeenCalledWith("/test/templates/typescript");
			expect(listLocalChildDirs).toHaveBeenCalledWith(
				"/test/templates/typescript",
				NON_TEMPLATE_DIR_NAMES,
			);
		});

		it("should return empty array when no templates root exists", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue(null);

			const result = await listProjectSpecNames("typescript");

			expect(result).toEqual([]);
		});

		it("should return empty array when language directory does not exist", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue("/test/templates");
			vi.mocked(isDirAsync).mockResolvedValue(false);

			const result = await listProjectSpecNames("nonexistent");

			expect(result).toEqual([]);
		});

		it("should return sorted project spec names when lang dir exists", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue("/test/templates");
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(listLocalChildDirs).mockResolvedValue([
				"package",
				"library",
				"app",
			]);

			const result = await listProjectSpecNames("typescript");

			expect(result).toEqual(["app", "library", "package"]);
		});

		it("should exclude non-template directories", async () => {
			vi.mocked(getLocalRoot).mockResolvedValue("/test/templates");
			vi.mocked(isDirAsync).mockResolvedValue(true);
			// listLocalChildDirs filters using NON_TEMPLATE_DIR_NAMES; mock returns already-filtered list
			vi.mocked(listLocalChildDirs).mockResolvedValue(["package"]);

			const result = await listProjectSpecNames("typescript");

			expect(listLocalChildDirs).toHaveBeenCalledWith(
				"/test/templates/typescript",
				NON_TEMPLATE_DIR_NAMES,
			);
			expect(result).toEqual(["package"]);
		});
	});

	describe("resolveTemplatesDir", () => {
		describe("local mode", () => {
			beforeEach(() => {
				isLocalMode = true;
			});

			it("should resolve local templates directory in local mode", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/typescript/package",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveTemplatesDir("typescript", "package");

				expect(result).toBe("/local/templates/typescript/package");
			});

			it("should resolve local templates directory for language only (no resource) in local mode", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/typescript",
				);
				vi.mocked(isDirAsync).mockResolvedValue(true);

				const result = await resolveTemplatesDir("typescript");

				expect(resolveLocalTemplatesSubpath).toHaveBeenCalledWith(
					"templates/typescript",
				);
				expect(result).toBe("/local/templates/typescript");
			});

			it("should throw when resolved local path is not a directory", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/typescript",
				);
				vi.mocked(isDirAsync).mockResolvedValue(false);
				vi.mocked(getLocalRoot).mockResolvedValue("/local/templates");

				await expect(resolveTemplatesDir("typescript")).rejects.toThrow(
					/Local templates not found at \/local\/templates for language "typescript"/,
				);
			});

			it("should throw when local templates not found in local mode", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(null);
				vi.mocked(getLocalRoot).mockResolvedValue("/local/templates");

				await expect(resolveTemplatesDir("typescript")).rejects.toThrow(
					/Local templates not found at \/local\/templates for language "typescript"/,
				);
			});

			it("should throw when no local templates root in local mode", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(null);
				vi.mocked(getLocalRoot).mockResolvedValue(null);

				await expect(resolveTemplatesDir("typescript")).rejects.toThrow(
					"No local templates root found.",
				);
			});
		});

		describe("remote mode", () => {
			it("should download and resolve remote templates in remote mode", async () => {
				vi.mocked(resolveRemoteSubpath).mockResolvedValue(
					"/tmp/downloaded/typescript",
				);

				const result = await resolveTemplatesDir("typescript");

				expect(resolveRemoteSubpath).toHaveBeenCalledWith(
					"templates/typescript",
					"yehle-templates-",
					expect.any(Function),
				);
				expect(result).toBe("/tmp/downloaded/typescript");
			});

			it("should return candidate path without resource when it exists in downloaded dir", async () => {
				const downloadedDir = "/tmp/yehle-templates-abc";
				const candidateWithoutResource = path.join(
					downloadedDir,
					"templates",
					"typescript",
				);
				vi.mocked(resolveRemoteSubpath).mockImplementation(
					async (_subpath, _tmpPrefix, normalize) => {
						if (normalize) return normalize(downloadedDir);
						return downloadedDir;
					},
				);
				vi.mocked(isDirAsync).mockImplementation((p) =>
					Promise.resolve(p === candidateWithoutResource),
				);

				const result = await resolveTemplatesDir("typescript");

				expect(result).toBe(candidateWithoutResource);
			});

			it("should include resource in subpath when provided", async () => {
				vi.mocked(resolveRemoteSubpath).mockResolvedValue(
					"/tmp/downloaded/package",
				);

				await resolveTemplatesDir("typescript", "package");

				expect(resolveRemoteSubpath).toHaveBeenCalledWith(
					"templates/typescript/package",
					"yehle-templates-",
					expect.any(Function),
				);
			});

			it("should return candidate path with resource when it exists in downloaded dir", async () => {
				const downloadedDir = "/tmp/yehle-templates-xyz";
				const candidateWithResource = path.join(
					downloadedDir,
					"templates",
					"typescript",
					"package",
				);
				vi.mocked(resolveRemoteSubpath).mockImplementation(
					async (_subpath, _tmpPrefix, normalize) => {
						if (normalize) return normalize(downloadedDir);
						return downloadedDir;
					},
				);
				vi.mocked(isDirAsync).mockImplementation((path) =>
					Promise.resolve(path === candidateWithResource),
				);

				const result = await resolveTemplatesDir("typescript", "package");

				expect(result).toBe(candidateWithResource);
			});

			it("should propagate error when remote validator throws", async () => {
				vi.mocked(resolveRemoteSubpath).mockImplementation(
					async (_subpath, _tmpPrefix, normalize) => {
						const downloadedDir = "/tmp/fake-download";
						if (normalize) return normalize(downloadedDir);
						return downloadedDir;
					},
				);
				vi.mocked(isDirAsync).mockResolvedValue(false);

				await expect(
					resolveTemplatesDir("typescript", "package"),
				).rejects.toThrow(
					/No remote templates found for language "typescript" and resource "package"/,
				);
			});
		});
	});

	describe("listAvailableTemplates", () => {
		describe("local mode", () => {
			beforeEach(() => {
				isLocalMode = true;
			});

			it("should return empty array when local subpath not found in local mode", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(null);

				const result = await listAvailableTemplates(
					Language.TYPESCRIPT,
					"package",
				);

				expect(result).toEqual([]);
			});

			it("should return local child dirs in local mode", async () => {
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(
					"/local/templates/typescript/package",
				);
				vi.mocked(listLocalChildDirs).mockResolvedValue(["basic", "advanced"]);

				const result = await listAvailableTemplates(
					Language.TYPESCRIPT,
					"package",
				);

				expect(result).toEqual(["basic", "advanced"]);
			});

			it("should call listLocalChildDirs with resolved dir and NON_TEMPLATE_DIR_NAMES in local mode", async () => {
				const localDir = "/local/templates/typescript/package";
				vi.mocked(resolveLocalTemplatesSubpath).mockResolvedValue(localDir);
				vi.mocked(listLocalChildDirs).mockResolvedValue(["basic"]);

				await listAvailableTemplates(Language.TYPESCRIPT, "package");

				expect(listLocalChildDirs).toHaveBeenCalledWith(
					localDir,
					NON_TEMPLATE_DIR_NAMES,
				);
			});
		});

		describe("remote mode", () => {
			it("should call remote API in remote mode", async () => {
				vi.mocked(listRemoteChildDirsViaAPI).mockResolvedValue([
					"basic",
					"advanced",
				]);

				const result = await listAvailableTemplates(
					Language.TYPESCRIPT,
					"package",
				);

				expect(listRemoteChildDirsViaAPI).toHaveBeenCalledWith(
					"templates/typescript/package",
					NON_TEMPLATE_DIR_NAMES,
				);
				expect(result).toEqual(["basic", "advanced"]);
			});

			it("should exclude non-template directories in remote mode", async () => {
				// listRemoteChildDirsViaAPI filters using NON_TEMPLATE_DIR_NAMES; mock returns already-filtered list
				vi.mocked(listRemoteChildDirsViaAPI).mockResolvedValue(["basic"]);

				const result = await listAvailableTemplates(
					Language.TYPESCRIPT,
					"package",
				);

				expect(listRemoteChildDirsViaAPI).toHaveBeenCalledWith(
					"templates/typescript/package",
					NON_TEMPLATE_DIR_NAMES,
				);
				expect(result).toEqual(["basic"]);
			});

			it("should construct correct subpath without resource", async () => {
				vi.mocked(listRemoteChildDirsViaAPI).mockResolvedValue([]);

				await listAvailableTemplates(Language.TYPESCRIPT, "");

				expect(listRemoteChildDirsViaAPI).toHaveBeenCalledWith(
					"templates/typescript",
					NON_TEMPLATE_DIR_NAMES,
				);
			});
		});
	});
});
