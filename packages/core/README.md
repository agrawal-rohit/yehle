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

- `registry.json` — lean catalog metadata (each compiled file `source` is a relative payload URI of `r/{itemId}.json` or `r/{itemId}/{variantId}.json`)
- `r/{itemId}.json` or `r/{itemId}/{variantId}.json` — install payloads with `target` and inlined template `content`

Consumers resolve those catalog file `source` values against the catalog location (`resolveRegistryPayload`).

## Validate artefacts

- `parseRegistryDocument` — validate a compiled `registry.json`
- `parseWithSchema(registryPayloadSchema, …)` — validate a payload document
