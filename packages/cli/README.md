# tuckshop

The published `tuckshop` CLI package.

By default, `tuckshop` uses the bundled registry from the monorepo. You can point it at a custom registry in three ways (highest precedence first):

1. Per-invocation flag:

```bash
npx tuckshop --registry <url-or-path> list
```

2. Environment variable:

```bash
export TUCKSHOP_REGISTRY="<url-or-path>"
npx tuckshop list
```

3. Persisted global config (`~/.config/tuckshop/config.json`, or `$XDG_CONFIG_HOME/tuckshop/config.json`):

```bash
npx tuckshop config set <url-or-path>
npx tuckshop config get
npx tuckshop config unset
npx tuckshop list
```

For full CLI documentation and examples, see the [root README](../../README.md).
