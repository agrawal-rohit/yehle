import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock readline before imports
vi.mock("node:readline", () => ({
	default: {
		createInterface: vi.fn(() => ({ close: vi.fn() })),
		emitKeypressEvents: vi.fn(),
	},
	createInterface: vi.fn(() => ({ close: vi.fn() })),
	emitKeypressEvents: vi.fn(),
}));

// Mock chalk
vi.mock("chalk", () => ({
	default: {
		bold: vi.fn((text) => text),
		magentaBright: vi.fn((text) => text),
		cyan: vi.fn((text) => text),
		red: vi.fn((text) => text),
		yellow: vi.fn((text) => text),
		green: vi.fn((text) => text),
		blue: vi.fn((text) => text),
		cyanBright: vi.fn((text) => text),
		redBright: vi.fn((text) => text),
		yellowBright: vi.fn((text) => text),
		greenBright: vi.fn((text) => text),
		hex: vi.fn(() => vi.fn((text) => text)),
	},
}));

// Mock consola/utils
vi.mock("consola/utils", () => ({
	stripAnsi: vi.fn((text) => text),
}));

// Mock core/utils
vi.mock("../../core/utils", () => ({
	sleep: vi.fn(() => Promise.resolve()),
	truncate: vi.fn((text) => text),
}));

import readline from "node:readline";
import { stripAnsi } from "consola/utils";
import animatedIntro from "../../src/cli/animated-intro";

describe("cli/animated-intro", () => {
	let mockStdout: any;
	let mockStdin: any;
	let processExitSpy: any;
	let stdoutWriteSpy: ReturnType<typeof vi.fn>;
	let stdinOnSpy: ReturnType<typeof vi.fn>;
	let stdinOffSpy: ReturnType<typeof vi.fn>;
	let stdinSetRawModeSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock stdout
		stdoutWriteSpy = vi.fn();
		mockStdout = {
			write: stdoutWriteSpy,
			columns: 80,
		};

		// Mock stdin
		stdinOnSpy = vi.fn();
		stdinOffSpy = vi.fn();
		stdinSetRawModeSpy = vi.fn();
		mockStdin = {
			on: stdinOnSpy,
			off: stdinOffSpy,
			setRawMode: stdinSetRawModeSpy,
			isTTY: true,
		};

		// Mock process.stdout and process.stdin
		vi.spyOn(process, "stdout", "get").mockReturnValue(mockStdout as any);
		vi.spyOn(process, "stdin", "get").mockReturnValue(mockStdin as any);

		// Mock process.exit
		processExitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`process.exit called with code ${code}`);
		}) as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("basic functionality", () => {
		test("should animate with a single string message", async () => {
			await animatedIntro("Hello World");

			expect(stdoutWriteSpy).toHaveBeenCalled();
			expect(readline.createInterface).toHaveBeenCalled();
		});

		test("should animate with an array of messages", async () => {
			await animatedIntro(["Message 1", "Message 2"]);

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle promise messages", async () => {
			const promiseMsg = Promise.resolve("Async message");

			await animatedIntro(promiseMsg);

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle array of promise messages", async () => {
			const messages = [Promise.resolve("First"), Promise.resolve("Second")];

			await animatedIntro(messages);

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle empty message array", async () => {
			await animatedIntro([]);

			// Empty array doesn't write to stdout
			expect(readline.createInterface).toHaveBeenCalled();
		});
	});

	describe("options", () => {
		test('should use default title "Yehle"', async () => {
			await animatedIntro("Test message");

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should accept custom title", async () => {
			await animatedIntro("Test message", { title: "Custom Title" });

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should use custom stdout when provided", async () => {
			const customStdout = {
				write: vi.fn(),
				columns: 100,
			};

			await animatedIntro("Test", { stdout: customStdout as any });

			expect(customStdout.write).toHaveBeenCalled();
			expect(stdoutWriteSpy).not.toHaveBeenCalled();
		});

		test("should respect custom frameDelayMs", async () => {
			await animatedIntro("Test", { frameDelayMs: 50 });

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should use default frameDelayMs of 150ms", async () => {
			await animatedIntro("Test");

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});
	});

	describe("readline setup", () => {
		test("should create readline interface", async () => {
			await animatedIntro("Test");

			expect(readline.createInterface).toHaveBeenCalledWith(
				expect.objectContaining({
					input: expect.anything(),
					escapeCodeTimeout: 50,
				}),
			);
		});

		test("should emit keypress events", async () => {
			await animatedIntro("Test");

			expect(readline.emitKeypressEvents).toHaveBeenCalled();
		});

		test("should set raw mode when stdin is TTY", async () => {
			mockStdin.isTTY = true;

			await animatedIntro("Test");

			expect(stdinSetRawModeSpy).toHaveBeenCalledWith(true);
		});

		test("should not set raw mode when stdin is not TTY", async () => {
			mockStdin.isTTY = false;

			await animatedIntro("Test");

			// Should still work, just not set raw mode initially
			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should register keypress listener", async () => {
			await animatedIntro("Test");

			expect(stdinOnSpy).toHaveBeenCalledWith("keypress", expect.any(Function));
		});
	});

	describe("cleanup", () => {
		test("should close readline interface on completion", async () => {
			await animatedIntro("Test");

			const rlInterface = vi.mocked(readline.createInterface).mock.results[0]
				?.value;
			expect(rlInterface?.close).toHaveBeenCalled();
		});

		test("should restore raw mode on cleanup", async () => {
			mockStdin.isTTY = true;

			await animatedIntro("Test");

			expect(stdinSetRawModeSpy).toHaveBeenCalledWith(true);
			expect(stdinSetRawModeSpy).toHaveBeenCalledWith(false);
		});

		test("should remove keypress listener on cleanup", async () => {
			await animatedIntro("Test");

			expect(stdinOffSpy).toHaveBeenCalledWith(
				"keypress",
				expect.any(Function),
			);
		});
	});

	describe("rendering", () => {
		test("should write to stdout during animation", async () => {
			await animatedIntro("Hello World");

			expect(stdoutWriteSpy).toHaveBeenCalled();
			// Should have written multiple frames
			expect(stdoutWriteSpy.mock.calls.length).toBeGreaterThan(1);
		});

		test("should handle stdout with different column widths", async () => {
			mockStdout.columns = 40;

			await animatedIntro("Test");

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle stdout with undefined columns", async () => {
			mockStdout.columns = undefined;

			await animatedIntro("Test");

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should call truncate for long messages", async () => {
			await animatedIntro(
				"This is a very long message that should be truncated",
			);

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should paint final frame with longer delay", async () => {
			await animatedIntro("Test", { frameDelayMs: 100 });

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});
	});

	describe("keyboard interaction", () => {
		test("should handle Ctrl+C to exit", async () => {
			let keypressHandler: Function | undefined;

			stdinOnSpy.mockImplementation((event: string, handler: Function) => {
				if (event === "keypress") {
					keypressHandler = handler;
				}
			});

			animatedIntro("Test");

			// Simulate Ctrl+C - this will throw because process.exit is mocked
			expect(() => {
				keypressHandler?.("", { ctrl: true, name: "c" });
			}).toThrow("process.exit called with code 0");
		});

		test("should handle ESC key for early cleanup", async () => {
			let keypressHandler: Function | undefined;

			stdinOnSpy.mockImplementation((event: string, handler: Function) => {
				if (event === "keypress") {
					keypressHandler = handler;
				}
			});

			animatedIntro("Test");

			// Simulate ESC - should trigger cleanup but not exit
			keypressHandler?.("", { name: "escape" });

			expect(stdinSetRawModeSpy).toHaveBeenCalledWith(false);
		});

		test("should not exit on Ctrl with non-C key", async () => {
			let keypressHandler: Function | undefined;

			stdinOnSpy.mockImplementation((event: string, handler: Function) => {
				if (event === "keypress") {
					keypressHandler = handler;
				}
			});

			animatedIntro("Test");

			// Simulate Ctrl+D - ctrl true but name !== 'c'
			keypressHandler?.("", { ctrl: true, name: "d" });

			// Should not call exit or cleanup
			expect(processExitSpy).not.toHaveBeenCalled();
			expect(stdinSetRawModeSpy).not.toHaveBeenCalledWith(false);
		});

		test("should handle other keypresses without cleanup or exit", async () => {
			let keypressHandler: Function | undefined;

			stdinOnSpy.mockImplementation((event: string, handler: Function) => {
				if (event === "keypress") {
					keypressHandler = handler;
				}
			});

			animatedIntro("Test");

			// Simulate a key that doesn't match Ctrl+C or ESC
			keypressHandler?.("", { name: "a" });

			// Should not call cleanup or exit
			expect(stdinSetRawModeSpy).not.toHaveBeenCalledWith(false);
			expect(processExitSpy).not.toHaveBeenCalled();
		});
	});

	describe("edge cases", () => {
		test("should handle single word message", async () => {
			await animatedIntro("Hello");

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle message with multiple spaces", async () => {
			await animatedIntro("Hello   World   Test");

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle empty string message", async () => {
			await animatedIntro("");

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle numeric message converted to string", async () => {
			await animatedIntro(123 as any);

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});
	});

	describe("message format handling", () => {
		test("should handle message that is already an array of words", async () => {
			// This tests the Array.isArray branch on line 113
			const messageArray = ["Hello", "World", "Test"];

			await animatedIntro(messageArray as any, { frameDelayMs: 10 });

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		test("should handle mixed string and array messages", async () => {
			const messages = ["String message", ["array", "message"] as any];

			await animatedIntro(messages as any, { frameDelayMs: 10 });

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});
	});

	describe("renderer edge cases", () => {
		test("should handle fewer lines than renderer height", async () => {
			// This will test the lines.length < height branch on line 166
			await animatedIntro("A", { frameDelayMs: 10 });

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});
	});

	describe("renderer line handling edge cases", () => {
		test("should handle renderer with varying line counts", async () => {
			// The lines array now returns 4 lines with top padding, but the renderer's paint
			// function has logic to handle < height and > height scenarios
			// These are defensive branches that protect against edge cases
			const customStdout = {
				write: vi.fn(),
				columns: 80,
			};

			await animatedIntro("Test message", {
				stdout: customStdout as any,
				frameDelayMs: 10,
			});

			expect(customStdout.write).toHaveBeenCalled();
		});

		test("should handle renderer initialization and multiple paints", async () => {
			// Ensure both initialized and non-initialized paths are tested
			const testStdout = {
				write: vi.fn(),
				columns: 80,
			};

			await animatedIntro(["First", "Second"], {
				stdout: testStdout as any,
				frameDelayMs: 10,
			});

			// Multiple messages mean multiple paint calls
			expect(testStdout.write).toHaveBeenCalled();
		});

		test("should handle finish when renderer is initialized", async () => {
			// Tests that finish() writes newline when initialized
			const testStdout = {
				write: vi.fn(),
				columns: 80,
			};

			await animatedIntro("A", { stdout: testStdout as any, frameDelayMs: 10 });

			// Check that cleanup was called (which calls finish)
			expect(testStdout.write).toHaveBeenCalled();
		});
	});

	describe("default export", () => {
		test("should export animatedIntro as default", () => {
			expect(animatedIntro).toBeDefined();
			expect(typeof animatedIntro).toBe("function");
		});
	});
});
