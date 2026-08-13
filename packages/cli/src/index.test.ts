import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock CLI dependencies used by the top-level entrypoint
const mockApp = {
	help: vi.fn(),
	option: vi.fn().mockReturnThis(),
	outputHelp: vi.fn(),
	parse: vi.fn(),
	matchedCommandName: undefined as string | undefined,
	options: {} as Record<string, unknown>,
};

vi.mock("cac", () => ({
	default: vi.fn(() => mockApp),
}));

vi.mock("./commands", () => ({
	registerCommandsCli: vi.fn(async () => {}),
}));

vi.mock("./registry-remote", () => ({
	loadRuntimeRegistry: vi.fn(async () => ({
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

/** Default shape returned by cac's `parse(..., { run: false })`. */
function emptyParseResult() {
	return { args: [] as string[], options: {} as Record<string, unknown> };
}

describe("index", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApp.matchedCommandName = undefined;
		mockApp.options = {};
		vi.mocked(registerCommandsCli).mockResolvedValue();
		vi.mocked(readConfig).mockResolvedValue({});
		vi.mocked(mockApp.parse).mockReturnValue(emptyParseResult());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("run", () => {
		it("should initialize CAC with correct name and register the commands CLI", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop"] });

			await run();

			expect(cac).toHaveBeenCalledWith("tuckshop");
			expect(mockApp.parse).toHaveBeenCalledWith(["node", "tuckshop"], {
				run: false,
			});
			expect(loadRuntimeRegistry).toHaveBeenCalledWith(undefined, undefined);
			expect(registerCommandsCli).toHaveBeenCalledWith(
				mockApp,
				expect.objectContaining({ contentBaseUrl: "https://example.com" }),
			);
		});

		it("should output help when no arguments are provided", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop"] });

			await run();

			expect(mockApp.outputHelp).toHaveBeenCalled();
			expect(mockApp.parse).toHaveBeenCalledTimes(1);
			expect(mockApp.parse).toHaveBeenCalledWith(["node", "tuckshop"], {
				run: false,
			});
		});

		it("should parse arguments when provided", async () => {
			const argv = ["node", "tuckshop", "list"];
			vi.stubGlobal("process", { argv });
			mockApp.matchedCommandName = "list";

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv, { run: false });
			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.outputHelp).not.toHaveBeenCalled();
		});

		it("should output help when no command matches", async () => {
			const argv = ["node", "tuckshop", "nope"];
			vi.stubGlobal("process", { argv });
			mockApp.matchedCommandName = undefined;

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.outputHelp).toHaveBeenCalled();
		});

		it("should not re-print help after cac already handled --help", async () => {
			const argv = ["node", "tuckshop", "config", "--help"];
			vi.stubGlobal("process", { argv });
			mockApp.matchedCommandName = undefined;
			mockApp.options = { help: true };

			await run();

			expect(mockApp.outputHelp).not.toHaveBeenCalled();
		});

		it("should handle parse errors by showing help for the command", async () => {
			const argv = ["node", "tuckshop", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse)
				.mockReturnValueOnce(emptyParseResult())
				.mockImplementationOnce(() => {
					throw new Error("Parse error");
				})
				.mockImplementationOnce(() => emptyParseResult());

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv, { run: false });
			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.parse).toHaveBeenCalledWith([...argv, "--help"]);
			expect(mockApp.outputHelp).not.toHaveBeenCalled();
		});

		it("should fallback to global help if command help also fails", async () => {
			const argv = ["node", "tuckshop", "package"];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse)
				.mockReturnValueOnce(emptyParseResult())
				.mockImplementationOnce(() => {
					throw new Error("Parse error");
				})
				.mockImplementationOnce(() => {
					throw new Error("Help parse error");
				});

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv, { run: false });
			expect(mockApp.parse).toHaveBeenCalledWith(argv);
			expect(mockApp.parse).toHaveBeenCalledWith([...argv, "--help"]);
			expect(mockApp.outputHelp).toHaveBeenCalled();
		});

		it("should pass through a global --registry override before registration", async () => {
			const argv = [
				"node",
				"tuckshop",
				"--registry",
				"https://example.com/registry.json",
				"list",
			];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse).mockReturnValue({
				args: ["list"],
				options: { registry: "https://example.com/registry.json" },
			});

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv, { run: false });
			expect(loadRuntimeRegistry).toHaveBeenCalledWith(
				"https://example.com/registry.json",
				undefined,
			);
			expect(registerCommandsCli).toHaveBeenCalledWith(
				mockApp,
				expect.objectContaining({ contentBaseUrl: "https://example.com" }),
			);
		});

		it("should pass through a global --registry=value override before registration", async () => {
			const argv = [
				"node",
				"tuckshop",
				"--registry=https://example.com/registry.json",
				"list",
			];
			vi.stubGlobal("process", { argv });
			vi.mocked(mockApp.parse).mockReturnValue({
				args: ["list"],
				options: { registry: "https://example.com/registry.json" },
			});

			await run();

			expect(mockApp.parse).toHaveBeenCalledWith(argv, { run: false });
			expect(loadRuntimeRegistry).toHaveBeenCalledWith(
				"https://example.com/registry.json",
				undefined,
			);
			expect(registerCommandsCli).toHaveBeenCalledWith(
				mockApp,
				expect.objectContaining({ contentBaseUrl: "https://example.com" }),
			);
		});

		it("should reject a missing --registry value before registration", async () => {
			vi.stubGlobal("process", {
				argv: ["node", "tuckshop", "list", "--registry"],
			});
			vi.mocked(mockApp.parse).mockReturnValue({
				args: ["list"],
				options: { registry: true },
			});

			await expect(run()).rejects.toThrow(
				"option `--registry <source>` value is missing",
			);
			expect(loadRuntimeRegistry).not.toHaveBeenCalled();
			expect(registerCommandsCli).not.toHaveBeenCalled();
		});

		it("should reject an empty --registry value before registration", async () => {
			vi.stubGlobal("process", {
				argv: ["node", "tuckshop", "--registry=", "list"],
			});
			vi.mocked(mockApp.parse).mockReturnValue({
				args: ["list"],
				options: { registry: "" },
			});

			await expect(run()).rejects.toThrow(
				"option `--registry <source>` value is missing",
			);
			expect(loadRuntimeRegistry).not.toHaveBeenCalled();
			expect(registerCommandsCli).not.toHaveBeenCalled();
		});

		it("should reject a non-string --registry value before registration", async () => {
			vi.stubGlobal("process", {
				argv: ["node", "tuckshop", "list", "--registry"],
			});
			vi.mocked(mockApp.parse).mockReturnValue({
				args: ["list"],
				options: { registry: 42 },
			});

			await expect(run()).rejects.toThrow(
				"option `--registry <source>` received an unexpected value (number)",
			);
			expect(loadRuntimeRegistry).not.toHaveBeenCalled();
			expect(registerCommandsCli).not.toHaveBeenCalled();
		});

		it("should forward a saved registry when no flag is present", async () => {
			vi.stubGlobal("process", { argv: ["node", "tuckshop", "list"] });
			vi.mocked(readConfig).mockResolvedValue({
				registry: "https://example.com/saved-registry.json",
			});

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
			vi.mocked(mockApp.parse).mockReturnValue({
				args: ["list"],
				options: { registry: "https://example.com/flag-registry.json" },
			});

			await run();

			expect(loadRuntimeRegistry).toHaveBeenCalledWith(
				"https://example.com/flag-registry.json",
				"https://example.com/saved-registry.json",
			);
		});

		it("should skip registry loading for config commands", async () => {
			vi.stubGlobal("process", {
				argv: ["node", "tuckshop", "config", "get"],
			});
			vi.mocked(readConfig).mockResolvedValue({
				registry: "https://example.com/broken-registry.json",
			});
			mockApp.matchedCommandName = "config";

			await run();

			expect(loadRuntimeRegistry).not.toHaveBeenCalled();
			expect(readConfig).not.toHaveBeenCalled();
			expect(registerCommandsCli).toHaveBeenCalledWith(mockApp, {
				contentBaseUrl: "",
				types: {},
				items: {},
			});
		});

		it("should skip registry loading for config even with --registry ahead", async () => {
			vi.stubGlobal("process", {
				argv: [
					"node",
					"tuckshop",
					"--registry",
					"https://example.com/flag-registry.json",
					"config",
					"unset",
				],
			});
			vi.mocked(mockApp.parse).mockReturnValue({
				args: ["config", "unset"],
				options: { registry: "https://example.com/flag-registry.json" },
			});
			mockApp.matchedCommandName = "config";

			await run();

			expect(loadRuntimeRegistry).not.toHaveBeenCalled();
		});
	});
});
