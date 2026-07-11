<div align="center">
  <img src="https://cdn.rohit-agrawal.com/work/tuckshop/logo.png" alt="Tuckshop" style="width: 30%; margin: auto" />
</div>

<br />

<div align="center">
  <p align="center" style="width: 80%; margin: auto">
    <img alt="Status" src="https://img.shields.io/github/actions/workflow/status/agrawal-rohit/tuckshop/ci.yml">
    <img alt="Sonar Coverage" src="https://img.shields.io/sonar/coverage/agrawal-rohit_tuckshop?server=https%3A%2F%2Fsonarcloud.io">
    <img alt="Downloads" src="https://img.shields.io/npm/dt/tuckshop">
    <img alt="Biome" src="https://img.shields.io/badge/code_style-biome-60a5fa">
    <img alt="License" src="https://img.shields.io/github/license/agrawal-rohit/tuckshop" />
  </p>
</div>

<div align="center">
  <p>✨ An opinionated <strong>scaffolding CLI</strong> for modern developers ✨</p>
</div>

<br />

<div align="center">
    <img src="https://cdn.rohit-agrawal.com/work/tuckshop/preview.gif" alt="Tuckshop Preview" style="margin: auto" />
</div>

<br />

`tuckshop` is a CLI tool for scaffolding modern software projects by performing common [yak-shaving](https://softwareengineering.stackexchange.com/a/388236) operations through opinionated templates, sensible tooling setup, and development best practices.

I would usually spend hours re-configuring the _"same old tooling and workflow setup"_ for every new project instead of focusing on the actual functionality. `tuckshop` eliminates that duplicative work by generating a project structure _(based on my personal flavour)_ with essential pieces already configured _(pre-commit hooks, a linter and formatter, build and release workflows, basic documentation, etc.)_ - thus allowing me to build things I'm interested in without the distractions.

## Table of Contents

* [Features](#features)
* [Supported Languages](#supported-languages)
  * [Typescript](#typescript)
* [Usage](#usage)
  * [Requirements](#requirements)
  * [Quickstart](#quickstart)
  * [Examples](#examples)
* [Commands Reference](#commands-reference)
  * [`create`](#create)
  * [`add`](#add)
* [Contributing](#contributing)
* [License](#license)

## Features

`tuckshop` sets you up with several best practices adopted in modern software development with pre-configured tooling that should cover most use-cases. `tuckshop` achieves this through:

* Automatic dependency upgrades using [dependabot][]
* Automatic builds, tests, and releases with [github actions][github-actions]
* Automatically generated Readme with badges through [shields.io][shields]
* Automatically generated MIT license with [spdx][spdx-license-list]
* Automatically generated community files _(contribution guidelines, issue templates, and pull request checklists)_
* A pre-configured [release process](CONTRIBUTING.md#release-process) for preview and production releases
* Opinionated [registry items][registry-items] that cover common use cases encountered in modern software development
* A collection of helpful **agent instructions and skills** that can be applied to new or existing projects.

[github-actions]: https://github.com/features/actions
[shields]: https://shields.io/
[spdx-license-list]: https://github.com/sindresorhus/spdx-license-list
[registry-items]: registry/
[dependabot]: https://github.com/dependabot

## Supported Languages

In addition to the general features listed above, `tuckshop` also configures language-specific tooling to enable unit testing, type-safety, consistent code linting/formatting, and _much more_. It currently supports the following languages:

### Typescript

* Unit testing with [vitest][] and test quality checks using [stryker][]
* Commit linting with [commitlint][]
* Pre-commit checks with [husky][]
* Pre-configured package bundling using [tsdown][]
* Fast and disk-efficient dependency management using [pnpm][]
* Type-safety using [typescript][]
* Rapid utility-first styling and theme management using [tailwindcss][]
* Code linting and formatting with [biome][]
* Automated changelog generation using [git-cliff][]
* Tag-driven releases with version management and package publishing to [npm][]

[vitest]: https://vitest.dev/
[stryker]: https://stryker-mutator.io/
[commitlint]: https://github.com/marionebl/commitlint
[husky]: https://github.com/typicode/husky
[biome]: https://biomejs.dev/
[tailwindcss]: https://tailwindcss.com/
[git-cliff]: https://git-cliff.org/
[typescript]: https://github.com/microsoft/TypeScript
[node]: https://nodejs.org
[tsdown]: https://tsdown.dev/
[npm]: https://www.npmjs.com/
[pnpm]: https://pnpm.io/
[npx]: https://www.npmjs.com/package/npx

> [!NOTE]
> Support for other languages is still in the works

## Usage

### Requirements

[Node.js v20+][node]

### Quickstart

The easiest way to start is to call the CLI through [npx][] to generate a new project from one of the provided templates:

```bash
npx tuckshop create typescript-package
```

> [!IMPORTANT]
> Some workflows in the generated projects may require repository secrets to be set in the GitHub project _(Settings → Secrets and variables → Actions)_. Additionally, ensure that "Allow GitHub Actions to create and approve pull requests" is checked in Settings → Actions → General. Make sure to set them to prevent [github action][github-actions] failures before releasing your code out in the world.

`tuckshop` uses a simple tag-driven release workflow for stress-free delivery _(This same workflow is configured for projects generated with `tuckshop`)_. See the [release process](CONTRIBUTING.md#release-process) section in [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Examples

#### Create a public NPM package

```bash
npx tuckshop create typescript-package \
  --name my-package \
  --public
```

#### Create a private internal Typescript library

```bash
npx tuckshop create typescript-package \
  --name internal-utils
```

#### Add registry items to an existing project

```bash
npx tuckshop add button@react workflow \
  --include-instructions \
  --ide-format cursor
```

## Commands Reference

#### `create [template]`

Create a new project from a registry template item. When `template` is omitted, `tuckshop` lists available templates from the registry and prompts you to choose one.

```bash
npx tuckshop create
```

```bash
npx tuckshop create typescript-react-app \
  --name my-app \
  --public \
  --include-instructions \
  --instructions-ide-format cursor
```

**Supported Flags**

- `--name <project-name>`: Name of the project
- `--public`: Optimise for open-source collaboration (license, release workflows, community files)
- `--include-instructions`: Add agent instructions for the chosen template
- `--instructions-ide-format <format>`: IDE format (`cursor`, `windsurf`, `cline`, `claude`)

#### `add [...items]`

Add one or more registry items (components, instruction bundles, file groups) into the **current** project. When no items are provided, `tuckshop` lists addable registry items and prompts you to choose.

```bash
npx tuckshop add button --framework react
```

```bash
npx tuckshop add workflow principles \
  --include-instructions \
  --ide-format cursor
```

**Supported Flags**

- `--framework <framework>`: Target framework for cross-framework items (for example, `react`, `vue`)
- `--ide-format <format>`: IDE format when adding instruction-type items
- `--include-instructions`: Include instruction output for instruction-type items

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to report issues, propose changes, and submit pull requests.

If you create a project with `tuckshop`, you can show support by adding this badge to your README:

![Made with Tuckshop](https://img.shields.io/badge/made_with-tuckshop-EFA607)

```html
<a href="https://github.com/agrawal-rohit/tuckshop"><img alt="Made with Tuckshop" src="https://img.shields.io/badge/made_with-tuckshop-EFA607"></a>
```

## License

[MIT](LICENSE) © [Rohit Agrawal](https://rohit.build/)
