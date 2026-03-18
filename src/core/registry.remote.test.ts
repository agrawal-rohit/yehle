import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("giget", () => ({
	downloadTemplate: vi.fn(),
}));

vi.mock("node:fs", () => ({
	default: {
		promises: {
			mkdtemp: vi.fn(),
		},
	},
}));

vi.mock("./constants", () => ({
	DEFAULT_GITHUB_OWNER: "agrawal-rohit",
	DEFAULT_GITHUB_REPO: "yehle",
	GITHUB_HEADERS: {
		Accept: "application/vnd.github.v3+json",
		Authorization: "token undefined",
		"User-Agent": "yehle",
	},
}));

vi.mock("./fs", () => ({
	isDirAsync: vi.fn(),
}));

// Import after mocks
import fs from "node:fs";
import { downloadTemplate } from "giget";
import { DEFAULT_GITHUB_OWNER, DEFAULT_GITHUB_REPO } from "./constants";
import { isDirAsync } from "./fs";
import {
	buildContentsURL,
	buildGigetSpec,
	downloadSubtreeToTemp,
	listRemoteChildDirsViaAPI,
	listRemoteFilesViaAPI,
	remoteSubpathExists,
	resolveRemoteSubpath,
} from "./registry.remote";

describe("core/registry.remote", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("buildContentsURL", () => {
		it("should build correct GitHub Contents API URL", () => {
			const result = buildContentsURL("templates/typescript");

			expect(result).toBe(
				`https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/contents/templates/typescript`,
			);
		});

		it("should handle simple subpath", () => {
			const result = buildContentsURL("templates");

			expect(result).toBe(
				`https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/contents/templates`,
			);
		});
	});

	describe("buildGigetSpec", () => {
		it("should build correct giget spec string", () => {
			const result = buildGigetSpec("templates/typescript");

			expect(result).toBe(
				`github:${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/templates/typescript`,
			);
		});

		it("should handle simple subpath", () => {
			const result = buildGigetSpec("templates");

			expect(result).toBe(
				`github:${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/templates`,
			);
		});
	});

	describe("downloadSubtreeToTemp", () => {
		it("should create temp directory and download template", async () => {
			const mockTmpDir = "/tmp/yehle-templates-abc123";
			const mockDownloadDir = "/tmp/yehle-templates-abc123/typescript";

			vi.mocked(fs.promises.mkdtemp).mockResolvedValue(mockTmpDir);
			vi.mocked(downloadTemplate).mockResolvedValue({
				dir: mockDownloadDir,
			} as never);

			const result = await downloadSubtreeToTemp(
				"templates/typescript",
				"yehle-",
			);

			expect(fs.promises.mkdtemp).toHaveBeenCalled();
			expect(downloadTemplate).toHaveBeenCalledWith(
				"github:agrawal-rohit/yehle/templates/typescript",
				{ dir: mockTmpDir, force: true },
			);
			expect(result).toBe(mockDownloadDir);
		});

		it("should throw descriptive error on download failure", async () => {
			vi.mocked(fs.promises.mkdtemp).mockResolvedValue("/tmp/yehle-abc");
			vi.mocked(downloadTemplate).mockRejectedValue(new Error("Network error"));

			await expect(
				downloadSubtreeToTemp("templates/nonexistent", "yehle-"),
			).rejects.toThrow(
				/Failed to download templates from "github:agrawal-rohit\/yehle\/templates\/nonexistent"/,
			);
		});

		it("should include original error message in thrown error", async () => {
			vi.mocked(fs.promises.mkdtemp).mockResolvedValue("/tmp/yehle-abc");
			vi.mocked(downloadTemplate).mockRejectedValue(
				new Error("Connection refused"),
			);

			try {
				await downloadSubtreeToTemp("templates/test", "yehle-");
				expect(true).toBe(false); // Should not reach here
			} catch (e) {
				expect(e).toBeInstanceOf(Error);
				expect((e as Error).message).toContain("Connection refused");
			}
		});
	});

	describe("remoteSubpathExists", () => {
		it("should return true when subpath returns array of contents", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => [
					{ name: "typescript", type: "dir" },
					{ name: "python", type: "dir" },
				],
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await remoteSubpathExists("templates");

			expect(result).toBe(true);
		});

		it("should return true when subpath returns object with type=dir", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => ({
					name: "typescript",
					type: "dir",
					path: "templates/typescript",
				}),
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await remoteSubpathExists("templates/typescript");

			expect(result).toBe(true);
		});

		it("should return false when status is 404", async () => {
			const mockResponse = {
				ok: false,
				status: 404,
				statusText: "Not Found",
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await remoteSubpathExists("templates/nonexistent");

			expect(result).toBe(false);
		});

		it("should return false when response is not ok (non-404)", async () => {
			const mockResponse = {
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await remoteSubpathExists("templates");

			expect(result).toBe(false);
		});

		it("should return false when data is object with non-dir type", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => ({
					name: "README.md",
					type: "file",
					path: "templates/README.md",
				}),
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await remoteSubpathExists("templates/README.md");

			expect(result).toBe(false);
		});

		it("should return false on network error", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValue(
				new Error("Network error"),
			);

			const result = await remoteSubpathExists("templates");

			expect(result).toBe(false);
		});
	});

	describe("listRemoteChildDirsViaAPI", () => {
		it("should return directory names from API response", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => [
					{ name: "src", type: "dir" },
					{ name: "dist", type: "dir" },
					{ name: "package.json", type: "file" },
				],
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await listRemoteChildDirsViaAPI("templates/typescript");

			// Returns in original order
			expect(result).toEqual(["src", "dist"]);
		});

		it("should exclude specified directories (case-insensitive)", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => [
					{ name: "src", type: "dir" },
					{ name: "dist", type: "dir" },
					{ name: "node_modules", type: "dir" },
				],
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await listRemoteChildDirsViaAPI(
				"templates/typescript",
				new Set(["dist", "tests"]),
			);

			// Returns in original order, filtered
			expect(result).toEqual(["src", "node_modules"]);
		});

		it("should throw when response is not ok", async () => {
			const mockResponse = {
				ok: false,
				status: 403,
				statusText: "Forbidden",
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			await expect(listRemoteChildDirsViaAPI("templates")).rejects.toThrow(
				"Failed to fetch from GitHub API: 403 Forbidden",
			);
		});

		it("should throw when response is not an array", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => ({ message: "Not Found" }),
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			await expect(listRemoteChildDirsViaAPI("templates")).rejects.toThrow(
				"Invalid response from GitHub API: expected array of contents",
			);
		});

		it("should filter out entries without type=dir", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => [
					{ name: "src", type: "dir" },
					{ name: "README.md", type: "file" },
					{ name: "config.json", type: "file" },
				],
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await listRemoteChildDirsViaAPI("templates");

			expect(result).toEqual(["src"]);
		});
	});

	describe("listRemoteFilesViaAPI", () => {
		it("should return file basenames without extensions, sorted", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => [
					{ name: "zebra.mdc", type: "file" },
					{ name: "alpha.mdc", type: "file" },
					{ name: "beta.md", type: "file" },
				],
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await listRemoteFilesViaAPI("instructions", [
				".mdc",
				".md",
			]);

			expect(result).toEqual(["alpha", "beta", "zebra"]);
		});

		it("should filter by specified extensions only", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => [
					{ name: "rule.mdc", type: "file" },
					{ name: "readme.txt", type: "file" },
					{ name: "doc.md", type: "file" },
				],
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await listRemoteFilesViaAPI("instructions", [".mdc"]);

			expect(result).toEqual(["rule"]);
		});

		it("should throw when response is not ok", async () => {
			const mockResponse = {
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			await expect(
				listRemoteFilesViaAPI("instructions", [".mdc"]),
			).rejects.toThrow("Failed to fetch from GitHub API: 401 Unauthorized");
		});

		it("should throw when response is not an array", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => null,
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			await expect(
				listRemoteFilesViaAPI("instructions", [".mdc"]),
			).rejects.toThrow(
				"Invalid response from GitHub API: expected array of contents",
			);
		});

		it("should filter out directories and non-matching extensions", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				json: async () => [
					{ name: "subdir", type: "dir" },
					{ name: "rule.mdc", type: "file" },
					{ name: "data.json", type: "file" },
				],
			} as unknown as Response;
			vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

			const result = await listRemoteFilesViaAPI("instructions", [".mdc"]);

			expect(result).toEqual(["rule"]);
		});
	});

	describe("resolveRemoteSubpath", () => {
		it("should download and normalize subpath when it exists", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => [{ name: "typescript", type: "dir" }],
			} as unknown as Response);

			const mockTmpDir = "/tmp/yehle-download";
			const mockNormalizedDir = "/tmp/yehle-download/normalized";

			vi.mocked(fs.promises.mkdtemp).mockResolvedValue(mockTmpDir);
			vi.mocked(downloadTemplate).mockResolvedValue({
				dir: mockTmpDir,
			} as never);
			vi.mocked(isDirAsync).mockResolvedValue(true);

			const normalizeFn = vi.fn().mockResolvedValue(mockNormalizedDir);

			const result = await resolveRemoteSubpath(
				"templates/typescript",
				"yehle-",
				normalizeFn,
			);

			expect(normalizeFn).toHaveBeenCalledWith(mockTmpDir);
			expect(result).toBe(mockNormalizedDir);
		});

		it("should throw when subpath does not exist", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: false,
				status: 404,
			} as unknown as Response);

			await expect(
				resolveRemoteSubpath("templates/nonexistent", "yehle-"),
			).rejects.toThrow(
				"Remote templates path does not exist: templates/nonexistent",
			);
		});

		it("should use downloaded dir directly when no normalize function provided", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => [{ name: "typescript", type: "dir" }],
			} as unknown as Response);

			const mockTmpDir = "/tmp/yehle-download";

			vi.mocked(fs.promises.mkdtemp).mockResolvedValue(mockTmpDir);
			vi.mocked(downloadTemplate).mockResolvedValue({
				dir: mockTmpDir,
			} as never);
			vi.mocked(isDirAsync).mockResolvedValue(true);

			const result = await resolveRemoteSubpath(
				"templates/typescript",
				"yehle-",
			);

			expect(result).toBe(mockTmpDir);
		});

		it("should throw when normalized path is not a directory", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => [{ name: "typescript", type: "dir" }],
			} as unknown as Response);

			const mockTmpDir = "/tmp/yehle-download";

			vi.mocked(fs.promises.mkdtemp).mockResolvedValue(mockTmpDir);
			vi.mocked(downloadTemplate).mockResolvedValue({
				dir: mockTmpDir,
			} as never);
			vi.mocked(isDirAsync).mockResolvedValue(false);

			await expect(
				resolveRemoteSubpath("templates/typescript", "yehle-"),
			).rejects.toThrow(/No remote templates found at templates\/typescript/);
		});
	});
});
