# tuckshop

The published `tuckshop` CLI package.

## Commands

### `add`

Install registry items into the current working directory:

```bash
npx tuckshop add pr-template-configuration
npx tuckshop add testing-configuration --overwrite
npx tuckshop add
```

When item ids are omitted, `add` prompts with a multiselect. Shared registry conditions are inferred from marker files when possible, then prompted. Payload files are fetched from the catalog location, written relative to the project root, and packages are installed per ecosystem after confirming or selecting a package manager.

### `list`

```bash
npx tuckshop list
npx tuckshop list --type workflow,configuration
```

## Registry source

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