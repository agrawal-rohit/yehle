# tuckshop

The published `tuckshop` CLI package.

By default, `tuckshop` uses the bundled registry from the monorepo, but you can point it at a custom registry with:

```bash
npx tuckshop --registry <url-or-path> list
```

Or set it as an environment variable:

```bash
export TUCKSHOP_REGISTRY="<url-or-path>"
npx tuckshop list
```

For full CLI documentation and examples, see the [root README](../../README.md).
