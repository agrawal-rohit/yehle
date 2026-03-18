---
description: "TypeScript and JavaScript coding standards"
globs:
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
alwaysApply: false
---

# TypeScript and JavaScript standards

## File naming

- Use **kebab-case** for file names, with optional file type suffixes:
  - `user-profile.ts`, `user-profile.utils.ts`, `user-profile.hook.ts`, `user-profile.api.ts`, etc.
- Prefer `*.ts` for non‑JSX files and `*.tsx` for files containing JSX.

## Types and safety

- Prefer `interface` over `type` for object shapes when extending or being implemented.
- Use `unknown` instead of `any` when the type is truly unknown; narrow it as close to the boundary as possible.
- Prefer `const` assertions and `satisfies` to help the compiler infer accurate types.