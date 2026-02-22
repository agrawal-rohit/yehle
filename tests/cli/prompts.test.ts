import consola from "consola";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import logger from "../../src/cli/logger";
import prompts, {
	confirmInput,
	multiselectInput,
	selectInput,
	textInput,
} from "../../src/cli/prompts";

// Mock consola
vi.mock("consola", () => ({
	default: {
		prompt: vi.fn(),
	},
}));

// Mock logger
vi.mock("../../src/cli/logger", () => ({
	default: {
		error: vi.fn(() => process.exit(1)),
		end: vi.fn(() => process.exit(0)),
	},
}));

describe("cli/prompts", () => {
	let processExitSpy: any;

	beforeEach(() => {
		vi.clearAllMocks();
		processExitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`process.exit called with code ${code}`);
		}) as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("textInput", () => {
		test("should call consola.prompt with correct parameters", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("test response");

			const message = "Enter your name";
			await textInput(message);

			expect(mockPrompt).toHaveBeenCalledWith(
				message,
				expect.objectContaining({
					type: "text",
					cancel: "symbol",
				}),
			);
		});

		test("should return trimmed value", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("  test value  ");

			const result = await textInput("Enter text");

			expect(result).toBe("test value");
		});

		test("should handle default value", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("default-name");

			await textInput("Enter name", {}, "default-name");

			expect(mockPrompt).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					initial: "default-name",
				}),
			);
		});

		test("should handle options", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("test");

			await textInput("Enter text", { placeholder: "Enter here" });

			expect(mockPrompt).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					placeholder: "Enter here",
				}),
			);
		});

		test("should error when required is true and input is empty", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("");

			await expect(() =>
				textInput("Enter name", { required: true }),
			).rejects.toThrow("process.exit called with code 1");

			expect(logger.error).toHaveBeenCalledWith("Package name is required");
		});

		test("should call logger.end when operation is canceled", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			const cancelSymbol = Symbol.for("cancel");
			mockPrompt.mockResolvedValue(cancelSymbol as any);

			await expect(() => textInput("Enter text")).rejects.toThrow(
				"process.exit called with code 0",
			);

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});
	});

	describe("selectInput", () => {
		test("should call consola.prompt with correct parameters", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("option1");

			const message = "Select an option";
			const options = ["option1", "option2", "option3"];

			await selectInput(message, { options });

			expect(mockPrompt).toHaveBeenCalledWith(
				message,
				expect.objectContaining({
					type: "select",
					cancel: "symbol",
					options,
				}),
			);
		});

		test("should return selected value", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("selected-option");

			const result = await selectInput("Select", { options: ["opt1", "opt2"] });

			expect(result).toBe("selected-option");
		});

		test("should handle default value", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("default-option");

			await selectInput("Select", { options: [] }, "default-option");

			expect(mockPrompt).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					initial: "default-option",
				}),
			);
		});

		test("should call logger.end when operation is canceled", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			const cancelSymbol = Symbol.for("cancel");
			mockPrompt.mockResolvedValue(cancelSymbol as any);

			await expect(() =>
				selectInput("Select", { options: [] }),
			).rejects.toThrow("process.exit called with code 0");

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});

		test("should use default opts when not provided", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("option1");

			await selectInput("Select an option");

			expect(mockPrompt).toHaveBeenCalledWith(
				"Select an option",
				expect.objectContaining({
					type: "select",
					cancel: "symbol",
					options: [],
				}),
			);
		});
	});

	describe("multiselectInput", () => {
		test("should call consola.prompt with correct parameters", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(["option1", "option2"]);

			const message = "Select multiple options";
			const options = ["option1", "option2", "option3"];

			await multiselectInput(message, { options });

			expect(mockPrompt).toHaveBeenCalledWith(
				message,
				expect.objectContaining({
					type: "multiselect",
					cancel: "symbol",
					options,
				}),
			);
		});

		test("should return array of selected values", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			const selectedValues = ["option1", "option3"];
			mockPrompt.mockResolvedValue(selectedValues);

			const result = await multiselectInput("Select multiple", {
				options: ["option1", "option2", "option3"],
			});

			expect(result).toEqual(selectedValues);
		});

		test("should handle default values", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(["default1", "default2"]);

			const defaultValues = ["default1", "default2"];
			await multiselectInput("Select", { options: [] }, defaultValues);

			expect(mockPrompt).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					initial: defaultValues,
				}),
			);
		});

		test("should call logger.end when operation is canceled", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			const cancelSymbol = Symbol.for("cancel");
			mockPrompt.mockResolvedValue(cancelSymbol as any);

			await expect(() =>
				multiselectInput("Select multiple", { options: [] }),
			).rejects.toThrow("process.exit called with code 0");

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});

		test("should use default opts when not provided", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(["option1"]);

			await multiselectInput("Select multiple options");

			expect(mockPrompt).toHaveBeenCalledWith(
				"Select multiple options",
				expect.objectContaining({
					type: "multiselect",
					cancel: "symbol",
					options: [],
				}),
			);
		});
	});

	describe("confirmInput", () => {
		test("should call consola.prompt with correct parameters", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(true);

			const message = "Do you want to continue?";

			await confirmInput(message);

			expect(mockPrompt).toHaveBeenCalledWith(
				message,
				expect.objectContaining({
					type: "confirm",
					cancel: "symbol",
				}),
			);
		});

		test("should return boolean value for true", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(true);

			const result = await confirmInput("Confirm?");

			expect(result).toBe(true);
		});

		test("should return boolean value for false", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(false);

			const result = await confirmInput("Confirm?");

			expect(result).toBe(false);
		});

		test("should handle default value", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(true);

			await confirmInput("Confirm?", {}, true);

			expect(mockPrompt).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					initial: true,
				}),
			);
		});

		test("should call logger.end when operation is canceled", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			const cancelSymbol = Symbol.for("cancel");
			mockPrompt.mockResolvedValue(cancelSymbol as any);

			await expect(() => confirmInput("Confirm?")).rejects.toThrow(
				"process.exit called with code 0",
			);

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});

		test("should convert truthy values to boolean", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue("yes");

			const result = await confirmInput("Confirm?");

			expect(result).toBe(true);
			expect(typeof result).toBe("boolean");
		});

		test("should convert falsy values to boolean", async () => {
			const mockPrompt = vi.mocked(consola.prompt);
			mockPrompt.mockResolvedValue(null as any);

			const result = await confirmInput("Confirm?");

			expect(result).toBe(false);
			expect(typeof result).toBe("boolean");
		});
	});

	describe("default export", () => {
		test("should export an object with all prompt methods", () => {
			expect(prompts).toBeDefined();
			expect(prompts.textInput).toBe(textInput);
			expect(prompts.selectInput).toBe(selectInput);
			expect(prompts.multiselectInput).toBe(multiselectInput);
			expect(prompts.confirmInput).toBe(confirmInput);
		});

		test("should have textInput method", () => {
			expect(prompts.textInput).toBeDefined();
			expect(typeof prompts.textInput).toBe("function");
		});

		test("should have selectInput method", () => {
			expect(prompts.selectInput).toBeDefined();
			expect(typeof prompts.selectInput).toBe("function");
		});

		test("should have multiselectInput method", () => {
			expect(prompts.multiselectInput).toBeDefined();
			expect(typeof prompts.multiselectInput).toBe("function");
		});

		test("should have confirmInput method", () => {
			expect(prompts.confirmInput).toBeDefined();
			expect(typeof prompts.confirmInput).toBe("function");
		});
	});
});
