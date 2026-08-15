import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRegistry } from "./build";
import * as parse from "./parse";
import type { Registry, RegistryItem, RegistryPayload } from "./schema";

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
 * Write a JSON file under registry/ (conditions.json, types.json, etc.).
 * @param packageRoot - Absolute temp package root.
 * @param fileName - File name under registry/.
 * @param data - Object written as JSON.
 */
function writeRegistryJson(
	packageRoot: string,
	fileName: string,
	data: Record<string, unknown>,
): void {
	const registryDir = path.join(packageRoot, "registry");
	fs.mkdirSync(registryDir, { recursive: true });
	fs.writeFileSync(
		path.join(registryDir, fileName),
		`${JSON.stringify(data, null, 2)}\n`,
		"utf8",
	);
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
						dependencies: ["react"],
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
		expect(written.items.button.variants?.[0].files[0]).toEqual({
			source: "r/button/react.json",
			target: "src/components/ui/button.tsx",
		});
		expect(written.items.button.variants?.[0]).not.toHaveProperty("payload");
		expect(written.items.button.variants?.[0].dependencies).toEqual(["react"]);

		const payload = JSON.parse(
			fs.readFileSync(path.join(tempDir, "r/button/react.json"), "utf8"),
		) as RegistryPayload;
		expect(payload).toEqual({
			id: "button",
			variantId: "react",
			files: [
				{
					target: "src/components/ui/button.tsx",
					content: "export const Button = () => null;\n",
				},
			],
		});
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
		writeRegistryJson(tempDir, "conditions.json", {
			language: {
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});

		const document = await runBuild();
		expect(document.items["git-hooks"].files).toBeUndefined();
		expect(document.items["git-hooks"].variants?.[0].files).toEqual([
			{
				source: "r/git-hooks/typescript.json",
				target: "commitlint.config.js",
			},
			{
				source: "r/git-hooks/typescript.json",
				target: "lint-staged.config.js",
			},
		]);

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

		const document = await runBuild();
		expect(document.items["assign-owner"]).toEqual({
			id: "assign-owner",
			title: "Assign Owner",
			description: "Assigns the repository owner",
			type: "configuration",
			files: [
				{
					source: "r/assign-owner.json",
					target: ".github/workflows/assign-owner.yml",
				},
			],
		});
		expect(document.items["assign-owner"]).not.toHaveProperty("variants");

		const payload = JSON.parse(
			fs.readFileSync(path.join(tempDir, "r/assign-owner.json"), "utf8"),
		) as RegistryPayload;
		expect(payload).toEqual({
			id: "assign-owner",
			files: [
				{
					target: ".github/workflows/assign-owner.yml",
					content: "name: assign-owner\n",
				},
			],
		});
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

		await expect(runBuild()).rejects.toThrow("Registry types not found");
	});

	it("falls back to types.json in the missing-types error when relative is empty", async () => {
		fs.rmSync(path.join(tempDir, "registry", "types.json"));
		fs.mkdirSync(path.join(tempDir, "registry"), { recursive: true });
		const relativeSpy = vi.spyOn(path, "relative").mockReturnValueOnce("");

		try {
			await expect(runBuild()).rejects.toThrow(
				"Registry types not found at types.json.",
			);
		} finally {
			relativeSpy.mockRestore();
		}
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

	it("falls back to empty variant files when a variant omits files", async () => {
		writeItem(
			tempDir,
			"configuration/shared",
			{
				id: "shared",
				title: "Shared",
				description: "Shared files",
				type: "configuration",
				files: [{ source: "shared.txt", target: "shared.txt" }],
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [{ source: "shared.txt", target: "shared.txt" }],
					},
				],
			},
			{ "shared.txt": "shared\n" },
		);

		const originalParseWithSchema = parse.parseWithSchema;
		const spy = vi
			.spyOn(parse, "parseWithSchema")
			.mockImplementation((schema, raw, label) => {
				if (label === "Registry item") {
					return {
						id: "shared",
						title: "Shared",
						description: "Shared files",
						type: "configuration",
						files: [{ source: "shared.txt", target: "shared.txt" }],
						variants: [
							{
								id: "default",
								title: "Default",
								description: "Default",
							},
						],
					} as RegistryItem;
				}
				return originalParseWithSchema(schema, raw, label);
			});

		try {
			const document = await runBuild();
			expect(document.items.shared.variants?.[0].files).toEqual([
				{ source: "r/shared/default.json", target: "shared.txt" },
			]);
		} finally {
			spy.mockRestore();
		}
	});

	it("falls back to an empty file list when a variant-less item omits files", async () => {
		writeItem(
			tempDir,
			"configuration/empty",
			{
				id: "empty",
				title: "Empty",
				description: "Empty",
				type: "configuration",
				files: [{ source: "a.txt", target: "a.txt" }],
			},
			{ "a.txt": "a\n" },
		);

		const originalParseWithSchema = parse.parseWithSchema;
		const spy = vi
			.spyOn(parse, "parseWithSchema")
			.mockImplementation((schema, raw, label) => {
				if (label === "Registry item") {
					return {
						id: "empty",
						title: "Empty",
						description: "Empty",
						type: "configuration",
					} as RegistryItem;
				}
				return originalParseWithSchema(schema, raw, label);
			});

		try {
			await expect(runBuild()).rejects.toThrow(/files/);
		} finally {
			spy.mockRestore();
		}
	});

	it("falls back to the default payload path when the planned entry is missing", async () => {
		writeItem(
			tempDir,
			"workflow/assign-owner",
			{
				id: "assign-owner",
				title: "Assign Owner",
				description: "Assigns the repository owner",
				type: "configuration",
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

		const originalFind = Array.prototype.find;
		const findSpy = vi
			.spyOn(Array.prototype, "find")
			.mockImplementation(function (this: unknown[], ...args) {
				const first = this[0] as
					| { relativeFile?: string; absoluteFile?: string }
					| undefined;
				if (
					first &&
					typeof first === "object" &&
					"relativeFile" in first &&
					"absoluteFile" in first
				) {
					return undefined;
				}
				return originalFind.apply(
					this,
					args as Parameters<typeof originalFind>,
				);
			});

		try {
			const document = await runBuild();
			expect(document.items["assign-owner"].files?.[0]).toEqual({
				source: "r/assign-owner.json",
				target: ".github/workflows/assign-owner.yml",
			});
		} finally {
			findSpy.mockRestore();
		}
	});
});
