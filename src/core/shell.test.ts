import { spawn } from "node:child_process";
import type { MockedFunction } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandExistsAsync, runAsync } from "./shell";

// Helper to test parseCommand indirectly through spawn calls
function expectParsedCommand(
	cmd: string,
	expectedCommand: string,
	expectedArgs: string[],
) {
	type FakeChild = {
		stdout: {
			on: (event: string, handler: (data: string) => void) => void;
		};
		on: (event: string, handler: (code?: number) => void) => FakeChild;
	};

	const fakeChild = {} as FakeChild;
	fakeChild.stdout = {
		on: (event, handler) => {
			if (event === "data") handler("test output");
		},
	};
	fakeChild.on = (event, handler) => {
		if (event === "close") handler(0);
		return fakeChild;
	};

	const mockedSpawn = vi.mocked(spawn);
	mockedSpawn.mockReturnValue(fakeChild as unknown as ReturnType<typeof spawn>);

	runAsync(cmd);

	expect(spawn).toHaveBeenCalledWith(
		expectedCommand,
		expectedArgs,
		expect.any(Object),
	);
}

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

describe("core/shell", () => {
	let spawnMock: MockedFunction<typeof spawn>;

	beforeEach(() => {
		spawnMock = vi.mocked(spawn);
		spawnMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("runAsync", () => {
		it("uses spawn and resolves trimmed stdout when stdio is pipe (default)", async () => {
			const fakeChild = {
				stdout: {
					on: (event: string, handler: (data: string) => void) => {
						if (event === "data") handler("  ok \n");
					},
				},
				on: (event: string, handler: (code?: number) => void) => {
					if (event === "close") handler(0);
				},
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			const result = await runAsync("echo test");

			expect(result).toBe("ok");
			expect(spawnMock).toHaveBeenCalledWith(
				"echo",
				["test"],
				expect.objectContaining({
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		});

		it("passes cwd, env, and timeoutMs to spawn when stdio is pipe", async () => {
			const fakeChild = {
				stdout: { on: vi.fn() },
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (code?: number) => void) => {
					if (event === "close") {
						handler(0);
					}
					return fakeChild;
				},
			);

			vi.mocked(fakeChild.stdout.on).mockImplementation(
				(event: string, handler: (data: string) => void) => {
					if (event === "data") {
						handler("done");
					}
				},
			);

			const result = await runAsync("echo env", {
				cwd: "/tmp/project",
				env: { EXTRA: "1" },
				timeoutMs: 1234,
				stdio: "pipe",
			});

			expect(result).toBe("done");
			expect(spawnMock).toHaveBeenCalledWith(
				"echo",
				["env"],
				expect.objectContaining({
					cwd: "/tmp/project",
					env: expect.objectContaining({ EXTRA: "1" }),
					timeout: 1234,
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		});

		it("rejects when spawn emits an error", async () => {
			const fakeChild = {
				stdout: { on: vi.fn() },
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			const error = new Error("spawn failed");

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (arg?: unknown) => void) => {
					if (event === "error") {
						handler(error);
					}
					return fakeChild;
				},
			);

			await expect(runAsync("bad command")).rejects.toBe(error);
		});

		it("rejects when spawn exits with non-zero code for pipe stdio", async () => {
			const fakeChild = {
				stdout: { on: vi.fn() },
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (code?: number) => void) => {
					if (event === "close") {
						handler(1);
					}
					return fakeChild;
				},
			);

			await expect(
				runAsync("bad-pipe", { stdio: "pipe" }),
			).rejects.toThrowError("Command failed: bad-pipe (exit 1)");
		});

		it("uses spawn and resolves trimmed stdout when stdio is ignore", async () => {
			const fakeChild = {
				stdout: { on: vi.fn() },
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (code?: number) => void) => {
					if (event === "close") {
						handler(0);
					}
					return fakeChild;
				},
			);

			vi.mocked(fakeChild.stdout.on).mockImplementation(
				(event: string, handler: (data: string) => void) => {
					if (event === "data") {
						handler("  ignored output \n");
					}
				},
			);

			const result = await runAsync("echo ignore", { stdio: "ignore" });

			expect(result).toBe("ignored output");
			expect(spawnMock).toHaveBeenCalledWith(
				"echo",
				["ignore"],
				expect.objectContaining({
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		});

		it("uses spawn and resolves empty string when stdio is inherit and exit code is 0", async () => {
			const fakeChild = {
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			// Simulate event handlers being attached, then trigger them
			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (code?: number) => void) => {
					if (event === "error") {
						// do nothing for this test
					}
					if (event === "close") {
						// Simulate successful exit
						handler(0);
					}
					return fakeChild;
				},
			);

			const result = await runAsync("ls", { stdio: "inherit" });

			expect(result).toBe("");
			expect(spawnMock).toHaveBeenCalledWith(
				"ls",
				[],
				expect.objectContaining({
					cwd: undefined,
					env: expect.any(Object),
					stdio: "inherit",
					timeout: undefined,
				}),
			);
		});

		it("rejects when spawn exits with non-zero code for inherit stdio", async () => {
			const fakeChild = {
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (code?: number) => void) => {
					if (event === "close") {
						handler(1);
					}
					return fakeChild;
				},
			);

			await expect(
				runAsync("bad-inherit", { stdio: "inherit" }),
			).rejects.toThrowError("Command failed: bad-inherit (exit 1)");
		});

		describe("commandExistsAsync", () => {
			it("returns true when command exists on non-Windows (uses 'which')", async () => {
				// Simulate a successful check on non-Windows by mocking spawn
				const fakeChild = {
					stdout: { on: vi.fn() },
					on: vi.fn(),
				};

				spawnMock.mockReturnValue(
					fakeChild as unknown as ReturnType<typeof spawn>,
				);

				vi.mocked(fakeChild.on).mockImplementation(
					(event: string, handler: (code?: number) => void) => {
						if (event === "close") {
							handler(0);
						}
						return fakeChild;
					},
				);

				vi.mocked(fakeChild.stdout.on).mockImplementation(
					(event: string, handler: (data: string) => void) => {
						if (event === "data") {
							handler("/usr/bin/node\n");
						}
					},
				);

				// Force non-Windows branch
				const originalPlatform = process.platform;
				Object.defineProperty(process, "platform", {
					value: "linux",
				});

				const result = await commandExistsAsync("node");

				// restore platform
				Object.defineProperty(process, "platform", {
					value: originalPlatform,
				});

				expect(result).toBe(true);
				expect(spawnMock).toHaveBeenCalledWith(
					"which",
					["node"],
					expect.objectContaining({
						stdio: ["ignore", "pipe", "pipe"],
					}),
				);
			});

			it("returns true when command exists on Windows (uses 'where')", async () => {
				const fakeChild = {
					stdout: { on: vi.fn() },
					on: vi.fn(),
				};

				spawnMock.mockReturnValue(
					fakeChild as unknown as ReturnType<typeof spawn>,
				);

				vi.mocked(fakeChild.on).mockImplementation(
					(event: string, handler: (code?: number) => void) => {
						if (event === "close") {
							handler(0);
						}
						return fakeChild;
					},
				);

				vi.mocked(fakeChild.stdout.on).mockImplementation(
					(event: string, handler: (data: string) => void) => {
						if (event === "data") {
							handler("C:\\\\Program Files\\\\node.exe\r\n");
						}
					},
				);

				const originalPlatform = process.platform;
				Object.defineProperty(process, "platform", {
					value: "win32",
				});

				const result = await commandExistsAsync("node");

				Object.defineProperty(process, "platform", {
					value: originalPlatform,
				});

				expect(result).toBe(true);
				expect(spawnMock).toHaveBeenCalledWith(
					"where",
					["node"],
					expect.objectContaining({
						stdio: ["ignore", "pipe", "pipe"],
					}),
				);
			});

			it("returns false when the underlying check fails", async () => {
				const fakeChild = {
					stdout: { on: vi.fn() },
					on: vi.fn(),
				};

				spawnMock.mockReturnValue(
					fakeChild as unknown as ReturnType<typeof spawn>,
				);

				const error = new Error("not found");

				vi.mocked(fakeChild.on).mockImplementation(
					(event: string, handler: (arg?: unknown) => void) => {
						if (event === "error") {
							handler(error);
						}
						return fakeChild;
					},
				);

				const originalPlatform = process.platform;
				Object.defineProperty(process, "platform", {
					value: "linux",
				});

				const result = await commandExistsAsync("nonexistent-cmd");

				Object.defineProperty(process, "platform", {
					value: originalPlatform,
				});

				expect(result).toBe(false);
				expect(spawnMock).toHaveBeenCalledWith(
					"which",
					["nonexistent-cmd"],
					expect.objectContaining({
						stdio: ["ignore", "pipe", "pipe"],
					}),
				);
			});
		});

		it("passes cwd, env, and timeoutMs to spawn when stdio is inherit", async () => {
			const fakeChild = {
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (code?: number) => void) => {
					if (event === "close") {
						handler(0);
					}
					return fakeChild;
				},
			);

			await runAsync("npm test", {
				cwd: "/repo",
				env: { CI: "true" },
				timeoutMs: 5000,
				stdio: "inherit",
			});

			expect(spawnMock).toHaveBeenCalledWith(
				"npm",
				["test"],
				expect.objectContaining({
					cwd: "/repo",
					env: expect.objectContaining({ CI: "true" }),
					stdio: "inherit",
					timeout: 5000,
				}),
			);
		});

		it("rejects when spawn emits an error", async () => {
			const fakeChild = {
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			const error = new Error("spawn failed");

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (arg?: unknown) => void) => {
					if (event === "error") {
						handler(error);
					}
					return fakeChild;
				},
			);

			await expect(runAsync("bad", { stdio: "inherit" })).rejects.toBe(error);
		});

		it("rejects when spawn exits with non-zero code", async () => {
			const fakeChild = {
				on: vi.fn(),
			};

			spawnMock.mockReturnValue(
				fakeChild as unknown as ReturnType<typeof spawn>,
			);

			vi.mocked(fakeChild.on).mockImplementation(
				(event: string, handler: (code?: number) => void) => {
					if (event === "close") {
						handler(2);
					}
					return fakeChild;
				},
			);

			await expect(
				runAsync("bad-exit", { stdio: "inherit" }),
			).rejects.toThrowError("Command failed: bad-exit (exit 2)");
		});

		describe("parseCommand (tested via spawn calls)", () => {
			it("parses simple command without args", () => {
				expectParsedCommand("ls", "ls", []);
			});

			it("parses command with single arg", () => {
				expectParsedCommand("echo test", "echo", ["test"]);
			});

			it("parses command with multiple args", () => {
				expectParsedCommand("git commit -m message", "git", [
					"commit",
					"-m",
					"message",
				]);
			});

			it("parses command with quoted args containing spaces", () => {
				expectParsedCommand('echo "hello world"', "echo", ["hello world"]);
			});

			it("parses command with multiple quoted args", () => {
				expectParsedCommand('npm run "build script" --verbose', "npm", [
					"run",
					"build script",
					"--verbose",
				]);
			});

			it("handles quotes at start and end of arg", () => {
				expectParsedCommand('cmd "arg with spaces" normal', "cmd", [
					"arg with spaces",
					"normal",
				]);
			});
		});
	});
});
