---
description: General coding principles and coding style to follow
alwaysApply: true
---

# General coding principles

- Fail fast with clear, actionable error messages.
- Favour solutions that achieve the same behaviour with fewer lines of code and less unnecessary indirection.
- Keep constants scoped as locally as practical; avoid module-level constants when they are only used inside one function.
- Prefer well-maintained third-party libraries over hand-rolled implementations for complex one-off tasks.
- Use descriptive names that reveal intent - `fetch_active_agents()` not `get_data()`
- Prefer long functions with comments over overfragmented code with many small functions.
- Do not define helper functions that are only called once or are thin wrappers; inline instead.
- Prefer enums over string unions for fixed set of values.

## Documentation expectations

- Every function should have a docstring (or equivalent) that documents parameters, important constraints, return values, and errors that may be thrown.
- Use comments to explain **why** decisions were made (overview, tradeoffs, workarounds, etc.), not to restate obvious **what** the code does.