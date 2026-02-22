import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getGitEmail,
	getGitUsername,
	initGitRepo,
	isGitRepo,
	makeInitialCommit,
} from "../../src/core/git";
import * as shell from "../../src/core/shell";

describe("core/git", () => {
	let runAsyncSpy: any;
	let existsSyncSpy: any;

	beforeEach(() => {
		runAsyncSpy = vi.spyOn(shell as any, "runAsync");
		existsSyncSpy = vi.spyOn(fs as any, "existsSync");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getGitUsername", () => {
		it("returns trimmed git user.name when set", async () => {
			runAsyncSpy.mockResolvedValue(" Jane Doe \n");

			const result = await getGitUsername();

			expect(runAsyncSpy).toHaveBeenCalledWith("git config --get user.name", {
				stdio: "pipe",
			});
			expect(result).toBe("Jane Doe");
		});

		it("returns undefined when git user.name is empty or whitespace", async () => {
			runAsyncSpy.mockResolvedValue("   \n");

			const result = await getGitUsername();

			expect(result).toBeUndefined();
		});

		it("returns undefined when git config command fails", async () => {
			runAsyncSpy.mockRejectedValue(new Error("git not available"));

			const result = await getGitUsername();

			expect(result).toBeUndefined();
		});
	});

	describe("getGitEmail", () => {
		it("returns trimmed git user.email when set", async () => {
			runAsyncSpy.mockResolvedValue(" user@example.com \n");

			const result = await getGitEmail();

			expect(runAsyncSpy).toHaveBeenCalledWith("git config --get user.email", {
				stdio: "pipe",
			});
			expect(result).toBe("user@example.com");
		});

		it("returns undefined when git user.email is empty or whitespace", async () => {
			runAsyncSpy.mockResolvedValue("\n");

			const result = await getGitEmail();

			expect(result).toBeUndefined();
		});

		it("returns undefined when git config command fails", async () => {
			runAsyncSpy.mockRejectedValue(new Error("git not available"));

			const result = await getGitEmail();

			expect(result).toBeUndefined();
		});
	});

	describe("isGitRepo", () => {
		it("returns true when .git directory exists", () => {
			const cwd = "/project/root";
			const expectedPath = path.join(cwd, ".git");
			existsSyncSpy.mockReturnValue(true);

			const result = isGitRepo(cwd);

			expect(existsSyncSpy).toHaveBeenCalledWith(expectedPath);
			expect(result).toBe(true);
		});

		it("returns false when .git directory does not exist", () => {
			const cwd = "/project/root";
			existsSyncSpy.mockReturnValue(false);

			const result = isGitRepo(cwd);

			expect(result).toBe(false);
		});
	});

	describe("initGitRepo", () => {
		it("does nothing when directory is already a git repo", async () => {
			const cwd = "/repo";
			existsSyncSpy.mockReturnValue(true);

			await initGitRepo(cwd);

			expect(runAsyncSpy).not.toHaveBeenCalled();
		});

		it("initializes a new git repo with main branch when not already a repo", async () => {
			const cwd = "/new-repo";
			existsSyncSpy.mockReturnValue(false);
			runAsyncSpy.mockResolvedValue("");

			await initGitRepo(cwd);

			expect(runAsyncSpy).toHaveBeenCalledWith("git init -b main", {
				cwd,
				stdio: "ignore",
			});
		});

		it("wraps initialization errors with context", async () => {
			const cwd = "/bad-repo";
			existsSyncSpy.mockReturnValue(false);
			runAsyncSpy.mockRejectedValue(new Error("git init failed"));

			await expect(initGitRepo(cwd)).rejects.toThrowError(
				`Failed to initialize git repository in ${cwd}: git init failed`,
			);
		});

		it("handles non-Error thrown values when initialization fails", async () => {
			const cwd = "/weird-repo";
			existsSyncSpy.mockReturnValue(false);
			runAsyncSpy.mockRejectedValue("some failure");

			await expect(initGitRepo(cwd)).rejects.toThrowError(
				`Failed to initialize git repository in ${cwd}: some failure`,
			);
		});
	});

	describe("makeInitialCommit", () => {
		it("stages all files and creates an initial commit when repo already exists", async () => {
			const cwd = "/existing-repo";
			existsSyncSpy.mockReturnValue(true);
			runAsyncSpy.mockResolvedValue("");

			await makeInitialCommit(cwd);

			// Should not attempt to re-initialize if already a repo
			expect(runAsyncSpy).toHaveBeenNthCalledWith(1, "git add -A", {
				cwd,
				stdio: "ignore",
			});
			expect(runAsyncSpy).toHaveBeenNthCalledWith(
				2,
				'git commit -m "chore: initial commit"',
				{ cwd, stdio: "ignore" },
			);
		});

		it("initializes repo first when not a git repo", async () => {
			const cwd = "/fresh-repo";
			existsSyncSpy.mockReturnValue(false);
			runAsyncSpy.mockResolvedValue("");

			await makeInitialCommit(cwd);

			// When not a repo, initGitRepo should run before add/commit, which results
			// in an extra initial runAsync call prior to the git add/commit calls.
			expect(runAsyncSpy).toHaveBeenNthCalledWith(1, "git init -b main", {
				cwd,
				stdio: "ignore",
			});
			expect(runAsyncSpy).toHaveBeenNthCalledWith(2, "git add -A", {
				cwd,
				stdio: "ignore",
			});
			expect(runAsyncSpy).toHaveBeenNthCalledWith(
				3,
				'git commit -m "chore: initial commit"',
				{ cwd, stdio: "ignore" },
			);
		});

		it("wraps errors during staging or committing with context", async () => {
			const cwd = "/failing-repo";
			existsSyncSpy.mockReturnValue(true);
			runAsyncSpy.mockRejectedValue(new Error("git add failed"));

			await expect(makeInitialCommit(cwd)).rejects.toThrowError(
				`Failed to create initial git commit in ${cwd}: git add failed`,
			);
		});

		it("handles non-Error thrown values during commit", async () => {
			const cwd = "/weird-commit-repo";
			existsSyncSpy.mockReturnValue(true);
			runAsyncSpy.mockRejectedValue("some commit error");

			await expect(makeInitialCommit(cwd)).rejects.toThrowError(
				`Failed to create initial git commit in ${cwd}: some commit error`,
			);
		});
	});
});
