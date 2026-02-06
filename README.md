<div align="center">
  <img src="https://cdn.rohit-agrawal.com/work/yehle/logo.png" alt="Yehle" style="width: 30%; margin: auto" />
</div>

<br />

<div align="center">
  <p align="center" style="width: 80%; margin: auto">
    <img alt="Status" src="https://img.shields.io/github/actions/workflow/status/agrawal-rohit/yehle/ci.yml">
    <img alt="Sonar Coverage" src="https://img.shields.io/sonar/coverage/agrawal-rohit_yehle?server=https%3A%2F%2Fsonarcloud.io">
    <img alt="Downloads" src="https://img.shields.io/npm/dt/yehle">
    <img alt="Biome" src="https://img.shields.io/badge/code_style-biome-60a5fa">
    <img alt="License" src="https://img.shields.io/github/license/agrawal-rohit/yehle" />
  </p>
</div>

<div align="center">
  <p>✨ An opinionated <strong>scaffolding CLI</strong> for modern developers ✨</p>
</div>

<br />

<div align="center">
    <img src="https://cdn.rohit-agrawal.com/work/yehle/preview.gif" alt="Yehle Preview" style="margin: auto" />
</div>

<br />

`yehle` is a CLI tool for scaffolding modern software projects by performing common [yak-shaving](https://softwareengineering.stackexchange.com/a/388236) operations through opinionated templates, sensible tooling setup, and development best practices.

I would usually spend hours re-configuring the _"same old tooling and workflow setup"_ for every new project instead of focusing on the actual functionality. `yehle` eliminates that duplicative work by generating a project structure _(based on my personal flavour)_ with essential pieces already configured _(pre-commit hooks, a linter and formatter, build and release workflows, basic documentation, etc.)_ - thus allowing me to build things I'm interested in without the distractions.

## Table of Contents

* [Features](#features)
* [Supported Languages](#supported-languages)
  * [Typescript](#typescript)
* [Usage](#usage)
  * [Requirements](#requirements)
  * [Quickstart](#quickstart)
  * [Examples](#examples)
* [Commands Reference](#commands-reference)
  * [`package`](#package)
* [Contributing](#contributing)
* [License](#license)

## Features

`yehle` sets you up with several best practices adopted in modern software development with pre-configured tooling that should cover most use-cases. `yehle` achieves this through:

* Automatic dependency upgrades using [dependabot][]
* Automatic builds, tests, and releases with [github actions][github-actions]
* Automatically generated Readme with badges through [shields.io][shields]
* Automatically generated MIT license with [spdx][spdx-license-list]
* Automatically generated community files _(contribution guidelines, issue templates, and pull request checklists)_
* A pre-configured [release process](CONTRIBUTING.md#release-process) for preview and production releases
* Opinionated [templates][] that cover common use cases encountered in modern software development

[github-actions]: https://github.com/features/actions
[shields]: https://shields.io/
[spdx-license-list]: https://github.com/sindresorhus/spdx-license-list
[templates]: templates/
[dependabot]: https://github.com/dependabot

## Supported Languages

In addition to the general features listed above, `yehle` also configures language-specific tooling to enable unit testing, type-safety, consistent code linting/formatting, and _much more_. It currently supports the following languages:

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
npx yehle <resource>
```

> [!IMPORTANT]
> Some workflows in the generated projects may require repository secrets to be set in the GitHub project _(Settings → Secrets and variables → Actions)_. Additionally, ensure that "Allow GitHub Actions to create and approve pull requests" is checked in Settings → Actions → General. Make sure to set them to prevent [github action][github-actions] failures before releasing your code out in the world.

`yehle` uses a simple tag-driven release workflow for stress-free delivery _(This same workflow is configured for projects generated with `yehle`)_. See the [release process](CONTRIBUTING.md#release-process) section in [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Examples

#### Create a public NPM package

```bash
npx yehle package \
  --name my-package \
  --lang typescript \
  --template default \
  --public
```

#### Create a private internal Typescript library

```bash
npx yehle package \
  --name internal-utils \
  --lang typescript \
  --template default
```

## Commands Reference

#### <span id="package"></span>`package`

Generate a new `package` for one of the [supported languages](#supported-languages) with sensible defaults, development best practices, and release workflows.
If you're new to `yehle`, I would recommend using the interactive CLI for a guided experience.

```bash
npx yehle package
```

Once you're acquainted, you can skip through most prompts by providing the values through the CLI flags directly.

  ```bash
  npx yehle package \
    --name my-lib \
    --lang typescript \
    --template default \
    --public
  ```

**Supported Flags**

- `--name <project-name>`: Name of the package
- `--lang <language>`: Programming language that the package is built for _(for example, `typescript`)_.
- `--template <template-name>`: The starter template for this package _(for example, `default`, `react`, etc.)_
- `--public`: Whether the package should be optimised for publishing and contributions _(sets up public registry configuration, release workflows, and community files for open-source collaboration)_.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to report issues, propose changes, and submit pull requests.

If you create a project with `yehle`, you can show support by adding this badge to your README:

![Made with Yehle](https://img.shields.io/badge/made_with-yehle-FEA624)

```html
<a href="https://github.com/agrawal-rohit/yehle"><img alt="Made with Yehle" src="https://img.shields.io/badge/made_with-yehle-FEA624"></a>
```

## License

[MIT](LICENSE) © [Rohit Agrawal](https://rohit.build/)
