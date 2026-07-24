import type { CAC } from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistryItemType } from "../registry/schema";

const mockLoadRegistry = vi.fn();
const mockGetRegistryItemTypes = vi.fn();
const mockListCommand = vi.fn();
const mockPickStringOptions = vi.fn();
const mockLoggerIntro = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("../registry/loader", () => ({
	loadRegistry: (...args: unknown[]) => mockLoadRegistry(...args),
}));

vi.mock("../registry/schema", async () => {
	const actual =
		await vi.importActual<typeof import("../registry/schema")>(
			"../registry/schema",
		);
	return {
		...actual,
		getRegistryItemTypes: (...args: unknown[]) =>
			mockGetRegistryItemTypes(...args),
	};
});

vi.mock("./list", () => ({
	default: (...args: unknown[]) => mockListCommand(...args),
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
	const actionHandler = vi.fn();
	const option = vi.fn().mockReturnThis();
	const command = vi.fn(() => ({
		option,
		action: (handler: (options: Record<string, unknown>) => Promise<void>) => {
			actionHandler.mockImplementation(handler);
			return { option, action: actionHandler };
		},
	}));

	const app = {
		usage: vi.fn(),
		command,
	};

	return { app: app as unknown as CAC, command, option, actionHandler };
}

describe("commands/index", () => {
	const registry = {
		version: "1.0.0",
		contentBaseUrl: "https://example.com",
		items: {
			"theme-a": {
				id: "theme-a",
				title: "Theme A",
				description: "A theme",
				type: RegistryItemType.THEME,
				variants: [],
			},
		},
	};
	const itemTypes = ["theme"];

	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadRegistry.mockResolvedValue(registry);
		mockGetRegistryItemTypes.mockReturnValue(itemTypes);
		mockPickStringOptions.mockReturnValue({ type: "theme" });
		mockListCommand.mockResolvedValue(undefined);
		mockLoggerIntro.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers the list command with usage and type option", async () => {
		const { app, command, option } = createMockApp();

		await registerCommandsCli(app);

		expect(app.usage).toHaveBeenCalledWith("<command> [options]");
		expect(mockLoadRegistry).toHaveBeenCalled();
		expect(mockGetRegistryItemTypes).toHaveBeenCalledWith(registry);
		expect(command).toHaveBeenCalledWith(
			"list",
			"List available registry items",
		);
		expect(option).toHaveBeenCalledWith(
			"--type <types>",
			expect.stringContaining("theme"),
		);
	});

	it("runs the list command action with picked options", async () => {
		const { app, actionHandler } = createMockApp();
		await registerCommandsCli(app);

		await actionHandler({ type: "theme" });

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
		const { app, actionHandler } = createMockApp();
		mockListCommand.mockRejectedValue(new Error("boom"));
		await registerCommandsCli(app);

		await actionHandler({});

		expect(mockLoggerError).toHaveBeenCalledWith("boom");
	});

	it("logs non-Error failures as strings", async () => {
		const { app, actionHandler } = createMockApp();
		mockListCommand.mockRejectedValue("string failure");
		await registerCommandsCli(app);

		await actionHandler({});

		expect(mockLoggerError).toHaveBeenCalledWith("string failure");
	});
});
