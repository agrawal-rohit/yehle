---
description: "react vite"
globs:
  - "**/*"
alwaysApply: true
---

# UI Coding Standards

## Libraries to use

- Framework: ReactJS + Vite (Web), Expo (Mobile)
- Icons: Lucide icons
- Charts: Tremor charts (Web) + `react-native-skia`/`victory-native` (Mobile)
- UI Components (Web): Shadcn primitives + Tailwind CSS v4
- UI Components (Mobile): React Native Reusables + UniWind
- State Management: Zustand (Ephemeral state) + TanStack Query (Remote data)
- API Wrapper: Apisauce
- Data Validation: Zod + React Hook Form
- Linter/Formatter/Code Quality: Biome + Typescript + Jest/Vitest

## Code style

- Single responsibility: Each component renders one logical piece of the UI.
- Co-location: Keep sub-components that are only used by one parent in the same file below the parent component. If used by multiple parents, use a separate file
- File naming: Use `kebab-case.<type>.{ts,tsx}` for files, `PascalCase` for classes and component names, `camelCase` for variables and functions.
- Extract literals into named constants
- Don't use implicit `any` types, use `unknown` or define a proper interface.

## Folder structure

```
src/
  pages/           # Individual page modules
    <page-1>/
      components/
      dialogs/
      forms/
      <page-1>.page.tsx
  shared/
    components/
    primitives/    # Unstyled/lightly-styled atomic building blocks (button, input, dialog, etc.)
    layouts/       # Structural shell components
    dialogs/       # Dialogs/modals
    forms/         # Standalone form components that are not always inside a modal
  api/
    <entity>.api.ts    # API calls that use the API client
    client.api.ts     # API middlewares and Apisauce configuration
  hooks/          # Shared hooks
    use<entity>Query.hook.ts   # TanStack query/mutation hooks for an entity that use `api/` functions
  types/          # Shared TypeScript interfaces and types
  app.store.ts     # Zustand store
```

## Recipes

- Loading State: Skeleton for individual elements, Spinner for dynamic UIs/charts
- Dialog/Modal: Use the `Dialog` primitive component. Every dialog is **controlled** via a local `open` state and receives its trigger as a prop.
- Forms: Use `react-hook-form` with `zodResolver`, the zod schema is the single source of truth for both validation rules and the TypeScript type. Use `onChange` for real-time feedback and `onSubmit` for multi-step wizards.
