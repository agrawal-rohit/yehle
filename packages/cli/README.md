# tuckshop

The published `tuckshop` CLI package.

By default, `tuckshop` uses the bundled registry from the monorepo. You can point it at a custom registry in following ways:

1. CLI flag at each command:

```bash
npx tuckshop --registry <url-or-path> list
```

2. Environment variable:

```bash
export TUCKSHOP_REGISTRY="<url-or-path>"
npx tuckshop list
```

3. Global preference set through the `config` command:

```bash
npx tuckshop config set <url-or-path>
npx tuckshop config get
npx tuckshop config unset
npx tuckshop list
```