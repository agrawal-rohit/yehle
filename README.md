<div align="center">
  <img src="https://cdn.rohit-agrawal.com/work/tuckshop/logo.png" alt="Tuckshop" style="width: 30%; margin: auto" />
</div>

<br />

<div align="center">
  <p align="center" style="width: 80%; margin: auto">
    <img alt="Status" src="https://img.shields.io/github/actions/workflow/status/agrawal-rohit/tuckshop/ci.yml">
    <img alt="Coverage" src="https://img.shields.io/sonar/coverage/agrawal-rohit_tuckshop?server=https%3A%2F%2Fsonarcloud.io">
    <img alt="Downloads" src="https://img.shields.io/npm/dt/tuckshop">
    <img alt="Biome" src="https://img.shields.io/badge/code_style-biome-60a5fa">
    <img alt="License" src="https://img.shields.io/github/license/agrawal-rohit/tuckshop" />
  </p>
</div>

<div align="center">
  <p>An opinionated scaffolding CLI with a default registry and an authoring core.</p>
</div>

`tuckshop` eliminates repetitive project setup by providing opinionated templates with pre-configured tooling, best practices, and reusable registry items. Now as a monorepo, it ships with three complementary packages:

- **`tuckshop`**: the CLI users run via `npx` to scaffold projects and add components
- **`@tuckshop/core`**: shared internals and registry-document validation
- **`@tuckshop/registry`**: the private default registry content bundled into the CLI

By default, `npx tuckshop` uses the bundled registry from this repository. To point the CLI at a custom registry, use `--registry`, set the `TUCKSHOP_REGISTRY` environment variable, or persist a default with `tuckshop config set`.

## Quickstart

List available templates from the default registry:

```bash
npx tuckshop list
```

Add registry items to the current project:

```bash
npx tuckshop add pr-template-configuration
npx tuckshop add testing-configuration --overwrite
npx tuckshop add
```

Use a custom registry for one invocation:

```bash
npx tuckshop --registry https://example.com/registry.json list
```

Persist a default registry source (stored in `~/.config/tuckshop/config.json`):

```bash
npx tuckshop config set https://example.com/registry.json
npx tuckshop list
```

Inspect or clear the saved source:

```bash
npx tuckshop config get
npx tuckshop config unset
```

Or set it as an environment variable for all commands:

```bash
export TUCKSHOP_REGISTRY="https://example.com/registry.json"
npx tuckshop list
```

Registry source precedence: `--registry` flag > `TUCKSHOP_REGISTRY` env > saved config > bundled default.
## Workspace layout

```text
packages/
├── cli/        # published as `tuckshop`
├── core/       # published as `@tuckshop/core`
└── registry/   # private default registry content
docs/           # documentation site
```

## Building a custom registry

`@tuckshop/core` compiles, validates, and parses registry documents. Call `buildRegistry` with an authoring `sourceDir` (items, `types.json`, optional `conditions/conditions.json`) and an `outDir` for compiled artefacts:

```ts
import { buildRegistry, parseRegistryDocument } from "@tuckshop/core";

await buildRegistry({ sourceDir, outDir });
const registry = parseRegistryDocument(JSON.parse(registryJson));
```

That emits a compact `registry.json` catalog plus compact install payloads at `r/{itemId}.json` (variant-less items) or `r/{itemId}/{variantId}.json` under `outDir`. Item identity is the `items` map key; each item or variant has a `source` payload URI. Consumers resolve it against the catalog location (`resolveRegistryPayload`). File contents and ecosystem-tagged dependencies live in the payload, not the catalog.

`@tuckshop/core` exposes:

- `buildRegistry()` for compiling an authoring tree into consumable artefacts
- Schema types and validation for catalog and payload documents
- `parseRegistryDocument()` and `parseWithSchema()` for runtime validation (unknown keys are rejected; use `registryPayloadSchema` for payload documents)
- `resolveRegistryPayload()` for storage-agnostic catalog `source` resolution

The private `@tuckshop/registry` package holds the default opinionated content and a short build script around `buildRegistry` (`pnpm build:registry`).

## Development

Requirements:

- Node.js 20+
- pnpm

Get started:

```bash
pnpm install
pnpm run build
```

Common development commands:

```bash
pnpm run check          # typecheck and lint (writes fixes)
pnpm run build          # build all packages
pnpm run build:registry # rebuild compiled registry metadata
pnpm cov                # run tests with coverage
pnpm run quality:changes # quality gate on changed files (pre-PR)
pnpm run quality         # full codebase quality scan
```

The default registry content lives under `packages/registry/registry/`. Compilation writes `packages/registry/registry.json` (committed) and `packages/registry/r/` (gitignored build output, bundled into the CLI package at `prepack`).

## Releases

This repository uses [release-please](https://github.com/googleapis/release-please):

1. Contributors merge code using conventional commits
2. Every push to `main` opens or updates a Release PR with version bumps and changelog
3. Maintainers review and squash-merge the Release PR to tag changed packages
   (for example `tuckshop@v0.3.0`, `core@v0.3.0`) and publish only those packages to npm

For details on the contributor and maintainer workflows, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © [Rohit Agrawal](https://rohit.build/)
