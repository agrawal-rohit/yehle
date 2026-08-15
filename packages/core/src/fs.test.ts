/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: false positive for test files */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	isFileAsync,
	readDirectoryAsync,
	readFileAsync,
	removeAsync,
	writeFileAsync,
} from "./fs";

function makeTempDir(prefix = "fs-test-"): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	return tmp;
}

describe("core/fs", () => {
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
