/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
	// Only run Biome on code/config files that Biome actually processes (see biome.json).
	"packages/**/*.{js,ts,jsx,tsx,cjs,mjs,json,css}": "pnpm check",
	"docs/**/*.{js,ts,jsx,tsx,mjs,json,css}": "pnpm exec biome check --write --no-errors-on-unmatched",
	// Rebuild packages/registry/registry.json whenever registry content or the build script changes,
	"packages/registry/registry/**/*": () =>
		"pnpm run build:registry && pnpm exec biome check --write packages/registry/registry.json && git add packages/registry/registry.json",
	"packages/registry/scripts/{build,builder}.ts": () =>
		"pnpm run build:registry && pnpm exec biome check --write packages/registry/registry.json && git add packages/registry/registry.json",
};
