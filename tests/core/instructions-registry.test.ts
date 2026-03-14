import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importInstructionsRegistry = async () => {
	vi.resetModules();
	return import("../../src/core/instructions-registry");
};

function setLocalModeEnv(value: boolean) {
	process.env.YEHLE_LOCAL_TEMPLATES = value ? "true" : "false";
}

describe("core/instructions-registry", () => {
	const originalEnv = { ...process.env };
	const tmpRoots: string[] = [];

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
		for (const dir of tmpRoots.splice(0)) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	function makeTempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join("/tmp", prefix));
		tmpRoots.push(dir);
		return dir;
	}

	describe("listAvailableInstructions", () => {
		it("returns instruction names from .md files in templates/instructions/essential/", async () => {
			setLocalModeEnv(true);
			const { listAvailableInstructions } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const essentialDir = path.join(
				projectRoot,
				"templates",
				"instructions",
				"essential",
			);
			fs.mkdirSync(essentialDir, { recursive: true });
			fs.writeFileSync(path.join(essentialDir, "react-vite.md"), "# React", "utf8");
			fs.writeFileSync(path.join(essentialDir, "general.md"), "# General", "utf8");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const rules = await listAvailableInstructions("essential");
				expect(rules).toContain("react-vite");
				expect(rules).toContain("general");
				expect(rules).toHaveLength(2);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns instruction names from .mdc files", async () => {
			setLocalModeEnv(true);
			const { listAvailableInstructions } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const essentialDir = path.join(
				projectRoot,
				"templates",
				"instructions",
				"essential",
			);
			fs.mkdirSync(essentialDir, { recursive: true });
			fs.writeFileSync(path.join(essentialDir, "react-vite.mdc"), "# React", "utf8");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const rules = await listAvailableInstructions("essential");
				expect(rules).toContain("react-vite");
				expect(rules).toHaveLength(1);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns instruction names from templates/<lang>/instructions/ for language", async () => {
			setLocalModeEnv(true);
			const { listAvailableInstructions } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const langDir = path.join(
				projectRoot,
				"templates",
				"typescript",
				"instructions",
			);
			fs.mkdirSync(langDir, { recursive: true });
			fs.writeFileSync(
				path.join(langDir, "typescript.md"),
				"# TS",
				"utf8",
			);

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const rules = await listAvailableInstructions("language", {
					lang: "typescript",
				});
				expect(rules).toContain("typescript");
				expect(rules).toHaveLength(1);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns instruction names from templates/instructions/<category>/", async () => {
			setLocalModeEnv(true);
			const { listAvailableInstructions } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const essentialDir = path.join(
				projectRoot,
				"templates",
				"instructions",
				"essential",
			);
			fs.mkdirSync(essentialDir, { recursive: true });
			fs.writeFileSync(
				path.join(essentialDir, "custom-rule.md"),
				"# Custom",
				"utf8",
			);

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const rules = await listAvailableInstructions("essential");
				expect(rules).toContain("custom-rule");
				expect(rules).toHaveLength(1);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns instruction names from templates/<lang>/<projectSpec>/<template>/instructions/ for template category", async () => {
			setLocalModeEnv(true);
			const { listAvailableInstructions } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const templateDir = path.join(
				projectRoot,
				"templates",
				"typescript",
				"package",
				"basic",
				"instructions",
			);
			fs.mkdirSync(templateDir, { recursive: true });
			fs.writeFileSync(
				path.join(templateDir, "my-template.md"),
				"# Template",
				"utf8",
			);

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const rules = await listAvailableInstructions("template", {
					lang: "typescript",
					projectSpec: "package",
					template: "basic",
				});
				expect(rules).toContain("my-template");
				expect(rules).toHaveLength(1);
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("returns empty array when category directory does not exist", async () => {
			setLocalModeEnv(true);
			const { listAvailableInstructions } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			fs.mkdirSync(path.join(projectRoot, "templates"), { recursive: true });
			// No templates/instructions/essential/

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const rules = await listAvailableInstructions("essential");
				expect(rules).toEqual([]);
			} finally {
				process.chdir(originalCwd);
			}
		});
	});

	describe("resolveInstructionsCategoryDir", () => {
		it("throws a descriptive error when local category directory is not found", async () => {
			setLocalModeEnv(true);
			const { resolveInstructionsCategoryDir } =
				await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			fs.mkdirSync(path.join(projectRoot, "templates"), {
				recursive: true,
			});
			// No templates/instructions/essential/

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				await expect(
					resolveInstructionsCategoryDir("essential"),
				).rejects.toThrow(/Local instructions not found for category "essential"/);
				await expect(
					resolveInstructionsCategoryDir("essential"),
				).rejects.toThrow(/templates\/instructions\/essential/);
			} finally {
				process.chdir(originalCwd);
			}
		});
	});

	describe("getInstructionWithFrontmatter", () => {
		it("returns content and normalized frontmatter (alwaysOn normalized to alwaysApply)", async () => {
			setLocalModeEnv(true);
			const { getInstructionWithFrontmatter } =
				await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const essentialDir = path.join(
				projectRoot,
				"templates",
				"instructions",
				"essential",
			);
			fs.mkdirSync(essentialDir, { recursive: true });
			const raw = `---
description: "My rule"
globs: ["**/*.ts"]
alwaysOn: true
---

# Body`;
			fs.writeFileSync(path.join(essentialDir, "rule.md"), raw, "utf8");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const { content, frontmatter } =
					await getInstructionWithFrontmatter("essential", "rule");
				expect(content).toContain("# Body");
				expect(frontmatter.description).toBe("My rule");
				expect(frontmatter.globs).toEqual(["**/*.ts"]);
				expect(frontmatter.alwaysApply).toBe(true);
			} finally {
				process.chdir(originalCwd);
			}
		});
	});

	describe("getInstructionContent", () => {
		it("reads content from .md file and strips frontmatter", async () => {
			setLocalModeEnv(true);
			const { getInstructionContent } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const essentialDir = path.join(
				projectRoot,
				"templates",
				"instructions",
				"essential",
			);
			fs.mkdirSync(essentialDir, { recursive: true });
			const raw = `---
description: "react vite"
globs: ["**/*"]
alwaysApply: true
---

# My Rule

Content here.`;
			fs.writeFileSync(path.join(essentialDir, "react-vite.md"), raw, "utf8");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				const result = await getInstructionContent(
					"essential",
					"react-vite",
				);
				expect(result).toContain("# My Rule");
				expect(result).toContain("Content here.");
				expect(result).not.toContain("---");
			} finally {
				process.chdir(originalCwd);
			}
		});

		it("throws when instruction name is not found in category", async () => {
			setLocalModeEnv(true);
			const { getInstructionContent } = await importInstructionsRegistry();
			const projectRoot = makeTempDir("yehle-instructions-");
			const essentialDir = path.join(
				projectRoot,
				"templates",
				"instructions",
				"essential",
			);
			fs.mkdirSync(essentialDir, { recursive: true });
			fs.writeFileSync(path.join(essentialDir, "other.md"), "# Other", "utf8");

			const originalCwd = process.cwd();
			process.chdir(projectRoot);

			try {
				await expect(
					getInstructionContent("essential", "nonexistent"),
				).rejects.toThrow(/Instruction "nonexistent" not found/);
			} finally {
				process.chdir(originalCwd);
			}
		});
	});
});
