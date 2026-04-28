# Tutuca

Zero-dependency batteries included SPA framework.

- **Single file, no build, no dependencies, no setup** — a script tag is all you need
- **Batteries included** — state management, side effects, automatic memoization, drag and drop and more
- **Fits in your head** (and the context window)
- **View source friendly** — step through the whole stack
- **As much HTML as possible, as little JS as needed**
- ~169KB minified, ~37KB brotli compressed

## Quick Start

For an interactive walk-through with editable examples, see the
[tutorial](https://marianoguerra.github.io/tutuca/tutorial.html).

### CDN (no install)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tutuca: Getting Started</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import { component, html, tutuca } from "https://esm.sh/tutuca";

      const Counter = component({
        name: "Counter",
        fields: {
          count: 0,
        },
        methods: {
          inc() {
            return this.setCount(this.count + 1);
          },
          dec() {
            return this.setCount(this.count - 1);
          },
        },
        view: html`<div>
          <button @on.click=".dec">-</button>
          <div @text=".count"></div>
          <button @on.click=".inc">+</button>
        </div>`,
      });

      function main() {
        const app = tutuca("#app");
        app.state.set(Counter.make({}));
        app.registerComponents([Counter]);
        app.start();
      }

      main();
    </script>
  </body>
</html>
```

## CLI

Tutuca ships a single-file CLI (`dist/tutuca-cli.js`) for inspecting, linting,
documenting, and rendering components defined in an ES module. The module just
needs to export `getComponents()` and, for render-time commands, `getExamples()`
in the storybook shape `{ title, description?, items: [{ title, description?, value, view? }] }` (a single section, or an array of sections).

### Setup

```sh
npm install --save-dev tutuca
# prettier is optional, only needed for --pretty
npm install --save-dev prettier
```

The package exposes `tutuca` via `bin`, so `npx tutuca` (or a global `npm i -g tutuca`) just works. `jsdom` ships as a regular dependency (it's needed by `render` and `lint`) and is installed automatically.

### Commands

```
tutuca <module-path> <command> [args] [flags]
tutuca help [command]
```

| Command | What it does |
|---|---|
| `info` | Export inventory and counts for the module |
| `list` | List components and their fields/views |
| `examples` | List the examples defined in the module's section |
| `docs [name]` | Component API docs — all, or one by name |
| `lint [name]` | Run lint checks — all, or one by name (exit 2 on errors) |
| `render [name] [--title t] [--view v]` | Render examples to HTML |
| `install-skill [--user] [--force]` | Install the tutuca Claude Code skill (no module path needed) |

Global flags: `-f, --format <cli\|md\|json\|html>`, `-o, --output <file>`, `--pretty`, `-h, --help`.

Exit codes:

- `0` — success
- `1` — usage error (bad args, missing module, bad module shape)
- `2` — `lint` reported errors
- `3` — `render` crashed while rendering

All module-consuming commands (`info`, `list`, `examples`, `docs`, `lint`, `render`) follow this table.

### Usage examples

```sh
# Summary of what the module exports
npx tutuca ./src/components.js info

# API docs for one component, as markdown
npx tutuca ./src/components.js docs Button --format md -o docs/button.md

# Render every example to HTML, pretty-printed
npx tutuca ./src/components.js render --format html --pretty -o dist/examples.html

# Render a single named example
npx tutuca ./src/components.js render Button --title "Disabled state"

# Lint just one component (exit 2 if findings)
npx tutuca ./src/components.js lint Button

# Post-edit verification: lint, then render the example covering the
# feature you just changed.
npx tutuca ./src/components.js lint
npx tutuca ./src/components.js render --title "Disabled state"
```

### Wrapping

The invocation stays short even without wrapping, but common patterns:

- **`package.json` scripts** — `"docs": "tutuca ./src/components.js docs"`
- **Shell alias** — `tut() { npx tutuca ./src/components.js "$@"; }`, then `tut render Button`
- **`justfile` / `Makefile`** — one recipe per subcommand, passing through positionals
- **Programmatic** — `import "tutuca/cli"` (the bundled entry) for custom build integration

## Use with Claude Code

Tutuca ships an LLM-facing reference (`SKILL.md` + `core.md` / `cli.md` /
`advanced.md`) packaged as a [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills).
Once installed, Claude auto-loads it whenever a session touches tutuca
components, views, macros, or the CLI.

```sh
# project-scoped: writes ./.claude/skills/tutuca/ (commit it for the team)
npx tutuca install-skill

# or user-scoped: writes ~/.claude/skills/tutuca/
npx tutuca install-skill --user

# overwrite an existing install
npx tutuca install-skill --force
```

The skill content is generated from `docs/llm/`, so the same reference
runs locally (`tutuca <module> lint` + `tutuca <module> render --title …`)
and inside Claude.

## License

MIT

## Links

- [Documentation & Playground](https://marianoguerra.github.io/tutuca/)
- [Tutorial](https://marianoguerra.github.io/tutuca/tutorial.html)
- [GitHub](https://github.com/marianoguerra/tutuca)
