import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmInput = vi.fn();

vi.mock("../cli/prompts", () => ({
	confirmInput: (...args: unknown[]) => mockConfirmInput(...args),
}));

import {
	confirmFileOverwrites,
	planFileWrites,
	writePlannedFile,
} from "./files";

describe("utils/files", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "add-files-"));
		vi.clearAllMocks();
		mockConfirmInput.mockResolvedValue(true);
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("rejects colliding destinations across items", async () => {
		await expect(
			planFileWrites(tempDir, [
				{
					label: "One",
					compiledItem: { files: [{ target: "HELLO.md", content: "a" }] },
				},
				{
					label: "Two",
					compiledItem: { files: [{ target: "HELLO.md", content: "b" }] },
				},
			]),
		).rejects.toThrow("Multiple compiled items write to the same target");
	});

	it("rejects path traversal with a payload-target label", async () => {
		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: {
						files: [{ target: "../escape.txt", content: "hi" }],
					},
				},
			]),
		).rejects.toThrow(
			'Compiled item file target "../escape.txt" must be a relative path under the project directory.',
		);
	});

	it("plans existing files for overwrite regardless of content", async () => {
		fs.writeFileSync(path.join(tempDir, "HELLO.md"), "same");

		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: { files: [{ target: "HELLO.md", content: "same" }] },
				},
			]),
		).resolves.toEqual({
			items: [
				{
					label: "Hello",
					files: [
						{
							target: "HELLO.md",
							destination: path.join(tempDir, "HELLO.md"),
							content: "same",
							projectDir: tempDir,
						},
					],
				},
			],
			conflicts: ["HELLO.md"],
		});
	});

	it("lists existing files that differ as conflicts", async () => {
		fs.writeFileSync(path.join(tempDir, "HELLO.md"), "old");

		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: { files: [{ target: "HELLO.md", content: "new" }] },
				},
			]),
		).resolves.toEqual({
			items: [
				{
					label: "Hello",
					files: [
						{
							target: "HELLO.md",
							destination: path.join(tempDir, "HELLO.md"),
							content: "new",
							projectDir: tempDir,
						},
					],
				},
			],
			conflicts: ["HELLO.md"],
		});
	});

	it("plans new files without conflicts", async () => {
		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: { files: [{ target: "HELLO.md", content: "hi" }] },
				},
			]),
		).resolves.toEqual({
			items: [
				{
					label: "Hello",
					files: [
						{
							target: "HELLO.md",
							destination: path.join(tempDir, "HELLO.md"),
							content: "hi",
							projectDir: tempDir,
						},
					],
				},
			],
			conflicts: [],
		});
	});

	it("rejects a destination that exists as a directory", async () => {
		fs.mkdirSync(path.join(tempDir, "HELLO.md"));

		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: { files: [{ target: "HELLO.md", content: "hi" }] },
				},
			]),
		).rejects.toThrow("exists and is a directory");
	});

	it("rejects a destination that is a symbolic link", async () => {
		const realFile = path.join(tempDir, "real.md");
		fs.writeFileSync(realFile, "real");
		fs.symlinkSync(realFile, path.join(tempDir, "HELLO.md"));

		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: { files: [{ target: "HELLO.md", content: "hi" }] },
				},
			]),
		).rejects.toThrow("exists and is a symbolic link");
	});

	it("rejects a destination that is neither a file nor a directory", async () => {
		const destination = path.join(tempDir, "HELLO.md");
		const realLstat = fs.promises.lstat.bind(fs.promises);
		vi.spyOn(fs.promises, "lstat").mockImplementation(async (targetPath) => {
			if (path.resolve(String(targetPath)) === path.resolve(destination)) {
				return {
					isSymbolicLink: () => false,
					isDirectory: () => false,
					isFile: () => false,
				} as fs.Stats;
			}
			return realLstat(targetPath);
		});

		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: { files: [{ target: "HELLO.md", content: "hi" }] },
				},
			]),
		).rejects.toThrow("exists but is neither a file nor a directory");
	});

	it("rethrows unexpected destination lstat errors", async () => {
		const destination = path.join(tempDir, "HELLO.md");
		const error = Object.assign(new Error("permission denied"), {
			code: "EACCES",
		});
		const realLstat = fs.promises.lstat.bind(fs.promises);
		vi.spyOn(fs.promises, "lstat").mockImplementation(async (targetPath) => {
			if (path.resolve(String(targetPath)) === path.resolve(destination))
				throw error;
			return realLstat(targetPath);
		});

		await expect(
			planFileWrites(tempDir, [
				{
					label: "Hello",
					compiledItem: { files: [{ target: "HELLO.md", content: "hi" }] },
				},
			]),
		).rejects.toBe(error);
	});

	it("rejects a destination whose ancestor is a symbolic link", async () => {
		const outside = fs.mkdtempSync(
			path.join(os.tmpdir(), "add-files-outside-"),
		);
		try {
			fs.symlinkSync(outside, path.join(tempDir, "vendor"));

			await expect(
				planFileWrites(tempDir, [
					{
						label: "Hello",
						compiledItem: {
							files: [{ target: "vendor/HELLO.md", content: "hi" }],
						},
					},
				]),
			).rejects.toThrow("path includes a symbolic link");
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});

	it("prompts once before overwriting an existing file", async () => {
		await confirmFileOverwrites(["HELLO.md"], false);

		expect(mockConfirmInput).toHaveBeenCalledTimes(1);
		expect(mockConfirmInput).toHaveBeenCalledWith(
			expect.stringContaining("HELLO.md"),
			{},
			false,
		);
	});

	it("prompts once for several existing files", async () => {
		await confirmFileOverwrites(["a.txt", "b.txt"], false);

		expect(mockConfirmInput).toHaveBeenCalledTimes(1);
		expect(mockConfirmInput).toHaveBeenCalledWith(
			"Overwrite these files?",
			{},
			false,
		);
	});

	it("skips overwrite prompts when overwrite is true", async () => {
		await confirmFileOverwrites(["HELLO.md"], true);

		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("throws when overwrite is declined", async () => {
		mockConfirmInput.mockResolvedValue(false);

		await expect(confirmFileOverwrites(["HELLO.md"], false)).rejects.toThrow(
			"Installation canceled before overwriting",
		);
	});

	it("throws when overwrite of several files is declined", async () => {
		mockConfirmInput.mockResolvedValue(false);

		await expect(
			confirmFileOverwrites(["a.txt", "b.txt"], false),
		).rejects.toThrow(
			"Installation canceled before overwriting existing files.",
		);
	});

	it("writes a planned file", async () => {
		const destination = path.join(tempDir, "nested", "HELLO.md");
		await writePlannedFile({
			target: "nested/HELLO.md",
			destination,
			content: "hi",
			projectDir: tempDir,
		});

		expect(fs.readFileSync(destination, "utf8")).toBe("hi");
	});

	it("refuses to write when the destination became a directory after planning", async () => {
		const destination = path.join(tempDir, "HELLO.md");
		fs.mkdirSync(destination);

		await expect(
			writePlannedFile({
				target: "HELLO.md",
				destination,
				content: "hi",
				projectDir: tempDir,
			}),
		).rejects.toThrow("exists and is a directory");
	});
});
