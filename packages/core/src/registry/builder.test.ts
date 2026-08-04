import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRegistry } from "./builder";
import { type Registry, SCHEMA_VERSION } from "./schema";

/**
 * Write a registry item fixture under a temp repo root.
 * @param repoRoot - Absolute temp repo root.
 * @param relativeDir - Item folder relative to registry/.
 * @param manifest - Manifest object written as registry-item.json.
 * @param files - Source files to create relative to the item folder.
 */
function writeItem(
	repoRoot: string,
	relativeDir: string,
	manifest: Record<string, unknown>,
	files: Record<string, string> = {},
): void {
	const itemDir = path.join(repoRoot, "registry", relativeDir);
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
 * Write a shared conditions map under registry/conditions.json.
 * @param repoRoot - Absolute temp repo root.
 * @param conditions - Conditions object written as JSON.
 */
function writeConditions(
	repoRoot: string,
	conditions: Record<string, unknown>,
): void {
	const registryDir = path.join(repoRoot, "registry");
	fs.mkdirSync(registryDir, { recursive: true });
	fs.writeFileSync(
		path.join(registryDir, "conditions.json"),
		`${JSON.stringify(conditions, null, 2)}\n`,
		"utf8",
	);
}

/**
 * Write a shared types map under registry/types.json.
 * @param repoRoot - Absolute temp repo root.
 * @param types - Types object written as JSON.
 */
function writeTypes(repoRoot: string, types: Record<string, unknown>): void {
	const registryDir = path.join(repoRoot, "registry");
	fs.mkdirSync(registryDir, { recursive: true });
	fs.writeFileSync(
		path.join(registryDir, "types.json"),
		`${JSON.stringify(types, null, 2)}\n`,
		"utf8",
	);
}

describe("registry/builder", () => {
	let tempDir: string;
	const previousEnv = process.env.TUCKSHOP_REGISTRY_BASE_URL;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "builder-test-"));
		fs.writeFileSync(
			path.join(tempDir, "package.json"),
			`${JSON.stringify({ name: "fixture", version: "1.2.3" }, null, 2)}\n`,
			"utf8",
		);
		delete process.env.TUCKSHOP_REGISTRY_BASE_URL;
		writeTypes(tempDir, {
			component: { label: "Components" },
			convention: { label: "Conventions" },
			"legacy-widget": { label: "Legacy Widgets" },
		});
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		if (previousEnv === undefined)
			delete process.env.TUCKSHOP_REGISTRY_BASE_URL;
		else process.env.TUCKSHOP_REGISTRY_BASE_URL = previousEnv;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("builds registry.json with version, contentBaseUrl, sorted items, and repo-relative sources", async () => {
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
			"convention/build",
			{
				id: "build",
				title: "Build",
				description: "Build workflow",
				type: "convention",
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

		const document = await buildRegistry(tempDir);
		const written = JSON.parse(
			fs.readFileSync(path.join(tempDir, "registry.json"), "utf8"),
		) as Registry;

		expect(document).toEqual(written);
		expect(written.version).toBe("1.2.3");
		expect(written.schemaVersion).toBe(SCHEMA_VERSION);
		expect(written.contentBaseUrl).toBe(
			"https://raw.githubusercontent.com/agrawal-rohit/tuckshop/v1.2.3",
		);
		expect(Object.keys(written.items)).toEqual(["build", "button"]);
		expect(written.items.button.variants[0].files[0]).toEqual({
			source: "registry/component/button/react/button.tsx",
			target: "src/components/ui/button.tsx",
		});
		expect(written.items.button.variants[0].dependencies).toEqual(["react"]);
		expect(written.items.build.variants[0].files[0].source).toBe(
			"registry/convention/build/github-actions/.github/workflows/build.yml",
		);
	});

	it("uses TUCKSHOP_REGISTRY_BASE_URL when set, stripping trailing slashes", async () => {
		process.env.TUCKSHOP_REGISTRY_BASE_URL = "https://example.com/mirror///";
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
						description: "Default",
						files: [{ source: "button.tsx", target: "button.tsx" }],
					},
				],
			},
			{ "button.tsx": "export {};\n" },
		);

		const document = await buildRegistry(tempDir);
		expect(document.contentBaseUrl).toBe("https://example.com/mirror");
	});

	it("throws when no registry items exist", async () => {
		fs.mkdirSync(path.join(tempDir, "registry"), { recursive: true });
		await expect(buildRegistry(tempDir)).rejects.toThrow(
			`No registry items found under ${path.join(tempDir, "registry")}.`,
		);
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

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Duplicate registry item id: "button".',
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

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry item "button" references missing file:',
		);
	});

	it("accepts custom registry item types", async () => {
		writeItem(
			tempDir,
			"component/button",
			{
				id: "button",
				title: "Button",
				description: "A button",
				type: "legacy-widget",
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [{ source: "button.tsx", target: "button.tsx" }],
					},
				],
			},
			{ "button.tsx": "export {};\n" },
		);

		const document = await buildRegistry(tempDir);
		expect(document.items.button.type).toBe("legacy-widget");
	});

	it("throws when a variant has no files", async () => {
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
					files: [],
				},
			],
		});

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry item "button" variant "default" has no files.',
		);
	});

	it("passes through item-level shared files and variant when", async () => {
		writeConditions(tempDir, {
			language: {
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});
		writeItem(
			tempDir,
			"convention/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "convention",
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
				"commitlint.config.js": "export default {};\n",
				"typescript/lint-staged.config.js": "export default {};\n",
			},
		);

		const document = await buildRegistry(tempDir);

		expect(document.conditions?.language).toEqual({
			label: "Language",
			values: [{ value: "typescript", label: "TypeScript" }],
		});
		expect(document.items["git-hooks"].files).toEqual([
			{
				source: "registry/convention/git-hooks/commitlint.config.js",
				target: "commitlint.config.js",
			},
		]);
		expect(document.items["git-hooks"].variants[0].when).toEqual({
			language: "typescript",
		});
	});

	it("throws when an item-level shared source file is missing", async () => {
		writeItem(
			tempDir,
			"convention/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "convention",
				files: [{ source: "missing.js", target: "missing.js" }],
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [{ source: "hook.sh", target: "hook.sh" }],
					},
				],
			},
			{ "hook.sh": "#!/bin/sh\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry item "git-hooks" references missing file:',
		);
	});

	it("throws when when is not an object", async () => {
		writeItem(
			tempDir,
			"convention/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "convention",
				variants: [
					{
						id: "typescript",
						title: "TypeScript",
						description: "TS",
						when: "language == typescript",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry item "git-hooks" variant "typescript" when must be an object.',
		);
	});

	it("throws when a condition has a duplicate value", async () => {
		writeConditions(tempDir, {
			language: {
				label: "Language",
				values: [
					{ value: "typescript", label: "TypeScript" },
					{ value: "typescript", label: "TS again" },
				],
			},
		});
		writeItem(
			tempDir,
			"convention/build",
			{
				id: "build",
				title: "Build",
				description: "Build",
				type: "convention",
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry condition "language" has duplicate value "typescript".',
		);
	});

	it("throws when a when key is not declared in conditions", async () => {
		writeItem(
			tempDir,
			"convention/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "convention",
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

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry item "git-hooks" variant "typescript" references unknown when key "language".',
		);
	});

	it("throws when a when value is undeclared for its key", async () => {
		writeConditions(tempDir, {
			language: {
				label: "Language",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});
		writeItem(
			tempDir,
			"convention/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "convention",
				variants: [
					{
						id: "python",
						title: "Python",
						description: "Py",
						when: { language: "python" },
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry item "git-hooks" variant "python" uses undeclared when value "python" for key "language".',
		);
	});

	it("passes through item-level dependencies and condition inference files", async () => {
		writeConditions(tempDir, {
			language: {
				label: "Language",
				inference: "files",
				values: [
					{
						value: "typescript",
						label: "TypeScript",
						files: ["package.json", "tsconfig.json"],
					},
					{
						value: "python",
						label: "Python",
						files: ["pyproject.toml"],
					},
				],
			},
		});
		writeItem(
			tempDir,
			"convention/git-hooks",
			{
				id: "git-hooks",
				title: "Git Hooks",
				description: "Hooks",
				type: "convention",
				dependencies: ["shared-runtime@^1"],
				devDependencies: ["husky@^9"],
				variants: [
					{
						id: "typescript",
						title: "TypeScript",
						description: "TS",
						when: { language: "typescript" },
						devDependencies: ["lint-staged@^16"],
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		const document = await buildRegistry(tempDir);

		expect(document.items["git-hooks"].dependencies).toEqual([
			"shared-runtime@^1",
		]);
		expect(document.items["git-hooks"].devDependencies).toEqual(["husky@^9"]);
		expect(document.items["git-hooks"].variants[0].devDependencies).toEqual([
			"lint-staged@^16",
		]);
		expect(document.conditions?.language).toEqual({
			label: "Language",
			inference: "files",
			values: [
				{
					value: "typescript",
					label: "TypeScript",
					files: ["package.json", "tsconfig.json"],
				},
				{
					value: "python",
					label: "Python",
					files: ["pyproject.toml"],
				},
			],
		});
	});

	it("throws when inference mode is invalid", async () => {
		writeConditions(tempDir, {
			language: {
				label: "Language",
				inference: "magic",
				values: [{ value: "typescript", label: "TypeScript" }],
			},
		});
		writeItem(
			tempDir,
			"convention/build",
			{
				id: "build",
				title: "Build",
				description: "Build",
				type: "convention",
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry condition "language" has invalid inference "magic"',
		);
	});

	it("throws when a value files entry is not a non-empty string", async () => {
		writeConditions(tempDir, {
			language: {
				label: "Language",
				inference: "files",
				values: [
					{
						value: "typescript",
						label: "TypeScript",
						files: [""],
					},
				],
			},
		});
		writeItem(
			tempDir,
			"convention/build",
			{
				id: "build",
				title: "Build",
				description: "Build",
				type: "convention",
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry condition "language" values[0].files[0] must be a non-empty string.',
		);
	});

	it("embeds types from types.json when present", async () => {
		writeTypes(tempDir, {
			component: {
				label: "Components",
				description: "Reusable UI primitives.",
			},
			theme: {
				label: "Themes",
			},
		});
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
						description: "Default",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		const document = await buildRegistry(tempDir);

		expect(document.types).toEqual({
			component: {
				label: "Components",
				description: "Reusable UI primitives.",
			},
			theme: {
				label: "Themes",
			},
		});
	});

	it("throws when types.json is absent", async () => {
		fs.rmSync(path.join(tempDir, "registry", "types.json"));
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
						description: "Default",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			"Registry types not found at registry/types.json.",
		);
	});

	it("throws when an item type is not declared in types.json", async () => {
		writeTypes(tempDir, {
			theme: { label: "Themes" },
		});
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
						description: "Default",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await expect(buildRegistry(tempDir)).rejects.toThrow(
			'Registry item "button" has undeclared type "component".',
		);
	});
});
