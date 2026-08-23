import type { Registry } from "@tuckshop/core";
import type { CAC } from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockListCommand = vi.fn();
const mockAddCommand = vi.fn();
const mockPickStringOptions = vi.fn();
const mockIntro = vi.fn();
const mockConfigGetCommand = vi.fn();
const mockConfigSetCommand = vi.fn();
const mockConfigUnsetCommand = vi.fn();
const mockLoadRegistry = vi.fn();

vi.mock("./list", () => ({
	listCommand: (...args: unknown[]) => mockListCommand(...args),
}));

vi.mock("./add", () => ({
	addCommand: (...args: unknown[]) => mockAddCommand(...args),
}));

vi.mock("./config", () => ({
	configGetCommand: (...args: unknown[]) => mockConfigGetCommand(...args),
	configSetCommand: (...args: unknown[]) => mockConfigSetCommand(...args),
	configUnsetCommand: (...args: unknown[]) => mockConfigUnsetCommand(...args),
}));

vi.mock("../cli/options", () => ({
	pickStringOptions: (...args: unknown[]) => mockPickStringOptions(...args),
	getBooleanOption: (options: Record<string, unknown>, key: string) =>
		options[key] === true,
}));

vi.mock("../cli/animated-intro", () => ({
	animatedIntro: (...args: unknown[]) => mockIntro(...args),
}));

import { registerCommandsCli } from "./index";

function createMockApp() {
	const actions = new Map<string, (...args: unknown[]) => Promise<void>>();
	const option = vi.fn().mockReturnThis();
	const example = vi.fn().mockReturnThis();
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
	};

	return {
		app: app as unknown as CAC,
		command,
		option,
		example,
		actions,
	};
}

describe("commands/index", () => {
	const registry = {
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
	} as Registry;

	let processExitSpy: ReturnType<typeof vi.fn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		processExitSpy = vi.fn();
		Object.defineProperty(process, "exit", {
			configurable: true,
			value: ((code?: string | number | null) => {
				processExitSpy(code);
				throw new Error(`process.exit called with code ${code ?? undefined}`);
			}) as typeof process.exit,
		});

		mockPickStringOptions.mockReturnValue({ type: "theme" });
		mockListCommand.mockReturnValue(undefined);
		mockAddCommand.mockResolvedValue(undefined);
		mockIntro.mockResolvedValue(undefined);
		mockConfigGetCommand.mockResolvedValue(undefined);
		mockConfigSetCommand.mockResolvedValue("/tmp/config.json");
		mockConfigUnsetCommand.mockResolvedValue(true);
		mockLoadRegistry.mockResolvedValue({
			registry,
			catalogLocation: "/workspace/registry.json",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * Assert a command action exits with code 1 and prints the message.
	 * @param action - Command action promise.
	 * @param message - Expected error text fragment.
	 */
	async function expectCommandError(
		action: Promise<void> | undefined,
		message: string,
	): Promise<void> {
		await expect(action).rejects.toThrow("process.exit called with code 1");
		expect(processExitSpy).toHaveBeenCalledWith(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining(message),
		);
	}

	it("registers the add, list, and nested config commands", () => {
		const { app, command, option, example } = createMockApp();

		registerCommandsCli(app, mockLoadRegistry);

		expect(app.usage).toHaveBeenCalledWith("<command> [options]");
		expect(command).toHaveBeenCalledWith(
			"add [items...]",
			"Add registry items to the current working directory",
		);
		expect(command).toHaveBeenCalledWith(
			"list",
			"List available registry items",
		);
		expect(command).toHaveBeenCalledWith(
			"config",
			"Get, set, or unset the default registry source",
		);
		expect(command).toHaveBeenCalledWith(
			"config get",
			"Print the active registry source",
		);
		expect(command).toHaveBeenCalledWith(
			"config set [source]",
			"Set the default registry HTTPS URL or local path (prompts if omitted)",
		);
		expect(command).toHaveBeenCalledWith(
			"config unset",
			"Clear the saved registry and use the default",
		);
		expect(option).toHaveBeenCalledWith(
			"--overwrite",
			"Overwrite existing files",
		);
		expect(option).toHaveBeenCalledWith(
			"--type <types>",
			"Filter by type: all, or comma-separated types. Lists all types when omitted",
		);
		expect(example).toHaveBeenCalledTimes(1);
		const exampleFactory = example.mock.calls[0]?.[0] as (
			bin: string,
		) => string;
		expect(exampleFactory("tuckshop")).toBe(
			"$ tuckshop config set <url-or-path>",
		);
	});

	it("runs the add command action with no positional items", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await actions.get("add [items...]")?.(undefined, {});

		expect(mockAddCommand).toHaveBeenCalledWith(
			registry,
			"/workspace/registry.json",
			{
				items: [],
				overwrite: false,
			},
		);
	});

	it("runs the add command action with trimmed positional items", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await actions.get("add [items...]")?.(
			["pr-template-configuration", "  ", ""],
			{ overwrite: true },
		);

		expect(mockLoadRegistry).toHaveBeenCalled();
		expect(mockIntro).toHaveBeenCalledWith("adding registry items");
		expect(mockAddCommand).toHaveBeenCalledWith(
			registry,
			"/workspace/registry.json",
			{
				items: ["pr-template-configuration"],
				overwrite: true,
			},
		);
	});

	it("runs the list command action with picked options", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await actions.get("list")?.({ type: "theme" });

		expect(mockLoadRegistry).toHaveBeenCalled();
		expect(mockIntro).toHaveBeenCalledWith("here's the menu");
		expect(mockPickStringOptions).toHaveBeenCalledWith({ type: "theme" }, [
			"type",
		]);
		expect(mockListCommand).toHaveBeenCalledWith(registry, "theme");
		expect(processExitSpy).not.toHaveBeenCalled();
	});

	it("exits when the registry loader fails for list", async () => {
		const { app, actions } = createMockApp();
		mockLoadRegistry.mockRejectedValue(new Error("load failed"));
		registerCommandsCli(app, mockLoadRegistry);

		await expectCommandError(actions.get("list")?.({}), "load failed");
	});

	it("runs config get without loading the registry", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await actions.get("config get")?.();

		expect(mockLoadRegistry).not.toHaveBeenCalled();
		expect(mockIntro).toHaveBeenCalledWith("fetching the configuration");
		expect(mockConfigGetCommand).toHaveBeenCalledWith();
	});

	it("rejects bare config without a subcommand", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await expectCommandError(
			actions.get("config")?.(),
			"Missing config action. Usage: tuckshop config <get|set|unset> [source]",
		);
		expect(mockConfigGetCommand).not.toHaveBeenCalled();
	});

	it("runs config set with the provided source", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await actions.get("config set [source]")?.(
			"https://example.com/registry.json",
		);

		expect(mockIntro).toHaveBeenCalledWith("updating the configuration");
		expect(mockConfigSetCommand).toHaveBeenCalledWith(
			"https://example.com/registry.json",
		);
	});

	it("runs config set without a source so the command can prompt", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await actions.get("config set [source]")?.();

		expect(mockConfigSetCommand).toHaveBeenCalledWith(undefined);
	});

	it("runs config unset", async () => {
		const { app, actions } = createMockApp();
		registerCommandsCli(app, mockLoadRegistry);

		await actions.get("config unset")?.();

		expect(mockIntro).toHaveBeenCalledWith("clearing the configuration");
		expect(mockConfigUnsetCommand).toHaveBeenCalled();
	});

	it("exits on config set failures", async () => {
		const { app, actions } = createMockApp();
		mockConfigSetCommand.mockRejectedValue(new Error("bad source"));
		registerCommandsCli(app, mockLoadRegistry);

		await expectCommandError(
			actions.get("config set [source]")?.("nope"),
			"bad source",
		);
	});
});
