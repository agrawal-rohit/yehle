import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import animatedIntro from "../../src/cli/animated-intro";
import logger, { Logger } from "../../src/cli/logger";

// Mock the animated-intro module
vi.mock("../../src/cli/animated-intro", () => ({
	default: vi.fn(),
}));

describe("cli/logger", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let processExitSpy: any;

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		processExitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`process.exit called with code ${code}`);
		}) as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("intro", () => {
		test("should call animatedIntro with the provided message", async () => {
			const testMessage = "Welcome to Yehle!";
			const loggerInstance = new Logger();

			await loggerInstance.intro(testMessage);

			expect(animatedIntro).toHaveBeenCalledWith(testMessage);
		});
	});

	describe("error", () => {
		test("should log error message with proper formatting", () => {
			const loggerInstance = new Logger();
			const errorMessage = "Something went wrong";

			expect(() => loggerInstance.error(errorMessage)).toThrow(
				"process.exit called with code 1",
			);

			expect(consoleLogSpy).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining(errorMessage),
			);
		});

		test("should exit with code 1", () => {
			const loggerInstance = new Logger();

			expect(() => loggerInstance.error("Test error")).toThrow(
				"process.exit called with code 1",
			);
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		test("should add blank lines before and after error message", () => {
			const loggerInstance = new Logger();

			expect(() => loggerInstance.error("Test error")).toThrow();

			// Should call console.log at least twice for the blank lines
			expect(consoleLogSpy).toHaveBeenCalledTimes(2);
		});
	});

	describe("end", () => {
		test("should log end message with proper formatting", () => {
			const loggerInstance = new Logger();
			const endMessage = "Process completed";

			expect(() => loggerInstance.end(endMessage)).toThrow(
				"process.exit called with code 0",
			);

			expect(consoleLogSpy).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining(endMessage),
			);
		});

		test("should exit with code 0", () => {
			const loggerInstance = new Logger();

			expect(() => loggerInstance.end("Test end")).toThrow(
				"process.exit called with code 0",
			);
			expect(processExitSpy).toHaveBeenCalledWith(0);
		});

		test("should add blank lines before and after end message", () => {
			const loggerInstance = new Logger();

			expect(() => loggerInstance.end("Test end")).toThrow();

			// Should call console.log at least twice for the blank lines
			expect(consoleLogSpy).toHaveBeenCalledTimes(2);
		});
	});

	describe("default export", () => {
		test("should export a Logger instance", () => {
			expect(logger).toBeInstanceOf(Logger);
		});

		test("should have intro method", () => {
			expect(logger.intro).toBeDefined();
			expect(typeof logger.intro).toBe("function");
		});

		test("should have error method", () => {
			expect(logger.error).toBeDefined();
			expect(typeof logger.error).toBe("function");
		});

		test("should have end method", () => {
			expect(logger.end).toBeDefined();
			expect(typeof logger.end).toBe("function");
		});
	});
});
