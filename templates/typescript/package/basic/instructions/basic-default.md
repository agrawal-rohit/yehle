---
description: "Basic package template defaults"
globs:
  - "**/*"
alwaysApply: true
---

# Basic Template Instructions

## Purpose

Minimal TypeScript package: single entry, tests, and standard tooling (tsdown, Vitest, Biome).

## Structure

- `src/index.ts`: main entry; export public API from here.
- `tests/`: Vitest tests; mirror `src/` layout when helpful.
- Keep dependencies minimal; add only what the template already includes.
