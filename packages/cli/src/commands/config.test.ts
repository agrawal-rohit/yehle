import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	configGetCommand,
	configSetCommand,
	configUnsetCommand,
} from "./config";

describe("commands/config", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(
			tempRoots.splice(0).map(async (root) => {
				await fs.promises.rm(root, { recursive: true, force: true });
			}),
		);
	});

	/**
	 * Create an isolated temp directory for config path injection.
	 * @returns Absolute temp directory path.
	 */
	async function makeTempRoot(): Promise<string> {
		const root = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "tuckshop-config-cmd-"),
		);
		tempRoots.push(root);
		return root;
	}

	describe("configSetCommand / configGetCommand / configUnsetCommand", () => {
		it("sets, gets, and unsets a registry URL", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await configSetCommand("https://example.com/registry.json", options);

			await configGetCommand(options);

			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(output).toContain("https://example.com/registry.json");
			expect(output).toContain(path.join(root, "tuckshop", "config.json"));

			await expect(configUnsetCommand(options)).resolves.toBe(true);
			await expect(configUnsetCommand(options)).resolves.toBe(false);
		});

		it("rejects invalid sources without writing config", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			vi.spyOn(console, "log").mockImplementation(() => {});

			await expect(configSetCommand("", options)).rejects.toThrow(
				"Registry source must not be empty.",
			);
			await expect(configSetCommand("   ", options)).rejects.toThrow(
				"Registry source must not be empty.",
			);

			await expect(configSetCommand("./nope.json", options)).rejects.toThrow(
				"does not exist",
			);

			await expect(configGetCommand({ ...options })).resolves.toBeUndefined();
		});

		it("rejects a local path that resolves to a directory", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			const registryDir = path.join(root, "registry-dir");
			await fs.promises.mkdir(registryDir);
			vi.spyOn(console, "log").mockImplementation(() => {});

			await expect(configSetCommand(registryDir, options)).rejects.toThrow(
				/is not a file/,
			);

			await expect(configGetCommand({ ...options })).resolves.toBeUndefined();
		});

		it("prints the default registry URL when none is saved", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await configGetCommand(options);

			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(output).toMatch(
				/registry:\s+https:\/\/raw\.githubusercontent\.com\/agrawal-rohit\/tuckshop\/tuckshop@[\d.]+\/packages\/registry\/registry\.json/,
			);
			expect(output).toContain(path.join(root, "tuckshop", "config.json"));
		});

		it("prints the default registry URL after unset", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await configSetCommand("https://example.com/registry.json", options);
			logSpy.mockClear();

			await expect(configUnsetCommand(options)).resolves.toBe(true);

			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(output).not.toContain("Restored the default registry.");
			expect(output).toMatch(
				/registry:\s+https:\/\/raw\.githubusercontent\.com\/agrawal-rohit\/tuckshop\/tuckshop@[\d.]+\/packages\/registry\/registry\.json/,
			);
			expect(output).toContain(path.join(root, "tuckshop", "config.json"));
		});
	});
});
