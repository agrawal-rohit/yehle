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

## Documentation

Full documentation (features, supported languages, available templates, API reference, and contributing)
lives at [`/docs`](/docs).

## Quickstart

Generate a new package:

```bash
npx yehle package
```

Add agent instructions to an existing repo:

```bash
npx yehle instructions --ide-format cursor
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to report issues, propose changes, and submit pull requests.

If you create a project with `yehle`, you can show support by adding this badge to your README:

![Made with Yehle](https://img.shields.io/badge/made_with-yehle-FEA624)

```html
<a href="https://github.com/agrawal-rohit/yehle"><img alt="Made with Yehle" src="https://img.shields.io/badge/made_with-yehle-FEA624"></a>
```

## License

[MIT](LICENSE) © [Rohit Agrawal](https://rohit.build/)
