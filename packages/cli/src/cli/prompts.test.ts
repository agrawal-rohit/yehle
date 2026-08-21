import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import logger from "./logger";
import prompts, {
	confirmInput,
	groupedMultiselectInput,
	multiselectInput,
	selectInput,
	textInput,
} from "./prompts";

const mockText = vi.fn();
const mockSelect = vi.fn();
const mockMultiselect = vi.fn();
const mockGroupMultiselect = vi.fn();
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn();

vi.mock("@clack/prompts", () => ({
	text: (...args: unknown[]) => mockText(...args),
	select: (...args: unknown[]) => mockSelect(...args),
	multiselect: (...args: unknown[]) => mockMultiselect(...args),
	groupMultiselect: (...args: unknown[]) => mockGroupMultiselect(...args),
	confirm: (...args: unknown[]) => mockConfirm(...args),
	isCancel: (...args: unknown[]) => mockIsCancel(...args),
}));

// Mock logger used by prompts helpers
vi.mock("./logger", () => ({
	default: {
		error: vi.fn((message: string) => {
			throw new Error(`process.exit called with code 1: ${message}`);
		}),
		end: vi.fn((message: string) => {
			throw new Error(`process.exit called with code 0: ${message}`);
		}),
	},
}));

describe("cli/prompts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsCancel.mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("textInput", () => {
		test("should call text with message", async () => {
			mockText.mockResolvedValue("test response");

			const message = "Enter your name";
			await textInput(message);

			expect(mockText).toHaveBeenCalledWith({ message });
		});

		test("should return trimmed value", async () => {
			mockText.mockResolvedValue("  test value  ");

			const result = await textInput("Enter text");

			expect(result).toBe("test value");
		});

		test("should pass default value as initialValue and defaultValue", async () => {
			mockText.mockResolvedValue("default-name");

			await textInput("Enter name", {}, "default-name");

			expect(mockText).toHaveBeenCalledWith({
				message: "Enter name",
				initialValue: "default-name",
				defaultValue: "default-name",
			});
		});

		test("should pass placeholder option", async () => {
			mockText.mockResolvedValue("test");

			await textInput("Enter text", { placeholder: "Enter here" });

			expect(mockText).toHaveBeenCalledWith({
				message: "Enter text",
				placeholder: "Enter here",
			});
		});

		test("should pass a required validate function", async () => {
			mockText.mockResolvedValue("ok");

			await textInput("Enter name", { required: true });

			const call = mockText.mock.calls[0]?.[0] as {
				validate?: (value: string | undefined) => string | undefined;
			};
			expect(call.validate?.("")).toBe("A value is required");
			expect(call.validate?.("   ")).toBe("A value is required");
			expect(call.validate?.("ok")).toBeUndefined();
		});

		test("should call logger.end when operation is canceled", async () => {
			const cancelSymbol = Symbol("clack:cancel");
			mockText.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			await expect(() => textInput("Enter text")).rejects.toThrow(
				"process.exit called with code 0",
			);

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});
	});

	describe("selectInput", () => {
		const options = [
			{ label: "Option 1", value: "option1" },
			{ label: "Option 2", value: "option2" },
			{ label: "Option 3", value: "option3" },
		];

		test("should call select with message and options", async () => {
			mockSelect.mockResolvedValue("option1");

			const message = "Select an option";
			await selectInput(message, { options });

			expect(mockSelect).toHaveBeenCalledWith({
				message,
				options,
			});
		});

		test("should return selected value", async () => {
			mockSelect.mockResolvedValue("selected-option");

			const result = await selectInput("Select", {
				options: [
					{ label: "opt1", value: "opt1" },
					{ label: "opt2", value: "opt2" },
				],
			});

			expect(result).toBe("selected-option");
		});

		test("should pass default value as initialValue", async () => {
			mockSelect.mockResolvedValue("default-option");

			await selectInput("Select", { options: [] }, "default-option");

			expect(mockSelect).toHaveBeenCalledWith({
				message: "Select",
				options: [],
				initialValue: "default-option",
			});
		});

		test("should call logger.end when operation is canceled", async () => {
			const cancelSymbol = Symbol("clack:cancel");
			mockSelect.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			await expect(() =>
				selectInput("Select", { options: [] }),
			).rejects.toThrow("process.exit called with code 0");

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});

		test("should use empty options when opts are not provided", async () => {
			mockSelect.mockResolvedValue("option1");

			await selectInput("Select an option");

			expect(mockSelect).toHaveBeenCalledWith({
				message: "Select an option",
				options: [],
			});
		});
	});

	describe("multiselectInput", () => {
		const options = [
			{ label: "Option 1", value: "option1" },
			{ label: "Option 2", value: "option2" },
			{ label: "Option 3", value: "option3" },
		];

		test("should call multiselect with message and options", async () => {
			mockMultiselect.mockResolvedValue(["option1", "option2"]);

			const message = "Select multiple options";
			await multiselectInput(message, { options });

			expect(mockMultiselect).toHaveBeenCalledWith({
				message,
				options,
			});
		});

		test("should return array of selected values", async () => {
			const selectedValues = ["option1", "option3"];
			mockMultiselect.mockResolvedValue(selectedValues);

			const result = await multiselectInput("Select multiple", {
				options,
			});

			expect(result).toEqual(selectedValues);
		});

		test("should pass default values as initialValues", async () => {
			mockMultiselect.mockResolvedValue(["default1", "default2"]);

			const defaultValues = ["default1", "default2"];
			await multiselectInput("Select", { options: [] }, defaultValues);

			expect(mockMultiselect).toHaveBeenCalledWith({
				message: "Select",
				options: [],
				initialValues: defaultValues,
			});
		});

		test("should call logger.end when operation is canceled", async () => {
			const cancelSymbol = Symbol("clack:cancel");
			mockMultiselect.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			await expect(() =>
				multiselectInput("Select multiple", { options: [] }),
			).rejects.toThrow("process.exit called with code 0");

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});

		test("should use empty options when opts are not provided", async () => {
			mockMultiselect.mockResolvedValue(["option1"]);

			await multiselectInput("Select multiple options");

			expect(mockMultiselect).toHaveBeenCalledWith({
				message: "Select multiple options",
				options: [],
			});
		});
	});

	describe("groupedMultiselectInput", () => {
		const options = {
			Configurations: [
				{
					label: "Pull Request Template",
					value: "pr-template-configuration",
					hint: "PR template",
				},
			],
		};

		test("should call groupMultiselect with grouped options", async () => {
			mockGroupMultiselect.mockResolvedValue(["pr-template-configuration"]);

			const result = await groupedMultiselectInput(
				"Which registry items should be added?",
				options,
			);

			expect(mockGroupMultiselect).toHaveBeenCalledWith({
				message: "Which registry items should be added?",
				options,
			});
			expect(result).toEqual(["pr-template-configuration"]);
		});

		test("should call logger.end when operation is canceled", async () => {
			const cancelSymbol = Symbol("clack:cancel");
			mockGroupMultiselect.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			await expect(() =>
				groupedMultiselectInput(
					"Which registry items should be added?",
					options,
				),
			).rejects.toThrow("process.exit called with code 0");

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});
	});

	describe("confirmInput", () => {
		test("should call confirm with message", async () => {
			mockConfirm.mockResolvedValue(true);

			const message = "Do you want to continue?";
			await confirmInput(message);

			expect(mockConfirm).toHaveBeenCalledWith({ message });
		});

		test("should return boolean value for true", async () => {
			mockConfirm.mockResolvedValue(true);

			const result = await confirmInput("Confirm?");

			expect(result).toBe(true);
		});

		test("should return boolean value for false", async () => {
			mockConfirm.mockResolvedValue(false);

			const result = await confirmInput("Confirm?");

			expect(result).toBe(false);
		});

		test("should pass default value as initialValue", async () => {
			mockConfirm.mockResolvedValue(true);

			await confirmInput("Confirm?", {}, true);

			expect(mockConfirm).toHaveBeenCalledWith({
				message: "Confirm?",
				initialValue: true,
			});
		});

		test("should call logger.end when operation is canceled", async () => {
			const cancelSymbol = Symbol("clack:cancel");
			mockConfirm.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			await expect(() => confirmInput("Confirm?")).rejects.toThrow(
				"process.exit called with code 0",
			);

			expect(logger.end).toHaveBeenCalledWith("Operation canceled");
		});
	});

	describe("default export", () => {
		test("should export an object with all prompt methods", () => {
			expect(prompts).toBeDefined();
			expect(prompts.textInput).toBe(textInput);
			expect(prompts.selectInput).toBe(selectInput);
			expect(prompts.multiselectInput).toBe(multiselectInput);
			expect(prompts.groupedMultiselectInput).toBe(groupedMultiselectInput);
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

		test("should have groupedMultiselectInput method", () => {
			expect(prompts.groupedMultiselectInput).toBeDefined();
			expect(typeof prompts.groupedMultiselectInput).toBe("function");
		});

		test("should have confirmInput method", () => {
			expect(prompts.confirmInput).toBeDefined();
			expect(typeof prompts.confirmInput).toBe("function");
		});
	});
});
