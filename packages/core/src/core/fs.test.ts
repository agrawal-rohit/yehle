/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: false positive for test files */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isRegularFileAsync, readJSONFileAsync, writeFileAsync } from "./fs";

function makeTempDir(prefix = "fs-test-"): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	return tmp;
}

describe("core/fs", () => {
	describe("isRegularFileAsync", () => {
		it("returns true when path is a regular file", async () => {
			const root = makeTempDir();
			const file = path.join(root, "file.txt");
			fs.writeFileSync(file, "content", "utf8");

			await expect(isRegularFileAsync(file)).resolves.toBe(true);
		});

		it("returns false when path does not exist", async () => {
			const root = makeTempDir();
			const file = path.join(root, "missing.txt");

			await expect(isRegularFileAsync(file)).resolves.toBe(false);
		});

		it("returns false when path is a directory", async () => {
			const root = makeTempDir();

			await expect(isRegularFileAsync(root)).resolves.toBe(false);
		});
	});

	describe("readJSONFileAsync", () => {
		it("parses and returns JSON content", async () => {
			const root = makeTempDir();
			const file = path.join(root, "data.json");
			const data = { hello: "world", n: 42 };
			fs.writeFileSync(file, JSON.stringify(data), "utf8");

			await expect(readJSONFileAsync(file)).resolves.toEqual(data);
		});

		it("rejects when file does not exist", async () => {
			const root = makeTempDir();
			const file = path.join(root, "missing.json");

			await expect(readJSONFileAsync(file)).rejects.toThrow();
		});

		it("rejects when file contains invalid JSON", async () => {
			const root = makeTempDir();
			const file = path.join(root, "bad.json");
			fs.writeFileSync(file, "{ not json", "utf8");

			await expect(readJSONFileAsync(file)).rejects.toThrow();
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
});
