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

	it("uses XDG_CONFIG_HOME when set", () => {
		const filePath = configPath({ XDG_CONFIG_HOME: "/custom/xdg" });

		expect(filePath).toBe(path.join("/custom/xdg", "tuckshop", "config.json"));
	});

	it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
		vi.spyOn(os, "homedir").mockReturnValue("/home/user");

		expect(configPath({})).toBe(
			path.join("/home/user", ".config", "tuckshop", "config.json"),
		);
	});

	it("uses process.env when no env override is provided", () => {
		const previous = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = "/from-process-env";

		try {
			expect(configPath()).toBe(
				path.join("/from-process-env", "tuckshop", "config.json"),
			);
		} finally {
			if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previous;
		}
	});

	it("treats whitespace-only XDG_CONFIG_HOME as unset", () => {
		vi.spyOn(os, "homedir").mockReturnValue("/home/user");

		const filePath = configPath({ XDG_CONFIG_HOME: "   " });

		expect(filePath).toBe(
			path.join("/home/user", ".config", "tuckshop", "config.json"),
		);
	});

	it("returns an empty object when the config file is missing", async () => {
		const root = await makeTempRoot();

		await expect(readConfig({ XDG_CONFIG_HOME: root })).resolves.toEqual({});
	});

	it("rethrows unexpected read errors without an errno code", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const error = new Error("read boom");
		vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(error);

		await expect(readConfig(env)).rejects.toBe(error);
	});

	it("rethrows non-ENOENT read errors", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const error = Object.assign(new Error("permission denied"), {
			code: "EACCES",
		});
		vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(error);

		await expect(readConfig(env)).rejects.toBe(error);
	});

	it("round-trips a registry value through write and read", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };

		await writeConfig({ registry: "https://example.com/registry.json" }, env);

		await expect(readConfig(env)).resolves.toEqual({
			registry: "https://example.com/registry.json",
		});

		const filePath = configPath(env);
		const written = await fs.promises.readFile(filePath, "utf8");
		expect(written).toContain("\n\t");
		expect(JSON.parse(written)).toEqual({
			registry: "https://example.com/registry.json",
		});
		expect((await fs.promises.stat(filePath)).mode & 0o777).toBe(0o600);
	});

	it("trims whitespace around a stored registry value on read", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const filePath = configPath(env);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(
			filePath,
			'{"registry":"  https://example.com/registry.json  "}\n',
			"utf8",
		);

		await expect(readConfig(env)).resolves.toEqual({
			registry: "https://example.com/registry.json",
		});
	});

	it("throws a path-bearing error for malformed JSON", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const filePath = configPath(env);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, "{not-json", "utf8");

		await expect(readConfig(env)).rejects.toThrow(
			`Malformed tuckshop config at ${filePath}`,
		);
	});

	it.each([
		{ label: "a JSON array", contents: '["array"]\n' },
		{ label: "JSON null", contents: "null\n" },
		{ label: "a JSON primitive", contents: "42\n" },
	])("throws when the config root is $label", async ({ contents }) => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const filePath = configPath(env);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, contents, "utf8");

		await expect(readConfig(env)).rejects.toThrow(
			`Malformed tuckshop config at ${filePath}: Config root must be a JSON object.`,
		);
	});

	it.each([
		{ label: "not a string", contents: '{"registry":42}\n' },
		{ label: "an empty string", contents: '{"registry":""}\n' },
		{ label: "whitespace only", contents: '{"registry":"   "}\n' },
	])("throws when registry is $label", async ({ contents }) => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const filePath = configPath(env);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, contents, "utf8");

		await expect(readConfig(env)).rejects.toThrow(
			`Malformed tuckshop config at ${filePath}: "registry" must be a non-empty string URL or file path.`,
		);
	});

	it("stringifies non-Error parse failures in the malformed-config message", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const filePath = configPath(env);
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, '{"registry":"ok"}\n', "utf8");
		vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
			throw "not-an-error";
		});

		await expect(readConfig(env)).rejects.toThrow(
			`Malformed tuckshop config at ${filePath}: not-an-error`,
		);
	});

	it("unsets the registry key and deletes an empty config file", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };
		const filePath = configPath(env);

		await writeConfig({ registry: "https://example.com/registry.json" }, env);
		const rmSpy = vi.spyOn(fs.promises, "rm");
		await expect(unsetRegistryConfig(env)).resolves.toBe(true);
		expect(rmSpy).toHaveBeenCalledWith(filePath, { force: true });
		await expect(fs.promises.stat(filePath)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(unsetRegistryConfig(env)).resolves.toBe(false);
	});

	it("preserves other keys when unsetting registry", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };

		await writeConfig(
			{ registry: "https://example.com/registry.json", future: true } as {
				registry?: string;
				future?: boolean;
			},
			env,
		);

		await expect(unsetRegistryConfig(env)).resolves.toBe(true);
		await expect(readConfig(env)).resolves.toEqual({ future: true });
	});

	it("rethrows non-ENOENT rm errors when unsetting", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };

		await writeConfig({ registry: "https://example.com/registry.json" }, env);
		const error = Object.assign(new Error("permission denied"), {
			code: "EACCES",
		});
		vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(error);

		await expect(unsetRegistryConfig(env)).rejects.toBe(error);
	});

	it("rethrows unexpected rm errors without an errno code", async () => {
		const root = await makeTempRoot();
		const env = { XDG_CONFIG_HOME: root };

		await writeConfig({ registry: "https://example.com/registry.json" }, env);
		const error = new Error("rm boom");
		vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(error);

		await expect(unsetRegistryConfig(env)).rejects.toBe(error);
	});
});
