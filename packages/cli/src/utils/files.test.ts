import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmInput = vi.fn();

vi.mock("../cli/prompts", () => ({
	confirmInput: (...args: unknown[]) => mockConfirmInput(...args),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	return {
		...actual,
		writeFileAsync: vi.fn(async () => undefined),
	};
});

import { type RegistryPayload, writeFileAsync } from "@tuckshop/core";
import {
	absoluteProjectTarget,
	confirmFileOverwrites,
	writePayloadFiles,
} from "./files";

/** Payload that omits `files` at runtime (parsed payloads always include it). */
const payloadWithoutFiles = {} as RegistryPayload;

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

	it("treats missing files arrays as empty during overwrite checks", async () => {
		await expect(
			confirmFileOverwrites(tempDir, [payloadWithoutFiles], false),
		).resolves.toBeUndefined();
		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("writes payloads that omit the files array", async () => {
		await writePayloadFiles(tempDir, payloadWithoutFiles, new Set());
		expect(writeFileAsync).not.toHaveBeenCalled();
	});

	it("rejects a destination already claimed in writtenTargets", async () => {
		const destination = absoluteProjectTarget(tempDir, "HELLO.md");
		await expect(
			writePayloadFiles(
				tempDir,
				{ files: [{ target: "HELLO.md", content: "hi" }] },
				new Set([destination]),
			),
		).rejects.toThrow("Multiple registry payloads write to the same target");
	});

	it("rejects path traversal with a payload-target label", () => {
		expect(() => absoluteProjectTarget(tempDir, "../escape.txt")).toThrow(
			'Payload file target "../escape.txt" must be a relative path under the project directory.',
		);
	});

	it("prompts before overwriting an existing file", async () => {
		fs.writeFileSync(path.join(tempDir, "HELLO.md"), "old");

		await confirmFileOverwrites(
			tempDir,
			[{ files: [{ target: "HELLO.md", content: "new" }] }],
			false,
		);

		expect(mockConfirmInput).toHaveBeenCalledWith(
			expect.stringContaining("HELLO.md"),
			{},
			false,
		);
	});

	it("skips overwrite prompts when overwrite is true", async () => {
		fs.writeFileSync(path.join(tempDir, "HELLO.md"), "old");

		await confirmFileOverwrites(
			tempDir,
			[{ files: [{ target: "HELLO.md", content: "new" }] }],
			true,
		);

		expect(mockConfirmInput).not.toHaveBeenCalled();
	});
});
