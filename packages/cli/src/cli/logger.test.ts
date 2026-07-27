import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import animatedIntro from "./animated-intro";
import logger from "./logger";

// Mock the animated-intro module used by Logger
vi.mock("./animated-intro", () => ({
	default: vi.fn(),
}));

describe("cli/logger", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let processExitSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		processExitSpy = vi.fn();
		const originalExit = process.exit;
		Object.defineProperty(process, "exit", {
			configurable: true,
			value: ((code?: string | number | null) => {
				processExitSpy(code);
				const normalized = code ?? undefined;
				throw new Error(`process.exit called with code ${normalized}`);
			}) as typeof originalExit,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("intro", () => {
		test("should call animatedIntro with the provided message", async () => {
			const testMessage = "welcome to the tuckshop!";

			await logger.intro(testMessage);

			expect(animatedIntro).toHaveBeenCalledWith(testMessage);
		});
	});

	describe("error", () => {
		test("should log error message with proper formatting", () => {
			const errorMessage = "Something went wrong";

			expect(() => logger.error(errorMessage)).toThrow(
				"process.exit called with code 1",
			);

			expect(consoleLogSpy).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining(errorMessage),
			);
		});

		test("should exit with code 1", () => {
			expect(() => logger.error("Test error")).toThrow(
				"process.exit called with code 1",
			);
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		test("should add blank lines before and after error message", () => {
			expect(() => logger.error("Test error")).toThrow();

			// Should call console.log at least twice for the blank lines
			expect(consoleLogSpy).toHaveBeenCalledTimes(2);
		});
	});

	describe("default export", () => {
		test("should expose intro and error methods", () => {
			expect(typeof logger.intro).toBe("function");
			expect(typeof logger.error).toBe("function");
		});
	});
});
