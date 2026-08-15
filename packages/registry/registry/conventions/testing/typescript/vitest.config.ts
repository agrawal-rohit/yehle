import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		exclude: [
			...configDefaults.exclude,
			"**/dist/**",
			"**/.stryker-tmp/**",
		],
		coverage: {
			reporter: ["text", "lcov", "html"],
			thresholds: {
				lines: 45,
			},
			exclude: [
				...(configDefaults.coverage.exclude || []),
				"**/coverage/**",
				"**/dist/**",
			],
		},
	},
});
