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

- `registry.json` — compact catalog index (identity is the `items` map key; each item may declare `source`, `variants`, and/or `handler`)
- `r/{itemId}.json` or `r/{itemId}/{variantId}.json` — compact install payloads with `target`, inlined template `content`, and `dependencies` keyed by ecosystem
- `r/{itemId}.handler.js` / `r/_handlers/{key}.handler.js` — bundled item and condition handlers (local catalogs only at install time)

Consumers resolve those catalog `source` / `handler` values against the catalog location (`resolveRegistryPayload` / `resolveLocalHandlerPath`).

## Validate artefacts

- `parseRegistryDocument` — validate a compiled `registry.json`
- `parseWithSchema(registryPayloadSchema, …)` — validate a payload document
- `import type { ItemHandler }` / `import type { ConditionHandler }` — typed handler contracts (prefer `import type` so the bundle stays self-contained)
