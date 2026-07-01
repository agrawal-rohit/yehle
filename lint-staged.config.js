/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
	// Only run Biome on code/config files that Biome actually processes (see biome.json).
	"src/**/*.{js,ts,jsx,tsx,cjs,mjs,json,css}": "pnpm check",
	"docs/**/*.{js,ts,jsx,tsx,mjs,json,css}": "pnpm exec biome check --write --no-errors-on-unmatched",
	// Recompile the built registry to the repo root whenever any registry item
	// (manifest or source file) changes, and stage the regenerated index.
	"registry/**/*": () => "pnpm run build:registry && git add registry.json",
	"scripts/build-registry.ts": () =>
		"pnpm run build:registry && git add registry.json",
};
