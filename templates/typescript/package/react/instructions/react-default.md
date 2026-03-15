---
description: "React package template defaults"
globs:
  - "**/*.tsx"
  - "**/*.ts"
alwaysApply: true
---

# React Template Instructions

## Purpose

TypeScript package that ships React components and optionally a Vite playground.

## Conventions

- Export components from the main entry; keep playground/demos out of the published bundle.
- Use JSX runtime (automatic); prefer `*.tsx` for any file containing JSX.
- Tests: use React Testing Library and Vitest; test behaviour, not implementation.
- Styling: follow the UI coding standards when adding styles (e.g. Tailwind, CSS modules).
