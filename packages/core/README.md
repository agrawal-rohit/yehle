# @tuckshop/core

Shared primitives and utilities for building and consuming `tuckshop` registries.

This package powers the default [`tuckshop`](https://www.npmjs.com/package/tuckshop) CLI and [`@tuckshop/registry`](../registry) content.

## Compile a registry

Third-party authors compile an authoring tree into a consumable catalog plus per-variant install payloads:

```ts
import { buildRegistry } from "@tuckshop/core";

await buildRegistry({
	sourceDir: "/path/to/my-registry/registry",
	outDir: "/path/to/my-registry",
});
```

That writes a fixed artefact layout under `outDir` (authors only control the `sourceDir` tree):

- `registry.json` — lean catalog metadata (each compiled variant includes a relative `payload` of `r/{itemId}/{variantId}.json`)
- `r/{itemId}/{variantId}.json` — per-variant install payloads with inlined template `content`

Consumers resolve those relative `payload` values against the catalog location (`resolveRegistryPayload`).

## Validate artefacts

- `parseRegistryDocument` — validate a compiled `registry.json`
- `parseWithSchema(registryPayloadSchema, …)` — validate a variant payload document
