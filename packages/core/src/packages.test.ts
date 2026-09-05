import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	assertUniqueCompiledItemTargets,
	buildPackageInstallCommands,
	compiledItem,
	compiledItemUsesEcosystem,
	detectPackageManagerFromLockfile,
	ecosystemManagers,
	foldCompiledItems,
	isPackageManagerForEcosystem,
	mergeCommandSet,
	mergeCompiledItemFields,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
	NpmPackageManager,
	packageManagerBindings,
	packageManagerSpec,
	reservedInterpolationKeys,
	selectPackageManager,
	uniqueSorted,
} from "./packages";
import { RegistryEcosystem } from "./schema";

describe("core/packages", () => {
	describe("mergeEcosystemMaps with mergeDependencySet", () => {
		it("merges runtime and dev lists per ecosystem", () => {
			expect(
				mergeEcosystemMaps(
					mergeDependencySet,
					{ npm: { runtime: ["zod"], dev: ["vitest"] } },
					{ npm: { runtime: ["chalk"], dev: ["vitest"] } },
				),
			).toEqual({
				npm: {
					runtime: ["chalk", "zod"],
					dev: ["vitest"],
				},
			});
		});

		it("drops empty ecosystems after merge", () => {
			expect(
				mergeEcosystemMaps(
					mergeDependencySet,
					{ npm: { runtime: ["zod"] } },
					{ npm: { runtime: [] } },
				),
			).toEqual({ npm: { runtime: ["zod"] } });
			expect(
				mergeEcosystemMaps(mergeDependencySet, undefined, {
					npm: { runtime: [], dev: [] },
				}),
			).toBeUndefined();
		});

		it("rejects empty and flag-like package names", () => {
			expect(() => mergeDependencySet({ runtime: [""] }, undefined)).toThrow(
				"Package name must not be empty.",
			);
			expect(() =>
				mergeDependencySet({ runtime: ["--ignore-scripts"] }, undefined),
			).toThrow('Package name "--ignore-scripts" is not allowed.');
		});

		it("returns undefined for empty inputs", () => {
			expect(
				mergeEcosystemMaps(mergeDependencySet, undefined, {}),
			).toBeUndefined();
			expect(
				mergeEcosystemMaps(mergeDependencySet, { npm: undefined }, undefined),
			).toBeUndefined();
		});
	});

	describe("mergeEcosystemMaps with mergeCommandSet", () => {
		it("later sources overwrite earlier command keys", () => {
			expect(
				mergeEcosystemMaps(
					mergeCommandSet,
					{ npm: { test: "jest", lint: "biome" } },
					{ npm: { test: "vitest" } },
				),
			).toEqual({ npm: { test: "vitest", lint: "biome" } });
		});

		it("returns undefined when both sides are empty", () => {
			expect(
				mergeEcosystemMaps(mergeCommandSet, undefined, {}),
			).toBeUndefined();
		});

		it("rejects empty and __proto__ command names", () => {
			expect(() => mergeCommandSet({ "": "vitest" }, undefined)).toThrow(
				"Command name must not be empty.",
			);
			expect(() =>
				mergeCommandSet(
					JSON.parse('{"__proto__":"x"}') as Record<string, string>,
					undefined,
				),
			).toThrow('Command "__proto__" is not allowed.');
		});

		it("rejects an empty command string", () => {
			expect(() => mergeCommandSet({ test: "" }, undefined)).toThrow(
				'Command "test" must be a non-empty string.',
			);
		});
	});

	describe("mergeSecretNames", () => {
		it("dedupes and sorts secret names", () => {
			expect(
				mergeSecretNames(["SONAR_TOKEN", "GH_ADMIN_TOKEN"], ["SONAR_TOKEN"]),
			).toEqual(["GH_ADMIN_TOKEN", "SONAR_TOKEN"]);
		});

		it("returns undefined when no names are present", () => {
			expect(mergeSecretNames(undefined, [])).toBeUndefined();
		});

		it("rejects an empty secret name", () => {
			expect(() => mergeSecretNames([""])).toThrow(
				"Secret name must not be empty.",
			);
		});
	});

	describe("uniqueSorted", () => {
		it("dedupes and sorts strings", () => {
			expect(uniqueSorted(["b", "a", "b"])).toEqual(["a", "b"]);
		});
	});

	describe("compiledItem", () => {
		it("omits absent optional fields", () => {
			expect(compiledItem({ files: [] })).toEqual({ files: [] });
			expect(
				compiledItem({
					files: [],
					secrets: ["GH_ADMIN_TOKEN"],
				}),
			).toEqual({ files: [], secrets: ["GH_ADMIN_TOKEN"] });
		});
	});

	describe("foldCompiledItems", () => {
		it("concatenates files and merges manifests", () => {
			expect(
				foldCompiledItems(
					[
						{
							files: [{ target: "a.ts", content: "a" }],
							dependencies: { npm: { runtime: ["zod"] } },
							secrets: ["GH_ADMIN_TOKEN"],
						},
						{
							files: [{ target: "b.ts", content: "b" }],
							dependencies: { npm: { dev: ["vitest"] } },
							secrets: ["GH_ADMIN_TOKEN"],
						},
					],
					(target) => `duplicate ${target}`,
				),
			).toEqual({
				files: [
					{ target: "a.ts", content: "a" },
					{ target: "b.ts", content: "b" },
				],
				dependencies: { npm: { runtime: ["zod"], dev: ["vitest"] } },
				secrets: ["GH_ADMIN_TOKEN"],
			});
		});

		it("throws when two files share a target", () => {
			expect(() =>
				foldCompiledItems(
					[
						{ files: [{ target: "README.md", content: "a" }] },
						{ files: [{ target: "README.md", content: "b" }] },
					],
					(target) => `duplicate ${target}`,
				),
			).toThrow("duplicate README.md");
		});
	});

	describe("mergeCompiledItemFields", () => {
		it("merges item and pack manifests without files", () => {
			expect(
				mergeCompiledItemFields(
					{ secrets: ["GH_ADMIN_TOKEN"] },
					{ secrets: ["SONAR_TOKEN"], commands: { npm: { test: "vitest" } } },
				),
			).toEqual({
				commands: { npm: { test: "vitest" } },
				secrets: ["GH_ADMIN_TOKEN", "SONAR_TOKEN"],
			});
		});
	});

	describe("assertUniqueCompiledItemTargets", () => {
		it("accepts unique targets", () => {
			expect(() =>
				assertUniqueCompiledItemTargets(
					[{ target: "a.ts", content: "a" }],
					(target) => target,
				),
			).not.toThrow();
		});

		it("rejects an escaping file target", () => {
			expect(() =>
				assertUniqueCompiledItemTargets(
					[{ target: "../secret.txt", content: "x" }],
					(target) => target,
				),
			).toThrow(
				'Compiled item file target "../secret.txt" must be a relative path (no absolute paths, URLs, or "..").',
			);
		});
	});

	describe("ecosystemManagers", () => {
		it("lists npm managers for the npm ecosystem", () => {
			expect(
				ecosystemManagers[RegistryEcosystem.NPM].map((spec) => spec.manager),
			).toEqual([
				NpmPackageManager.NPM,
				NpmPackageManager.PNPM,
				NpmPackageManager.YARN,
				NpmPackageManager.BUN,
			]);
		});
	});

	describe("isPackageManagerForEcosystem", () => {
		it("accepts managers registered for the ecosystem", () => {
			expect(isPackageManagerForEcosystem(RegistryEcosystem.NPM, "pnpm")).toBe(
				true,
			);
			expect(isPackageManagerForEcosystem(RegistryEcosystem.NPM, "pip")).toBe(
				false,
			);
		});
	});

	describe("packageManagerSpec", () => {
		it("returns the matching ecosystem manager", () => {
			expect(
				packageManagerSpec(RegistryEcosystem.NPM, NpmPackageManager.PNPM)
					.manager,
			).toBe(NpmPackageManager.PNPM);
		});

		it("throws when the manager is not valid for the ecosystem", () => {
			expect(() =>
				packageManagerSpec(RegistryEcosystem.NPM, "pip" as NpmPackageManager),
			).toThrow('Package manager "pip" is not valid for ecosystem "npm".');
		});
	});

	describe("detectPackageManagerFromLockfile", () => {
		it("returns the manager when exactly one lockfile matches", () => {
			expect(
				detectPackageManagerFromLockfile(
					"/project",
					RegistryEcosystem.NPM,
					(absolutePath) => absolutePath.endsWith("pnpm-lock.yaml"),
				),
			).toEqual({
				manager: NpmPackageManager.PNPM,
				lockfile: "pnpm-lock.yaml",
			});
		});

		it("returns undefined when no lockfile matches", () => {
			expect(
				detectPackageManagerFromLockfile(
					"/project",
					RegistryEcosystem.NPM,
					() => false,
				),
			).toBeUndefined();
		});

		it("returns undefined when multiple lockfiles match", () => {
			expect(
				detectPackageManagerFromLockfile(
					"/project",
					RegistryEcosystem.NPM,
					(absolutePath) =>
						absolutePath.endsWith("package-lock.json") ||
						absolutePath.endsWith("pnpm-lock.yaml"),
				),
			).toBeUndefined();
		});

		it("rejects a relative project directory", () => {
			expect(() =>
				detectPackageManagerFromLockfile("project", RegistryEcosystem.NPM),
			).toThrow("Project directory must be an absolute path.");
		});

		it("uses fs.existsSync when no path checker is provided", () => {
			expect(
				detectPackageManagerFromLockfile(
					path.join(import.meta.dirname, "..", "..", ".."),
					RegistryEcosystem.NPM,
				),
			).toEqual({ manager: "pnpm", lockfile: "pnpm-lock.yaml" });
		});
	});

	describe("packageManagerBindings", () => {
		it("returns interpolation bindings for a manager", () => {
			expect(
				packageManagerBindings(RegistryEcosystem.NPM, NpmPackageManager.PNPM),
			).toEqual({
				pmRun: "pnpm",
				pmExec: "pnpm exec",
				pmInstall: "pnpm install --ignore-scripts --frozen-lockfile",
				pmPublish:
					"pnpm -r publish --provenance --access public --no-git-checks",
			});
		});
	});

	describe("reservedInterpolationKeys", () => {
		it("reserves packageManager and pm* bindings for the ecosystem", () => {
			expect(reservedInterpolationKeys(RegistryEcosystem.NPM)).toEqual([
				"packageManager",
				"pmRun",
				"pmExec",
				"pmInstall",
				"pmPublish",
			]);
		});
	});

	describe("compiledItemUsesEcosystem", () => {
		it("is true when runtime or dev dependencies are present", () => {
			expect(
				compiledItemUsesEcosystem(
					{ files: [], dependencies: { npm: { runtime: ["zod"] } } },
					RegistryEcosystem.NPM,
				),
			).toBe(true);
			expect(
				compiledItemUsesEcosystem(
					{ files: [], dependencies: { npm: { dev: ["vitest"] } } },
					RegistryEcosystem.NPM,
				),
			).toBe(true);
		});

		it("is true when package.json scripts are present", () => {
			expect(
				compiledItemUsesEcosystem(
					{ files: [], commands: { npm: { test: "vitest" } } },
					RegistryEcosystem.NPM,
				),
			).toBe(true);
		});

		it("is true when files interpolate package-manager bindings", () => {
			expect(
				compiledItemUsesEcosystem(
					{
						files: [
							{
								target: "dependabot.yml",
								content: "ecosystem: {{packageManager}}",
							},
						],
					},
					RegistryEcosystem.NPM,
				),
			).toBe(true);
			expect(
				compiledItemUsesEcosystem(
					{
						files: [{ target: "ci.yml", content: "run: {{pmRun}} test" }],
					},
					RegistryEcosystem.NPM,
				),
			).toBe(true);
		});

		it("is false when the payload has neither deps, commands, nor manager tags", () => {
			expect(
				compiledItemUsesEcosystem({ files: [] }, RegistryEcosystem.NPM),
			).toBe(false);
			expect(
				compiledItemUsesEcosystem(
					{ files: [], dependencies: { npm: { runtime: [] } } },
					RegistryEcosystem.NPM,
				),
			).toBe(false);
			expect(
				compiledItemUsesEcosystem(
					{
						files: [{ target: "README.md", content: "Hello {{authorName}}" }],
					},
					RegistryEcosystem.NPM,
				),
			).toBe(false);
		});
	});

	describe("selectPackageManager", () => {
		it("returns the lockfile manager without prompting", async () => {
			const select = vi.fn();
			await expect(
				selectPackageManager(
					RegistryEcosystem.NPM,
					"/project",
					{ select },
					(absolutePath) => absolutePath.endsWith("pnpm-lock.yaml"),
				),
			).resolves.toBe(NpmPackageManager.PNPM);
			expect(select).not.toHaveBeenCalled();
		});

		it("prompts when no lockfile matches", async () => {
			const select = vi.fn().mockResolvedValue(NpmPackageManager.YARN);
			await expect(
				selectPackageManager(
					RegistryEcosystem.NPM,
					"/project",
					{ select },
					() => false,
				),
			).resolves.toBe(NpmPackageManager.YARN);
			expect(select).toHaveBeenCalledWith(
				"Which package manager should be used for the project?",
				expect.objectContaining({
					options: expect.arrayContaining([
						{ label: "npm", value: "npm" },
						{ label: "Yarn", value: "yarn" },
					]),
				}),
				NpmPackageManager.NPM,
			);
		});

		it("rejects an unknown prompted manager", async () => {
			const select = vi.fn().mockResolvedValue("pip");
			await expect(
				selectPackageManager(
					RegistryEcosystem.NPM,
					"/project",
					{ select },
					() => false,
				),
			).rejects.toThrow('Unknown packageManager "pip"');
		});
	});

	describe("buildPackageInstallCommands", () => {
		it("builds runtime and dev install commands as argv", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.NPM,
					{ runtime: ["zod"], dev: ["vitest@^3"] },
				),
			).toEqual([
				{
					executable: "npm",
					args: ["install", "--ignore-scripts", "zod"],
					display: "npm install --ignore-scripts zod",
				},
				{
					executable: "npm",
					args: ["install", "--ignore-scripts", "-D", "vitest@^3"],
					display: "npm install --ignore-scripts -D vitest@^3",
				},
			]);
		});

		it("treats a missing runtime list as empty", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.NPM,
					{ dev: ["vitest@^3"] },
				),
			).toEqual([
				{
					executable: "npm",
					args: ["install", "--ignore-scripts", "-D", "vitest@^3"],
					display: "npm install --ignore-scripts -D vitest@^3",
				},
			]);
		});

		it("returns an empty list when there is nothing to install", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.NPM,
					{
						runtime: [],
						dev: [],
					},
				),
			).toEqual([]);
		});

		it("throws when the manager is not valid for the ecosystem", () => {
			expect(() =>
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					"pip" as NpmPackageManager,
					{ runtime: ["zod"] },
				),
			).toThrow('Package manager "pip" is not valid for ecosystem "npm".');
		});

		it("rejects a flag-like package name", () => {
			expect(() =>
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.NPM,
					{ runtime: ["-evil"] },
				),
			).toThrow('Package name "-evil" is not allowed.');
		});

		it("builds pnpm, yarn, and bun install commands", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.PNPM,
					{ runtime: ["zod"] },
				),
			).toEqual([
				{
					executable: "pnpm",
					args: ["add", "--ignore-scripts", "zod"],
					display: "pnpm add --ignore-scripts zod",
				},
			]);
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.YARN,
					{ runtime: ["zod"] },
				),
			).toEqual([
				{
					executable: "yarn",
					args: ["add", "--ignore-scripts", "zod"],
					display: "yarn add --ignore-scripts zod",
				},
			]);
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.BUN,
					{ runtime: ["zod"] },
				),
			).toEqual([
				{
					executable: "bun",
					args: ["add", "--ignore-scripts", "zod"],
					display: "bun add --ignore-scripts zod",
				},
			]);
		});
	});
});
