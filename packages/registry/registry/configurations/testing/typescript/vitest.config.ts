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
				lines: {{coverageThreshold}},
				statements: {{coverageThreshold}},
				functions: {{coverageThreshold}},
				branches: {{coverageThreshold}},
			},
			exclude: [
				...(configDefaults.coverage.exclude || []),
				"**/coverage/**",
				"**/dist/**",
			],
		},
	},
});
