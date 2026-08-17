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

- `registry.json` — compact catalog index (identity is the `items` map key; each item or variant has a `source` payload URI of `r/{itemId}.json` or `r/{itemId}/{variantId}.json`)
- `r/{itemId}.json` or `r/{itemId}/{variantId}.json` — compact install payloads with `target`, inlined template `content`, and npm dependencies

Consumers resolve those catalog `source` values against the catalog location (`resolveRegistryPayload`).

## Validate artefacts

- `parseRegistryDocument` — validate a compiled `registry.json`
- `parseWithSchema(registryPayloadSchema, …)` — validate a payload document
