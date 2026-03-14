import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Language } from "../../src/resources/package/config";

vi.mock("giget", () => ({ downloadTemplate: vi.fn() }));

// Helper to load the module fresh with current env
const importTemplateRegistry = async () => {
	// Ensure a fresh module instance each time so process.env is re-read
	vi.resetModules();
	const modulePath = "../../src/core/template-registry";
	const resolved = await import(modulePath + "?t=" + Date.now());
	return resolved;
};

function setLocalModeEnv(value: boolean | undefined) {
	if (value === undefined) {
		delete (process.env as Record<string, string | undefined>)
			.YEHLE_LOCAL_TEMPLATES;
	} else {
		process.env.YEHLE_LOCAL_TEMPLATES = value ? "true" : "false";
	}
}

describe("core/template-registry", () => {
	const originalEnv = { ...process.env };
	const tmpRoots: string[] = [];

	beforeEach(() => {
		// Reset env before each test
		process.env = { ...originalEnv };
		delete process.env.YEHLE_LOCAL_TEMPLATES;
	});

	afterEach(() => {
		// Restore original env after each test
		process.env = originalEnv;
	});

	function makeTempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		tmpRoots.push(dir);
		return dir;
	}

	afterEach(() => {
		// Best-effort cleanup; ignore errors so tests don't fail on removal.
		for (const dir of tmpRoots.splice(0)) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	describe("resolveTemplatesDir", () => {
		describe("local", () => {
			it("returns a directory path for an existing local language/resource subtree", async () => {
				setLocalModeEnv(true);
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Create a fake ./templates tree in a temp cwd.
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");
				const lang = "typescript";
				const resource = "package";
				const expectedDir = path.join(templatesRoot, lang, resource);

				fs.mkdirSync(expectedDir, { recursive: true });

				// Change process.cwd within this test's scope.
				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					const dir = await resolveTemplatesDir(lang, resource);

					expect(fs.realpathSync(dir)).toBe(fs.realpathSync(expectedDir));
					const stat = fs.statSync(dir);
					expect(stat.isDirectory()).toBe(true);
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("returns a directory path for an existing local language subtree (without resource)", async () => {
				setLocalModeEnv(true);
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Create a fake ./templates tree in a temp cwd.
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");
				const lang = "typescript";
				const expectedDir = path.join(templatesRoot, lang);

				fs.mkdirSync(expectedDir, { recursive: true });

				// Change process.cwd within this test's scope.
				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					const dir = await resolveTemplatesDir(lang);

					expect(fs.realpathSync(dir)).toBe(fs.realpathSync(expectedDir));
					const stat = fs.statSync(dir);
					expect(stat.isDirectory()).toBe(true);
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("throws a descriptive error when local language/resource subtree does not exist", async () => {
				setLocalModeEnv(true);
				const { resolveTemplatesDir } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");

				const lang = "go";
				const resource = "api";

				// Create the root and language folder; no resource folder.
				fs.mkdirSync(templatesRoot, { recursive: true });
				const langRoot = path.join(templatesRoot, lang);
				fs.mkdirSync(langRoot, { recursive: true });

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					let error: unknown;
					try {
						await resolveTemplatesDir(lang, resource);
					} catch (e) {
						error = e;
					}

					expect(error).toBeInstanceOf(Error);
					if (error instanceof Error) {
						expect(error.message).toContain("Local templates not found");
						expect(error.message).toContain(lang);
						expect(error.message).toContain(resource);
					}
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("throws when templates directory does not exist", async () => {
				setLocalModeEnv(true);
				const { resolveTemplatesDir } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");

				const lang = "go";
				const resource = "api";

				// Do not create the templates directory

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					let error: unknown;
					try {
						await resolveTemplatesDir(lang, resource);
					} catch (e) {
						error = e;
					}

					expect(error).toBeInstanceOf(Error);
					if (error instanceof Error) {
						expect(error.message).toContain("Local templates not found");
						expect(error.message).toContain("<no local templates root>");
					}
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("throws when templates directory does not exist and no resource", async () => {
				setLocalModeEnv(true);
				const { resolveTemplatesDir } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");

				const lang = "go";

				// Do not create the templates directory

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					let error: unknown;
					try {
						await resolveTemplatesDir(lang);
					} catch (e) {
						error = e;
					}

					expect(error).toBeInstanceOf(Error);
					if (error instanceof Error) {
						expect(error.message).toContain("Local templates not found");
						expect(error.message).toContain("<no local templates root>");
						expect(error.message).toContain(`language "${lang}"`);
						expect(error.message).not.toContain("resource");
					}
				} finally {
					process.chdir(originalCwd);
				}
			});
		});
		describe("remote", () => {
			beforeEach(() => {
				setLocalModeEnv(false);
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response("[]", {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);
			});

			afterEach(() => {
				vi.unstubAllGlobals();
			});

			it("surfaces a clear error when remote templates path is definitely missing (404 from content probe)", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Simulate a 404 on the GitHub contents check.
				vi.stubGlobal(
					"fetch",
					vi
						.fn()
						.mockResolvedValueOnce(new Response("Not Found", { status: 404 })),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("nonexistent-lang", "nonexistent-resource");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Remote templates path does not exist",
					);
					expect(error.message).toContain(
						"templates/nonexistent-lang/nonexistent-resource",
					);
				}
			});

			it("surfaces a clear error when remote templates path without resource is definitely missing (404 from content probe)", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Simulate a 404 on the GitHub contents check.
				vi.stubGlobal(
					"fetch",
					vi
						.fn()
						.mockResolvedValueOnce(new Response("Not Found", { status: 404 })),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("nonexistent-lang");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Remote templates path does not exist",
					);
					expect(error.message).toContain("templates/nonexistent-lang");
					expect(error.message).not.toContain("/nonexistent-lang/");
				}
			});

			it("throws when remote templates path is a file", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to return a file response
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify({ type: "file" }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("nonexistent-lang");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Remote templates path does not exist",
					);
				}
			});

			it("returns a directory path for remote templates with resource", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to indicate the subtree exists
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify([]), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to succeed
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockResolvedValue({
					dir: "/tmp/yehle-templates",
					source: "mock",
				});

				// Mock isDirAsync to return true for the resource subdir
			});

			it("returns a directory path for remote templates without resource", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to indicate the subtree exists
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify([]), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to succeed
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockResolvedValue({
					dir: "/tmp/yehle-templates",
					source: "mock",
				});

				// Mock isDirAsync to return true for the normalized dir (language dir)
				const fsModule = await import("../../src/core/fs");
				const isDirAsyncSpy = vi.spyOn(fsModule, "isDirAsync");
				isDirAsyncSpy.mockImplementation(
					async (path: string) =>
						path === "/tmp/yehle-templates/templates/typescript",
				);

				const dir = await resolveTemplatesDir("typescript");

				expect(dir).toBe("/tmp/yehle-templates/templates/typescript");

				isDirAsyncSpy.mockRestore();
			});

			it("handles 403 response from GitHub API", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to return 403
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response("Forbidden", {
							status: 403,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to succeed
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockResolvedValue({
					dir: "/tmp/yehle-templates",
					source: "mock",
				});

				// Mock isDirAsync to return true for downloaded dir
				const fsModule = await import("../../src/core/fs");
				const isDirAsyncSpy = vi.spyOn(fsModule, "isDirAsync");
				isDirAsyncSpy.mockResolvedValue(true);

				const result = await resolveTemplatesDir("typescript", "package");
				expect(result).toBe(
					"/tmp/yehle-templates/templates/typescript/package",
				);

				isDirAsyncSpy.mockRestore();
			});

			it("handles dir type response from GitHub API", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to return {type: "dir"}
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify({ type: "dir" }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to succeed
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockResolvedValue({
					dir: "/tmp/yehle-templates",
					source: "mock",
				});

				// Mock isDirAsync to return true for downloaded dir
				const fsModule = await import("../../src/core/fs");
				const isDirAsyncSpy = vi.spyOn(fsModule, "isDirAsync");

				isDirAsyncSpy.mockRestore();
			});

			it("handles file type response from GitHub API", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to return {type: "file"}
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify({ type: "file" }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("typescript", "package");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Remote templates path does not exist",
					);
				}
			});

			it("throws when downloaded directory does not exist", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to indicate the subtree exists
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify([]), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to succeed
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockResolvedValue({
					dir: "/tmp/yehle-templates",
					source: "mock",
				});

				// Mock isDirAsync to return false
				const fsModule = await import("../../src/core/fs");
				const isDirAsyncSpy = vi.spyOn(fsModule, "isDirAsync");
				isDirAsyncSpy.mockResolvedValue(false);

				let error: unknown;
				try {
					await resolveTemplatesDir("typescript", "resource");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain("No remote templates found");
				}

				isDirAsyncSpy.mockRestore();
			});

			it("handles null json response from GitHub API", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to return null
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify(null), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("typescript", "package");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Remote templates path does not exist",
					);
				}
			});

			it("handles non-object json response from GitHub API", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to return a string
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify("not an object"), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("typescript", "package");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Remote templates path does not exist",
					);
				}
			});

			it("throws when downloaded directory does not exist", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to indicate the subtree exists
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify([]), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to succeed
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockResolvedValue({
					dir: "/tmp/yehle-templates",
					source: "mock",
				});

				// Mock isDirAsync to return false
				const fsModule = await import("../../src/core/fs");
				const isDirAsyncSpy = vi.spyOn(fsModule, "isDirAsync");
				isDirAsyncSpy.mockResolvedValue(false);

				let error: unknown;
				try {
					await resolveTemplatesDir("typescript");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain("No remote templates found");
					expect(error.message).toContain(`language "typescript"`);
					expect(error.message).not.toContain("resource");
				}

				isDirAsyncSpy.mockRestore();
			});

			it("throws when remote templates path returns invalid json", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to return invalid json
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response("null", {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("nonexistent-lang");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Remote templates path does not exist",
					);
				}
			});

			it("handles fetch throwing in subtreeExistsRemote", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to throw
				vi.stubGlobal(
					"fetch",
					vi.fn().mockRejectedValue(new Error("Network error")),
				);

				// Mock downloadTemplate to succeed
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockResolvedValue({
					dir: "/tmp/yehle-templates",
					source: "mock",
				});

				// Mock isDirAsync to return true for the downloaded dir
				const fsModule = await import("../../src/core/fs");
				const isDirAsyncSpy = vi.spyOn(fsModule, "isDirAsync");
				isDirAsyncSpy.mockResolvedValue(true);

				const result = await resolveTemplatesDir("typescript", "package");
				expect(result).toBe(
					"/tmp/yehle-templates/templates/typescript/package",
				);

				isDirAsyncSpy.mockRestore();
			});
		});
	});

	describe("listAvailableTemplates", () => {
		describe("local", () => {
			it("returns template names (subdirectory names) for an existing local resource directory", async () => {
				setLocalModeEnv(true);
				const { listAvailableTemplates } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");
				const lang: Language = "typescript" as Language;
				const resource = "package";

				const resourceDir = path.join(templatesRoot, lang, resource);
				fs.mkdirSync(resourceDir, { recursive: true });

				const templateNames = ["basic", "advanced", "with-tests"];
				for (const name of templateNames) {
					fs.mkdirSync(path.join(resourceDir, name));
				}
				// Shared dir that should not be listed.
				fs.mkdirSync(path.join(resourceDir, "shared"));
				// Add a file to ensure non-directory entries are filtered out.
				fs.writeFileSync(path.join(resourceDir, "readme.md"), "# Readme");

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					const result = await listAvailableTemplates(lang, resource);

					// Should contain our template subdirectories...
					expect(result).toEqual(
						expect.arrayContaining(["basic", "advanced", "with-tests"]),
					);
					// ...but not the shared directory (case insensitive).
					expect(result).not.toContain("shared");
					expect(result).not.toContain("Shared");
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("returns an empty array when the local resource directory does not exist", async () => {
				setLocalModeEnv(true);
				const { listAvailableTemplates } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");
				fs.mkdirSync(templatesRoot, { recursive: true });

				const lang: Language = "python" as Language;
				const resource = "cli";

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					const result = await listAvailableTemplates(lang, resource);
					expect(result).toEqual([]);
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("returns an empty array when the local language directory exists but resource directory does not exist", async () => {
				setLocalModeEnv(true);
				const { listAvailableTemplates } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");
				const lang: Language = "typescript" as Language;
				const resource = "api";

				const langDir = path.join(templatesRoot, lang);
				fs.mkdirSync(langDir, { recursive: true });
				// Do not create the resource directory

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					const result = await listAvailableTemplates(lang, resource);
					expect(result).toEqual([]);
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("returns an empty array when the local resource directory exists but has no subdirectories", async () => {
				setLocalModeEnv(true);
				const { listAvailableTemplates } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");
				const lang: Language = "typescript" as Language;
				const resource = "package";

				const resourceDir = path.join(templatesRoot, lang, resource);
				fs.mkdirSync(resourceDir, { recursive: true });
				// Add a file but no subdirectories
				fs.writeFileSync(path.join(resourceDir, "readme.md"), "# Readme");

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					const result = await listAvailableTemplates(lang, resource);
					expect(result).toEqual([]);
				} finally {
					process.chdir(originalCwd);
				}
			});

			it("returns an empty array when listChildDirs encounters a non-directory", async () => {
				setLocalModeEnv(true);
				const { listAvailableTemplates } = await importTemplateRegistry();
				const projectRoot = makeTempDir("yehle-project-");
				const templatesRoot = path.join(projectRoot, "templates");
				const lang: Language = "typescript" as Language;
				const resource = "package";

				const resourceDir = path.join(templatesRoot, lang, resource);
				fs.mkdirSync(resourceDir, { recursive: true });

				// Spy on isDirAsync to return true for the first 3 calls, false for the 4th
				const fsModule = await import("../../src/core/fs");
				const isDirAsyncSpy = vi.spyOn(fsModule, "isDirAsync");
				let callCount = 0;
				isDirAsyncSpy.mockImplementation(async (path) => {
					callCount++;
					if (callCount <= 3) return true;
					return false;
				});

				const originalCwd = process.cwd();
				process.chdir(projectRoot);

				try {
					const result = await listAvailableTemplates(lang, resource);
					expect(result).toEqual([]);
				} finally {
					process.chdir(originalCwd);
				}
			});
		});

		describe("remote", () => {
			beforeEach(() => {
				setLocalModeEnv(false);
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response("[]", {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);
			});

			afterEach(() => {
				vi.unstubAllGlobals();
			});

			it("lists remote template names from GitHub API and filters out shared", async () => {
				const { listAvailableTemplates } = await importTemplateRegistry();
				const lang: Language = "typescript" as Language;
				const resource = "package";

				const mockApiResponse = [
					{ type: "dir", name: "basic" },
					{ type: "file", name: "README.md" },
					{ type: "dir", name: "Advanced" },
					{ type: "dir", name: "shared" },
					{ type: "dir", name: "Shared" },
				];

				const fetchMock = vi.fn().mockResolvedValue(
					new Response(JSON.stringify(mockApiResponse), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				);

				vi.stubGlobal("fetch", fetchMock);

				const result = await listAvailableTemplates(lang, resource);

				// Should only include directory names, excluding "shared".
				expect(result).toEqual(expect.arrayContaining(["basic", "Advanced"]));
				expect(result).not.toContain("shared");

				// Ensure we hit the GitHub contents API URL shape.
				expect(fetchMock).toHaveBeenCalledTimes(1);
				const calledUrl = (
					fetchMock.mock.calls[0][0] as URL | string
				).toString();
				expect(calledUrl).toContain("/contents/templates/");
				expect(calledUrl).toContain(lang);
				expect(calledUrl).toContain(resource);
			});

			it("returns an empty array when the remote API returns no directories", async () => {
				const { listAvailableTemplates } = await importTemplateRegistry();
				const lang: Language = "typescript" as Language;
				const resource = "package";

				const mockApiResponse = [
					{ type: "file", name: "README.md" },
					{ type: "dir", name: "shared" },
				];

				const fetchMock = vi.fn().mockResolvedValue(
					new Response(JSON.stringify(mockApiResponse), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				);

				vi.stubGlobal("fetch", fetchMock);

				const result = await listAvailableTemplates(lang, resource);

				expect(result).toEqual([]);

				expect(fetchMock).toHaveBeenCalledTimes(1);
			});

			it("throws a descriptive error when the GitHub API returns a non-OK status", async () => {
				const { listAvailableTemplates } = await importTemplateRegistry();
				const lang: Language = "typescript" as Language;
				const resource = "package";

				const fetchMock = vi.fn().mockResolvedValue(
					new Response("rate limited", {
						status: 403,
						statusText: "Forbidden",
					}),
				);

				vi.stubGlobal("fetch", fetchMock);

				let error: unknown;
				try {
					await listAvailableTemplates(lang, resource);
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain("Failed to fetch from GitHub API");
					expect(error.message).toContain("403");
				}
			});

			it("throws when the GitHub API response is not an array", async () => {
				const { listAvailableTemplates } = await importTemplateRegistry();
				const lang: Language = "typescript" as Language;
				const resource = "package";

				const fetchMock = vi.fn().mockResolvedValue(
					new Response(JSON.stringify({ not: "an array" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				);

				vi.stubGlobal("fetch", fetchMock);

				let error: unknown;
				try {
					await listAvailableTemplates(lang, resource);
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain(
						"Invalid response from GitHub API: expected array of contents",
					);
				}
			});

			it("throws a descriptive error when remote download fails", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to indicate the subtree exists
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify([]), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to throw
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockRejectedValue(
					new Error("Network error"),
				);

				let error: unknown;
				try {
					await resolveTemplatesDir("nonexistent-lang");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain("Failed to download templates");
				}
			});

			it("throws a descriptive error when remote download fails with non-Error", async () => {
				const { resolveTemplatesDir } = await importTemplateRegistry();
				// Mock fetch to indicate the subtree exists
				vi.stubGlobal(
					"fetch",
					vi.fn().mockResolvedValue(
						new Response(JSON.stringify([]), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				);

				// Mock downloadTemplate to throw a non-Error
				const { downloadTemplate } = await import("giget");
				vi.mocked(downloadTemplate).mockRejectedValue("Network failure");

				let error: unknown;
				try {
					await resolveTemplatesDir("typescript", "summon");
				} catch (e) {
					error = e;
				}

				expect(error).toBeInstanceOf(Error);
				if (error instanceof Error) {
					expect(error.message).toContain("Failed to download templates");
					expect(error.message).toContain("Network failure");
				}
			});
		});
	});
});
