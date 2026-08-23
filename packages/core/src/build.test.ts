import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRegistry } from "./build";
import type { Registry, RegistryPayload } from "./schema";

/**
 * Write a registry item fixture under a temp package root.
 * @param packageRoot - Absolute temp package root.
 * @param relativeDir - Item folder relative to registry/.
 * @param manifest - Manifest object written as registry-item.json.
 * @param files - Source files to create relative to the item folder.
 */
function writeItem(
	packageRoot: string,
	relativeDir: string,
	manifest: Record<string, unknown>,
	files: Record<string, string> = {},
): void {
	const itemDir = path.join(packageRoot, "registry", relativeDir);
	fs.mkdirSync(itemDir, { recursive: true });
	fs.writeFileSync(
		path.join(itemDir, "registry-item.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
	for (const [relativePath, content] of Object.entries(files)) {
		const absolutePath = path.join(itemDir, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, content, "utf8");
	}
}

/**
 * Write a JSON file under registry/ (conditions/conditions.json, types.json, etc.).
 * @param packageRoot - Absolute temp package root.
 * @param fileName - File name under registry/ (may include subdirectories).
 * @param data - Object written as JSON.
 */
function writeRegistryJson(
	packageRoot: string,
	fileName: string,
	data: Record<string, unknown>,
): void {
	const absolutePath = path.join(packageRoot, "registry", fileName);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

describe("buildRegistry", () => {
	let tempDir: string;

	/**
	 * Run buildRegistry against the current temp fixture root.
	 * @returns The built registry document.
	 */
	function runBuild() {
		return buildRegistry({
			sourceDir: path.join(tempDir, "registry"),
			outDir: tempDir,
		});
	}

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build-"));
		writeRegistryJson(tempDir, "types.json", {
			component: { label: "Components" },
			configuration: { label: "Configurations" },
		});
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("builds registry.json with install targets and per-variant payloads", async () => {
		writeItem(
			tempDir,
			"component/button",
			{
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				variants: [
					{
						id: "react",
						title: "React",
						description: "React button",
						dependencies: {
							npm: {
								runtime: ["react"],
							},
						},
						files: [
							{
								source: "react/button.tsx",
								target: "src/components/ui/button.tsx",
							},
						],
					},
				],
			},
			{ "react/button.tsx": "export const Button = () => null;\n" },
		);
		writeItem(
			tempDir,
			"configuration/build",
			{
				id: "build",
				title: "Build",
				description: "Build workflow",
				type: "configuration",
				variants: [
					{
						id: "github-actions",
						title: "GitHub Actions",
						description: "GHA build",
						files: [
							{
								source: "github-actions/.github/workflows/build.yml",
								target: ".github/workflows/build.yml",
							},
						],
					},
				],
			},
			{
				"github-actions/.github/workflows/build.yml": "name: build\n",
			},
		);

		const document = await runBuild();
		const written = JSON.parse(
			fs.readFileSync(path.join(tempDir, "registry.json"), "utf8"),
		) as Registry;

		expect(document).toEqual(written);
		expect(Object.keys(written.items)).toEqual(["build", "button"]);
		expect(fs.readFileSync(path.join(tempDir, "registry.json"), "utf8")).toBe(
			`${JSON.stringify(document)}\n`,
		);
		expect(written.items.button).toEqual({
			title: "Button",
			description: "A button",
			type: "component",
			variants: [
				{
					id: "react",
					title: "React",
					source: "r/button/react.json",
				},
			],
		});
		expect(written.items.button).not.toHaveProperty("id");
		expect(written.items.button.variants?.[0]).not.toHaveProperty("files");
		expect(written.items.button.variants?.[0]).not.toHaveProperty(
			"description",
		);
		expect(written.items.button.variants?.[0]).not.toHaveProperty(
			"dependencies",
		);

		const payloadPath = path.join(tempDir, "r/button/react.json");
		const payloadRaw = fs.readFileSync(payloadPath, "utf8");
		const payload = JSON.parse(payloadRaw) as RegistryPayload;
		expect(payload).toEqual({
			files: [
				{
					target: "src/components/ui/button.tsx",
					content: "export const Button = () => null;\n",
				},
			],
			dependencies: {
				npm: {
					runtime: ["react"],
				},
			},
		});
		expect(payload).not.toHaveProperty("id");
		expect(payload).not.toHaveProperty("variantId");
		expect(payloadRaw).toBe(`${JSON.stringify(payload)}\n`);
	});

	it("inlines item-level shared files into every variant payload", async () => {
		writeItem(
			tempDir,
			"configuration/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "configuration",
				files: [
					{ source: "commitlint.config.js", target: "commitlint.config.js" },
				],
				variants: [
					{
						id: "typescript",
						title: "TypeScript",
						description: "TS hooks",
						when: { language: "typescript" },
						files: [
							{
								source: "typescript/lint-staged.config.js",
								target: "lint-staged.config.js",
							},
						],
					},
				],
			},
			{
				"commitlint.config.js": "module.exports = {};\n",
				"typescript/lint-staged.config.js": "module.exports = {};\n",
			},
		);
		writeRegistryJson(tempDir, "conditions/conditions.json", {
			language: {
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});

		const document = await runBuild();
		expect(document.items["git-hooks"]).not.toHaveProperty("id");
		expect(document.items["git-hooks"]).not.toHaveProperty("files");
		expect(document.items["git-hooks"]).not.toHaveProperty("when");
		expect(document.items["git-hooks"].variants?.[0]).toEqual({
			id: "typescript",
			title: "TypeScript",
			source: "r/git-hooks/typescript.json",
			when: { language: "typescript" },
		});

		const payload = JSON.parse(
			fs.readFileSync(
				path.join(tempDir, "r/git-hooks/typescript.json"),
				"utf8",
			),
		) as RegistryPayload;
		expect(payload.files.map((file) => file.target)).toEqual([
			"commitlint.config.js",
			"lint-staged.config.js",
		]);
		expect(
			payload.files.every((file) => typeof file.content === "string"),
		).toBe(true);
	});

	it("builds a variant-less item with a top-level payload", async () => {
		writeItem(
			tempDir,
			"workflow/assign-owner",
			{
				id: "assign-owner",
				title: "Assign Owner",
				description: "Assigns the repository owner",
				type: "configuration",
				registryDependencies: ["setup-workspace"],
				files: [
					{
						source: ".github/workflows/assign-owner.yml",
						target: ".github/workflows/assign-owner.yml",
					},
				],
			},
			{
				".github/workflows/assign-owner.yml": "name: assign-owner\n",
			},
		);
		writeItem(
			tempDir,
			"configuration/pr-template",
			{
				id: "pr-template",
				title: "PR Template",
				description: "A pull request template",
				type: "configuration",
				files: [
					{
						source: ".github/pull_request_template.md",
						target: ".github/pull_request_template.md",
					},
				],
			},
			{
				".github/pull_request_template.md": "## Summary\n",
			},
		);

		const document = await runBuild();
		expect(document.items["assign-owner"]).toEqual({
			title: "Assign Owner",
			description: "Assigns the repository owner",
			type: "configuration",
			source: "r/assign-owner.json",
			registryDependencies: ["setup-workspace"],
		});
		expect(document.items["assign-owner"]).not.toHaveProperty("variants");
		expect(document.items["assign-owner"]).not.toHaveProperty("files");
		expect(document.items["assign-owner"]).not.toHaveProperty("id");
		expect(document.items["pr-template"]).toEqual({
			title: "PR Template",
			description: "A pull request template",
			type: "configuration",
			source: "r/pr-template.json",
		});
		expect(document.items["pr-template"]).not.toHaveProperty(
			"registryDependencies",
		);

		const payload = JSON.parse(
			fs.readFileSync(path.join(tempDir, "r/assign-owner.json"), "utf8"),
		) as RegistryPayload;
		expect(payload).toEqual({
			files: [
				{
					target: ".github/workflows/assign-owner.yml",
					content: "name: assign-owner\n",
				},
			],
		});
		expect(payload).not.toHaveProperty("id");
		expect(payload).not.toHaveProperty("variantId");
	});

	it("builds an empty items map and wipes a stale r/ tree", async () => {
		const stale = path.join(tempDir, "r", "stale", "old.json");
		fs.mkdirSync(path.dirname(stale), { recursive: true });
		fs.writeFileSync(stale, "{}\n", "utf8");
		fs.mkdirSync(path.join(tempDir, "registry"), { recursive: true });

		const document = await runBuild();

		expect(document.items).toEqual({});
		expect(fs.existsSync(path.join(tempDir, "registry.json"))).toBe(true);
		expect(fs.existsSync(path.join(tempDir, "r"))).toBe(false);
	});

	it("treats a missing sourceDir as empty and still requires types.json", async () => {
		await expect(
			buildRegistry({
				sourceDir: path.join(tempDir, "missing-source"),
				outDir: tempDir,
			}),
		).rejects.toThrow("Registry types not found");
	});

	it("throws on duplicate registry item ids", async () => {
		const manifest = {
			id: "button",
			title: "Button",
			description: "A button",
			type: "component",
			variants: [
				{
					id: "default",
					title: "Default",
					description: "Default",
					files: [{ source: "button.tsx", target: "button.tsx" }],
				},
			],
		};
		writeItem(tempDir, "component/a", manifest, {
			"button.tsx": "export {};\n",
		});
		writeItem(tempDir, "component/b", manifest, {
			"button.tsx": "export {};\n",
		});

		await expect(runBuild()).rejects.toThrow(
			'Duplicate registry item id: "button".',
		);
	});

	it("throws on duplicate variant ids within an item", async () => {
		writeItem(
			tempDir,
			"component/button",
			{
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				variants: [
					{
						id: "default",
						title: "Default",
						description: "One",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
					{
						id: "default",
						title: "Also default",
						description: "Two",
						files: [{ source: "b.txt", target: "b.txt" }],
					},
				],
			},
			{ "a.txt": "a\n", "b.txt": "b\n" },
		);

		await expect(runBuild()).rejects.toThrow(
			'Registry item has duplicate variant id "default".',
		);
	});

	it("throws when a declared source file is missing", async () => {
		writeItem(tempDir, "component/button", {
			id: "button",
			title: "Button",
			description: "A button",
			type: "component",
			variants: [
				{
					id: "default",
					title: "Default",
					description: "Default",
					files: [{ source: "missing.tsx", target: "button.tsx" }],
				},
			],
		});

		await expect(runBuild()).rejects.toThrow(
			'Registry item "button" references missing file:',
		);
	});

	it("throws when types.json is absent", async () => {
		fs.rmSync(path.join(tempDir, "registry", "types.json"));
		fs.mkdirSync(path.join(tempDir, "registry"), { recursive: true });

		await expect(runBuild()).rejects.toThrow(
			"Registry types not found at types.json.",
		);
	});

	it("does not wipe r/ when types.json is missing", async () => {
		const stale = path.join(tempDir, "r", "stale", "old.json");
		fs.mkdirSync(path.dirname(stale), { recursive: true });
		fs.writeFileSync(stale, "{}\n", "utf8");
		fs.rmSync(path.join(tempDir, "registry", "types.json"));
		fs.mkdirSync(path.join(tempDir, "registry"), { recursive: true });

		await expect(runBuild()).rejects.toThrow(
			"Registry types not found at types.json.",
		);
		expect(fs.existsSync(stale)).toBe(true);
	});

	it("throws when registry-item.json is not valid JSON", async () => {
		const itemDir = path.join(tempDir, "registry", "component", "broken");
		fs.mkdirSync(itemDir, { recursive: true });
		fs.writeFileSync(
			path.join(itemDir, "registry-item.json"),
			"{ not json\n",
			"utf8",
		);

		await expect(runBuild()).rejects.toThrow("is not valid JSON");
	});

	it("throws when a file source escapes the item folder", async () => {
		writeItem(
			tempDir,
			"component/button",
			{
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				files: [{ source: "../outside.txt", target: "button.tsx" }],
			},
			{ "button.tsx": "export {};\n" },
		);

		await expect(runBuild()).rejects.toThrow(
			"must be a relative path under the item folder",
		);
	});

	it("throws when an item file and a variant file share a target", async () => {
		writeItem(
			tempDir,
			"configuration/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "configuration",
				files: [{ source: "shared.js", target: "config.js" }],
				variants: [
					{
						id: "typescript",
						title: "TypeScript",
						description: "TS hooks",
						files: [{ source: "typescript/override.js", target: "config.js" }],
					},
				],
			},
			{
				"shared.js": "module.exports = {};\n",
				"typescript/override.js": "module.exports = { ts: true };\n",
			},
		);

		await expect(runBuild()).rejects.toThrow(
			'Registry item "git-hooks" variant "typescript" declares duplicate file target "config.js".',
		);
	});

	it("throws when an inlined source file is empty", async () => {
		writeItem(
			tempDir,
			"component/button",
			{
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				files: [{ source: "empty.txt", target: "empty.txt" }],
			},
			{ "empty.txt": "" },
		);

		await expect(runBuild()).rejects.toThrow('Registry payload for "button"');
	});

	it("throws when a when key is not declared in conditions", async () => {
		writeItem(
			tempDir,
			"configuration/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "configuration",
				variants: [
					{
						id: "typescript",
						title: "TypeScript",
						description: "TS",
						when: { language: "typescript" },
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(runBuild()).rejects.toThrow(
			'Registry item "git-hooks" variant "typescript" references unknown when key "language".',
		);
	});

	it("writes artefacts to outDir independently of sourceDir", async () => {
		const sourceDir = path.join(tempDir, "authoring");
		const outDir = path.join(tempDir, "dist");
		fs.mkdirSync(sourceDir, { recursive: true });
		fs.writeFileSync(
			path.join(sourceDir, "types.json"),
			`${JSON.stringify({ component: { label: "Components" } }, null, 2)}\n`,
			"utf8",
		);
		const itemDir = path.join(sourceDir, "component/button");
		fs.mkdirSync(itemDir, { recursive: true });
		fs.writeFileSync(
			path.join(itemDir, "registry-item.json"),
			`${JSON.stringify(
				{
					id: "button",
					title: "Button",
					description: "A button",
					type: "component",
					variants: [
						{
							id: "default",
							title: "Default",
							description: "Default",
							files: [{ source: "a.txt", target: "a.txt" }],
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		fs.writeFileSync(path.join(itemDir, "a.txt"), "a\n", "utf8");

		const document = await buildRegistry({ sourceDir, outDir });

		expect(document.items.button).toBeDefined();
		expect(fs.existsSync(path.join(outDir, "registry.json"))).toBe(true);
		expect(fs.existsSync(path.join(outDir, "r/button/default.json"))).toBe(
			true,
		);
		expect(fs.existsSync(path.join(sourceDir, "registry.json"))).toBe(false);
	});

	it("moves dependencies into payloads and keeps registryDependencies in the catalog", async () => {
		writeItem(
			tempDir,
			"configuration/testing",
			{
				id: "testing",
				title: "Testing",
				description: "Tests",
				type: "configuration",
				registryDependencies: ["setup-workspace"],
				dependencies: {
					npm: {
						runtime: ["shared-lib"],
						dev: ["vitest"],
					},
				},
				variants: [
					{
						id: "typescript",
						title: "TypeScript",
						description: "TS tests",
						when: { language: "typescript" },
						registryDependencies: ["setup-workspace-workflow"],
						dependencies: {
							npm: {
								runtime: ["react"],
								dev: ["@vitest/coverage-v8"],
							},
						},
						files: [{ source: "vitest.config.ts", target: "vitest.config.ts" }],
					},
				],
			},
			{ "vitest.config.ts": "export default {};\n" },
		);
		writeRegistryJson(tempDir, "conditions/conditions.json", {
			language: {
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});

		const document = await runBuild();
		expect(document.items.testing).toEqual({
			title: "Testing",
			description: "Tests",
			type: "configuration",
			registryDependencies: ["setup-workspace"],
			variants: [
				{
					id: "typescript",
					title: "TypeScript",
					source: "r/testing/typescript.json",
					when: { language: "typescript" },
					registryDependencies: ["setup-workspace-workflow"],
				},
			],
		});
		expect(document.items.testing).not.toHaveProperty("dependencies");

		const payload = JSON.parse(
			fs.readFileSync(path.join(tempDir, "r/testing/typescript.json"), "utf8"),
		) as RegistryPayload;
		expect(payload.dependencies).toEqual({
			npm: {
				runtime: ["react", "shared-lib"],
				dev: ["@vitest/coverage-v8", "vitest"],
			},
		});
		expect(payload).not.toHaveProperty("id");
		expect(payload).not.toHaveProperty("variantId");
		expect(payload).not.toHaveProperty("registryDependencies");
	});

	it("bundles item install scripts and condition handlers into r/", async () => {
		writeItem(
			tempDir,
			"configuration/license",
			{
				id: "license",
				title: "License",
				description: "SPDX license",
				type: "configuration",
				beforeInstall: "handler.ts",
			},
			{
				"handler.ts": `
export default async function beforeInstall() {
  return { files: [{ target: "LICENSE", content: "MIT" }] };
}
`,
			},
		);
		fs.mkdirSync(path.join(tempDir, "registry/conditions"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(tempDir, "registry/conditions/language.ts"),
			`
export default {
  async infer() {
    return "typescript";
  },
};
`,
			"utf8",
		);
		writeRegistryJson(tempDir, "conditions/conditions.json", {
			language: {
				label: "Language",
				handler: "conditions/language.ts",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});

		const document = await runBuild();
		expect(document.items.license).toEqual({
			title: "License",
			description: "SPDX license",
			type: "configuration",
			beforeInstall: ["r/license.beforeInstall.0.js"],
		});
		expect(document.items.license).not.toHaveProperty("source");
		expect(document.conditions?.language.handler).toBe(
			"r/_handlers/language.handler.js",
		);
		expect(
			fs.existsSync(path.join(tempDir, "r/license.beforeInstall.0.js")),
		).toBe(true);
		expect(
			fs.existsSync(path.join(tempDir, "r/_handlers/language.handler.js")),
		).toBe(true);
		expect(fs.existsSync(path.join(tempDir, "r/license.json"))).toBe(false);
	});

	it("writes a payload for a script item that declares packages", async () => {
		writeItem(
			tempDir,
			"configuration/with-pkgs",
			{
				id: "with-pkgs",
				title: "With packages",
				description: "Install script plus packages",
				type: "configuration",
				beforeInstall: "handler.ts",
				dependencies: {
					npm: {
						runtime: ["left-pad"],
					},
				},
			},
			{
				"handler.ts": `
export default async function beforeInstall() {
  return { files: [{ target: "X", content: "x" }] };
}
`,
			},
		);

		const document = await runBuild();
		expect(document.items["with-pkgs"]).toEqual({
			title: "With packages",
			description: "Install script plus packages",
			type: "configuration",
			source: "r/with-pkgs.json",
			beforeInstall: ["r/with-pkgs.beforeInstall.0.js"],
		});

		const payload = JSON.parse(
			fs.readFileSync(path.join(tempDir, "r/with-pkgs.json"), "utf8"),
		) as RegistryPayload;
		expect(payload).toEqual({
			files: [],
			dependencies: {
				npm: {
					runtime: ["left-pad"],
				},
			},
		});
		expect(
			fs.existsSync(path.join(tempDir, "r/with-pkgs.beforeInstall.0.js")),
		).toBe(true);
	});

	it("rejects install scripts that runtime-import @tuckshop/core", async () => {
		writeItem(
			tempDir,
			"configuration/bad",
			{
				id: "bad",
				title: "Bad",
				description: "Imports core at runtime",
				type: "configuration",
				beforeInstall: "handler.ts",
			},
			{
				"handler.ts": `
import { parseWithSchema } from "@tuckshop/core";
export default async function beforeInstall() {
  void parseWithSchema;
  return { files: [{ target: "X", content: "x" }] };
}
`,
			},
		);

		await expect(runBuild()).rejects.toThrow("@tuckshop/core");
	});

	it("rejects a declared install script file that is missing", async () => {
		writeItem(
			tempDir,
			"configuration/missing-handler",
			{
				id: "missing-handler",
				title: "Missing script",
				description: "Points at a missing script",
				type: "configuration",
				beforeInstall: "handler.ts",
				files: [{ source: "a.txt", target: "a.txt" }],
			},
			{
				"a.txt": "hello\n",
			},
		);

		await expect(runBuild()).rejects.toThrow("missing script");
	});

	it("rejects an install script that fails to bundle", async () => {
		writeItem(
			tempDir,
			"configuration/syntax-error",
			{
				id: "syntax-error",
				title: "Syntax error",
				description: "Invalid TypeScript install script",
				type: "configuration",
				beforeInstall: "handler.ts",
			},
			{
				"handler.ts":
					"export default async function beforeInstall() { return [[[; };\n",
			},
		);

		await expect(runBuild()).rejects.toThrow("Failed to bundle");
	});

	it("preserves item uses in the catalog", async () => {
		writeRegistryJson(tempDir, "conditions/conditions.json", {
			language: {
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});
		writeItem(
			tempDir,
			"configuration/uses-lang",
			{
				id: "uses-lang",
				title: "Uses language",
				description: "Declares uses",
				type: "configuration",
				uses: ["language"],
				files: [{ source: "a.txt", target: "a.txt" }],
			},
			{ "a.txt": "hello\n" },
		);

		const document = await runBuild();
		expect(document.items["uses-lang"].uses).toEqual(["language"]);
	});

	it("compiles item-level and variant-level afterInstall scripts", async () => {
		writeItem(
			tempDir,
			"configuration/lifecycle",
			{
				id: "lifecycle",
				title: "Lifecycle",
				description: "Install lifecycle scripts",
				type: "configuration",
				afterInstall: "after.ts",
				variants: [
					{
						id: "pro",
						title: "Pro",
						description: "Pro tier",
						afterInstall: "pro-after.ts",
						files: [{ source: "pro.txt", target: "pro.txt" }],
					},
				],
			},
			{
				"after.ts": `export default async function afterInstall() {}\n`,
				"pro-after.ts": `export default async function afterInstall() {}\n`,
				"pro.txt": "pro\n",
			},
		);

		const document = await runBuild();
		expect(document.items.lifecycle.afterInstall).toEqual([
			"r/lifecycle.afterInstall.0.js",
		]);
		expect(document.items.lifecycle.variants).toEqual([
			expect.objectContaining({
				id: "pro",
				afterInstall: ["r/lifecycle/pro.afterInstall.0.js"],
			}),
		]);
		expect(
			fs.existsSync(path.join(tempDir, "r/lifecycle.afterInstall.0.js")),
		).toBe(true);
		expect(
			fs.existsSync(path.join(tempDir, "r/lifecycle/pro.afterInstall.0.js")),
		).toBe(true);
	});

	it("namespaces variant install scripts under r/{itemId}/{variantId}", async () => {
		writeItem(
			tempDir,
			"component/button",
			{
				id: "button",
				title: "Button",
				description: "Button component",
				type: "component",
				beforeInstall: "shared.ts",
				variants: [
					{
						id: "react",
						title: "React",
						description: "React button",
						beforeInstall: "react.ts",
						files: [{ source: "react.tsx", target: "button.tsx" }],
					},
					{
						id: "vue",
						title: "Vue",
						description: "Vue button",
						beforeInstall: "vue.ts",
						files: [{ source: "vue.vue", target: "button.vue" }],
					},
				],
			},
			{
				"shared.ts": `export default async function beforeInstall() { return { files: [] }; }\n`,
				"react.ts": `export default async function beforeInstall() { return { files: [] }; }\n`,
				"vue.ts": `export default async function beforeInstall() { return { files: [] }; }\n`,
				"react.tsx": "export {}\n",
				"vue.vue": "<template></template>\n",
			},
		);

		const document = await runBuild();
		expect(document.items.button.beforeInstall).toEqual([
			"r/button.beforeInstall.0.js",
		]);
		expect(document.items.button.variants).toEqual([
			expect.objectContaining({
				id: "react",
				beforeInstall: ["r/button/react.beforeInstall.0.js"],
			}),
			expect.objectContaining({
				id: "vue",
				beforeInstall: ["r/button/vue.beforeInstall.0.js"],
			}),
		]);
		expect(
			fs.existsSync(path.join(tempDir, "r/button.beforeInstall.0.js")),
		).toBe(true);
		expect(
			fs.existsSync(path.join(tempDir, "r/button/react.beforeInstall.0.js")),
		).toBe(true);
		expect(
			fs.existsSync(path.join(tempDir, "r/button/vue.beforeInstall.0.js")),
		).toBe(true);
	});

	it("copies registryDependencies into the catalog without treating them as scripts", async () => {
		writeItem(
			tempDir,
			"template/react-app",
			{
				id: "react-app",
				title: "React App",
				description: "React template",
				type: "component",
				registryDependencies: ["license-configuration", "git-init"],
				files: [{ source: "README.md", target: "README.md" }],
			},
			{ "README.md": "# App\n" },
		);

		const document = await runBuild();
		expect(document.items["react-app"]).toMatchObject({
			registryDependencies: ["license-configuration", "git-init"],
		});
		expect(document.items["react-app"]).not.toHaveProperty("beforeInstall");
		expect(document.items["react-app"]).not.toHaveProperty("afterInstall");
	});

	it("rethrows non-ENOENT errors while walking the authoring tree", async () => {
		const blocked = path.join(tempDir, "registry", "blocked");
		fs.mkdirSync(blocked, { recursive: true });
		fs.chmodSync(blocked, 0);

		try {
			await expect(runBuild()).rejects.toThrow();
		} finally {
			fs.chmodSync(blocked, 0o755);
		}
	});
});
