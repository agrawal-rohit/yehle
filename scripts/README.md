# Release Template Contract

This repository's manual release tooling is designed to be reusable as a
registry convention.

## Three layers

1. Core: `scripts/analyze-release.ts`, `scripts/apply-release.ts`,
   `cliff.toml`, and `.github/workflows/release.yml`
2. Variant: package-manager/toolchain setup and the commands stored in
   `release.config.json`
3. Config: one repo-local `release.config.json` instance

## What stays generic

The core files are intentionally language-agnostic:

- `scripts/analyze-release.ts` only reads git history and semantic versions
- `scripts/apply-release.ts` never edits manifests directly; it runs configured
  `bumpCommand` and `publishCommand` templates
- `cliff.toml` groups conventional commits independently of package manager
- `.github/workflows/release.yml` delegates package selection and publish logic
  to the scripts

## What a variant controls

Per-language variants change configuration values, not core logic:

- `manifestFiles`
- `bumpCommand`
- `publishCommand`
- workflow toolchain setup

Examples:

- TypeScript: `package.json`, `npm version`, `pnpm publish`
- Rust: `Cargo.toml`, `cargo set-version`, `cargo publish`
- Python: `pyproject.toml`, poetry/hatch versioning, poetry publish

## How to reuse this in another monorepo

1. Copy the generic core files into the target repo
2. Add a `release.config.json` describing packages, tags, globs, and commands
3. Adjust the workflow's toolchain setup for the chosen language variant
4. Run the release workflow in dry-run mode to verify the computed plan
