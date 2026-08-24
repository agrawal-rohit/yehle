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

- `registry.json` (or `registryFileName`) — index (identity is the `items` map key; each item may declare `source`, `packs`, and/or `beforeInstall` / `afterInstall`)
- `r/{itemId}.json` or `r/{itemId}/{packId}.json` — compiled items with `target`, inlined template `content`, and `dependencies` keyed by ecosystem
- `r/{itemId}.beforeInstall.{index}.js` / `r/{itemId}.afterInstall.{index}.js` — bundled install scripts (local registries only at install time)
- `r/_handlers/{key}.handler.js` — bundled condition handlers

Consumers join index `source` values against the index location with `joinIndexSource`. Install scripts are loaded by `runBeforeInstallHook` / `runAfterInstallHook`. The npm package manager is selected by core at install time (lockfile detection, otherwise a prompt) and passed into planning, interpolation (`packageManager`, `pmRun`, `pmExec`, `pmInstall`, `pmPublish`), hooks, and installs. Pack `when.packageManager` matches that selection; registries may also declare a normal `packageManager` condition if they want.

## Validate compiled output

- `parseRegistryDocument` — validate the compiled index (`registry.json`)
- `parseWithSchema(compiledItemSchema, …)` — validate a compiled item
- `import type { BeforeInstallHook }` / `import type { ConditionHandler }` — typed hook contracts (prefer `import type` so bundles stay self-contained)

## Install lifecycle

Each item has two optional phases: `beforeInstall` (prompts, file generation, setup before writes) and `afterInstall` (side effects after writes). Each phase accepts colocated script paths. Other registry items belong in `registryDependencies`. The CLI runs `beforeInstall` scripts, confirms overwrites, writes compiled items, then runs `afterInstall` scripts in plan order.
