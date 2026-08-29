import { RegistryTrust, setScriptExecutor } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmInput = vi.fn();
const mockBundledRegistryPath = vi.fn(() => "/bundled/registry.json");

vi.mock("../cli/prompts", () => ({
	confirmInput: (...args: unknown[]) => mockConfirmInput(...args),
}));

vi.mock("./registry", () => ({
	bundledRegistryPath: () => mockBundledRegistryPath(),
}));

import { confirmHookMutations, prepareScriptExecution } from "./scripts";

afterEach(() => {
	setScriptExecutor(undefined);
	vi.clearAllMocks();
});

beforeEach(() => {
	mockBundledRegistryPath.mockReturnValue("/bundled/registry.json");
	mockConfirmInput.mockResolvedValue(true);
});

describe("prepareScriptExecution", () => {
	const registry = {
		types: { configuration: { label: "Configurations" } },
		items: {
			license: {
				title: "License",
				description: "SPDX",
				type: "configuration",
				prepare: ["r/license.prepare.0.js"],
			},
		},
	};

	it("allows bundled registry scripts without prompting", async () => {
		const result = await prepareScriptExecution({
			indexLocation: "/bundled/registry.json",
			registry,
			itemIds: ["license"],
			projectDir: "/project",
		});

		expect(result).toEqual({
			trust: RegistryTrust.Bundled,
			scriptsAllowed: true,
		});
		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("prompts for non-bundled local registries", async () => {
		const result = await prepareScriptExecution({
			indexLocation: "/other/registry.json",
			registry,
			itemIds: ["license"],
			projectDir: "/project",
		});

		expect(result.trust).toBe(RegistryTrust.Local);
		expect(result.scriptsAllowed).toBe(true);
		expect(mockConfirmInput).toHaveBeenCalled();
	});

	it("refuses remote HTTPS script execution", async () => {
		await expect(
			prepareScriptExecution({
				indexLocation: "https://example.com/registry.json",
				registry,
				itemIds: ["license"],
				projectDir: "/project",
			}),
		).rejects.toThrow("Remote HTTPS registries cannot execute custom scripts");
	});
});

describe("confirmHookMutations", () => {
	it("skips the prompt when hooks proposed no mutations", async () => {
		await expect(
			confirmHookMutations([{ compiledItem: { files: [] } }]),
		).resolves.toBe(true);
		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("prompts when hooks proposed files or packages", async () => {
		mockConfirmInput.mockResolvedValueOnce(false);
		await expect(
			confirmHookMutations([
				{
					compiledItem: {
						files: [{ target: "LICENSE", content: "MIT" }],
						dependencies: { npm: { runtime: ["zod"] } },
					},
				},
			]),
		).resolves.toBe(false);
		expect(mockConfirmInput).toHaveBeenCalled();
	});
});
