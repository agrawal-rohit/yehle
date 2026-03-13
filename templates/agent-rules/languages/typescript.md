# TypeScript Library Standards

## Project setup

- Use TypeScript strict mode
- Prefer `tsup`, `tsdown`, or `unbuild` for library builds
- Use Vitest for unit tests
- Use Biome for linting and formatting

## Code style

- Prefer `interface` over `type` for object shapes
- Export types alongside implementations
- Use `unknown` over `any` when type is truly unknown
- Prefer `const` assertions and `satisfies` for inference
- Use JSDoc for public API surface

## Package structure

- Single entry point with clean exports
- Separate internal utilities from public API
- Use `package.json` exports field for modern resolution
- Include `types` in package.json for type definitions

## Testing

- Test public API behaviour, not implementation details
- Use descriptive test names that describe expected behaviour
- Prefer `describe`/`it` blocks that read like specifications
