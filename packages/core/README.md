# @tuckshop/core

Shared primitives and utilities for building and consuming `tuckshop` registries.

This package powers the default [`tuckshop`](https://www.npmjs.com/package/tuckshop) CLI and [`@tuckshop/registry`](../registry) content.

## Compile a registry

Third-party authors compile an authoring tree into a consumable catalog plus install payloads:

```ts
import { buildRegistry } from "@tuckshop/core";

await buildRegistry({
	sourceDir: "/path/to/my-registry/registry",
	outDir: "/path/to/my-registry",
});
```

That writes a fixed artefact layout under `outDir` (authors only control the `sourceDir` tree):

- `registry.json` — compact catalog index (identity is the `items` map key; each item may declare `source`, `variants`, and/or `beforeInstall` / `afterInstall`)
- `r/{itemId}.json` or `r/{itemId}/{variantId}.json` — compact install payloads with `target`, inlined template `content`, and `dependencies` keyed by ecosystem
- `r/{itemId}.beforeInstall.{index}.js` / `r/{itemId}.afterInstall.{index}.js` — bundled install scripts (local catalogs only at install time)
- `r/_handlers/{key}.handler.js` — bundled condition handlers

Consumers join catalog `source` values against the catalog location with `joinCatalogSource`. Install scripts are loaded by `runBeforeInstallHook` / `runAfterInstallHook`.

## Validate artefacts

- `parseRegistryDocument` — validate a compiled `registry.json`
- `parseWithSchema(registryPayloadSchema, …)` — validate a payload document
- `import type { BeforeInstallHook }` / `import type { ConditionHandler }` — typed hook contracts (prefer `import type` so bundles stay self-contained)

## Install lifecycle

Each item has two optional phases: `beforeInstall` (prompts, file generation, setup before writes) and `afterInstall` (side effects after writes). Each phase accepts colocated script paths. Other registry items belong in `registryDependencies`. The CLI runs `beforeInstall` scripts, confirms overwrites, writes payloads, then runs `afterInstall` scripts in plan order.
