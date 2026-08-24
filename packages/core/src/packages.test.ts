import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildPackageInstallCommands,
	detectPackageManagerFromLockfile,
	ecosystemManagers,
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
	NpmPackageManager,
} from "./packages";
import { RegistryEcosystem } from "./schema";

describe("core/packages", () => {
	describe("mergeEcosystemMaps with mergeDependencySet", () => {
		it("merges dependency sets per ecosystem and deduplicates names", () => {
			expect(
				mergeEcosystemMaps(
					mergeDependencySet,
					{ npm: { dev: ["vitest@^3"] } },
					{ npm: { dev: ["@vitest/coverage-v8@^3"] } },
				),
			).toEqual({
				npm: {
					dev: ["@vitest/coverage-v8@^3", "vitest@^3"],
				},
			});
		});

		it("unions runtime and dev dependencies across sources", () => {
			expect(
				mergeEcosystemMaps(
					mergeDependencySet,
					{ npm: { runtime: ["react"], dev: ["vitest"] } },
					{ npm: { runtime: ["react", "zod"] } },
				),
			).toEqual({
				npm: {
					runtime: ["react", "zod"],
					dev: ["vitest"],
				},
			});
		});

		it("keeps only the non-empty dependency list when the other side is blank", () => {
			expect(
				mergeEcosystemMaps(
					mergeDependencySet,
					{ npm: { runtime: ["left-pad"] } },
					{ npm: { runtime: [], dev: [] } },
				),
			).toEqual({
				npm: { runtime: ["left-pad"] },
			});
		});

		it("returns undefined when all sources are empty", () => {
			expect(
				mergeEcosystemMaps(mergeDependencySet, undefined, {}),
			).toBeUndefined();
			expect(
				mergeEcosystemMaps(
					mergeDependencySet,
					{ npm: { runtime: [] } },
					undefined,
				),
			).toBeUndefined();
		});
	});

	describe("mergeEcosystemMaps with mergeCommandSet", () => {
		it("merges command maps and lets later sources overwrite keys", () => {
			expect(
				mergeEcosystemMaps(
					mergeCommandSet,
					{ npm: { test: "vitest run", lint: "biome check" } },
					{ npm: { test: "vitest run --coverage" } },
				),
			).toEqual({
				npm: {
					test: "vitest run --coverage",
					lint: "biome check",
				},
			});
		});

		it("returns undefined when all sources are empty", () => {
			expect(
				mergeEcosystemMaps(mergeCommandSet, undefined, {}),
			).toBeUndefined();
			expect(mergeCommandSet({}, {})).toBeUndefined();
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

		it("uses fs.existsSync when no path checker is provided", () => {
			expect(
				detectPackageManagerFromLockfile(
					path.join(import.meta.dirname, "..", "..", ".."),
					RegistryEcosystem.NPM,
				),
			).toEqual({ manager: "pnpm", lockfile: "pnpm-lock.yaml" });
		});
	});

	describe("buildPackageInstallCommands", () => {
		it("builds runtime and dev install commands", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.NPM,
					{ runtime: ["zod"], dev: ["vitest@^3"] },
				),
			).toEqual(["npm install zod", "npm install -D vitest@^3"]);
		});

		it("treats a missing runtime list as empty", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.NPM,
					{ dev: ["vitest@^3"] },
				),
			).toEqual(["npm install -D vitest@^3"]);
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

		it("builds pnpm, yarn, and bun install commands", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.PNPM,
					{ runtime: ["zod"] },
				),
			).toEqual(["pnpm add zod"]);
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.YARN,
					{ runtime: ["zod"] },
				),
			).toEqual(["yarn add zod"]);
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.BUN,
					{ runtime: ["zod"] },
				),
			).toEqual(["bun add zod"]);
		});
	});
});
