import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	configGetCommand,
	configSetCommand,
	configUnsetCommand,
	RegistrySourceOrigin,
	resolveEffectiveRegistryOrigin,
	validateRegistrySource,
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

	describe("resolveEffectiveRegistryOrigin", () => {
		it("prefers flag over env and saved config", () => {
			expect(
				resolveEffectiveRegistryOrigin({
					flag: "https://flag.example/registry.json",
					envRegistry: "https://env.example/registry.json",
					saved: "https://config.example/registry.json",
				}),
			).toBe(RegistrySourceOrigin.Flag);
		});

		it("prefers env over saved config", () => {
			expect(
				resolveEffectiveRegistryOrigin({
					envRegistry: "https://env.example/registry.json",
					saved: "https://config.example/registry.json",
				}),
			).toBe(RegistrySourceOrigin.Env);
		});

		it("uses saved config before the bundled default", () => {
			expect(
				resolveEffectiveRegistryOrigin({
					saved: "https://config.example/registry.json",
				}),
			).toBe(RegistrySourceOrigin.Config);
		});

		it("falls back to the bundled default", () => {
			expect(resolveEffectiveRegistryOrigin({})).toBe(
				RegistrySourceOrigin.Default,
			);
		});
	});

	describe("validateRegistrySource", () => {
		it("accepts absolute HTTP(S) URLs", async () => {
			await expect(
				validateRegistrySource(" https://example.com/registry.json "),
			).resolves.toBe("https://example.com/registry.json");
		});

		it("rejects empty sources", async () => {
			await expect(validateRegistrySource("   ")).rejects.toThrow(
				"Registry source must not be empty.",
			);
		});

		it("rejects nonexistent local paths", async () => {
			await expect(
				validateRegistrySource("./missing-registry.json", "/tmp"),
			).rejects.toThrow("does not exist");
		});

		it("accepts an existing local registry file", async () => {
			const root = await makeTempRoot();
			const registryFile = path.join(root, "registry.json");
			await fs.promises.writeFile(registryFile, "{}\n", "utf8");

			await expect(
				validateRegistrySource("./registry.json", root),
			).resolves.toBe("./registry.json");
		});

		it("rejects paths that resolve to directories", async () => {
			const root = await makeTempRoot();

			await expect(validateRegistrySource(root, "/tmp")).rejects.toThrow(
				"is not a file",
			);
		});
	});

	describe("configSetCommand / configGetCommand / configUnsetCommand", () => {
		it("sets, gets, and unsets a registry URL", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await configSetCommand("https://example.com/registry.json", options);

			await configGetCommand({
				...options,
				saved: "https://example.com/registry.json",
			});

			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(output).toContain("https://example.com/registry.json");
			expect(output).toContain(RegistrySourceOrigin.Config);

			await expect(configUnsetCommand(options)).resolves.toBe(true);
			await expect(configUnsetCommand(options)).resolves.toBe(false);
		});

		it("rejects invalid sources without writing config", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			vi.spyOn(console, "log").mockImplementation(() => {});

			await expect(configSetCommand("./nope.json", options)).rejects.toThrow(
				"does not exist",
			);

			await expect(configGetCommand({ ...options })).resolves.toBeUndefined();
		});

		it("reports flag origin when a flag overrides the saved config", async () => {
			const root = await makeTempRoot();
			const options = { env: { XDG_CONFIG_HOME: root } };
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await configSetCommand("https://example.com/registry.json", options);

			await configGetCommand({
				...options,
				flag: "https://flag.example/registry.json",
			});

			const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(output).toContain(RegistrySourceOrigin.Flag);
			expect(output).toContain("https://flag.example/registry.json");
		});
	});
});
