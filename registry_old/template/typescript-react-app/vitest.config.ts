import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	test: {
		environment: "happy-dom",
		globals: true,
		setupFiles: "./test-setup.ts",
		exclude: [...configDefaults.exclude],
		coverage: {
			reporter: ["text", "lcov", "html"],
			exclude: [
				...(configDefaults.coverage.exclude || []),
				"**/commitlint.config.js",
				"**/lint-staged.config.js",
			],
		},
	},
});
