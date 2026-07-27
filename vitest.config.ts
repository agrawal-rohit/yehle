import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Match Jest's node environment
		environment: "node",
		// Enable Jest-style global APIs (describe, test, expect) without imports
		globals: true,
		// Preserve Vitest's default excludes (already includes node_modules, etc.)
		exclude: [
			...configDefaults.exclude,
			"packages/*/dist/**",
			"packages/registry/registry/**",
			"**/.stryker-tmp/**",
		],
		coverage: {
			reporter: ["text", "lcov", "html"],
			thresholds: {
				lines: 45,
			},
			exclude: [
				...(configDefaults.coverage.exclude || []),
				"packages/*/dist/**",
				"packages/registry/registry/**",
				"**/commitlint.config.*",
				"**/lint-staged.config.js",
				"packages/cli/bin/**",
				"**/docs/**",
				"**/stryker.config.mjs",
			],
		},
	},
});
