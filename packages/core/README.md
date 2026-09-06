# @tuckshop/core

Shared primitives and utilities for building and consuming `tuckshop` registries.

This package powers the default [`tuckshop`](https://www.npmjs.com/package/tuckshop) CLI and [`@tuckshop/registry`](../registry) content.

## Compile a registry

Third-party authors compile a registry source tree into an index plus compiled items:

```ts
import { buildRegistry } from "@tuckshop/core";

await buildRegistry({
	sourceDir: "/path/to/my-registry/registry",
	outDir: "/path/to/my-registry",
	registryFileName: "registry.json",
	// Optional layout overrides (defaults shown):
	// itemManifestFileName: "registry-item.json",
	// typesFileName: "types.json",
	// conditionsFileName: "conditions/conditions.json",
	// compiledDirName: "r",
	// bundleExternalPackages: ["acme-helpers"], // always includes @tuckshop/core
});
```

That writes compiled output under `outDir` (defaults match the paths below; override via options above):

- `registry.json` (or `registryFileName`) — index (identity is the `items` map key; each item may declare `source`, `packs`, and/or `beforeWrite` / `afterInstall`)
- `r/{itemId}.json` or `r/{itemId}/{packId}.json` — compiled items with `target`, inlined template `content`, and `dependencies` keyed by ecosystem
- `r/{itemId}.beforeWrite.{index}.js` / `r/{itemId}.afterInstall.{index}.js` — bundled install scripts (local registries only at install time)
- `r/_handlers/{key}.handler.js` — bundled condition handlers

Consumers join index `source` values against the index location with `joinIndexSource`. Install scripts are loaded by `runBeforeWriteHook` / `runAfterInstallHook`. The package manager for the npm ecosystem is selected by core at install time (lockfile detection, otherwise a prompt) and passed into planning, interpolation (`packageManager`, `pmRun`, `pmExec`, `pmInstall`, `pmPublish`), hooks, and installs. Pack `when.packageManager` matches that selection.

## Validate compiled output

- `parseRegistryDocument` — validate the compiled index (`registry.json`)
- `parseWithSchema(compiledItemSchema, …)` — validate a compiled item
- `import type { BeforeWriteHook }` / `import type { ConditionHandler }` — typed hook contracts (prefer `import type` so bundles stay self-contained)

## Install lifecycle

Each item has two optional phases: `beforeWrite` (generate or upsert files before writes) and `afterInstall` (side effects after package install). Each phase accepts script paths relative to the item folder (`..` is allowed as long as the file stays under the registry source). Other registry items belong in `dependsOn`. The CLI runs `beforeWrite` scripts, confirms overwrites, writes compiled items, merges `package.json` scripts, installs packages, then runs `afterInstall` scripts in plan order. `afterInstall` still runs if the user declines package install, and must not return a value.
