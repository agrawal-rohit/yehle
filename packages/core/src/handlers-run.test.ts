import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistryConditionKind } from "./condition-kind";
import type { PromptHost } from "./handlers";
import {
	createHandlerRuntime,
	inferConditionDefault,
	runItemHandler,
} from "./handlers-run";

function makePromptHost(overrides: Partial<PromptHost> = {}): PromptHost {
	return {
		text: vi.fn(async () => ""),
		select: vi.fn(async () => ""),
		multiselect: vi.fn(async () => []),
		confirm: vi.fn(async () => false),
		...overrides,
	};
}

describe("core/handlers-run", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "handlers-run-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("createHandlerRuntime joins relative paths to projectDir", async () => {
		const isFile = vi.fn(async () => true);
		const readFile = vi.fn(async () => "contents");
		const runtime = createHandlerRuntime("/project", makePromptHost(), {
			isFile,
			readFile,
			run: vi.fn(async () => ""),
		});

		await runtime.isFile("tsconfig.json");
		expect(isFile).toHaveBeenCalledWith("/project/tsconfig.json");

		await runtime.readFile("src/a.ts");
		expect(readFile).toHaveBeenCalledWith("/project/src/a.ts");
	});

	it("createHandlerRuntime passes absolute paths through unchanged", async () => {
		const isFile = vi.fn(async () => true);
		const readFile = vi.fn(async () => "contents");
		const runtime = createHandlerRuntime("/project", makePromptHost(), {
			isFile,
			readFile,
			run: vi.fn(async () => ""),
		});

		await runtime.isFile("/abs/file.ts");
		expect(isFile).toHaveBeenCalledWith("/abs/file.ts");

		await runtime.readFile("/abs/file.ts");
		expect(readFile).toHaveBeenCalledWith("/abs/file.ts");
	});

	it("inferConditionDefault returns undefined without a handler", async () => {
		const runtime = createHandlerRuntime("/project", makePromptHost(), {
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

		const runtime = createHandlerRuntime(tempDir, makePromptHost(), {
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

		const runtime = createHandlerRuntime(tempDir, makePromptHost(), {
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

	it("runItemHandler runs prompts, files, and transform in order", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const handlerPath = path.join(tempDir, "r/item.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(
			handlerPath,
			`
module.exports = {
  async prompts() { return { name: "Ada" }; },
  async files(ctx) {
    return [{ target: "HELLO", content: "Hello " + ctx.variables.name }];
  },
  async transform(ctx) {
    return ctx.files.map((file) => ({
      ...file,
      content: file.content + "!",
    }));
  },
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, makePromptHost(), {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const result = await runItemHandler(catalog, "r/item.handler.js", runtime, {
			itemId: "item",
			variantId: "default",
			conditions: {},
			variables: { prior: "1" },
			payload: { files: [{ target: "EXISTING", content: "x" }] },
		});

		expect(result.variables).toEqual({ prior: "1", name: "Ada" });
		expect(result.files).toEqual([
			{ target: "EXISTING", content: "x!" },
			{ target: "HELLO", content: "Hello Ada!" },
		]);
	});

	it("runItemHandler omits variantId from context when unset and preserves files when hooks yield nothing", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const capturePath = path.join(tempDir, "item-capture.json");
		const handlerPath = path.join(tempDir, "r/item.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(
			handlerPath,
			`
const fs = require("node:fs");
module.exports = {
  async prompts(ctx) {
    fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
      itemId: ctx.itemId,
      variantId: ctx.variantId,
      hasVariantId: Object.hasOwn(ctx, "variantId"),
    }));
    return null;
  },
  async files() { return []; },
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, makePromptHost(), {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const result = await runItemHandler(catalog, "r/item.handler.js", runtime, {
			itemId: "item",
			conditions: {},
			payload: { files: [{ target: "KEEP", content: "yes" }] },
		});

		expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
			itemId: "item",
			hasVariantId: false,
		});
		expect(result.variables).toEqual({});
		expect(result.files).toEqual([{ target: "KEEP", content: "yes" }]);
	});

	it("runItemHandler includes variantId when provided", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const capturePath = path.join(tempDir, "variant-capture.json");
		const handlerPath = path.join(tempDir, "r/item.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(
			handlerPath,
			`
const fs = require("node:fs");
module.exports = {
  async prompts(ctx) {
    fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
      variantId: ctx.variantId,
      hasVariantId: Object.hasOwn(ctx, "variantId"),
    }));
  },
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, makePromptHost(), {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		await runItemHandler(catalog, "r/item.handler.js", runtime, {
			itemId: "item",
			variantId: "v1",
			conditions: {},
			payload: { files: [] },
		});

		expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
			variantId: "v1",
			hasVariantId: true,
		});
	});

	it("runItemHandler ignores nullish prompts and files results", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const handlerPath = path.join(tempDir, "r/item.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(
			handlerPath,
			`
module.exports = {
  async prompts() { return null; },
  async files() { return null; },
};
`,
		);

		const runtime = createHandlerRuntime(tempDir, makePromptHost(), {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const result = await runItemHandler(catalog, "r/item.handler.js", runtime, {
			itemId: "item",
			conditions: {},
			variables: { keep: "1" },
			payload: { files: [{ target: "KEEP", content: "yes" }] },
		});

		expect(result.variables).toEqual({ keep: "1" });
		expect(result.files).toEqual([{ target: "KEEP", content: "yes" }]);
	});

	it("runItemHandler starts from empty variables and payload files", async () => {
		const catalog = path.join(tempDir, "registry.json");
		const handlerPath = path.join(tempDir, "r/item.handler.js");
		fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
		fs.writeFileSync(
			handlerPath,
			`module.exports = { async transform() { return []; } };\n`,
		);

		const runtime = createHandlerRuntime(tempDir, makePromptHost(), {
			isFile: vi.fn(async () => false),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
		});

		const result = await runItemHandler(catalog, "r/item.handler.js", runtime, {
			itemId: "item",
			conditions: {},
			payload: { files: [] },
		});

		expect(result.variables).toEqual({});
		expect(result.files).toEqual([]);
	});
});
