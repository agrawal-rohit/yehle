---
description: "Package setup and layout"
alwaysApply: false
---

# Setup

## Purpose

Minimal TypeScript package with a single entry point, tests, and standard tooling.

## Structure

- A single **entry point** in the source tree that exports the package's public API (for example, `src/index.ts`).
- Co‑located tests that mirror the entry point (for example, `src/index.test.ts`) using Vitest.
- A TypeScript configuration (for example, `tsconfig.json`) that enables strict type checking.
- A build configuration for `tsdown` (for example, `tsdown.config.ts`).
- A test configuration for Vitest (for example, `vitest.config.ts`).

## Tooling

- Build: `pnpm build` (uses `tsdown` under the hood).
- Tests: `pnpm test` (Vitest).
- Type checking: `pnpm typecheck`.
- Lint/format: `pnpm lint`, `pnpm format`, and `pnpm check` for combined checks.
