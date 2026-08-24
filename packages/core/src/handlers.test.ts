import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistryConditionKind } from "./condition-kind";
import {
	createHandlerRuntime,
	inferConditionDefault,
	localScriptPath,
	runFinalizeInstallHook,
	runPrepareInstallHook,
} from "./handlers";
import { NpmPackageManager } from "./packages";

describe("core/handlers", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "handlers-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("localScriptPath", () => {
		it("joins a relative script under a local registry", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(localScriptPath(catalog, "r/item.prepare.0.js")).toBe(
				path.join(tempDir, "r/item.prepare.0.js"),
			);
		});

		it("trims surrounding whitespace on the script URI", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(localScriptPath(catalog, "  r/item.prepare.0.js  ")).toBe(
				path.join(tempDir, "r/item.prepare.0.js"),
			);
		});

		it("rejects empty and whitespace-only script URIs", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(() => localScriptPath(catalog, "")).toThrow(
				'Script URI "" must be a relative path under the registry directory.',
			);
			expect(() => localScriptPath(catalog, "   ")).toThrow(
				'Script URI "   " must be a relative path under the registry directory.',
			);
		});

		it("rejects remote HTTPS registries", () => {
			expect(() =>
				localScriptPath(
					"https://example.com/registry.json",
					"r/item.prepare.0.js",
				),
			).toThrow("local registry");
		});

		it("rejects parent-directory escapes with Script URI wording", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(() =>
				localScriptPath(catalog, "r/../outside.prepare.0.js"),
			).toThrow(
				'Script URI "r/../outside.prepare.0.js" must be a relative path under the registry directory.',
			);
		});

		it("rejects absolute HTTP script URIs", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(() =>
				localScriptPath(catalog, "https://evil.example/h.js"),
			).toThrow("relative path under the registry directory");
		});
	});

	describe("runPrepareInstallHook script loading", () => {
		const runtime = () =>
			createHandlerRuntime(tempDir, {
				isFile: vi.fn(async () => false),
				readFile: vi.fn(async () => ""),
				run: vi.fn(async () => ""),
			});

		it("loads a default-exported install hook function", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
			fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
			fs.writeFileSync(
				scriptPath,
				"module.exports = { default: async function prepare() {} };\n",
			);

			await expect(
				runPrepareInstallHook(catalog, "r/item.prepare.0.js", runtime(), {
					itemId: "item",
					conditions: {},
					packageManager: NpmPackageManager.NPM,
					compiledItem: { files: [] },
				}),
			).resolves.toEqual({ files: [], bindings: {} });
		});

		it("loads a module that exports the hook function directly", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
			fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
			fs.writeFileSync(
				scriptPath,
				"module.exports = async function prepare() { return { files: [] }; };\n",
			);

			await expect(
				runPrepareInstallHook(catalog, "r/item.prepare.0.js", runtime(), {
					itemId: "item",
					conditions: {},
					packageManager: NpmPackageManager.NPM,
					compiledItem: { files: [] },
				}),
			).resolves.toEqual({ files: [], bindings: {} });
		});

		it("rejects modules without an install hook function", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const scriptPath = path.join(tempDir, "r/bad.prepare.0.js");
			fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
			fs.writeFileSync(scriptPath, "module.exports = {};\n");

			await expect(
				runPrepareInstallHook(catalog, "r/bad.prepare.0.js", runtime(), {
					itemId: "item",
					conditions: {},
					packageManager: NpmPackageManager.NPM,
					compiledItem: { files: [] },
				}),
			).rejects.toThrow("must export a `prepare` hook function");
		});

		it("rejects null and non-function install hook exports", async () => {
			const catalog = path.join(tempDir, "registry.json");

			for (const [name, source] of [
				["null", "module.exports = null;\n"],
				["number", "module.exports = 42;\n"],
				["object", "module.exports = { async prepare() {} };\n"],
			] as const) {
				const scriptPath = path.join(tempDir, `r/${name}.prepare.0.js`);
				fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
				fs.writeFileSync(scriptPath, source);

				await expect(
					runPrepareInstallHook(catalog, `r/${name}.prepare.0.js`, runtime(), {
						itemId: "item",
						conditions: {},
						packageManager: NpmPackageManager.NPM,
						compiledItem: { files: [] },
					}),
				).rejects.toThrow("must export a `prepare` hook function");
			}
		});
	});

	describe("inferConditionDefault handler loading", () => {
		const runtime = () =>
			createHandlerRuntime(tempDir, {
				isFile: vi.fn(async () => false),
				readFile: vi.fn(async () => ""),
				run: vi.fn(async () => ""),
			});

		it("loads a default-exported condition handler", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const handlerPath = path.join(tempDir, "r/_handlers/language.handler.js");
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(
				handlerPath,
				"module.exports = { default: { async infer() { return 'typescript'; } } };\n",
			);

			await expect(
				inferConditionDefault(
					catalog,
					{
						key: "language",
						label: "Language",
						kind: RegistryConditionKind.SELECT,
						values: [{ value: "typescript", label: "TypeScript" }],
						handler: "r/_handlers/language.handler.js",
					},
					runtime(),
					{},
				),
			).resolves.toBe("typescript");
		});

		it("rejects modules without an infer hook", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const handlerPath = path.join(tempDir, "r/_handlers/bad.handler.js");
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(
				handlerPath,
				'module.exports = { infer: "not a function" };\n',
			);

			await expect(
				inferConditionDefault(
					catalog,
					{
						key: "language",
						label: "Language",
						kind: RegistryConditionKind.SELECT,
						values: [{ value: "typescript", label: "TypeScript" }],
						handler: "r/_handlers/bad.handler.js",
					},
					runtime(),
					{},
				),
			).rejects.toThrow("condition handler with an infer hook");
		});

		it("rejects null and non-object condition handler exports", async () => {
			const catalog = path.join(tempDir, "registry.json");

			for (const [name, source] of [
				["null", "module.exports = null;\n"],
				["number", "module.exports = 1;\n"],
			] as const) {
				const handlerPath = path.join(
					tempDir,
					`r/_handlers/${name}.handler.js`,
				);
				fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
				fs.writeFileSync(handlerPath, source);

				await expect(
					inferConditionDefault(
						catalog,
						{
							key: "language",
							label: "Language",
							kind: RegistryConditionKind.SELECT,
							values: [{ value: "typescript", label: "TypeScript" }],
							handler: `r/_handlers/${name}.handler.js`,
						},
						runtime(),
						{},
					),
				).rejects.toThrow("condition handler with an infer hook");
			}
		});
	});

	it("createHandlerRuntime joins relative paths to projectDir", async () => {
		const isFile = vi.fn(async () => true);
		const readFile = vi.fn(async () => "contents");
		const runtime = createHandlerRuntime("/project", {
			isFile,
			readFile,
			run: vi.fn(async () => ""),
		});

		await runtime.isFile("tsconfig.json");
		expect(isFile).toHaveBeenCalledWith("/project/tsconfig.json");

		await runtime.readFile("src/a.ts");
		expect(readFile).toHaveBeenCalledWith("/project/src/a.ts");
	});

	it("createHandlerRuntime confines absolute paths to the project directory", async () => {
		const isFile = vi.fn(async () => true);
		const readFile = vi.fn(async () => "contents");
		const runtime = createHandlerRuntime("/project", {
			isFile,
			readFile,
			run: vi.fn(async () => ""),
		});

		await runtime.isFile("/project/src/file.ts");
		expect(isFile).toHaveBeenCalledWith("/project/src/file.ts");

		await runtime.readFile("/project/src/file.ts");
		expect(readFile).toHaveBeenCalledWith("/project/src/file.ts");

		expect(() => runtime.isFile("/abs/file.ts")).toThrow(
			'Handler path "/abs/file.ts" escapes the project directory.',
		);
		expect(() => runtime.readFile("../.ssh/id_rsa")).toThrow(
			"must be a relative path under the project directory",
		);
	});

	it("inferConditionDefault returns schema default when no handler is declared", async () => {
		const runtime = createHandlerRuntime("/project", {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await expect(
			inferConditionDefault(
				"/catalog/registry.json",
				{
					key: "coverageThreshold",
					label: "Coverage",
					kind: RegistryConditionKind.TEXT,
					values: [],
					default: "45",
				},
				runtime,
				{},
			),
		).resolves.toBe("45");
	});

	it("inferConditionDefault returns undefined without a handler or default", async () => {
		const runtime = createHandlerRuntime("/project", {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await expect(
			inferConditionDefault(
				"/catalog/registry.json",
				{
					key: "language",
					label: "Language",
					kind: RegistryConditionKind.SELECT,
					values: [{ value: "typescript", label: "TypeScript" }],
				},
				runtime,
				{},
			),
		).resolves.toBeUndefined();
	});

	it("inferConditionDefault does not special-case packageManager without a handler", async () => {
		fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await expect(
			inferConditionDefault(
				"/catalog/registry.json",
				{
					key: "packageManager",
					label: "Package manager",
					kind: RegistryConditionKind.SELECT,
					values: [
						{ value: "npm", label: "npm" },
						{ value: "pnpm", label: "pnpm" },
					],
				},
				runtime,
				{},
			),
		).resolves.toBeUndefined();
	});

	it("inferConditionDefault uses a schema default when packageManager has no handler", async () => {
		fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await expect(
			inferConditionDefault(
				"/catalog/registry.json",
				{
					key: "packageManager",
					label: "Package manager",
					kind: RegistryConditionKind.SELECT,
					values: [{ value: "npm", label: "npm" }],
					default: "npm",
				},
				runtime,
				{},
			),
		).resolves.toBe("npm");
	});

	it("inferConditionDefault prefers a declared handler over a schema default", async () => {
		fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
		const catalog = path.join(tempDir, "registry.json");
		const handlerPath = path.join(
			tempDir,
			"r/_handlers/packageManager.handler.js",
		);
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(
			handlerPath,
			"module.exports = { async infer() { return 'npm'; } };\n",
		);
		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "packageManager",
					label: "Package manager",
					kind: RegistryConditionKind.SELECT,
					values: [
						{ value: "npm", label: "npm" },
						{ value: "pnpm", label: "pnpm" },
					],
					handler: "r/_handlers/packageManager.handler.js",
				},
				runtime,
				{},
			),
		).resolves.toBe("npm");
	});

	it("inferConditionDefault falls back to schema default when infer returns undefined", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const handlerPath = path.join(tempDir, "r/_handlers/fallback.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(
			handlerPath,
			"module.exports = { async infer() { return undefined; } };\n",
		);
		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "coverageThreshold",
					label: "Coverage",
					kind: RegistryConditionKind.TEXT,
					values: [],
					default: "45",
					handler: "r/_handlers/fallback.handler.js",
				},
				runtime,
				{},
			),
		).resolves.toBe("45");
	});

	it("inferConditionDefault passes optional description and values only when present", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const capturePath = path.join(tempDir, "capture.json");

		async function writeCaptureInfer(name: string): Promise<string> {
			const handlerPath = path.join(tempDir, `r/_handlers/${name}.handler.js`);
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(
				handlerPath,
				`
const fs = require("node:fs");
module.exports = {
  async infer(ctx) {
    fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      values: ctx.values,
      hasDescription: Object.hasOwn(ctx, "description"),
      hasValues: Object.hasOwn(ctx, "values"),
      conditions: ctx.conditions,
    }));
    return "typescript";
  }
};
`,
			);
			return `r/_handlers/${name}.handler.js`;
		}

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const withExtras = await writeCaptureInfer("with-extras");
		await inferConditionDefault(
			catalog,
			{
				key: "language",
				label: "Language",
				description: "Pick a language",
				kind: RegistryConditionKind.SELECT,
				values: [{ value: "typescript", label: "TypeScript" }],
				handler: withExtras,
			},
			runtime,
			{ language: "typescript" },
		);

		expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
			key: "language",
			label: "Language",
			description: "Pick a language",
			values: [{ value: "typescript", label: "TypeScript" }],
			hasDescription: true,
			hasValues: true,
			conditions: { language: "typescript" },
		});

		const withoutExtras = await writeCaptureInfer("without-extras");
		await inferConditionDefault(
			catalog,
			{
				key: "author",
				label: "Author",
				kind: RegistryConditionKind.TEXT,
				values: [],
				handler: withoutExtras,
			},
			runtime,
			{},
		);

		expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
			key: "author",
			label: "Author",
			hasDescription: false,
			hasValues: false,
			conditions: {},
		});
	});

	it("inferConditionDefault normalizes inferred values by kind", async () => {
		const catalog = path.join(tempDir, "registry.json");

		async function writeInfer(name: string, body: string): Promise<string> {
			const handlerPath = path.join(tempDir, `r/_handlers/${name}.handler.js`);
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(
				handlerPath,
				`module.exports = { async infer() { ${body} } };\n`,
			);
			return `r/_handlers/${name}.handler.js`;
		}

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const selectUri = await writeInfer("select", 'return "typescript";');
		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "language",
					label: "Language",
					kind: RegistryConditionKind.SELECT,
					values: [{ value: "typescript", label: "TypeScript" }],
					handler: selectUri,
				},
				runtime,
				{},
			),
		).resolves.toBe("typescript");

		const invalidSelectUri = await writeInfer("bad-select", 'return "python";');
		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "language",
					label: "Language",
					kind: RegistryConditionKind.SELECT,
					values: [{ value: "typescript", label: "TypeScript" }],
					handler: invalidSelectUri,
				},
				runtime,
				{},
			),
		).resolves.toBeUndefined();

		const boolUri = await writeInfer("bool", 'return "true";');
		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "enableCi",
					label: "Enable CI",
					description: "Toggle CI",
					kind: RegistryConditionKind.BOOLEAN,
					values: [],
					handler: boolUri,
				},
				runtime,
				{},
			),
		).resolves.toBe(true);

		const emptyTextUri = await writeInfer("empty-text", 'return "";');
		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "author",
					label: "Author",
					kind: RegistryConditionKind.TEXT,
					values: [],
					handler: emptyTextUri,
				},
				runtime,
				{},
			),
		).resolves.toBeUndefined();

		const undefinedUri = await writeInfer("undef", "return undefined;");
		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "author",
					label: "Author",
					kind: RegistryConditionKind.TEXT,
					values: [],
					handler: undefinedUri,
				},
				runtime,
				{},
			),
		).resolves.toBeUndefined();

		const multiUri = await writeInfer("multi", 'return ["ios", "web"];');
		await expect(
			inferConditionDefault(
				catalog,
				{
					key: "platforms",
					label: "Platforms",
					kind: RegistryConditionKind.MULTISELECT,
					values: [
						{ value: "ios", label: "iOS" },
						{ value: "android", label: "Android" },
					],
					handler: multiUri,
				},
				runtime,
				{},
			),
		).resolves.toBeUndefined();
	});

	it("runPrepareInstallHook upserts returned files and merges bindings", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`
module.exports = async function prepare(ctx) {
  const name = ctx.bindings.prior;
  return {
    bindings: { greeting: "Hello " + name },
    files: [
      { target: "GREETING.md", content: "Hello " + name },
    ],
  };
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const result = await runPrepareInstallHook(
			catalog,
			"r/item.prepare.0.js",
			runtime,
			{
				itemId: "item",
				packIds: ["default"],
				conditions: {},
				packageManager: NpmPackageManager.NPM,
				bindings: { prior: "Ada" },
				compiledItem: { files: [{ target: "EXISTING", content: "x" }] },
			},
		);

		expect(result.bindings).toEqual({ prior: "Ada", greeting: "Hello Ada" });
		expect(result.files).toEqual([
			{ target: "EXISTING", content: "x" },
			{ target: "GREETING.md", content: "Hello Ada" },
		]);
	});

	it("runPrepareInstallHook upserts by target and honors removeFiles", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`
module.exports = async function prepare() {
  return {
    removeFiles: ["DROP"],
    files: [{ target: "KEEP", content: "updated" }],
  };
};
`,
		);

		const result = await runPrepareInstallHook(
			catalog,
			"r/item.prepare.0.js",
			createHandlerRuntime(tempDir, {
				isFile: vi.fn(async () => false),
				readFile: vi.fn(async () => ""),
				run: vi.fn(async () => ""),
			}),
			{
				itemId: "item",
				conditions: {},
				packageManager: NpmPackageManager.NPM,
				compiledItem: {
					files: [
						{ target: "KEEP", content: "old" },
						{ target: "DROP", content: "gone" },
					],
				},
			},
		);

		expect(result.files).toEqual([{ target: "KEEP", content: "updated" }]);
	});

	it("runPrepareInstallHook merges commands, dependencies, and secrets when the hook returns them", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`
module.exports = async function prepare() {
  return {
    commands: { npm: { check: "biome check ." } },
    dependencies: { npm: { dev: ["@biomejs/biome@^2"] } },
    secrets: ["SONAR_TOKEN"],
  };
};
`,
		);

		const result = await runPrepareInstallHook(
			catalog,
			"r/item.prepare.0.js",
			createHandlerRuntime(tempDir, {
				isFile: vi.fn(async () => false),
				readFile: vi.fn(async () => ""),
				run: vi.fn(async () => ""),
			}),
			{
				itemId: "item",
				conditions: {},
				packageManager: NpmPackageManager.NPM,
				compiledItem: {
					files: [],
					commands: { npm: { test: "vitest run" } },
					secrets: ["GH_ADMIN_TOKEN"],
				},
			},
		);

		expect(result.commands).toEqual({
			npm: { test: "vitest run", check: "biome check ." },
		});
		expect(result.dependencies).toEqual({
			npm: { dev: ["@biomejs/biome@^2"] },
		});
		expect(result.secrets).toEqual(["GH_ADMIN_TOKEN", "SONAR_TOKEN"]);
	});

	it("runPrepareInstallHook omits packIds from context when unset and preserves files when the hook yields nothing", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const capturePath = path.join(tempDir, "item-capture.json");
		const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`
const fs = require("node:fs");
module.exports = async function prepare(ctx) {
  fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
    itemId: ctx.itemId,
    packIds: ctx.packIds,
    hasPackIds: Object.hasOwn(ctx, "packIds"),
  }));
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const result = await runPrepareInstallHook(
			catalog,
			"r/item.prepare.0.js",
			runtime,
			{
				itemId: "item",
				conditions: {},
				packageManager: NpmPackageManager.NPM,
				compiledItem: { files: [{ target: "KEEP", content: "yes" }] },
			},
		);

		expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
			itemId: "item",
			hasPackIds: false,
		});
		expect(result.bindings).toEqual({});
		expect(result.files).toEqual([{ target: "KEEP", content: "yes" }]);
	});

	it("runPrepareInstallHook includes packIds when provided", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const capturePath = path.join(tempDir, "variant-capture.json");
		const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`
const fs = require("node:fs");
module.exports = async function prepare(ctx) {
  fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
    packIds: ctx.packIds,
    hasPackIds: Object.hasOwn(ctx, "packIds"),
  }));
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await runPrepareInstallHook(catalog, "r/item.prepare.0.js", runtime, {
			itemId: "item",
			packIds: ["v1"],
			conditions: {},
			packageManager: NpmPackageManager.NPM,
			compiledItem: { files: [] },
		});

		expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
			packIds: ["v1"],
			hasPackIds: true,
		});
	});

	it("runFinalizeInstallHook includes packIds when provided", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const capturePath = path.join(tempDir, "after-variant.json");
		const scriptPath = path.join(tempDir, "r/item.finalize.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`
const fs = require("node:fs");
module.exports = async function finalize(ctx) {
  fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
    packIds: ctx.packIds,
    hasPackIds: Object.hasOwn(ctx, "packIds"),
  }));
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await runFinalizeInstallHook(catalog, "r/item.finalize.0.js", runtime, {
			itemId: "item",
			packIds: ["v1"],
			conditions: {},
			packageManager: NpmPackageManager.NPM,
			bindings: {},
			compiledItem: { files: [] },
		});

		expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
			packIds: ["v1"],
			hasPackIds: true,
		});
	});

	it("runFinalizeInstallHook ignores hook return values", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const scriptPath = path.join(tempDir, "r/item.finalize.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`
module.exports = async function finalize() {
  return {
    files: [{ target: "TOO_LATE", content: "nope" }],
    bindings: { ignored: "yes" },
  };
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const bindings = { keep: "1" };
		const files = [{ target: "KEEP", content: "yes" }];

		await runFinalizeInstallHook(catalog, "r/item.finalize.0.js", runtime, {
			itemId: "item",
			conditions: {},
			packageManager: NpmPackageManager.NPM,
			bindings,
			compiledItem: { files },
		});

		expect(bindings).toEqual({ keep: "1" });
		expect(files).toEqual([{ target: "KEEP", content: "yes" }]);
	});

	it("runPrepareInstallHook starts from empty bindings and compiled item files", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const scriptPath = path.join(tempDir, "r/item.prepare.0.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(
			scriptPath,
			`module.exports = async function prepare() { return { files: [] }; };\n`,
		);

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const result = await runPrepareInstallHook(
			catalog,
			"r/item.prepare.0.js",
			runtime,
			{
				itemId: "item",
				conditions: {},
				packageManager: NpmPackageManager.NPM,
				compiledItem: { files: [] },
			},
		);

		expect(result.bindings).toEqual({});
		expect(result.files).toEqual([]);
	});

	it("runPrepareInstallHook and runFinalizeInstallHook run independently", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const logPath = path.join(tempDir, "lifecycle.log");
		const beforePath = path.join(tempDir, "r/item.prepare.0.js");
		const afterPath = path.join(tempDir, "r/item.finalize.0.js");
		fs.mkdirSync(path.dirname(beforePath), { recursive: true });
		fs.writeFileSync(
			beforePath,
			`
const fs = require("node:fs");
module.exports = async function prepare(ctx) {
  fs.appendFileSync(${JSON.stringify(logPath)}, "before:" + ctx.itemId + "\\n");
};
`,
		);
		fs.writeFileSync(
			afterPath,
			`
const fs = require("node:fs");
module.exports = async function finalize(ctx) {
  fs.appendFileSync(${JSON.stringify(logPath)}, "after:" + ctx.itemId + "\\n");
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});
		const options = {
			itemId: "item",
			conditions: {},
			packageManager: NpmPackageManager.NPM,
			compiledItem: { files: [{ target: "KEEP", content: "yes" }] },
		};

		await runPrepareInstallHook(
			catalog,
			"r/item.prepare.0.js",
			runtime,
			options,
		);
		await runFinalizeInstallHook(
			catalog,
			"r/item.finalize.0.js",
			runtime,
			options,
		);

		expect(fs.readFileSync(logPath, "utf8")).toBe("before:item\nafter:item\n");
	});
});
