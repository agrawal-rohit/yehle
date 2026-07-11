---
description: "React UI app setup and layout"
alwaysApply: false
---

# React UI app template setup

## Purpose

TypeScript React app scaffold for building interactive demos, playgrounds, and SaaS-style UIs with Vite and Tailwind CSS.

## Structure

- An **entry module** that mounts the app with theme and tooltip providers (`src/index.tsx`).
- An empty **App shell** to build your UI in (`src/App.tsx`).
- **Theme tokens** and Tailwind setup in `src/index.css`.
- Reusable **UI primitives** under `src/components/ui/` (button, slider, tabs, select, etc.).
- A **theme provider** with system/light/dark support (`src/components/theme-provider.tsx`).
- A **color picker** primitive (`src/components/color-picker.tsx`).
- A `cn()` utility in `src/lib/utils.ts`.

## Tooling and commands

- Development: `pnpm dev` (Vite dev server).
- Build: `pnpm build` (production build to `dist/`).
- Preview: `pnpm preview` (preview the production build).
- Tests: `pnpm test` (Vitest).
- Coverage: `pnpm cov`.
- Type checking: `pnpm typecheck`.
- Lint/format: `pnpm lint`, `pnpm format`, and `pnpm check`.

## UI composition

- Compose controls from primitives in `src/components/ui/`.
- Use the theme provider for light/dark/system mode.
- Extend `App.tsx` with your preview and configuration UI.
