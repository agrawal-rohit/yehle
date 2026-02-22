import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node modules and internal modules
const mockApp = {
	help: vi.fn(),
	outputHelp: vi.fn(),
	parse: vi.fn(),
};

vi.mock("cac", () => ({
	default: vi.fn(() => mockApp),
}));

vi.mock("../src/resources", () => ({
	registerResourcesCli: vi.fn(),
}));

import cac from "cac";
// Import after mocks
import run from "../src/index";
import { registerResourcesCli } from "../src/resources";

describe("index", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("run", () => {
		it("should initialize CAC with correct name and register the resources CLI", () => {
			vi.stubGlobal("process", { argv: ["node", "yehle"] });

			run();

			expect(cac).toHaveBeenCalledWith("yehle");
			expect(registerResourcesCli).toHaveBeenCalledWith(mockApp);
			expect(mockApp.help).toHaveBeenCalled();
		});

		it("should output help when no arguments are provided", () => {
			vi.stubGlobal("process", { argv: ["node", "yehle"] });

			run();

			expect(mockApp.outputHelp).toHaveBeenCalled();
			expect(mockApp.parse).not.toHaveBeenCalled();
		});

		it("should parse arguments when provided", () => {
			const argv = ["node", "yehle", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse).mockImplementation(() => {});

			run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.outputHelp).not.toHaveBeenCalled();
		});

		it("should handle parse errors by showing help for the command", () => {
			const argv = ["node", "yehle", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse)
				.mockImplementationOnce(() => {
					throw new Error("Parse error");
				})
				.mockImplementationOnce(() => {});

			run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.parse).toHaveBeenCalledWith([...argv, "--help"]);
			expect(mockApp.outputHelp).not.toHaveBeenCalled();
		});

		it("should fallback to global help if command help also fails", () => {
			const argv = ["node", "yehle", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse)
				.mockImplementationOnce(() => {
					throw new Error("Parse error");
				})
				.mockImplementationOnce(() => {
					throw new Error("Help parse error");
				});

			run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.parse).toHaveBeenCalledWith([...argv, "--help"]);
			expect(mockApp.outputHelp).toHaveBeenCalled();
		});

		it("should filter out empty arguments", () => {
			const argv = ["node", "yehle", "", "package"];
			vi.stubGlobal("process", { argv: ["node", "yehle", "package"] });
			vi.mocked(mockApp.parse).mockImplementation(() => {});

			run();

			expect(mockApp.parse).toHaveBeenCalledWith(["node", "yehle", "package"]);
		});
	});
});
