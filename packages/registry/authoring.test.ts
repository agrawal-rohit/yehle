import type {
	ConditionHandlerContext,
	InstallHookContext,
} from "@tuckshop/core";
import { describe, expect, it, vi } from "vitest";
import packageManagerHandler from "./registry/conditions/package-manager";
import licenseHandler from "./registry/configurations/license/handler";

/** Minimal hook context for registry beforeInstall contract tests. */
function hookContext(
	overrides: Partial<InstallHookContext> = {},
): InstallHookContext {
	return {
		projectDir: "/tmp/project",
		isFile: vi.fn(async () => false),
		readFile: vi.fn(async () => ""),
		run: vi.fn(async () => ""),
		itemId: "license-configuration",
		conditions: {},
		bindings: {},
		payload: { files: [] },
		...overrides,
	};
}

describe("registry authoring contracts", () => {
	it("package-manager infer returns a unique lockfile manager", async () => {
		const ctx: ConditionHandlerContext = {
			projectDir: "/tmp/project",
			key: "packageManager",
			label: "Package manager",
			conditions: {},
			isFile: async (filePath) => filePath.endsWith("pnpm-lock.yaml"),
			readFile: vi.fn(async () => ""),
			run: vi.fn(async () => ""),
			values: [
				{ value: "npm", label: "npm" },
				{ value: "pnpm", label: "pnpm" },
			],
		};

		await expect(packageManagerHandler.infer?.(ctx)).resolves.toBe("pnpm");
	});

	it("license beforeInstall upserts LICENSE from captured conditions", async () => {
		const result = await licenseHandler(
			hookContext({
				conditions: {
					licenseId: "MIT",
					authorName: "Ada",
					copyrightYear: "2026",
				},
			}),
		);

		expect(result?.files).toHaveLength(1);
		expect(result?.files?.[0]?.target).toBe("LICENSE");
		expect(result?.files?.[0]?.content).toContain("MIT");
		expect(result?.files?.[0]?.content).toContain("2026");
		expect(result?.files?.[0]?.content).toContain("Ada");
	});

	it("license beforeInstall fails without licenseId", async () => {
		await expect(licenseHandler(hookContext())).rejects.toThrow(
			'Condition "licenseId" is required',
		);
	});
});
