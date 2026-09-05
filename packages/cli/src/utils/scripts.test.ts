import {
	getScriptExecutor,
	RegistryConditionKind,
	RegistryTrust,
	setScriptExecutor,
} from "@tuckshop/core";
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
				beforeWrite: ["r/license.beforeWrite.0.js"],
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
			trust: RegistryTrust.BUNDLED,
			allowInfer: false,
			allowMutation: true,
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

		expect(result.trust).toBe(RegistryTrust.LOCAL);
		expect(result.allowMutation).toBe(true);
		expect(mockConfirmInput).toHaveBeenCalled();
	});

	it("refuses remote HTTPS mutation hooks", async () => {
		await expect(
			prepareScriptExecution({
				indexLocation: "https://example.com/registry.json",
				registry,
				itemIds: ["license"],
				projectDir: "/project",
			}),
		).rejects.toThrow("Remote HTTPS registries cannot execute custom scripts");
	});

	it("skips infer handlers on a remote registry and installs a rejecting executor", async () => {
		const result = await prepareScriptExecution({
			indexLocation: "https://example.com/registry.json",
			registry: {
				types: { configuration: { label: "Configurations" } },
				conditions: {
					language: {
						kind: RegistryConditionKind.SELECT,
						label: "Language",
						handler: "conditions/language.ts",
						values: [{ value: "typescript", label: "TypeScript" }],
					},
				},
				items: {
					testing: {
						title: "Testing",
						description: "Testing",
						type: "configuration",
						requires: ["language"],
					},
				},
			},
			itemIds: ["testing"],
			projectDir: "/project",
		});

		expect(result).toEqual({
			trust: RegistryTrust.REMOTE,
			allowInfer: false,
			allowMutation: false,
		});
		await expect(
			getScriptExecutor()?.loadModule(
				"/registry.json",
				"conditions/language.ts",
				(value: unknown): value is unknown => true,
				"unused",
			),
		).rejects.toThrow("cannot run");
	});
});

describe("confirmHookMutations", () => {
	it("skips the prompt when hooks proposed no mutations", async () => {
		await expect(
			confirmHookMutations(
				[{ compiledItem: { files: [] } }],
				[{ compiledItem: { files: [] } }],
			),
		).resolves.toBe(true);
		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("skips the prompt when static files are unchanged", async () => {
		const payload = {
			compiledItem: {
				files: [{ target: "README.md", content: "hi" }],
			},
		};
		await expect(confirmHookMutations([payload], [payload])).resolves.toBe(
			true,
		);
		expect(mockConfirmInput).not.toHaveBeenCalled();
	});

	it("prompts when hooks added files, packages, or secrets", async () => {
		mockConfirmInput.mockResolvedValueOnce(false);
		await expect(
			confirmHookMutations(
				[{ compiledItem: { files: [] } }],
				[
					{
						compiledItem: {
							files: [{ target: "LICENSE", content: "MIT" }],
							dependencies: { npm: { runtime: ["zod"] } },
							secrets: ["HELLO_TOKEN"],
						},
					},
				],
			),
		).resolves.toBe(false);
		expect(mockConfirmInput).toHaveBeenCalled();
	});

	it("prompts when hooks removed files", async () => {
		mockConfirmInput.mockResolvedValueOnce(true);
		await expect(
			confirmHookMutations(
				[
					{
						compiledItem: {
							files: [{ target: "OLD.md", content: "gone" }],
						},
					},
				],
				[{ compiledItem: { files: [] } }],
			),
		).resolves.toBe(true);
		expect(mockConfirmInput).toHaveBeenCalled();
	});

	it("prompts when hooks rewrote an existing file", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		mockConfirmInput.mockResolvedValueOnce(true);

		await expect(
			confirmHookMutations(
				[
					{
						compiledItem: {
							files: [{ target: "README.md", content: "catalog" }],
						},
					},
				],
				[
					{
						compiledItem: {
							files: [{ target: "README.md", content: "hooked" }],
						},
					},
				],
			),
		).resolves.toBe(true);

		expect(mockConfirmInput).toHaveBeenCalled();
		expect(log.mock.calls.flat().join("\n")).toContain("Files changed");
		log.mockRestore();
	});

	it("prompts when hooks rewrote an existing package.json script", async () => {
		mockConfirmInput.mockResolvedValueOnce(true);

		await expect(
			confirmHookMutations(
				[
					{
						compiledItem: {
							files: [],
							commands: { npm: { test: "vitest" } },
						},
					},
				],
				[
					{
						compiledItem: {
							files: [],
							commands: { npm: { test: "rm -rf /" } },
						},
					},
				],
			),
		).resolves.toBe(true);

		expect(mockConfirmInput).toHaveBeenCalled();
	});

	it("rejects mismatched before and after lists", async () => {
		await expect(
			confirmHookMutations([{ compiledItem: { files: [] } }], []),
		).rejects.toThrow("mismatched item lists");
	});
});
