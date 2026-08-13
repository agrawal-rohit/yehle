import type { CAC } from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockListCommand = vi.fn();
const mockPickStringOptions = vi.fn();
const mockLoggerIntro = vi.fn();
const mockLoggerError = vi.fn();
const mockConfigGetCommand = vi.fn();
const mockConfigSetCommand = vi.fn();
const mockConfigUnsetCommand = vi.fn();

vi.mock("./list", () => ({
	default: (...args: unknown[]) => mockListCommand(...args),
}));

vi.mock("./config", () => ({
	configGetCommand: (...args: unknown[]) => mockConfigGetCommand(...args),
	configSetCommand: (...args: unknown[]) => mockConfigSetCommand(...args),
	configUnsetCommand: (...args: unknown[]) => mockConfigUnsetCommand(...args),
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

import { registerCommandsCli } from "./index";

function createMockApp() {
	const actions = new Map<string, (...args: unknown[]) => Promise<void>>();
	const option = vi.fn().mockReturnThis();
	const command = vi.fn((name: string) => {
		const commandApi = {
			option,
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
	};

	return {
		app: app as unknown as CAC,
		command,
		option,
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
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers the list and config commands with usage and type option", async () => {
		const { app, command, option } = createMockApp();

		await registerCommandsCli(app, registry);

		expect(app.usage).toHaveBeenCalledWith("<command> [options]");
		expect(command).toHaveBeenCalledWith(
			"list",
			"List available registry items",
		);
		expect(command).toHaveBeenCalledWith(
			"config get",
			"Show the configured registry source",
		);
		expect(command).toHaveBeenCalledWith(
			"config set <source>",
			"Persist a default registry source",
		);
		expect(command).toHaveBeenCalledWith(
			"config unset",
			"Clear the saved registry source",
		);
		expect(option).toHaveBeenCalledWith(
			"--type <types>",
			expect.stringContaining("component, theme"),
		);
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

	it("runs config get with the current registry flag and env", async () => {
		const { app, actions } = createMockApp();
		const previous = process.env.TUCKSHOP_REGISTRY;
		process.env.TUCKSHOP_REGISTRY = "https://example.com/env-registry.json";

		try {
			await registerCommandsCli(app, registry, {
				registryFlag: "https://example.com/flag-registry.json",
			});

			await actions.get("config get")?.();

			expect(mockLoggerIntro).toHaveBeenCalledWith("checking the shelves");
			expect(mockConfigGetCommand).toHaveBeenCalledWith({
				flag: "https://example.com/flag-registry.json",
				envRegistry: "https://example.com/env-registry.json",
			});
		} finally {
			if (previous === undefined) delete process.env.TUCKSHOP_REGISTRY;
			else process.env.TUCKSHOP_REGISTRY = previous;
		}
	});

	it("runs config set with the provided source", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		await actions.get("config set <source>")?.(
			"https://example.com/registry.json",
		);

		expect(mockLoggerIntro).toHaveBeenCalledWith("stocking the shelves");
		expect(mockConfigSetCommand).toHaveBeenCalledWith(
			"https://example.com/registry.json",
		);
	});

	it("runs config unset", async () => {
		const { app, actions } = createMockApp();
		await registerCommandsCli(app, registry);

		await actions.get("config unset")?.();

		expect(mockLoggerIntro).toHaveBeenCalledWith("clearing the shelves");
		expect(mockConfigUnsetCommand).toHaveBeenCalled();
	});

	it("logs config command failures", async () => {
		const { app, actions } = createMockApp();
		mockConfigSetCommand.mockRejectedValue(new Error("bad source"));
		await registerCommandsCli(app, registry);

		await actions.get("config set <source>")?.("nope");

		expect(mockLoggerError).toHaveBeenCalledWith("bad source");
	});

	it("logs non-Error failures from config set as strings", async () => {
		const { app, actions } = createMockApp();
		mockConfigSetCommand.mockRejectedValue("set failure");
		await registerCommandsCli(app, registry);

		await actions.get("config set <source>")?.("nope");

		expect(mockLoggerError).toHaveBeenCalledWith("set failure");
	});

	it("logs Error messages when config get fails", async () => {
		const { app, actions } = createMockApp();
		mockConfigGetCommand.mockRejectedValue(new Error("read failed"));
		await registerCommandsCli(app, registry);

		await actions.get("config get")?.();

		expect(mockLoggerError).toHaveBeenCalledWith("read failed");
	});

	it("logs non-Error failures from config get as strings", async () => {
		const { app, actions } = createMockApp();
		mockConfigGetCommand.mockRejectedValue("get failure");
		await registerCommandsCli(app, registry);

		await actions.get("config get")?.();

		expect(mockLoggerError).toHaveBeenCalledWith("get failure");
	});

	it("logs Error messages when config unset fails", async () => {
		const { app, actions } = createMockApp();
		mockConfigUnsetCommand.mockRejectedValue(new Error("clear failed"));
		await registerCommandsCli(app, registry);

		await actions.get("config unset")?.();

		expect(mockLoggerError).toHaveBeenCalledWith("clear failed");
	});

	it("logs non-Error failures from config unset as strings", async () => {
		const { app, actions } = createMockApp();
		mockConfigUnsetCommand.mockRejectedValue("unset failure");
		await registerCommandsCli(app, registry);

		await actions.get("config unset")?.();

		expect(mockLoggerError).toHaveBeenCalledWith("unset failure");
	});
});
