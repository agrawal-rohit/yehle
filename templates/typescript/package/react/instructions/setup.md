---
description: "Package setup and layout"
alwaysApply: false
---

# React template setup

## Purpose

TypeScript package that ships React components and includes a React + Vite playground for local development.

## Structure

- A clear **entry module** that exports the public React API for consumers (for example, `src/index.ts`).
- One or more component modules for React UI pieces (for example, `src/button.tsx` or similar).
- Co‑located tests for components (for example, `src/index.test.tsx`) using Vitest and React Testing Library.
- A TypeScript configuration for the project (for example, `tsconfig.json`).
- A build configuration for `tsdown` (for example, `tsdown.config.ts`).
- A test configuration for Vitest and any DOM test setup (for example, `vitest.config.ts` and `test-setup.ts`).
- A dedicated playground directory for interactive demos (for example, `playground/` with its own Vite config).

## Tooling and commands

- Build: `pnpm build` (uses `tsdown`).
- Tests: `pnpm test` (Vitest with React Testing Library).
- Playground: `pnpm playground` (Vite dev server using `playground/vite.config.ts`).
- Type checking: `pnpm typecheck`.
- Lint/format: `pnpm lint`, `pnpm format`, and `pnpm check`.
