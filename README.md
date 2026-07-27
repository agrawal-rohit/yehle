<div align="center">
  <img src="https://cdn.rohit-agrawal.com/work/tuckshop/logo.png" alt="Tuckshop" style="width: 30%; margin: auto" />
</div>

<br />

<div align="center">
  <p align="center" style="width: 80%; margin: auto">
    <img alt="Status" src="https://img.shields.io/github/actions/workflow/status/agrawal-rohit/tuckshop/ci.yml">
    <img alt="Coverage" src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/agrawal-rohit/tuckshop/main/.github/badges/coverage.json">
    <a href="https://github.com/agrawal-rohit/tuckshop/actions/workflows/ci.yml"><img alt="Code Quality" src="https://img.shields.io/badge/code%20quality-CodeQL%20%C2%B7%20Fallow%20%C2%B7%20Semgrep-2ea44f"></a>
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
- **`@tuckshop/core`**: the registry builder, validator, resolver, and authoring API for custom registries
- **`@tuckshop/registry`**: the private default registry content bundled into the CLI

By default, `npx tuckshop` uses the bundled registry from this repository. To point the CLI at a custom registry, use `--registry` or set the `TUCKSHOP_REGISTRY` environment variable.

## Quickstart

List available templates from the default registry:

```bash
npx tuckshop list
```

Use a custom registry:

```bash
npx tuckshop --registry https://example.com/registry.json list
```

Or set it as an environment variable for all commands:

```bash
export TUCKSHOP_REGISTRY="https://example.com/registry.json"
npx tuckshop list
```

## Workspace layout

```text
packages/
├── cli/        # published as `tuckshop`
├── core/       # published as `@tuckshop/core`
└── registry/   # private default registry content
docs/           # documentation site
```

## Building a custom registry

If you want to build your own registry, install `@tuckshop/core` and reuse the same primitives that power the default registry:

```ts
import { buildRegistry, parseRegistryDocument } from "@tuckshop/core";
```

`@tuckshop/core` exposes:

- Schema types and `SCHEMA_VERSION` for your registry document
- Registry validation to ensure your document is well-formed
- Registry building from a structured `registry/` directory
- Condition inference and variant resolution for cross-platform items
- Local registry source resolution helpers

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
pnpm run check:ci       # typecheck and lint
pnpm run build          # build all packages
pnpm run build:registry # rebuild compiled registry metadata
pnpm run release:plan   # preview the next release plan
pnpm cov                # run tests with coverage
pnpm run quality:changes # quality gate on changed files (pre-PR)
pnpm run quality         # full codebase quality scan
```

The default registry content lives under `packages/registry/registry/`, and the compiled metadata is written to `packages/registry/registry.json`.

## Releases

This repository uses a config-driven monorepo release workflow:

1. Contributors merge code using conventional commits
2. Maintainers run the `Release` GitHub Actions workflow in dry-run mode
3. The workflow computes per-package bumps from git history and previews the plan
4. Rerunning with `dry_run: false` bumps versions, rebuilds registry metadata,
   publishes affected public packages, and creates GitHub releases

For details on the contributor and maintainer workflows, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © [Rohit Agrawal](https://rohit.build/)
