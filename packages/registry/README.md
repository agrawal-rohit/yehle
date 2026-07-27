# @tuckshop/registry

Private default registry content for the `tuckshop` CLI.

This package is not published to npm. Instead, the CLI embeds the compiled `registry.json` at pack time, and file sources are fetched from GitHub using the document's `contentBaseUrl`.

## Structure

- `registry/`: Registry item manifests (`.registry-item.json`) and source files
- `scripts/build.ts`: Build script that uses `@tuckshop/core` to compile the registry
- `registry.json`: Compiled registry document as per the `@tuckshop/core` schema

## Developing

After modifying items under `registry/`:

```bash
pnpm run build:registry
```

This rebuilds the compiled registry document. The build script:

1. Discovers all items and their manifests
2. Infers conditions and resolves variants
3. Sets `contentBaseUrl` to `https://cdn.jsdelivr.net/gh/agrawal-rohit/tuckshop@<version>/packages/registry`
4. Writes the final document to `registry.json`

Sources in the compiled document are relative to the package root (`registry/...`), so raw GitHub URLs resolve correctly under the `packages/registry/` path.
