import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrapModuleExport } from "./cjs-export";
import { RegistryConditionKind } from "./condition-kind";
import {
	assertIntegrityMatch,
	assertScriptsAllowed,
	classifyRegistryTrust,
	collectDeclaredScriptUris,
	collectRegistryArtifactUris,
	createScriptExecutor,
	INTEGRITY_PREFIX,
	RegistryTrust,
	sha256Integrity,
	verifyItemIntegrity,
	verifyScriptIntegrity,
} from "./scripts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0))
		fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Create a temporary directory for script fixtures.
 * @returns Absolute temp directory path.
 */
function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tuckshop-security-"));
	tempDirs.push(dir);
	return dir;
}

describe("scripts (trust and integrity)", () => {
	it("classifies bundled, local, and remote registry trust", () => {
		expect(
			classifyRegistryTrust("/app/registry.json", "/app/registry.json"),
		).toBe(RegistryTrust.Bundled);
		expect(
			classifyRegistryTrust("/other/registry.json", "/app/registry.json"),
		).toBe(RegistryTrust.Local);
		expect(
			classifyRegistryTrust(
				"https://example.com/registry.json",
				"/app/registry.json",
			),
		).toBe(RegistryTrust.Remote);
	});

	it("allows bundled scripts without prompting", async () => {
		await expect(
			assertScriptsAllowed(RegistryTrust.Bundled, ["r/item.prepare.0.js"]),
		).resolves.toBe(true);
	});

	it("prompts for local scripts and fails remote script execution", async () => {
		await expect(
			assertScriptsAllowed(
				RegistryTrust.Local,
				["r/item.prepare.0.js"],
				async () => true,
			),
		).resolves.toBe(true);

		await expect(
			assertScriptsAllowed(RegistryTrust.Remote, ["r/item.prepare.0.js"]),
		).rejects.toThrow("Remote HTTPS registries cannot execute custom scripts");
	});

	it("hashes and verifies integrity digests", () => {
		const digest = sha256Integrity("hello");
		expect(digest.startsWith(INTEGRITY_PREFIX)).toBe(true);
		expect(() =>
			assertIntegrityMatch("hello", digest, "fixture"),
		).not.toThrow();
		expect(() => assertIntegrityMatch("other", digest, "fixture")).toThrow(
			"does not match",
		);

		verifyScriptIntegrity({ "r/a.js": digest }, "r/a.js", "hello");
		verifyItemIntegrity({ "r/a.json": digest }, "r/a.json", "hello");
	});

	it("collects condition handlers and install hooks for selected items", () => {
		const registry = {
			types: { configuration: { label: "Configurations" } },
			conditions: {
				language: {
					kind: RegistryConditionKind.SELECT,
					label: "Language",
					handler: "r/_handlers/language.handler.js",
					values: [{ value: "typescript", label: "TypeScript" }],
				},
			},
			items: {
				license: {
					title: "License",
					description: "SPDX",
					type: "configuration",
					requires: ["language"],
					source: "r/license.json",
					prepare: ["r/license.prepare.0.js"],
					finalize: ["r/license.finalize.0.js"],
					conditions: {
						owner: {
							kind: RegistryConditionKind.TEXT,
							label: "Owner",
							handler: "r/license.owner.handler.js",
						},
					},
					packs: [
						{
							id: "mit",
							title: "MIT",
							source: "r/license/mit.json",
							prepare: ["r/license/mit.prepare.0.js"],
							finalize: ["r/license/mit.finalize.0.js"],
						},
					],
				},
			},
		};
		const uris = collectDeclaredScriptUris(registry, [
			"license@mit",
			"missing",
		]);

		expect(uris).toEqual([
			"r/_handlers/language.handler.js",
			"r/license.finalize.0.js",
			"r/license.owner.handler.js",
			"r/license.prepare.0.js",
			"r/license/mit.finalize.0.js",
			"r/license/mit.prepare.0.js",
		]);
		expect(collectRegistryArtifactUris(registry)).toEqual({
			scriptUris: uris,
			itemUris: ["r/license.json", "r/license/mit.json"],
		});
	});

	it("unwraps a default export when present", () => {
		const fn = () => "ok";
		expect(unwrapModuleExport({ default: fn })).toBe(fn);
		expect(unwrapModuleExport(fn)).toBe(fn);
	});

	it("loads modules through the in-process script executor with integrity checks", async () => {
		const dir = makeTempDir();
		const scriptPath = path.join(dir, "hook.js");
		fs.writeFileSync(
			scriptPath,
			'module.exports = async function prepare() { return { bindings: { ok: "1" } }; };\n',
		);
		const digest = sha256Integrity(fs.readFileSync(scriptPath));
		const executor = createScriptExecutor({
			resolveScriptPath: () => scriptPath,
			scriptIntegrity: { "r/hook.js": digest },
			mode: "in-process",
		});
		const hook = await executor.loadModule(
			path.join(dir, "registry.json"),
			"r/hook.js",
			(value): value is (ctx: unknown) => Promise<unknown> =>
				typeof value === "function",
			"expected function",
		);
		await expect(hook({})).resolves.toEqual({ bindings: { ok: "1" } });
	});
});

/**
 * Absolute path to the compiled sandbox runner used by child processes.
 * @returns Absolute path to `dist/scripts.js`.
 */
function compiledRunnerPath(): string {
	return path.join(__dirname, "..", "dist", "scripts.js");
}

/**
 * Write a CommonJS hook script and return its absolute path plus integrity digest.
 * @param dir - Directory that owns the script.
 * @param source - CommonJS module source.
 * @returns Absolute script path and sha256 integrity digest.
 */
function writeHook(
	dir: string,
	source: string,
): { scriptPath: string; digest: string } {
	const scriptPath = path.join(dir, "hook.js");
	fs.writeFileSync(scriptPath, source, "utf8");
	return { scriptPath, digest: sha256Integrity(fs.readFileSync(scriptPath)) };
}

describe("scripts (sandbox)", () => {
	it("blocks direct filesystem writes inside the permissioned child", async () => {
		const dir = makeTempDir();
		const projectDir = path.join(dir, "project");
		fs.mkdirSync(projectDir);
		const target = path.join(dir, "outside.txt");
		const { scriptPath, digest } = writeHook(
			dir,
			`
module.exports = async function prepare() {
  require("node:fs").writeFileSync(${JSON.stringify(target)}, "pwned");
  return {};
};
`,
		);

		const executor = createScriptExecutor({
			resolveScriptPath: () => scriptPath,
			scriptIntegrity: { "r/hook.js": digest },
			mode: "sandbox",
			projectDir,
			runnerPath: compiledRunnerPath(),
		});
		const hook = await executor.loadModule(
			path.join(dir, "registry.json"),
			"r/hook.js",
			(value): value is (ctx: unknown) => Promise<unknown> =>
				typeof value === "function",
			"expected function",
		);

		await expect(hook({ projectDir })).rejects.toThrow();
		expect(fs.existsSync(target)).toBe(false);
	}, 15_000);

	it("blocks fetch when the Node permission model denies network", async () => {
		// Node 24+ no longer gates network via --permission; skip when fetch is allowed.
		const networkBlocked = await new Promise<boolean>((resolve) => {
			const child = spawn(
				process.execPath,
				[
					"--permission",
					"--allow-fs-read=*",
					"-e",
					"fetch('https://example.com').then(()=>process.exit(0)).catch(()=>process.exit(2))",
				],
				{ stdio: "ignore" },
			);
			child.on("exit", (code) => resolve(code === 2));
			child.on("error", () => resolve(false));
		});
		if (!networkBlocked) return;

		const dir = makeTempDir();
		const projectDir = path.join(dir, "project");
		fs.mkdirSync(projectDir);
		const { scriptPath, digest } = writeHook(
			dir,
			`
module.exports = async function prepare() {
  await fetch("https://example.com");
  return {};
};
`,
		);

		const executor = createScriptExecutor({
			resolveScriptPath: () => scriptPath,
			scriptIntegrity: { "r/hook.js": digest },
			mode: "sandbox",
			projectDir,
			runnerPath: compiledRunnerPath(),
		});
		const hook = await executor.loadModule(
			path.join(dir, "registry.json"),
			"r/hook.js",
			(value): value is (ctx: unknown) => Promise<unknown> =>
				typeof value === "function",
			"expected function",
		);

		await expect(hook({ projectDir })).rejects.toThrow();
	}, 15_000);

	it("allows ctx.readFile under the project and parent-mediated ctx.run", async () => {
		const dir = makeTempDir();
		const projectDir = path.join(dir, "project");
		fs.mkdirSync(projectDir);
		fs.writeFileSync(
			path.join(projectDir, "package.json"),
			'{"name":"demo"}\n',
			"utf8",
		);
		const { scriptPath, digest } = writeHook(
			dir,
			`
module.exports = async function prepare(ctx) {
  const pkg = await ctx.readFile("package.json");
  const out = await ctx.run("printf ok");
  return { bindings: { pkg: pkg.trim(), out: out.trim() } };
};
`,
		);

		const executor = createScriptExecutor({
			resolveScriptPath: () => scriptPath,
			scriptIntegrity: { "r/hook.js": digest },
			mode: "sandbox",
			projectDir,
			runnerPath: compiledRunnerPath(),
		});
		const hook = await executor.loadModule(
			path.join(dir, "registry.json"),
			"r/hook.js",
			(value): value is (ctx: unknown) => Promise<unknown> =>
				typeof value === "function",
			"expected function",
		);

		await expect(hook({ projectDir })).resolves.toEqual({
			bindings: { pkg: '{"name":"demo"}', out: "ok" },
		});
	}, 15_000);

	it("rejects path escapes via ctx.readFile", async () => {
		const dir = makeTempDir();
		const projectDir = path.join(dir, "project");
		fs.mkdirSync(projectDir);
		const { scriptPath, digest } = writeHook(
			dir,
			`
module.exports = async function prepare(ctx) {
  return { bindings: { secret: await ctx.readFile("../.ssh/id_rsa") } };
};
`,
		);

		const executor = createScriptExecutor({
			resolveScriptPath: () => scriptPath,
			scriptIntegrity: { "r/hook.js": digest },
			mode: "sandbox",
			projectDir,
			runnerPath: compiledRunnerPath(),
		});
		const hook = await executor.loadModule(
			path.join(dir, "registry.json"),
			"r/hook.js",
			(value): value is (ctx: unknown) => Promise<unknown> =>
				typeof value === "function",
			"expected function",
		);

		await expect(hook({ projectDir })).rejects.toThrow(
			"must be a relative path under the project directory",
		);
	}, 15_000);
});
