import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	configPath,
	readConfig,
	unsetRegistryConfig,
	writeConfig,
} from "./config";

describe("cli/config", () => {
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
			path.join(os.tmpdir(), "tuckshop-config-"),
		);
		tempRoots.push(root);
		return root;
	}

	it("resolves under XDG_CONFIG_HOME when set", () => {
		const filePath = configPath({
			env: { XDG_CONFIG_HOME: "/custom/xdg" },
			homedir: "/home/user",
		});

		expect(filePath).toBe(path.join("/custom/xdg", "tuckshop", "config.json"));
	});

	it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
		const filePath = configPath({
			env: {},
			homedir: "/home/user",
		});

		expect(filePath).toBe(
			path.join("/home/user", ".config", "tuckshop", "config.json"),
		);
	});

	it("uses process.env when no env override is provided", () => {
		const previous = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = "/from-process-env";

		try {
			expect(configPath({ homedir: "/home/user" })).toBe(
				path.join("/from-process-env", "tuckshop", "config.json"),
			);
		} finally {
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
		}
	});

	it("uses os.homedir when neither XDG_CONFIG_HOME nor homedir is provided", () => {
		vi.spyOn(os, "homedir").mockReturnValue("/mock-home");

		expect(configPath({ env: {} })).toBe(
			path.join("/mock-home", ".config", "tuckshop", "config.json"),
		);
	});

	it("treats whitespace-only XDG_CONFIG_HOME as unset", () => {
		const filePath = configPath({
			env: { XDG_CONFIG_HOME: "   " },
			homedir: "/home/user",
		});

		expect(filePath).toBe(
			path.join("/home/user", ".config", "tuckshop", "config.json"),
		);
	});

	it("returns an empty object when the config file is missing", async () => {
		const root = await makeTempRoot();

		await expect(
			readConfig({ env: { XDG_CONFIG_HOME: root } }),
		).resolves.toEqual({});
	});

	it("rethrows unexpected read errors without an errno code", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };
		const error = new Error("read boom");
		vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(error);

		await expect(readConfig(options)).rejects.toBe(error);
	});

	it("rethrows non-ENOENT read errors", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };
		const error = Object.assign(new Error("permission denied"), {
			code: "EACCES",
		});
		vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(error);

		await expect(readConfig(options)).rejects.toBe(error);
	});

	it("round-trips a registry value through write and read", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };

		await writeConfig(
			{ registry: "https://example.com/registry.json" },
			options,
		);

		await expect(readConfig(options)).resolves.toEqual({
			registry: "https://example.com/registry.json",
		});

		const written = await fs.promises.readFile(configPath(options), "utf8");
		expect(JSON.parse(written)).toEqual({
			registry: "https://example.com/registry.json",
		});
	});

	it("throws a path-bearing error for malformed JSON", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };
		const filePath = configPath(options);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, "{not-json", "utf8");

		await expect(readConfig(options)).rejects.toThrow(
			`Malformed tuckshop config at ${filePath}`,
		);
	});

	it("throws when the config root is not a JSON object", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };
		const filePath = configPath(options);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, '["array"]\n', "utf8");

		await expect(readConfig(options)).rejects.toThrow(
			`Malformed tuckshop config at ${filePath}`,
		);
	});

	it("stringifies non-Error parse failures in the malformed-config message", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };
		const filePath = configPath(options);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, '{"registry":"ok"}\n', "utf8");
		vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
			throw "not-an-error";
		});

		await expect(readConfig(options)).rejects.toThrow(
			`Malformed tuckshop config at ${filePath}: not-an-error`,
		);
	});

	it("unsets the registry key and deletes an empty config file", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };
		const filePath = configPath(options);

		await writeConfig(
			{ registry: "https://example.com/registry.json" },
			options,
		);
		await expect(unsetRegistryConfig(options)).resolves.toBe(true);
		await expect(fs.promises.stat(filePath)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(unsetRegistryConfig(options)).resolves.toBe(false);
	});

	it("preserves other keys when unsetting registry", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };

		await writeConfig(
			{ registry: "https://example.com/registry.json", future: true } as {
				registry?: string;
				future?: boolean;
			},
			options,
		);

		await expect(unsetRegistryConfig(options)).resolves.toBe(true);
		await expect(readConfig(options)).resolves.toEqual({ future: true });
	});

	it("treats a raced ENOENT on unlink as a successful unset", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };

		await writeConfig(
			{ registry: "https://example.com/registry.json" },
			options,
		);
		const error = Object.assign(new Error("already gone"), { code: "ENOENT" });
		vi.spyOn(fs.promises, "unlink").mockRejectedValueOnce(error);

		await expect(unsetRegistryConfig(options)).resolves.toBe(true);
	});

	it("rethrows non-ENOENT unlink errors when unsetting", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };

		await writeConfig(
			{ registry: "https://example.com/registry.json" },
			options,
		);
		const error = Object.assign(new Error("permission denied"), {
			code: "EACCES",
		});
		vi.spyOn(fs.promises, "unlink").mockRejectedValueOnce(error);

		await expect(unsetRegistryConfig(options)).rejects.toBe(error);
	});

	it("rethrows unexpected unlink errors without an errno code", async () => {
		const root = await makeTempRoot();
		const options = { env: { XDG_CONFIG_HOME: root } };

		await writeConfig(
			{ registry: "https://example.com/registry.json" },
			options,
		);
		const error = new Error("unlink boom");
		vi.spyOn(fs.promises, "unlink").mockRejectedValueOnce(error);

		await expect(unsetRegistryConfig(options)).rejects.toBe(error);
	});
});
