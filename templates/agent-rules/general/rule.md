# General Coding Best Practices

## Principles

- Write code for humans first, machines second
- Prefer explicit over implicit
- Fail fast with clear error messages
- Keep functions small and focused
- Avoid premature optimization

## Naming

- Use descriptive names that reveal intent
- Avoid abbreviations unless widely understood
- Use consistent naming conventions across the codebase
- Prefer positive boolean names (e.g. `isEnabled` over `isDisabled`)

## Documentation

- Document the "why" not the "what"
- Keep comments up to date with code changes
- Use README for project overview and setup
- Document non-obvious decisions in ADRs when appropriate

## Error handling

- Handle errors at appropriate boundaries
- Provide context in error messages
- Use typed errors where possible
- Don't swallow exceptions silently
