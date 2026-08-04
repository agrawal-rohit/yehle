import { SCHEMA_VERSION } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock CLI dependencies used by the top-level entrypoint
const mockApp = {
	help: vi.fn(),
	option: vi.fn().mockReturnThis(),
	outputHelp: vi.fn(),
	parse: vi.fn(),
};

vi.mock("cac", () => ({
	default: vi.fn(() => mockApp),
}));

vi.mock("./commands", () => ({
	registerCommandsCli: vi.fn(async () => {}),
}));

vi.mock("./registry-remote", () => ({
	loadRuntimeRegistry: vi.fn(async () => ({
		version: "1.0.0",
		schemaVersion: SCHEMA_VERSION,
		contentBaseUrl: "https://example.com",
		items: {},
	})),
}));

vi.mock("./cli/config", () => ({
	readConfig: vi.fn(async () => ({})),
}));

import cac from "cac";
import { readConfig } from "./cli/config";
import { registerCommandsCli } from "./commands";
import run from "./index";
import { loadRuntimeRegistry } from "./registry-remote";

describe("index", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(registerCommandsCli).mockResolvedValue();
		vi.mocked(readConfig).mockResolvedValue({});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("run", () => {
		it("should initialize CAC with correct name and register the commands CLI", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop"] });

			await run();

			expect(cac).toHaveBeenCalledWith("tuckshop");
			expect(loadRuntimeRegistry).toHaveBeenCalledWith(undefined, undefined);
			expect(registerCommandsCli).toHaveBeenCalledWith(
				mockApp,
				expect.objectContaining({ schemaVersion: SCHEMA_VERSION }),
				{ registryFlag: undefined },
			);
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

		it("should pass through a global --registry override before registration", async () => {
			vi.stubGlobal("process", {
				argv: [
					"node",
					"tuckshop",
					"--registry",
					"https://example.com/registry.json",
					"list",
				],
			});
			vi.mocked(mockApp.parse).mockImplementation(() => {});

			await run();

			expect(loadRuntimeRegistry).toHaveBeenCalledWith(
				"https://example.com/registry.json",
				undefined,
			);
			expect(registerCommandsCli).toHaveBeenCalledWith(
				mockApp,
				expect.objectContaining({ schemaVersion: SCHEMA_VERSION }),
				{ registryFlag: "https://example.com/registry.json" },
			);
		});

		it("should forward a saved registry when no flag is present", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop", "list"] });
			vi.mocked(readConfig).mockResolvedValue({
				registry: "https://example.com/saved-registry.json",
			});
			vi.mocked(mockApp.parse).mockImplementation(() => {});

			await run();

			expect(loadRuntimeRegistry).toHaveBeenCalledWith(
				undefined,
				"https://example.com/saved-registry.json",
			);
		});

		it("should prefer the flag over a saved registry", async () => {
			vi.stubGlobal("process", {
				argv: [
					"node",
					"tuckshop",
					"--registry",
					"https://example.com/flag-registry.json",
					"list",
				],
			});
			vi.mocked(readConfig).mockResolvedValue({
				registry: "https://example.com/saved-registry.json",
			});
			vi.mocked(mockApp.parse).mockImplementation(() => {});

			await run();

			expect(loadRuntimeRegistry).toHaveBeenCalledWith(
				"https://example.com/flag-registry.json",
				"https://example.com/saved-registry.json",
			);
		});
	});
});
