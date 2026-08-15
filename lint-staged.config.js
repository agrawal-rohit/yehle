/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */

/** Rebuild the catalog and stage the generated `registry.json`. */
function rebuildRegistryCommands() {
	return [
		"pnpm run build:registry",
		"pnpm exec biome check --write packages/registry/registry.json",
		"git add packages/registry/registry.json",
	];
}

export default {
	// Only run Biome on code/config files that Biome actually processes (see biome.json).
	"packages/**/*.{js,ts,jsx,tsx,cjs,mjs,json,css}": "pnpm check",
	"docs/**/*.{js,ts,jsx,tsx,mjs,json,css}":
		"pnpm exec biome check --write --no-errors-on-unmatched",
	// Rebuild packages/registry/registry.json whenever registry content or the build script changes.
	"packages/registry/registry/**/*": () => rebuildRegistryCommands(),
	"packages/registry/scripts/{build,builder}.ts": () =>
		rebuildRegistryCommands(),
};
