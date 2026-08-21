import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OperationCanceledError } from "./errors";
import {
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

			await textInput("Enter your name");

			const payload = mockText.mock.calls[0]?.[0] as Record<string, unknown>;
			expect(payload).toEqual({ message: "Enter your name" });
			expect("placeholder" in payload).toBe(false);
			expect("initialValue" in payload).toBe(false);
			expect("defaultValue" in payload).toBe(false);
		});

		test("should return trimmed value", async () => {
			mockText.mockResolvedValue("  test value  ");

			await expect(textInput("Enter text")).resolves.toBe("test value");
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

		test("should throw OperationCanceledError when canceled", async () => {
			const cancelSymbol = Symbol("clack:cancel");
			mockText.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			await expect(textInput("Enter text")).rejects.toBeInstanceOf(
				OperationCanceledError,
			);
		});
	});

	describe("selectInput", () => {
		const options = [
			{ label: "Option 1", value: "option1" },
			{ label: "Option 2", value: "option2" },
		];

		test("should call select with message and options", async () => {
			mockSelect.mockResolvedValue("option1");

			await selectInput("Select an option", { options });

			const payload = mockSelect.mock.calls[0]?.[0] as Record<string, unknown>;
			expect(payload).toEqual({
				message: "Select an option",
				options,
			});
			expect("initialValue" in payload).toBe(false);
		});

		test("should return selected value", async () => {
			mockSelect.mockResolvedValue("selected-option");

			await expect(
				selectInput("Select", {
					options: [
						{ label: "opt1", value: "opt1" },
						{ label: "opt2", value: "opt2" },
					],
				}),
			).resolves.toBe("selected-option");
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

		test("should throw OperationCanceledError when canceled", async () => {
			mockSelect.mockResolvedValue(Symbol("clack:cancel"));
			mockIsCancel.mockReturnValue(true);

			await expect(
				selectInput("Select", { options: [] }),
			).rejects.toBeInstanceOf(OperationCanceledError);
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
		];

		test("should call multiselect with message and options", async () => {
			mockMultiselect.mockResolvedValue(["option1", "option2"]);

			await multiselectInput("Select multiple options", { options });

			const payload = mockMultiselect.mock.calls[0]?.[0] as Record<
				string,
				unknown
			>;
			expect(payload).toEqual({
				message: "Select multiple options",
				options,
			});
			expect("initialValues" in payload).toBe(false);
		});

		test("should return array of selected values", async () => {
			const selectedValues = ["option1", "option3"];
			mockMultiselect.mockResolvedValue(selectedValues);

			await expect(
				multiselectInput("Select multiple", { options }),
			).resolves.toEqual(selectedValues);
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

		test("should throw OperationCanceledError when canceled", async () => {
			mockMultiselect.mockResolvedValue(Symbol("clack:cancel"));
			mockIsCancel.mockReturnValue(true);

			await expect(
				multiselectInput("Select multiple", { options: [] }),
			).rejects.toBeInstanceOf(OperationCanceledError);
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

		test("should throw OperationCanceledError when canceled", async () => {
			mockGroupMultiselect.mockResolvedValue(Symbol("clack:cancel"));
			mockIsCancel.mockReturnValue(true);

			await expect(
				groupedMultiselectInput(
					"Which registry items should be added?",
					options,
				),
			).rejects.toBeInstanceOf(OperationCanceledError);
		});
	});

	describe("confirmInput", () => {
		test("should call confirm with message", async () => {
			mockConfirm.mockResolvedValue(true);

			await confirmInput("Do you want to continue?");

			const payload = mockConfirm.mock.calls[0]?.[0] as Record<string, unknown>;
			expect(payload).toEqual({
				message: "Do you want to continue?",
			});
			expect("initialValue" in payload).toBe(false);
		});

		test("should return boolean value for true", async () => {
			mockConfirm.mockResolvedValue(true);

			await expect(confirmInput("Confirm?")).resolves.toBe(true);
		});

		test("should return boolean value for false", async () => {
			mockConfirm.mockResolvedValue(false);

			await expect(confirmInput("Confirm?")).resolves.toBe(false);
		});

		test("should pass default value as initialValue", async () => {
			mockConfirm.mockResolvedValue(true);

			await confirmInput("Confirm?", {}, true);

			expect(mockConfirm).toHaveBeenCalledWith({
				message: "Confirm?",
				initialValue: true,
			});
		});

		test("should throw OperationCanceledError when canceled", async () => {
			mockConfirm.mockResolvedValue(Symbol("clack:cancel"));
			mockIsCancel.mockReturnValue(true);

			await expect(confirmInput("Confirm?")).rejects.toBeInstanceOf(
				OperationCanceledError,
			);
		});
	});
});
