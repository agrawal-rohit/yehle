import type { CAC } from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockListCommand = vi.fn();
const mockPickStringOptions = vi.fn();
const mockLoggerIntro = vi.fn();
const mockLoggerError = vi.fn();
const mockConfigGetCommand = vi.fn();
const mockConfigSetCommand = vi.fn();
const mockConfigUnsetCommand = vi.fn();
const mockConsolaPrompt = vi.fn();
const mockReadConfig = vi.fn();

vi.mock("./list", () => ({
	default: (...args: unknown[]) => mockListCommand(...args),
}));

vi.mock("./config", () => ({
	configGetCommand: (...args: unknown[]) => mockConfigGetCommand(...args),
	configSetCommand: (...args: unknown[]) => mockConfigSetCommand(...args),
	configUnsetCommand: (...args: unknown[]) => mockConfigUnsetCommand(...args),
}));

vi.mock("../cli/config", () => ({
	readConfig: (...args: unknown[]) => mockReadConfig(...args),
}));

vi.mock("../cli/options", () => ({
	pickStringOptions: (...args: unknown[]) => mockPickStringOptions(...args),
}));

vi.mock("../cli/logger", () => ({
	default: {
		intro: (...args: unknown[]) => mockLoggerIntro(...args),
		error: (...args: unknown[]) => mockLoggerError(...args),
	},
}));

vi.mock("consola", () => ({
	default: {
		prompt: (...args: unknown[]) => mockConsolaPrompt(...args),
	},
}));

import { registerCommandsCli } from "./index";

function createMockApp() {
	const actions = new Map<string, (...args: unknown[]) => Promise<void>>();
	const option = vi.fn().mockReturnThis();
	const example = vi.fn().mockReturnThis();
	const help = vi.fn().mockReturnThis();
	const command = vi.fn((name: string) => {
		const commandApi = {
			option,
			example,
			action: (handler: (...args: unknown[]) => Promise<void>) => {
				actions.set(name, handler);
				return commandApi;
			},
		};
		return commandApi;
	});

	const app = {
		usage: vi.fn(),
		command,
		help,
	};

	return {
		app: app as unknown as CAC,
		command,
		option,
		example,
		help,
		actions,
	};
}

describe("commands/index", () => {
	const registry = {
		contentBaseUrl: "https://example.com",
		types: {
			component: { label: "Components" },
			theme: { label: "Themes" },
		},
		items: {
			"theme-a": {
				id: "theme-a",
				title: "Theme A",
				description: "A theme",
				type: "theme",
				variants: [],
			},
		},
	};
	const itemTypes = ["component", "theme"];

	beforeEach(() => {
		vi.clearAllMocks();
		mockPickStringOptions.mockReturnValue({ type: "theme" });
		mockListCommand.mockResolvedValue(undefined);
		mockLoggerIntro.mockResolvedValue(undefined);
		mockConfigGetCommand.mockResolvedValue(undefined);
		mockConfigSetCommand.mockResolvedValue("/tmp/config.json");
		mockConfigUnsetCommand.mockResolvedValue(true);
		mockConsolaPrompt.mockResolvedValue(
			"https://example.com/prompted-registry.json",
		);
		mockReadConfig.mockResolvedValue({});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers the list and config commands with usage and type option", async () => {
		const { app, command, option, example, help } = createMockApp();

		await registerCommandsCli(app, registry);

		expect(app.usage).toHaveBeenCalledWith("<command> [options]");
		expect(command).toHaveBeenCalledWith(
			"list",
			"List available registry items",
		);
		expect(command).toHaveBeenCalledWith(
			"config <action> [source]",
			"Get, set, or unset the default registry source",
		);
		expect(option).toHaveBeenCalledWith(
			"--type <types>",
			expect.stringContaining("component, theme"),
		);
		expect(example).toHaveBeenCalledTimes(3);
		expect(help).toHaveBeenCalledWith(expect.any(Function));
	});

	it("enriches config help with action and source documentation", async () => {
		const { app, help } = createMockApp();
		await registerCommandsCli(app, registry);

		const helpCallback = vi.mocked(help).mock.calls[0]?.[0] as (
			sections: Array<{ title?: string; body: string }>,
		) => Array<{ title?: string; body: string }>;

		const enriched = helpCallback([
			{ body: "tuckshop" },
			{ title: "Usage", body: "  $ tuckshop config <action> [source]" },
			{ title: "Options", body: "  -h, --help" },
		]);

		expect(enriched).toEqual([
			{ body: "tuckshop" },
			{ title: "Usage", body: "  $ tuckshop config <action> [source]" },
			{
				title: "Arguments",
				body: [
					"  action               get | set | unset",
					"  source               Registry HTTPS URL or local path (prompts if omitted for set)",
				].join("\n"),
			},
			{ title: "Options", body: "  -h, --help" },
		]);

		const untouched = helpCallback([
			{ body: "tuckshop" },
			{ title: "Usage", body: "  $ tuckshop list" },
		]);
		expect(untouched).toEqual([
			{ body: "tuckshop" },
			{ title: "Usage", body: "  $ tuckshop list" },
		]);
	});

	it("runs the list command action with picked options", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		const listAction = actions.get("list");
		expect(listAction).toBeDefined();
		await listAction?.({ type: "theme" });

		expect(mockLoggerIntro).toHaveBeenCalledWith("here's the menu");
		expect(mockPickStringOptions).toHaveBeenCalledWith({ type: "theme" }, [
			"type",
		]);
		expect(mockListCommand).toHaveBeenCalledWith(registry, itemTypes, {
			type: "theme",
		});
		expect(mockLoggerError).not.toHaveBeenCalled();
	});

	it("logs Error messages when the list command fails", async () => {
		const { app, actions } = createMockApp();
		mockListCommand.mockRejectedValue(new Error("boom"));
		await registerCommandsCli(app, registry);

		await actions.get("list")?.({});

		expect(mockLoggerError).toHaveBeenCalledWith("boom");
	});

	it("logs non-Error failures as strings", async () => {
		const { app, actions } = createMockApp();
		mockListCommand.mockRejectedValue("string failure");
		await registerCommandsCli(app, registry);

		await actions.get("list")?.({});

		expect(mockLoggerError).toHaveBeenCalledWith("string failure");
	});

	it("runs config get", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("get");

		expect(mockLoggerIntro).toHaveBeenCalledWith("fetching the configuration");
		expect(mockConfigGetCommand).toHaveBeenCalledWith();
	});

	it("rejects bare config without an action", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.();

		expect(mockConfigGetCommand).not.toHaveBeenCalled();
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Missing config action. Usage: tuckshop config <get|set|unset> [source]",
		);
	});

	it("runs config set with the provided source", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.(
			"set",
			"https://example.com/registry.json",
		);

		expect(mockLoggerIntro).toHaveBeenCalledWith("updating the configuration");
		expect(mockConsolaPrompt).not.toHaveBeenCalled();
		expect(mockConfigSetCommand).toHaveBeenCalledWith(
			"https://example.com/registry.json",
		);
	});

	it("prompts for a source when config set omits one", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("set");

		expect(mockConsolaPrompt).toHaveBeenCalledWith(
			"Registry URL or local path",
			expect.objectContaining({ type: "text", cancel: "reject" }),
		);
		expect(mockConfigSetCommand).toHaveBeenCalledWith(
			"https://example.com/prompted-registry.json",
		);
	});

	it("rejects an empty prompted source", async () => {
		const { app, actions } = createMockApp();
		mockConsolaPrompt.mockResolvedValue("   ");
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("set");

		expect(mockConfigSetCommand).not.toHaveBeenCalled();
		expect(mockLoggerError).toHaveBeenCalledWith(
			"Registry source must not be empty.",
		);
	});

	it("runs config unset and notes restoring the default", async () => {
		const { app, actions } = createMockApp();
		mockReadConfig.mockResolvedValue({
			registry: "https://example.com/registry.json",
		});
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("unset");

		expect(mockLoggerIntro).toHaveBeenCalledWith(
			"clearing the configuration (restored the default registry)",
		);
		expect(mockConfigUnsetCommand).toHaveBeenCalled();
	});

	it("notes when unset is already on the default registry", async () => {
		const { app, actions } = createMockApp();
		mockReadConfig.mockResolvedValue({});
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("unset");

		expect(mockLoggerIntro).toHaveBeenCalledWith(
			"clearing the configuration (already using the default registry)",
		);
		expect(mockConfigUnsetCommand).toHaveBeenCalled();
	});

	it("rejects unknown config actions", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("bogus");

		expect(mockLoggerError).toHaveBeenCalledWith(
			'Unknown config action "bogus". Use get, set, or unset.',
		);
	});

	it("logs config command failures", async () => {
		const { app, actions } = createMockApp();
		mockConfigSetCommand.mockRejectedValue(new Error("bad source"));
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("set", "nope");

		expect(mockLoggerError).toHaveBeenCalledWith("bad source");
	});

	it("logs non-Error failures from config set as strings", async () => {
		const { app, actions } = createMockApp();
		mockConfigSetCommand.mockRejectedValue("set failure");
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("set", "nope");

		expect(mockLoggerError).toHaveBeenCalledWith("set failure");
	});

	it("logs Error messages when config get fails", async () => {
		const { app, actions } = createMockApp();
		mockConfigGetCommand.mockRejectedValue(new Error("read failed"));
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("get");

		expect(mockLoggerError).toHaveBeenCalledWith("read failed");
	});

	it("logs non-Error failures from config get as strings", async () => {
		const { app, actions } = createMockApp();
		mockConfigGetCommand.mockRejectedValue("get failure");
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("get");

		expect(mockLoggerError).toHaveBeenCalledWith("get failure");
	});

	it("logs Error messages when config unset fails", async () => {
		const { app, actions } = createMockApp();
		mockConfigUnsetCommand.mockRejectedValue(new Error("clear failed"));
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("unset");

		expect(mockLoggerError).toHaveBeenCalledWith("clear failed");
	});

	it("logs non-Error failures from config unset as strings", async () => {
		const { app, actions } = createMockApp();
		mockConfigUnsetCommand.mockRejectedValue("unset failure");
		await registerCommandsCli(app, registry);

		await actions.get("config <action> [source]")?.("unset");

		expect(mockLoggerError).toHaveBeenCalledWith("unset failure");
	});
});
