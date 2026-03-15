---
description: "Package / library project defaults"
globs:
  - "**/*.ts"
  - "package.json"
alwaysApply: false
---

# Package (project-spec) Instructions

## Scope

This project is a **package** (library) — not an app. Follow library best practices.

## Conventions

- Publish a single entry point; use `package.json` `exports` for subpaths if needed.
- Prefer dual ESM + CJS builds or ESM-only with type definitions.
- Version and changelog: use semantic versioning and keep a CHANGELOG (e.g. cliff, standard-version).
- Do not bundle dependencies that are meant to be peer or external unless documented.
