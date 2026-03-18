---
description: "React coding standards and conventions"
globs:
  - "**/*.tsx"
  - "**/*.ts"
alwaysApply: false
---

# React coding standards

## Data fetching and server state

- Prefer **TanStack Query** (or an equivalent data‑fetching library) over ad‑hoc `useEffect` and manual loading/error state for remote data.
- Keep server state and client state separate; avoid mixing them in the same store or component.

## State management

- Use **Zustand** for complex or cross‑cutting global state that multiple components need to coordinate on.
- Use **Jotai** for simple global state and derived values when a lightweight atom model is sufficient.
- Avoid unnecessary prop drilling; if props would pass through more than two levels, consider a context or a small state store instead.

## Components and responsibilities

- Favour **single‑responsibility, readable components**:
  - Each component should focus on one piece of UI or behaviour.
  - Extract smaller components when a piece of UI is conceptually separate or reused.
- Prefer composition over large, deeply nested component trees in a single file.

## Styling

- Use **Tailwind CSS** (or a similar utility‑first approach) for styling where appropriate.
- Prefer **headless shadcn components** (or similar primitive component libraries) as building blocks, then layer your own design system on top.
- Keep styling concerns close to components (for example, Tailwind classes or co‑located style files) rather than scattered globals.

## Validation and forms

- Use **Zod** for data and form validation, and integrate it with form libraries where possible.
- Keep validation schemas near the components or modules that own the data contracts.
