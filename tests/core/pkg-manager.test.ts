import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ensurePackageManager,
	getInstallScript,
	LANGUAGE_PACKAGE_MANAGER,
	LANGUAGE_PACKAGE_REGISTRY,
	type PackageManager,
	validatePackageName,
} from "../../src/core/pkg-manager";
import * as shell from "../../src/core/shell";
import { Language } from "../../src/resources/package/config";

describe("core/pkg-manager", () => {
	describe("LANGUAGE_PACKAGE_MANAGER", () => {
		it("maps TypeScript to pnpm", () => {
			expect(LANGUAGE_PACKAGE_MANAGER[Language.TYPESCRIPT]).toBe("pnpm");
		});
	});

	describe("LANGUAGE_PACKAGE_REGISTRY", () => {
		it("maps TypeScript to NPM", () => {
			expect(LANGUAGE_PACKAGE_REGISTRY[Language.TYPESCRIPT]).toBe("NPM");
		});
	});

	describe("validatePackageName", () => {
		let validateTsSpy: any;

		beforeEach(async () => {
			const tsModule: any = await import(
				"../../src/resources/package/typescript"
			);
			validateTsSpy = vi.spyOn(
				tsModule,
				"validateTypescriptPackageName",
			) as any;
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("does not throw for a valid TypeScript package name", () => {
			(validateTsSpy as any).mockReturnValue(true);

			expect(() =>
				validatePackageName("valid-pkg", Language.TYPESCRIPT),
			).not.toThrow();

			expect(validateTsSpy).toHaveBeenCalledWith("valid-pkg");
		});

		it("throws with provided string message for invalid TypeScript name", () => {
			(validateTsSpy as any).mockReturnValue("name is invalid");

			expect(() =>
				validatePackageName("invalid-pkg", Language.TYPESCRIPT),
			).toThrowError("name is invalid");
		});

		it('throws generic "Invalid package name" when validator returns non-true non-string', () => {
			(validateTsSpy as any).mockReturnValue({ reason: "bad" } as any);

			expect(() =>
				validatePackageName("invalid-pkg", Language.TYPESCRIPT),
			).toThrowError("Invalid package name");
		});

		it("throws for unsupported language", () => {
			// Create a fake language value outside the supported enum
			const unsupportedLanguage = 999 as unknown as Language;

			expect(() =>
				validatePackageName("some-name", unsupportedLanguage),
			).toThrowError(`Unsupported language: ${unsupportedLanguage}`);
		});
	});

	describe("ensurePackageManager", () => {
		let commandExistsSpy: any;
		let runAsyncSpy: any;

		beforeEach(() => {
			commandExistsSpy = vi.spyOn(shell as any, "commandExistsAsync") as any;
			runAsyncSpy = vi.spyOn(shell as any, "runAsync") as any;
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("throws if pnpm is not installed", async () => {
			(commandExistsSpy as any).mockResolvedValue(false);

			await expect(
				ensurePackageManager("pnpm" as PackageManager),
			).rejects.toThrowError(
				"pnpm is not installed. Please install PNPM and re-run.",
			);

			expect(commandExistsSpy).toHaveBeenCalledWith("pnpm");
			expect(runAsyncSpy).not.toHaveBeenCalled();
		});

		it("returns pnpm with version when pnpm is installed", async () => {
			(commandExistsSpy as any).mockResolvedValue(true);
			(runAsyncSpy as any).mockResolvedValue("9.1.0");

			const result = await ensurePackageManager("pnpm" as PackageManager);

			expect(result).toBe("pnpm@9.1.0");
			expect(commandExistsSpy).toHaveBeenCalledWith("pnpm");
			expect(runAsyncSpy).toHaveBeenCalledWith("pnpm --version");
		});

		it("throws for unsupported package manager", async () => {
			await expect(
				// Cast to bypass type restriction and test runtime behavior
				ensurePackageManager("npm" as PackageManager),
			).rejects.toThrowError("Unsupported package manager: npm");
		});
	});

	describe("getInstallScript", () => {
		it("returns pnpm install command for pnpm", () => {
			const script = getInstallScript("pnpm" as PackageManager);
			expect(script).toBe("pnpm install");
		});

		it("throws for unsupported package manager", () => {
			expect(() => getInstallScript("npm" as PackageManager)).toThrowError(
				"Unsupported package manager: npm",
			);
		});
	});
});
