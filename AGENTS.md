# AGENTS.md

## Cursor Cloud specific instructions

### Overview

**yehle** is a CLI scaffolding tool for modern developers. It generates project structures from templates with pre-configured tooling. Single-package Node.js/TypeScript repo (not a monorepo). No external services or databases required.

### Development commands

All scripts are in `package.json`. Key commands:

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Lint (Biome) | `pnpm run lint` |
| Format (Biome) | `pnpm run format` |
| Typecheck | `pnpm run typecheck` |
| Lint + Typecheck | `pnpm run check` |
| Test (watch) | `pnpm test` |
| Test (single run) | `pnpm vitest run` |
| Test + coverage | `pnpm cov` |
| Build | `pnpm run build` |
| Pack tarball | `pnpm pack` |

### Known caveats

- **`command` builtin issue:** `src/core/shell.ts` `commandExistsAsync()` uses `spawn('command', ['-v', ...])` to check if a binary exists. On Linux, `command` is a shell built-in (not an executable), so `spawn` fails with ENOENT. A shim at `/usr/local/bin/command` is installed in the VM environment to work around this. If you see "pnpm is not installed. Please install PNPM and re-run." errors from the CLI at runtime, this shim is likely missing.

- **pnpm build scripts warning:** After `pnpm install`, you may see a warning about ignored build scripts for `esbuild` and `unrs-resolver`. These do not affect lint, test, build, or CLI functionality.

- **Interactive CLI:** The `package` command requires interactive terminal input (consola prompts). For non-interactive testing, run `node bin/cli.js --help` or `node bin/cli.js package --help`. For full end-to-end scaffolding tests, use a TTY-capable terminal or the computerUse subagent.

- **Pre-commit hooks:** Husky runs lint-staged on pre-commit and commitlint on commit-msg. Use Conventional Commits format (see `CONTRIBUTING.md`).
