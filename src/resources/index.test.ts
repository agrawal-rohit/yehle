import type { CAC } from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node modules and internal modules
vi.mock("../cli/logger", () => ({
	default: {
		error: vi.fn(),
	},
}));

vi.mock("./instructions/command", () => ({
	default: vi.fn(),
}));

vi.mock("./package/command", () => ({
	default: vi.fn(),
}));

import logger from "../cli/logger";
// Import after mocks
import { registerResourcesCli } from "./index";
import generateInstructions from "./instructions/command";
import generatePackage from "./package/command";

type MockCommand = {
	option: ReturnType<typeof vi.fn>;
	action: ReturnType<typeof vi.fn>;
};

describe("resources/index", () => {
	let mockApp: CAC;
	let mockCommand: MockCommand;
	beforeEach(() => {
		vi.clearAllMocks();
		mockCommand = {
			option: vi.fn().mockReturnThis(),
			action: vi.fn(),
		};
		const commandFn = vi.fn(() => mockCommand);
		const appLike = {
			usage: vi.fn(),
			command: commandFn,
		};
		mockApp = appLike as unknown as CAC;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("registerResourcesCli", () => {
		it("should register the `instructions` command with correct options", () => {
			registerResourcesCli(mockApp);

			expect(mockApp.usage).toHaveBeenCalledWith("<resource> [options]");
			expect(mockApp.command).toHaveBeenCalledWith(
				"instructions",
				"Add agent instructions to an existing project",
			);
			expect(mockCommand.option).toHaveBeenCalledWith(
				"--ide-format <format>",
				expect.stringContaining("cursor"),
			);
		});

		it("should register the `package` command with correct usage and options", () => {
			registerResourcesCli(mockApp);

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

		it("should call generateInstructions for resource 'instructions' with correct options", async () => {
			vi.mocked(generateInstructions).mockResolvedValue();

			registerResourcesCli(mockApp);
			const instructionsAction = mockCommand.action.mock.calls[0]?.[0];
			if (instructionsAction) {
				await instructionsAction({
					ideFormat: "cursor",
				});
			}

			expect(generateInstructions).toHaveBeenCalledWith({
				ideFormat: "cursor",
			});
		});

		it("should log error when generateInstructions throws", async () => {
			vi.mocked(generateInstructions).mockRejectedValue(
				new Error("Instructions error"),
			);

			registerResourcesCli(mockApp);
			const instructionsAction = mockCommand.action.mock.calls[0]?.[0];
			if (instructionsAction) {
				await instructionsAction({});
			}

			expect(logger.error).toHaveBeenCalledWith("Instructions error");
		});

		it("should call generatePackage for resource 'package' with correct options", async () => {
			vi.mocked(generatePackage).mockResolvedValue();

			registerResourcesCli(mockApp);
			const packageAction = mockCommand.action.mock.calls[1]?.[0];
			if (packageAction) {
				await packageAction({
					name: "test",
					lang: "typescript",
					public: true,
					template: "basic",
				});
			}

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
			const packageAction = mockCommand.action.mock.calls[1]?.[0];
			if (packageAction) await packageAction({ public: "true" });

			expect(generatePackage).toHaveBeenCalledWith({
				lang: undefined,
				name: undefined,
				template: undefined,
				public: true,
				includeInstructions: undefined,
				instructionsIdeFormat: undefined,
			});
		});

		it("should log error for thrown exceptions", async () => {
			const error = new Error("Test error");
			vi.mocked(generatePackage).mockRejectedValue(error);

			registerResourcesCli(mockApp);
			const packageAction = mockCommand.action.mock.calls[1]?.[0];
			if (packageAction) await packageAction({});

			expect(logger.error).toHaveBeenCalledWith("Test error");
		});

		it("should log string error for non-Error exceptions", async () => {
			vi.mocked(generatePackage).mockRejectedValue("String error");

			registerResourcesCli(mockApp);
			const packageAction = mockCommand.action.mock.calls[1]?.[0];
			if (packageAction) await packageAction({});

			expect(logger.error).toHaveBeenCalledWith("String error");
		});
	});
});
