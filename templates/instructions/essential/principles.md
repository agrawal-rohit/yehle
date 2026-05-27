---
description: General coding principles and coding style to follow
alwaysApply: true
---

# General coding principles

- Fail fast with clear, actionable error messages.
- Favour solutions that achieve the same behaviour with **fewer lines of code** and less unnecessary indirection.
- For complex, one‑off tasks (for example, parsing markdown or handling low‑level protocols), prefer **well‑maintained third‑party libraries** over ad‑hoc hand‑rolled implementations.
- Use descriptive names that reveal intent.

## Documentation expectations

- Every function should have a docstring (or equivalent) that documents parameters, important constraints, return values, and errors that may be thrown.
- Use comments to explain **why** decisions were made, not to restate obvious **what** the code does.
