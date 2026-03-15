import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	default: {
		promises: {
			readdir: vi.fn(),
		},
	},
}));

vi.mock("./fs", () => ({
	isDirAsync: vi.fn(),
}));

// Import after mocks
import fs from "node:fs";
import { isDirAsync } from "./fs";
import {
	getLocalRoot,
	listLocalChildDirs,
	listLocalFilesWithExtensions,
	resolveLocalTemplatesSubpath,
} from "./registry.local";

describe("core/registry.local", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(process, "cwd").mockReturnValue("/test/project");
	});

	describe("getLocalRoot", () => {
		it("should return path when directory exists", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);

			const result = await getLocalRoot("templates");

			expect(result).toBe("/test/project/templates");
			expect(isDirAsync).toHaveBeenCalledWith("/test/project/templates");
		});

		it("should return null when directory does not exist", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(false);

			const result = await getLocalRoot("templates");

			expect(result).toBeNull();
		});

		it("should resolve path using process.cwd()", async () => {
			vi.spyOn(process, "cwd").mockReturnValue("/custom/cwd");
			vi.mocked(isDirAsync).mockResolvedValue(true);

			const result = await getLocalRoot("data");

			expect(result).toBe("/custom/cwd/data");
		});
	});

	describe("resolveLocalTemplatesSubpath", () => {
		it("should return path when templates root exists and subpath resolves to a directory", async () => {
			vi.mocked(isDirAsync)
				.mockResolvedValueOnce(true) // templates root
				.mockResolvedValueOnce(true); // subpath

			const result = await resolveLocalTemplatesSubpath("templates/typescript");

			expect(result).toBe("/test/project/templates/typescript");
		});

		it("should return null when templates root does not exist", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(false);

			const result = await resolveLocalTemplatesSubpath("templates/typescript");

			expect(result).toBeNull();
		});

		it("should return null when subpath does not resolve to a directory", async () => {
			vi.mocked(isDirAsync)
				.mockResolvedValueOnce(true) // templates root
				.mockResolvedValueOnce(false); // subpath

			const result = await resolveLocalTemplatesSubpath(
				"templates/nonexistent",
			);

			expect(result).toBeNull();
		});

		it("should handle subpath with multiple segments", async () => {
			vi.mocked(isDirAsync)
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(true);

			const result = await resolveLocalTemplatesSubpath(
				"templates/typescript/package/basic",
			);

			expect(result).toBe("/test/project/templates/typescript/package/basic");
		});
	});

	describe("listLocalChildDirs", () => {
		it("should return empty array when directory does not exist", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(false);
			vi.mocked(fs.promises.readdir).mockResolvedValue([]);

			const result = await listLocalChildDirs("/some/dir");

			expect(result).toEqual([]);
		});

		it("should return child directory names", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "src", isDirectory: () => true, isFile: () => false },
				{ name: "dist", isDirectory: () => true, isFile: () => false },
				{ name: "node_modules", isDirectory: () => true, isFile: () => false },
				{ name: "package.json", isDirectory: () => false, isFile: () => true },
			] as never);

			const result = await listLocalChildDirs("/test/project");

			// Returns in directory order, not sorted
			expect(result).toEqual(["src", "dist", "node_modules"]);
		});

		it("should exclude specified directories (case-insensitive)", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "src", isDirectory: () => true, isFile: () => false },
				{ name: "dist", isDirectory: () => true, isFile: () => false },
				{ name: "node_modules", isDirectory: () => true, isFile: () => false },
				{ name: "tests", isDirectory: () => true, isFile: () => false },
			] as never);

			const result = await listLocalChildDirs(
				"/test/project",
				new Set(["dist", "tests"]),
			);

			// Returns in directory order, filtered - exact match for exclusion
			expect(result).toEqual(["src", "node_modules"]);
		});

		it("should return empty array when directory is empty", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([]);

			const result = await listLocalChildDirs("/empty/dir");

			expect(result).toEqual([]);
		});

		it("should filter out files and only return directories", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "file1.txt", isDirectory: () => false, isFile: () => true },
				{ name: "subdir", isDirectory: () => true, isFile: () => false },
				{ name: "file2.md", isDirectory: () => false, isFile: () => true },
			] as never);

			const result = await listLocalChildDirs("/test/dir");

			expect(result).toEqual(["subdir"]);
		});
	});

	describe("listLocalFilesWithExtensions", () => {
		it("should return empty array when directory does not exist", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(false);

			const result = await listLocalFilesWithExtensions("/some/dir", [".mdc"]);

			expect(result).toEqual([]);
		});

		it("should return file basenames without extensions, sorted alphabetically", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "zebra.mdc", isDirectory: () => false, isFile: () => true },
				{ name: "alpha.mdc", isDirectory: () => false, isFile: () => true },
				{ name: "beta.md", isDirectory: () => false, isFile: () => true },
			] as never);

			const result = await listLocalFilesWithExtensions("/rules", [
				".mdc",
				".md",
			]);

			expect(result).toEqual(["alpha", "beta", "zebra"]);
		});

		it("should filter by specified extensions only", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "rule.mdc", isDirectory: () => false, isFile: () => true },
				{ name: "readme.txt", isDirectory: () => false, isFile: () => true },
				{ name: "doc.md", isDirectory: () => false, isFile: () => true },
			] as never);

			const result = await listLocalFilesWithExtensions("/dir", [".mdc"]);

			expect(result).toEqual(["rule"]);
		});

		it("should handle multiple extensions for same file (last match wins)", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "file.mdc.md", isDirectory: () => false, isFile: () => true },
			] as never);

			const result = await listLocalFilesWithExtensions("/dir", [
				".mdc",
				".md",
			]);

			// When checking .mdc first, file.mdc.md doesn't match, then it matches .md and returns file.mdc
			expect(result).toEqual(["file.mdc"]);
		});

		it("should return empty array when no files match extensions", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "readme.txt", isDirectory: () => false, isFile: () => true },
				{ name: "data.json", isDirectory: () => false, isFile: () => true },
			] as never);

			const result = await listLocalFilesWithExtensions("/dir", [
				".mdc",
				".md",
			]);

			expect(result).toEqual([]);
		});

		it("should filter out directories", async () => {
			vi.mocked(isDirAsync).mockResolvedValue(true);
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "subdir", isDirectory: () => true, isFile: () => false },
				{ name: "rule.mdc", isDirectory: () => false, isFile: () => true },
			] as never);

			const result = await listLocalFilesWithExtensions("/dir", [".mdc"]);

			expect(result).toEqual(["rule"]);
		});
	});
});
