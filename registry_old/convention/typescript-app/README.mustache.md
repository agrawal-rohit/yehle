<div align="center">
  <h2>{{ name }}</h2>
</div>

<div align="center">
  <p align="center" style="width: 80%; margin: auto">
    <a href="https://github.com/agrawal-rohit/tuckshop"><img alt="Made with Tuckshop" src="https://img.shields.io/badge/made_with-tuckshop-EFA607"></a>
    {{#public}}
    <img alt="Status" src="https://img.shields.io/github/actions/workflow/status/{{ authorGitUsername }}/{{ name }}/ci.yml">
    {{/public}}
    <img alt="License" src="https://img.shields.io/github/license/{{ authorGitUsername }}/{{ name }}" />
  </p>

[Getting started](#getting-started) • [Scripts](#scripts) • [Project structure](#project-structure){{#public}} • [Contributing](#contributing){{/public}} • [License](#license)

</div>

<br />

A TypeScript application scaffold for building modern web apps and internal tools.

## Getting started

```bash
pnpm install
pnpm dev
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start the Vite dev server |
| `pnpm build` | Production build to `dist/` |
| `pnpm preview` | Preview the production build locally |
| `pnpm typecheck` | Run TypeScript without emitting |
| `pnpm test` | Run tests with Vitest |
| `pnpm cov` | Run tests with coverage |
| `pnpm lint` | Lint with Biome |
| `pnpm format` | Format with Biome |
| `pnpm check` | Typecheck + Biome check |

## Project structure

```
src/
├── App.tsx                 # Empty UI shell — add your app here
├── index.tsx               # App entry (theme + tooltip providers)
├── index.css               # Tailwind + theme tokens
├── components/
│   ├── color-picker.tsx    # Reusable color picker
│   ├── theme-provider.tsx  # Light/dark/system theme
│   └── ui/                 # Button, slider, tabs, select, etc.
└── lib/
    └── utils.ts            # cn() helper
```

{{#public}}
## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to report issues, propose changes, and submit pull requests.
{{/public}}

## License

[MIT](LICENSE){{#public}} © [{{ authorName }}](https://github.com/{{ authorGitUsername }}){{/public}}
