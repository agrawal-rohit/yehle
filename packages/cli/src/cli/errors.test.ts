import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	InterruptError,
	isErrnoCode,
	OperationCanceledError,
	printCancel,
	printError,
	runCliCommand,
} from "./errors";

describe("cli/errors", () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let processExitSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		processExitSpy = vi.fn();
		Object.defineProperty(process, "exit", {
			configurable: true,
			value: ((code?: string | number | null) => {
				processExitSpy(code);
				throw new Error(`process.exit called with code ${code ?? undefined}`);
			}) as typeof process.exit,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("printError prints without exiting", () => {
		printError("Something went wrong");

		const printed = String(consoleErrorSpy.mock.calls[0]?.[0]);
		expect(printed).toContain("error");
		expect(printed).toContain("Something went wrong");
		expect(processExitSpy).not.toHaveBeenCalled();
	});

	test("printCancel prints without exiting", () => {
		printCancel("stopped by user");

		const printed = String(consoleErrorSpy.mock.calls[0]?.[0]);
		expect(printed).toContain("canceled");
		expect(printed).toContain("stopped by user");
		expect(processExitSpy).not.toHaveBeenCalled();
	});

	test("OperationCanceledError defaults to exit code 0", () => {
		const error = new OperationCanceledError();
		expect(error.name).toBe("OperationCanceledError");
		expect(error.message).toBe("Operation canceled");
		expect(error.exitCode).toBe(0);
	});

	test("InterruptError defaults to exit code 130", () => {
		const error = new InterruptError();
		expect(error.name).toBe("InterruptError");
		expect(error.message).toBe("Interrupted");
		expect(error.exitCode).toBe(130);
	});

	test("isErrnoCode matches objects with the given code and rejects other values", () => {
		expect(isErrnoCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
		expect(isErrnoCode({ code: "EACCES" }, "ENOENT")).toBe(false);
		expect(isErrnoCode(null, "ENOENT")).toBe(false);
		expect(isErrnoCode("ENOENT", "ENOENT")).toBe(false);
		expect(isErrnoCode(undefined, "ENOENT")).toBe(false);
	});

	test("runCliCommand resolves when the action succeeds", async () => {
		await expect(runCliCommand(async () => {})).resolves.toBeUndefined();
		expect(processExitSpy).not.toHaveBeenCalled();
	});

	test("runCliCommand prints cancel and exits 0 on OperationCanceledError", async () => {
		await expect(
			runCliCommand(async () => {
				throw new OperationCanceledError("Operation canceled");
			}),
		).rejects.toThrow("process.exit called with code 0");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Operation canceled"),
		);
		expect(processExitSpy).toHaveBeenCalledWith(0);
	});

	test("runCliCommand exits 130 on InterruptError without an extra message", async () => {
		await expect(
			runCliCommand(async () => {
				throw new InterruptError();
			}),
		).rejects.toThrow("process.exit called with code 130");

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(processExitSpy).toHaveBeenCalledWith(130);
	});

	test("runCliCommand prints errors and exits 1", async () => {
		await expect(
			runCliCommand(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("process.exit called with code 1");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("boom"),
		);
		expect(processExitSpy).toHaveBeenCalledWith(1);
	});

	test("runCliCommand stringifies non-Error failures", async () => {
		await expect(
			runCliCommand(async () => {
				throw "string failure";
			}),
		).rejects.toThrow("process.exit called with code 1");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("string failure"),
		);
	});
});
