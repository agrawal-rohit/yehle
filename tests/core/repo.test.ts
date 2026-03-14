import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_GITHUB_OWNER,
	DEFAULT_GITHUB_REPO,
	GITHUB_HEADERS,
	getLocalInstructionsRoot,
	getLocalRoot,
	getLocalTemplatesRoot,
} from "../../src/core/repo";

describe("core/repo", () => {
	const tmpRoots: string[] = [];

	afterEach(() => {
		for (const dir of tmpRoots.splice(0)) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	function makeTempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		tmpRoots.push(dir);
		return dir;
	}

	describe("constants", () => {
		it("exports DEFAULT_GITHUB_OWNER and DEFAULT_GITHUB_REPO", () => {
			expect(DEFAULT_GITHUB_OWNER).toBe("agrawal-rohit");
			expect(DEFAULT_GITHUB_REPO).toBe("yehle");
		});

		it("exports GITHUB_HEADERS with User-Agent and Accept", () => {
			expect(GITHUB_HEADERS).toEqual({
				"User-Agent": "yehle-cli",
				Accept: "application/vnd.github.v3+json",
			});
		});
	});

	describe("getLocalRoot", () => {
		it("returns absolute path when directory exists under cwd", async () => {
			const projectRoot = makeTempDir("yehle-repo-");
			const customDir = path.join(projectRoot, "custom-dir");
			fs.mkdirSync(customDir, { recursive: true });

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getLocalRoot("custom-dir");
				expect(result).not.toBeNull();
				if (result === null) return;
				expect(path.isAbsolute(result)).toBe(true);
				expect(fs.realpathSync(result)).toBe(
					fs.realpathSync(customDir),
				);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns null when directory does not exist under cwd", async () => {
			const projectRoot = makeTempDir("yehle-repo-");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getLocalRoot("nonexistent-dir");
				expect(result).toBeNull();
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns null when path under cwd is a file, not a directory", async () => {
			const projectRoot = makeTempDir("yehle-repo-");
			const filePath = path.join(projectRoot, "a-file");
			fs.writeFileSync(filePath, "content", "utf8");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getLocalRoot("a-file");
				expect(result).toBeNull();
			} finally {
				process.chdir(originalCwd);
			}
		});
	});

	describe("getLocalTemplatesRoot", () => {
		it("returns path to templates when templates exists under cwd", async () => {
			const projectRoot = makeTempDir("yehle-repo-");
			const templatesDir = path.join(projectRoot, "templates");
			fs.mkdirSync(templatesDir, { recursive: true });

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getLocalTemplatesRoot();
				expect(result).not.toBeNull();
				if (result === null) return;
				expect(fs.realpathSync(result)).toBe(
					fs.realpathSync(templatesDir),
				);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns null when templates does not exist under cwd", async () => {
			const projectRoot = makeTempDir("yehle-repo-");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getLocalTemplatesRoot();
				expect(result).toBeNull();
			} finally {
				process.chdir(originalCwd);
			}
		});
	});

	describe("getLocalInstructionsRoot", () => {
		it("returns path to instructions when instructions exists under cwd", async () => {
			const projectRoot = makeTempDir("yehle-repo-");
			const instructionsDir = path.join(projectRoot, "instructions");
			fs.mkdirSync(instructionsDir, { recursive: true });

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getLocalInstructionsRoot();
				expect(result).not.toBeNull();
				if (result === null) return;
				expect(fs.realpathSync(result)).toBe(
					fs.realpathSync(instructionsDir),
				);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns null when instructions does not exist under cwd", async () => {
			const projectRoot = makeTempDir("yehle-repo-");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getLocalInstructionsRoot();
				expect(result).toBeNull();
			} finally {
				process.chdir(originalCwd);
			}
		});
	});
});
