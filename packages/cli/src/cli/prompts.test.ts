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

		test("should throw when the result is not a string", async () => {
			mockText.mockResolvedValue(42);

			await expect(textInput("Enter text")).rejects.toThrow(
				'Text prompt "Enter text" returned a non-string value.',
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
			mockSelect.mockResolvedValue("opt1");

			await expect(
				selectInput("Select", {
					options: [
						{ label: "opt1", value: "opt1" },
						{ label: "opt2", value: "opt2" },
					],
				}),
			).resolves.toBe("opt1");
		});

		test("should pass default value as initialValue", async () => {
			mockSelect.mockResolvedValue("option1");

			await selectInput("Select", { options }, "option1");

			expect(mockSelect).toHaveBeenCalledWith({
				message: "Select",
				options,
				initialValue: "option1",
			});
		});

		test("should throw OperationCanceledError when canceled", async () => {
			mockSelect.mockResolvedValue(Symbol("clack:cancel"));
			mockIsCancel.mockReturnValue(true);

			await expect(selectInput("Select", { options })).rejects.toBeInstanceOf(
				OperationCanceledError,
			);
		});

		test("should throw when options are empty", async () => {
			await expect(
				selectInput("Select an option", { options: [] }),
			).rejects.toThrow('Select prompt "Select an option" has no options.');
			expect(mockSelect).not.toHaveBeenCalled();
		});

		test("should throw when the default is not an offered option", async () => {
			await expect(
				selectInput("Select", { options }, "missing"),
			).rejects.toThrow(
				'Select prompt "Select" has an unexpected default value.',
			);
			expect(mockSelect).not.toHaveBeenCalled();
		});

		test("should throw when the selected value is not an offered option", async () => {
			mockSelect.mockResolvedValue("missing");

			await expect(selectInput("Select", { options })).rejects.toThrow(
				'Select prompt "Select" returned an unexpected value.',
			);
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
			const selectedValues = ["option1", "option2"];
			mockMultiselect.mockResolvedValue(selectedValues);

			await expect(
				multiselectInput("Select multiple", { options }),
			).resolves.toEqual(selectedValues);
		});

		test("should pass default values as initialValues", async () => {
			mockMultiselect.mockResolvedValue(["option1"]);

			const defaultValues = ["option1"];
			await multiselectInput("Select", { options }, defaultValues);

			expect(mockMultiselect).toHaveBeenCalledWith({
				message: "Select",
				options,
				initialValues: defaultValues,
			});
		});

		test("should throw OperationCanceledError when canceled", async () => {
			mockMultiselect.mockResolvedValue(Symbol("clack:cancel"));
			mockIsCancel.mockReturnValue(true);

			await expect(
				multiselectInput("Select multiple", { options }),
			).rejects.toBeInstanceOf(OperationCanceledError);
		});

		test("should throw when options are empty", async () => {
			await expect(
				multiselectInput("Select multiple options", { options: [] }),
			).rejects.toThrow(
				'Select prompt "Select multiple options" has no options.',
			);
			expect(mockMultiselect).not.toHaveBeenCalled();
		});

		test("should throw when a default is not an offered option", async () => {
			await expect(
				multiselectInput("Select", { options }, ["missing"]),
			).rejects.toThrow(
				'Select prompt "Select" has an unexpected default value.',
			);
			expect(mockMultiselect).not.toHaveBeenCalled();
		});

		test("should throw when a selected value is not an offered option", async () => {
			mockMultiselect.mockResolvedValue(["option1", "missing"]);

			await expect(
				multiselectInput("Select multiple", { options }),
			).rejects.toThrow(
				'Multiselect prompt "Select multiple" returned an unexpected value.',
			);
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

		test("should throw when no grouped options are offered", async () => {
			await expect(
				groupedMultiselectInput("Which registry items should be added?", {}),
			).rejects.toThrow(
				'Select prompt "Which registry items should be added?" has no options.',
			);
			expect(mockGroupMultiselect).not.toHaveBeenCalled();
		});

		test("should throw when a selected value is not an offered option", async () => {
			mockGroupMultiselect.mockResolvedValue(["missing"]);

			await expect(
				groupedMultiselectInput(
					"Which registry items should be added?",
					options,
				),
			).rejects.toThrow(
				'Multiselect prompt "Which registry items should be added?" returned an unexpected value.',
			);
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

		test("should throw when the result is not a boolean", async () => {
			mockConfirm.mockResolvedValue("yes");

			await expect(confirmInput("Confirm?")).rejects.toThrow(
				'Confirm prompt "Confirm?" returned a non-boolean value.',
			);
		});
	});
});
