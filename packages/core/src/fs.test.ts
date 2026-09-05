/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: false positive for test files */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	InvalidJsonError,
	isFileAsync,
	isMissingPathError,
	lstatAsync,
	PathKind,
	pathKindAsync,
	readDirectoryAsync,
	readFileAsync,
	readJsonFileAsync,
	removeAsync,
	writeFileAsync,
} from "./fs";

const createdDirs: string[] = [];

function makeTempDir(prefix = "fs-test-"): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	createdDirs.push(tmp);
	return tmp;
}

afterEach(() => {
	while (createdDirs.length > 0) {
		const dir = createdDirs.pop();
		if (dir) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("core/fs", () => {
	describe("isMissingPathError", () => {
		it("detects ENOENT and rejects other errors", () => {
			expect(isMissingPathError({ code: "ENOENT" })).toBe(true);
			expect(isMissingPathError({ code: "EACCES" })).toBe(false);
			expect(isMissingPathError(null)).toBe(false);
			expect(isMissingPathError("ENOENT")).toBe(false);
		});
	});

	describe("pathKindAsync", () => {
		it("classifies files, directories, and missing paths", async () => {
			const root = makeTempDir();
			const file = path.join(root, "file.txt");
			fs.writeFileSync(file, "content", "utf8");

			await expect(pathKindAsync(file)).resolves.toBe(PathKind.FILE);
			await expect(pathKindAsync(root)).resolves.toBe(PathKind.DIRECTORY);
			await expect(pathKindAsync(path.join(root, "missing.txt"))).resolves.toBe(
				PathKind.ABSENT,
			);
		});

		it("rejects special filesystem nodes that are neither files nor directories", async () => {
			vi.spyOn(fs.promises, "stat").mockResolvedValueOnce({
				isDirectory: () => false,
				isFile: () => false,
			} as fs.Stats);

			await expect(pathKindAsync("/tmp/special-node")).rejects.toThrow(
				"neither a file nor a directory",
			);
		});

		it("rethrows filesystem errors other than missing paths", async () => {
			vi.spyOn(fs.promises, "stat").mockRejectedValueOnce(
				Object.assign(new Error("permission denied"), { code: "EACCES" }),
			);

			await expect(pathKindAsync("/tmp/forbidden")).rejects.toThrow(
				"permission denied",
			);
		});
	});

	describe("lstatAsync", () => {
		it("returns stats for existing paths and undefined for missing ones", async () => {
			const root = makeTempDir();
			const file = path.join(root, "file.txt");
			fs.writeFileSync(file, "content", "utf8");

			await expect(lstatAsync(file)).resolves.toBeInstanceOf(fs.Stats);
			await expect(lstatAsync(path.join(root, "missing.txt"))).resolves.toBe(
				undefined,
			);
		});
	});

	describe("isFileAsync", () => {
		it("returns true when path is a file", async () => {
			const root = makeTempDir();
			const file = path.join(root, "file.txt");
			fs.writeFileSync(file, "content", "utf8");

			await expect(isFileAsync(file)).resolves.toBe(true);
		});

		it("returns false when path does not exist", async () => {
			const root = makeTempDir();
			const file = path.join(root, "missing.txt");

			await expect(isFileAsync(file)).resolves.toBe(false);
		});

		it("returns false when path is a directory", async () => {
			const root = makeTempDir();

			await expect(isFileAsync(root)).resolves.toBe(false);
		});

		it("rethrows filesystem errors other than missing paths", async () => {
			vi.spyOn(fs.promises, "stat").mockRejectedValueOnce(
				Object.assign(new Error("permission denied"), { code: "EACCES" }),
			);

			await expect(isFileAsync("/tmp/forbidden")).rejects.toThrow(
				"permission denied",
			);
		});
	});

	describe("readFileAsync", () => {
		it("returns UTF-8 file contents", async () => {
			const root = makeTempDir();
			const file = path.join(root, "note.txt");
			fs.writeFileSync(file, "hello\n", "utf8");

			await expect(readFileAsync(file)).resolves.toBe("hello\n");
		});

		it("rejects when the file does not exist", async () => {
			const root = makeTempDir();

			await expect(
				readFileAsync(path.join(root, "missing.txt")),
			).rejects.toThrow();
		});
	});

	describe("readJsonFileAsync", () => {
		it("parses a JSON object from disk", async () => {
			const root = makeTempDir();
			const file = path.join(root, "data.json");
			fs.writeFileSync(file, '{"version":"1.0.0"}\n', "utf8");

			await expect(readJsonFileAsync(file, "Package")).resolves.toEqual({
				version: "1.0.0",
			});
		});

		it("rejects with a labeled InvalidJsonError when JSON is invalid", async () => {
			const root = makeTempDir();
			const file = path.join(root, "bad.json");
			fs.writeFileSync(file, "{ not json\n", "utf8");

			await expect(readJsonFileAsync(file, "Package")).rejects.toThrow(
				InvalidJsonError,
			);
			await expect(readJsonFileAsync(file, "Package")).rejects.toThrow(
				"Package is not valid JSON:",
			);
		});

		it("stringifies non-Error parse failures", async () => {
			const root = makeTempDir();
			const file = path.join(root, "data.json");
			fs.writeFileSync(file, "{}\n", "utf8");
			const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
				throw "not-an-error";
			});

			try {
				await expect(readJsonFileAsync(file, "Package")).rejects.toThrow(
					"Package is not valid JSON: not-an-error",
				);
			} finally {
				parseSpy.mockRestore();
			}
		});

		it("rejects when the file does not exist", async () => {
			const root = makeTempDir();

			await expect(
				readJsonFileAsync(path.join(root, "missing.json"), "Package"),
			).rejects.toThrow();
		});
	});

	describe("writeFileAsync", () => {
		it("writes file and creates parent directories", async () => {
			const root = makeTempDir();
			const file = path.join(root, "nested", "out.txt");

			await writeFileAsync(file, "hello world");

			expect(fs.readFileSync(file, "utf8")).toBe("hello world");
		});

		it("overwrites existing file", async () => {
			const root = makeTempDir();
			const file = path.join(root, "out.txt");
			fs.writeFileSync(file, "old", "utf8");

			await writeFileAsync(file, "new");

			expect(fs.readFileSync(file, "utf8")).toBe("new");
		});
	});

	describe("readDirectoryAsync", () => {
		it("lists files and directories", async () => {
			const root = makeTempDir();
			fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
			fs.mkdirSync(path.join(root, "nested"));

			const entries = await readDirectoryAsync(root);
			const names = entries.map((entry) => entry.name).sort();

			expect(names).toEqual(["a.txt", "nested"]);
			expect(entries.find((entry) => entry.name === "a.txt")?.isFile()).toBe(
				true,
			);
			expect(
				entries.find((entry) => entry.name === "nested")?.isDirectory(),
			).toBe(true);
		});

		it("rejects when the directory does not exist", async () => {
			const root = makeTempDir();

			await expect(
				readDirectoryAsync(path.join(root, "missing")),
			).rejects.toThrow();
		});
	});

	describe("removeAsync", () => {
		it("removes a directory tree", async () => {
			const root = makeTempDir();
			const nested = path.join(root, "stale", "old.json");
			fs.mkdirSync(path.dirname(nested), { recursive: true });
			fs.writeFileSync(nested, "{}\n", "utf8");

			await removeAsync(path.join(root, "stale"));

			expect(fs.existsSync(path.join(root, "stale"))).toBe(false);
		});

		it("ignores a missing path", async () => {
			const root = makeTempDir();

			await expect(
				removeAsync(path.join(root, "missing")),
			).resolves.toBeUndefined();
		});
	});
});
