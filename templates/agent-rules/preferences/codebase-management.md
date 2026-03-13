# Codebase Management

## Git and version control

- Git commits should adhere to the "Conventional Commits" format
- Use Terraform configurations for infrastructure deployment through a single command
- Use docker-compose/docker for the local environment that mimics the terraform deployed environment as closely as possible
- Use `just` commands for codebase installation, local docker environment spinup, linting/formatting, etc.
- Always use the current stable API for installed third-party libraries/packages.

## Code quality

- Add comments for the **why** behind the code, instead of the **what**. Always preserve all existing code comments during refactoring, cleanup, optimization, and any other code modification.
- When generating e2e/unit tests, always test ideal behaviour and never read the implementation to decide what to test. Read the function signatures, DTO shapes, API contracts, or component props to write tests that assert ideal/expected behaviour for that interface.
