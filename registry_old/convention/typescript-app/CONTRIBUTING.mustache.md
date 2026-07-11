# Contributing

Thanks for your interest in contributing to `{{ name }}`! This guide will help you get started with the development process, from setting up your environment to submitting changes.

## Table of Contents

- [Getting Help](#getting-help)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing & Code Quality](#testing--code-quality)
- [Documentation](#documentation)
- [Release Process](#release-process)
- [Dependencies](#dependencies)
- [Security](#security)
- [Maintainer Guidelines](#maintainer-guidelines)
- [Recognition](#recognition)

## Getting Help

If you have questions, ideas, or need help:
- Search existing [GitHub Discussions](https://github.com/{{ authorGitUsername }}/{{ name }}/discussions) first
- Open a new discussion for questions and proposals
- Create a [GitHub Issue](https://github.com/{{ authorGitUsername }}/{{ name }}/issues) for bug reports

Please be specific about your environment and include steps to reproduce issues when reporting bugs.

## Development Setup

1. Fork the repository
2. Install dependencies: `pnpm install`
3. Start development: `pnpm dev`
4. Run the test suite: `pnpm test`
5. Build the app: `pnpm build`

## Making Changes

### Branching Strategy

- Create feature branches from `main`
- Use descriptive branch names: `feat/<scope>-description` or `fix/<scope>-description`
- Keep changes focused and atomic

### Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Optional longer description

BREAKING CHANGE: details (if applicable)
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`

### Pull Requests

- Run tests with coverage: `pnpm cov`
- Include tests for new features and bug fixes
- Reference related issues using GitHub keywords (e.g., `Closes #123`)
- Use a clear title and explain the why behind changes
- Keep PRs focused on a single purpose

## Testing & Code Quality

- Run tests with coverage: `pnpm cov`
- Check linting: `pnpm run lint`
- Format code: `pnpm run format`
- Run type checks: `pnpm run check`

Pre-commit hooks will automatically check your code quality. If they block your commit, run the appropriate fix commands and try again.

## Documentation

- Update `README.md` for public-facing changes
- Document new features, CLI commands, and configuration options
- Include examples for complex functionality
- Keep documentation consistent with code changes

Small documentation fixes (typos, clarifications) are always welcome!

## Release Process

### Overview

> [!IMPORTANT]
> - Ensure that `"Allow GitHub Actions to create and approve pull requests"` is checked in your repository settings *(Settings > Actions > General > Workflow permissions)*

This project uses a tag-driven release workflow. Pushing a semver tag triggers a GitHub Actions workflow that builds the app and creates a GitHub Release with a changelog generated from conventional commits using [git-cliff](https://git-cliff.org/).

- **Stable releases** (`v1.2.3`) → GitHub Release with changelog
  ```bash
  git checkout main
  git pull origin main
  git tag v1.2.3
  git push origin v1.2.3
  ```
- **Pre-releases** (`v1.2.3-rc.1`, `v1.2.3-beta.1`, `v1.2.3-alpha.1`) → GitHub Release marked as pre-release
  ```bash
  git tag v1.2.3-rc.1    # or -beta.1, -alpha.1
  git push origin v1.2.3-rc.1
  ```

When the tag is pushed, the release workflow:

1. Installs dependencies and builds the app
2. Generates a changelog with git-cliff
3. Creates a GitHub Release with the changelog
4. Includes a placeholder step for your deploy/publish target — edit `.github/workflows/release.yml` to add your hosting provider (Vercel, Netlify, Cloudflare Pages, etc.)

## Dependencies

- Propose new dependencies via GitHub Issues first
- Consider bundle size, maintenance burden, and licensing
- Security updates and critical fixes are always welcome
- Include rationale and testing notes for dependency changes

## Security

- **Do not** report security vulnerabilities in public issues
- Use GitHub's [private vulnerability reporting](https://github.com/{{ authorGitUsername }}/{{ name }}/security/advisories)

## Maintainer Guidelines

Some guidelines for maintainers:

- Changes to `main` should be added through pull requests
- Tag format must adhere to semver standards: `vX.Y.Z` for stable releases and `vX.Y.Z-rc.N`, `-beta.N`, `-alpha.N` for pre-releases
- Keep required checks and branch protection enabled on `main` branch
- Avoid modifying config files in the repository without discussion:
  - Configuration files (`cliff.toml`, `biome.json`, etc.)
  - CI workflows (`.github/workflows/*`)
  - Release tooling

If changes to these areas are needed, open an issue to discuss first.

## Recognition

Contributors are recognized through:

- GitHub's contributor graph
- Release notes (generated from commit messages)
- Community acknowledgments

Your contributions are greatly appreciated!
