import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadConditionHandler,
	loadItemHandler,
	resolveLocalHandlerPath,
} from "./handlers-load";

describe("core/handlers-load", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "handlers-load-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("resolveLocalHandlerPath", () => {
		it("resolves a relative handler under a local catalog", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(resolveLocalHandlerPath(catalog, "r/item.handler.js")).toBe(
				path.join(tempDir, "r/item.handler.js"),
			);
		});

		it("trims surrounding whitespace on the handler URI", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(resolveLocalHandlerPath(catalog, "  r/item.handler.js  ")).toBe(
				path.join(tempDir, "r/item.handler.js"),
			);
		});

		it("rejects empty and whitespace-only handler URIs", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(() => resolveLocalHandlerPath(catalog, "")).toThrow(
				'Handler URI "" must be a relative path under the catalog directory.',
			);
			expect(() => resolveLocalHandlerPath(catalog, "   ")).toThrow(
				'Handler URI "   " must be a relative path under the catalog directory.',
			);
		});

		it("rejects remote HTTPS catalogs", () => {
			expect(() =>
				resolveLocalHandlerPath(
					"https://example.com/registry.json",
					"r/item.handler.js",
				),
			).toThrow("local catalog");
		});

		it("rejects parent-directory escapes with Handler URI wording", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(() =>
				resolveLocalHandlerPath(catalog, "r/../outside.handler.js"),
			).toThrow(
				'Handler URI "r/../outside.handler.js" must be a relative path under the catalog directory.',
			);
		});

		it("rejects absolute HTTP handler URIs", () => {
			const catalog = path.join(tempDir, "registry.json");
			expect(() =>
				resolveLocalHandlerPath(catalog, "https://evil.example/h.js"),
			).toThrow("relative path under the catalog directory");
		});
	});

	describe("loadItemHandler", () => {
		it("loads handlers that export only prompts, only files, or only transform", async () => {
			const catalog = path.join(tempDir, "registry.json");

			for (const [name, body] of [
				["prompts", "async prompts() { return {}; }"],
				["files", "async files() { return []; }"],
				["transform", "async transform(ctx) { return ctx.files; }"],
			] as const) {
				const handlerPath = path.join(tempDir, `r/${name}.handler.js`);
				fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
				fs.writeFileSync(handlerPath, `module.exports = { ${body} };\n`);

				const handler = await loadItemHandler(catalog, `r/${name}.handler.js`);
				expect(typeof handler[name]).toBe("function");
			}
		});

		it("loads a default-exported item handler", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const handlerPath = path.join(tempDir, "r/item.handler.js");
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(
				handlerPath,
				"module.exports = { default: { async files() { return []; } } };\n",
			);

			const handler = await loadItemHandler(catalog, "r/item.handler.js");
			expect(typeof handler.files).toBe("function");
		});

		it("rejects modules without prompts, files, or transform", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const handlerPath = path.join(tempDir, "r/bad.handler.js");
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(handlerPath, "module.exports = {};\n");

			await expect(
				loadItemHandler(catalog, "r/bad.handler.js"),
			).rejects.toThrow("prompts, files, and/or transform");
		});

		it("prefers an explicit default export over the module namespace", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const handlerPath = path.join(tempDir, "r/item.handler.js");
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(
				handlerPath,
				`
module.exports = {
  default: undefined,
  async files() { return [{ target: "from-namespace", content: "x" }]; },
};
`,
			);

			const handler = await loadItemHandler(catalog, "r/item.handler.js");
			expect(typeof handler.files).toBe("function");
			expect(await handler.files?.({} as never)).toEqual([
				{ target: "from-namespace", content: "x" },
			]);
		});

		it("rejects null and non-object item handler exports", async () => {
			const catalog = path.join(tempDir, "registry.json");

			for (const [name, source] of [
				["null", "module.exports = null;\n"],
				["number", "module.exports = 42;\n"],
				["string", 'module.exports = "nope";\n'],
			] as const) {
				const handlerPath = path.join(tempDir, `r/${name}.handler.js`);
				fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
				fs.writeFileSync(handlerPath, source);

				await expect(
					loadItemHandler(catalog, `r/${name}.handler.js`),
				).rejects.toThrow("prompts, files, and/or transform");
			}
		});
	});

	describe("loadConditionHandler", () => {
		it("loads a default-exported condition handler", async () => {
			const catalog = path.join(tempDir, "registry.json");
			const handlerPath = path.join(tempDir, "r/_handlers/language.handler.js");
			fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
			fs.writeFileSync(
				handlerPath,
				"module.exports = { default: { async infer() { return 'typescript'; } } };\n",
			);

			const handler = await loadConditionHandler(
				catalog,
				"r/_handlers/language.handler.js",
			);
			expect(await handler.infer?.({} as never)).toBe("typescript");
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
				loadConditionHandler(catalog, "r/_handlers/bad.handler.js"),
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
					loadConditionHandler(catalog, `r/_handlers/${name}.handler.js`),
				).rejects.toThrow("condition handler with an infer hook");
			}
		});
	});
});
