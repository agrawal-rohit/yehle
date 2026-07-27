# Contributing

Thanks for your interest in contributing to `tuckshop`! This guide will help you get started with the development process, from setting up your environment to submitting changes.

## Table of Contents

- [Getting Help](#getting-help)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing & Code Quality](#testing--code-quality)
- [Documentation](#documentation)
- [Release Process](#release-process)
- [Dependencies](#dependencies)
- [Code Registry](#code-registry)
- [Security](#security)
- [Maintainer Guidelines](#maintainer-guidelines)
- [Recognition](#recognition)

## Getting Help

If you have questions, ideas, or need help:

- Search existing [GitHub Discussions](https://github.com/agrawal-rohit/tuckshop/discussions) first
- Open a new discussion for questions and proposals
- Create a [GitHub Issue](https://github.com/agrawal-rohit/tuckshop/issues) for bug reports

Please be specific about your environment and include steps to reproduce issues when reporting bugs.

## Development Setup

1. Fork the repository
2. Install dependencies: `pnpm install`
3. Build the workspace: `pnpm run build`
4. Build the default registry: `pnpm run build:registry`
5. Test the CLI package locally: `pnpm --filter tuckshop pack`

The repository is a pnpm workspace with the following structure:

- `packages/cli`: published as `tuckshop`
- `packages/core`: published as `@tuckshop/core`
- `packages/registry`: private default registry content
- `docs`: documentation site

## Making Changes

### Branching Strategy

- Create feature branches from `main`
- Use descriptive branch names: `feat/<scope>-description` or `fix/<scope>-description`
- Keep changes focused and atomic

### Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): short description

Optional longer description

BREAKING CHANGE: details (if applicable)
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`

### Pull Requests

- Run `pnpm run check` and `pnpm cov` before opening a pull request
- Include tests for new features and bug fixes
- Use a conventional commit type that reflects the change impact
- Reference related issues using GitHub keywords (e.g., `Closes #123`)
- Use a clear title and explain the why behind changes
- Keep PRs focused on a single purpose

## Testing & Code Quality

- Typecheck and lint: `pnpm run check`
- Build packages: `pnpm run build`
- Run tests with coverage: `pnpm cov`
- Quality gate on changed files: `pnpm run quality:changes`
- Full codebase quality scan: `pnpm run quality` (or `pnpm run quality dead-code`, `pnpm run quality health`, etc.)
- Format code: `pnpm run format`

Pre-commit hooks will automatically check your code quality. If they block your commit, run the appropriate fix commands and try again.

## Documentation

- Update `README.md` or [`docs/`](./docs) for public-facing changes
- Document new APIs, CLI commands, and configuration options
- Include examples for complex functionality
- Keep documentation consistent with code changes

Small documentation fixes (typos, clarifications) are always welcome!

## Release Process

### Overview

> [!IMPORTANT]
>
> - [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) must be configured
> - Ensure GitHub Actions can push release commits and create tags on `main`

This repository uses a config-driven monorepo release workflow. Contributors
focus on code and conventional commits; maintainers decide when to cut releases
by manually dispatching a GitHub Actions workflow.

### For contributors

1. Follow [Conventional Commits](https://www.conventionalcommits.org/)
2. Choose the commit type that matches the intended release impact:
   - `fix` / `perf` -> patch
   - `feat` -> minor
   - `!` or `BREAKING CHANGE:` -> major
3. Merge the pull request when the code is ready

You do not need to create changesets or manually bump package versions.

### For maintainers

The release workflow is triggered manually from the Actions tab:

1. Run `Release` with `dry_run: true`
2. Review the computed plan in the GitHub Actions summary
3. Optionally rerun with:
   - `packages` to narrow the release scope
   - `bump_override` when the inferred bump should be adjusted
4. Rerun with `dry_run: false` to:
   - bump versions for affected packages
   - regenerate changelogs with `git-cliff`
   - rebuild `packages/registry/registry.json` so `contentBaseUrl` matches the new CLI tag
   - commit the release changes to `main`
   - create package tags and GitHub releases
   - publish public packages with npm trusted publishing

The release logic is driven by [`release.config.json`](./release.config.json).
That keeps the scripts generic enough to later ship as a reusable
`monorepo-release` registry convention.

**Note:** `tuckshop` and `@tuckshop/registry` are versioned together so
default-registry content ships with matching CLI releases.
`@tuckshop/registry` is private and never published to npm; `@tuckshop/core`
is published independently when it changes.

### Testing Pre-releases

Pre-release automation is intentionally deferred for now. Stable releases use
the manual workflow above. If a pre-release is needed, cut it explicitly and
test it the same way you would test a stable publish:

```bash
# For tuckshop itself
npx tuckshop@1.2.3-rc.1 --help

# For @tuckshop/core
npm install @tuckshop/core@1.2.3-rc.1
```

Found a bug? Fix it on `main`, merge the change, and rerun the release workflow
when you are ready to publish the next version.

## Dependencies

- Propose new dependencies via GitHub Issues first
- Consider bundle size, maintenance burden, and licensing
- Security updates and critical fixes are always welcome
- Include rationale and testing notes for dependency changes

## Code Registry

`tuckshop` uses a JSON registry inspired by [shadcn](https://ui.shadcn.com/docs/registry) to distribute all registry items _(e.g. project templates, UI components, conventions, and agent instructions)_. Each unit is a self-contained folder holding its manifest and its source files. A unit can be wired to other items through the `registryDependencies` property to make composable units.

The default registry content lives under `packages/registry/registry/`. Shared registry conditions are centralized in `packages/registry/registry/conditions.json`.

### Registry Layout

Every item is a folder under `packages/registry/registry/` containing a `registry-item.json` manifest alongside the files it ships. Folder paths are just for convenience, the manifest holds the actual identity.

```text
packages/registry/registry/
├── conditions.json
├── convention/dependency-updater/     # id: dependency-updater
├── convention/build/                  # id: build
├── convention/changelog/              # id: changelog
├── component/button/                  # id: button
│   ├── registry-item.json
│   └── react/button.tsx
└── …
```

The compiled registry is written to `packages/registry/registry.json` by `pnpm run build:registry`, and is regenerated and staged automatically by the pre-commit hook whenever anything under `packages/registry/registry/` changes.

`registry.json` only holds metadata for individual items, so the index stays lean as the registry grows. Each file records a package-relative `source`, and the CLI fetches the content at install time from `${contentBaseUrl}/${source}` _(pinned to the release version)_.

### Authoring Guidelines

- Keep items atomic and colocate the manifest and every file it ships in one folder.
- Extract reusable concerns into their own items and reference them via `registryDependencies`.
- Run `pnpm run build:registry` after changing items _(the pre-commit hook and `prepack` also run it)_.

### Proposing New Items

When proposing a new registry item:

1. Add a new folder under `packages/registry/registry/` with a `registry-item.json` (`id`, `title`, `description`, `type`, `variants`) and its files
2. Include everything needed for a complete working setup; depend on existing concern items instead of copying files
3. Run `pnpm run build:registry`, `pnpm cov`, and `pnpm --filter tuckshop pack`
4. Document what the item provides in your pull request
5. Include examples of generated output

## Security

- **Do not** report security vulnerabilities in public issues
- Use GitHub's [private vulnerability reporting](https://github.com/agrawal-rohit/tuckshop/security/advisories/new)

## Maintainer Guidelines

Some guidelines for maintainers:

- Changes to `main` should be added through pull requests
- Prefer the manual `Release` workflow over ad-hoc local tagging or publishing
- Keep required checks and branch protection enabled on `main` branch
- Avoid modifying config files in the repository without discussion:
  - Configuration files (`biome.json`, `.changeset/config.json`, etc.)
  - CI workflows (`.github/workflows/*`)
  - Release tooling

If changes to these areas are needed, open an issue to discuss first.

## Recognition

Contributors are recognized through:

- GitHub's contributor graph
- Release notes (generated from conventional commits via git-cliff)
- Community acknowledgments

Your contributions are greatly appreciated!
