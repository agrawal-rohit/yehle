import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock CLI dependencies used by the top-level entrypoint
const mockApp = {
	help: vi.fn(),
	outputHelp: vi.fn(),
	parse: vi.fn(),
};

vi.mock("cac", () => ({
	default: vi.fn(() => mockApp),
}));

vi.mock("./commands", () => ({
	registerCommandsCli: vi.fn(async () => {}),
}));

import cac from "cac";
import { registerCommandsCli } from "./commands";
import run from "./index";

describe("index", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(registerCommandsCli).mockResolvedValue();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("run", () => {
		it("should initialize CAC with correct name and register the commands CLI", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop"] });

			await run();

			expect(cac).toHaveBeenCalledWith("tuckshop");
			expect(registerCommandsCli).toHaveBeenCalledWith(mockApp);
			expect(mockApp.help).toHaveBeenCalled();
		});

		it("should output help when no arguments are provided", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop"] });

			await run();

			expect(mockApp.outputHelp).toHaveBeenCalled();
			expect(mockApp.parse).not.toHaveBeenCalled();
		});

		it("should parse arguments when provided", async () => {
			const argv = ["node", "tuckshop", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse).mockImplementation(() => {});

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.outputHelp).not.toHaveBeenCalled();
		});

		it("should handle parse errors by showing help for the command", async () => {
			const argv = ["node", "tuckshop", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse)
				.mockImplementationOnce(() => {
					throw new Error("Parse error");
				})
				.mockImplementationOnce(() => {});

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.parse).toHaveBeenCalledWith([...argv, "--help"]);
			expect(mockApp.outputHelp).not.toHaveBeenCalled();
		});

		it("should fallback to global help if command help also fails", async () => {
			const argv = ["node", "tuckshop", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse)
				.mockImplementationOnce(() => {
					throw new Error("Parse error");
				})
				.mockImplementationOnce(() => {
					throw new Error("Help parse error");
				});

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.parse).toHaveBeenCalledWith([...argv, "--help"]);
			expect(mockApp.outputHelp).toHaveBeenCalled();
		});

		it("should filter out empty arguments", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop", "package"] });
			vi.mocked(mockApp.parse).mockImplementation(() => {});

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith([
				"node",
				"tuckshop",
				"package",
			]);
		});
	});
});
