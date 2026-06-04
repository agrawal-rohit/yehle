---
description: Core expectations for how to plan, code, and verify changes
alwaysApply: true
---

# Workflow expectations

## How to work with me

- Plan before non-trivial changes: outline a short, concrete plan and confirm trade-offs when they matter.
- Clarify when uncertain: ask 1–2 targeted questions instead of assuming when requirements or code are ambiguous.
- Push back on unsafe or unreasonable requests: call out when something would violate security, performance, or architecture constraints and propose safer alternatives.

## Testing and SDLC

- When designing e2e or unit tests, focus on **ideal behaviour** and contracts:
  - Use function signatures, DTO shapes, API contracts, or component props to define expectations.
  - Avoid reading the implementation as the primary source of truth for what to test.
- Prefer behaviour-driven tests that describe expected inputs/outputs and edge cases.
- Co-locate tests with the code they cover (for example, `src/foo.ts` with `src/foo.test.ts`).
- Use arrange–act–assert style in tests to maximise readability.
- When work is non-trivial, prefer an RPI flow:
  - Research to gather focused context.
  - Plan to produce a concise, verifiable plan.
  - Implement changes step by step following the plan.
  - Verify as per the plan.