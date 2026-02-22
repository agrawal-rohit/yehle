import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node modules and internal modules
vi.mock("../../src/cli/logger", () => ({
	default: {
		error: vi.fn(),
	},
}));

vi.mock("../../src/resources/package/command", () => ({
	default: vi.fn(),
}));

import logger from "../../src/cli/logger";
// Import after mocks
import { registerResourcesCli } from "../../src/resources/index";
import generatePackage from "../../src/resources/package/command";

describe("resources/index", () => {
	let mockApp: any;
	let mockCommand: any;
	let capturedAction: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockCommand = {
			option: vi.fn().mockReturnThis(),
			action: vi.fn((fn: any) => {
				capturedAction = fn;
			}),
		};
		mockApp = {
			usage: vi.fn(),
			command: vi.fn(() => mockCommand),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("registerResourcesCli", () => {
		it("should register the `package` command with correct usage and options", () => {
			registerResourcesCli(mockApp);

			expect(mockApp.usage).toHaveBeenCalledWith("<resource> [options]");
			expect(mockApp.command).toHaveBeenCalledWith(
				"package",
				"Generate a package",
			);

			expect(mockCommand.option).toHaveBeenCalledWith(
				"--name <name>",
				"Package name",
			);
			expect(mockCommand.option).toHaveBeenCalledWith(
				"--lang <lang>",
				"Target language (e.g., typescript)",
			);
			expect(mockCommand.option).toHaveBeenCalledWith(
				"--public",
				"Public package (will setup for publishing to a package registry)",
			);
			expect(mockCommand.option).toHaveBeenCalledWith(
				"--template <template>",
				"Starter template for the package",
			);
		});

		it("should call generatePackage for resource 'package' with correct options", async () => {
			vi.mocked(generatePackage).mockResolvedValue();

			registerResourcesCli(mockApp);
			await capturedAction({
				name: "test",
				lang: "typescript",
				public: true,
				template: "basic",
			});

			expect(generatePackage).toHaveBeenCalledWith({
				lang: "typescript",
				name: "test",
				template: "basic",
				public: true,
			});
		});

		it("should convert public option to boolean for package", async () => {
			vi.mocked(generatePackage).mockResolvedValue();

			registerResourcesCli(mockApp);
			await capturedAction({ public: "true" });

			expect(generatePackage).toHaveBeenCalledWith({
				lang: undefined,
				name: undefined,
				template: undefined,
				public: true,
			});
		});

		it("should log usage for unknown resource", async () => {
			const consoleLogSpy = vi
				.spyOn(console, "log")
				.mockImplementation(() => {});

			registerResourcesCli(mockApp);
			await capturedAction("unknown", {});

			consoleLogSpy.mockRestore();
		});

		it("should log error for thrown exceptions", async () => {
			const error = new Error("Test error");
			vi.mocked(generatePackage).mockRejectedValue(error);

			registerResourcesCli(mockApp);
			await capturedAction("package", {});

			expect(logger.error).toHaveBeenCalledWith("Test error");
		});

		it("should log string error for non-Error exceptions", async () => {
			vi.mocked(generatePackage).mockRejectedValue("String error");

			registerResourcesCli(mockApp);
			await capturedAction("package", {});

			expect(logger.error).toHaveBeenCalledWith("String error");
		});
	});
});
