import { describe, expect, it } from "vitest";
import {
	buildPackageInstallCommands,
	ecosystemManagers,
	inferPackageManagerFromLockfile,
	mergeRegistryPackages,
	NpmPackageManager,
} from "./packages";
import { RegistryEcosystem } from "./schema";

describe("core/packages", () => {
	describe("mergeRegistryPackages", () => {
		it("merges package sets per ecosystem and deduplicates names", () => {
			expect(
				mergeRegistryPackages(
					{
						npm: { devDependencies: ["vitest@^3"] },
					},
					{
						npm: { devDependencies: ["@vitest/coverage-v8@^3"] },
					},
				),
			).toEqual({
				npm: {
					devDependencies: ["@vitest/coverage-v8@^3", "vitest@^3"],
				},
			});
		});

		it("unions runtime and dev dependencies across sources", () => {
			expect(
				mergeRegistryPackages(
					{ npm: { dependencies: ["react"], devDependencies: ["vitest"] } },
					{ npm: { dependencies: ["react", "zod"] } },
				),
			).toEqual({
				npm: {
					dependencies: ["react", "zod"],
					devDependencies: ["vitest"],
				},
			});
		});

		it("keeps only the non-empty dependency list when the other side is blank", () => {
			expect(
				mergeRegistryPackages(
					{ npm: { dependencies: ["left-pad"] } },
					{ npm: { dependencies: [], devDependencies: [] } },
				),
			).toEqual({
				npm: { dependencies: ["left-pad"] },
			});
		});

		it("returns undefined when all sources are empty", () => {
			expect(mergeRegistryPackages(undefined, {})).toBeUndefined();
			expect(
				mergeRegistryPackages({ npm: { dependencies: [] } }, undefined),
			).toBeUndefined();
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

	describe("inferPackageManagerFromLockfile", () => {
		it("infers bun when bun.lock is present", () => {
			expect(
				inferPackageManagerFromLockfile(
					"/project",
					RegistryEcosystem.NPM,
					(filePath) => filePath.endsWith("bun.lock"),
				),
			).toBe(NpmPackageManager.BUN);
		});

		it("returns undefined when multiple npm lockfiles are present", () => {
			expect(
				inferPackageManagerFromLockfile(
					"/project",
					RegistryEcosystem.NPM,
					(filePath) =>
						filePath.endsWith("bun.lock") ||
						filePath.endsWith("pnpm-lock.yaml"),
				),
			).toBeUndefined();
		});

		it("returns undefined when no lockfile is present", () => {
			expect(
				inferPackageManagerFromLockfile(
					"/project",
					RegistryEcosystem.NPM,
					() => false,
				),
			).toBeUndefined();
		});

		it("does not infer npm from package.json alone", () => {
			expect(
				inferPackageManagerFromLockfile(
					"/project",
					RegistryEcosystem.NPM,
					(filePath) => filePath.endsWith("package.json"),
				),
			).toBeUndefined();
		});
	});

	describe("buildPackageInstallCommands", () => {
		it("builds pnpm dev dependency commands", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.PNPM,
					{ devDependencies: ["vitest@^3"] },
				),
			).toEqual(["pnpm add -D vitest@^3"]);
		});

		it("builds npm runtime and dev commands", () => {
			expect(
				buildPackageInstallCommands(
					RegistryEcosystem.NPM,
					NpmPackageManager.NPM,
					{
						dependencies: ["react"],
						devDependencies: ["vitest@^3"],
					},
				),
			).toEqual(["npm install react", "npm install -D vitest@^3"]);
		});

		it("builds a command for every manager listed for the ecosystem", () => {
			for (const spec of ecosystemManagers[RegistryEcosystem.NPM]) {
				expect(
					buildPackageInstallCommands(RegistryEcosystem.NPM, spec.manager, {
						dependencies: ["left-pad"],
					}),
				).toHaveLength(1);
			}
		});
	});
});
