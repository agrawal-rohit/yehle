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

- Every function or public entrypoint should have a docstring (or equivalent) that documents:
  - Parameters and important constraints.
  - Return values and shapes.
  - Errors or exceptions that may be thrown and when.
- Use comments to explain **why** decisions were made, not to restate obvious **what** the code does.
- Keep project-level docs (like `README.md` and CONTRIBUTING) accurate when behaviour or workflows change.

## Testing and SDLC

- Prefer behaviour-driven tests that describe expected inputs/outputs and edge cases.
- Co-locate tests with the code they cover (for example, `src/foo.ts` with `src/foo.test.ts`).
- Use arrange–act–assert style in tests to maximise readability.
- When work is non-trivial, prefer an R→P→I→V flow:
  - **Researcher** (`researcher` skill or subagent) gathers focused context and writes a short memo.
  - **Planner** (`planner` skill or subagent) produces a concise, verifiable plan from that memo.
  - **Implementer** (`implementer` subagent or main agent) applies changes step by step, following the plan.
  - **Verifier** (`verifier` skill or subagent) runs `pnpm run check:ci`, `pnpm test` (and coverage when requested) and reports what truly passed vs failed.
