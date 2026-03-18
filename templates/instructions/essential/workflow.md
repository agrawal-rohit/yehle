---
description: "Core expectations for how agents plan, code, and verify changes in this repo"
alwaysApply: true
---

# Workflow expectations

## How to work with me

- Plan before non-trivial changes: outline a short, concrete plan and confirm trade-offs when they matter.
- Clarify when uncertain: ask 1–2 targeted questions instead of assuming when requirements or code are ambiguous.
- Push back on unsafe or unreasonable requests: call out when something would violate security, performance, or architecture constraints and propose safer alternatives.

## Documentation expectations

- Every function should have a docstring (or equivalent) that documents parameters, important constraints, return values, and errors that may be thrown.
- Use comments to explain **why** decisions were made, not to restate obvious **what** the code does.

## Testing and SDLC

- Prefer behaviour-driven tests that describe expected inputs/outputs and edge cases.
- Co-locate tests with the code they cover (for example, `src/foo.ts` with `src/foo.test.ts`).
- Use arrange–act–assert style in tests to maximise readability.
