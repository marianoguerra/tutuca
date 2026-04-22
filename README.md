# Tutuca

Zero-dependency batteries included SPA framework.

- **Single file, no build, no dependencies, no setup** — a script tag is all you need
- **Batteries included** — state management, side effects, automatic memoization, drag and drop and more
- **Fits in your head** (and the context window)
- **View source friendly** — step through the whole stack
- **As much HTML as possible, as little JS as needed**
- ~107KB minified, ~29KB brotli compressed

## Quick Start

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
in the storybook shape `{ title, description?, groups?, items: [{ title, description?, value, view? }] }`.

### Setup

```sh
npm install --save-dev tutuca jsdom
# prettier is optional, only needed for --pretty
npm install --save-dev prettier
```

The package exposes `tutuca` via `bin`, so `npx tutuca` (or a global `npm i -g tutuca jsdom`) just works. `jsdom` is a peer dep because it's only needed for `render`, `lint`, `doctor`, and `stresstest`.

### Commands

```
tutuca <module-path> <command> [args] [flags]
tutuca stresstest [--iterations N] [--seed S]
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
| `doctor` | Lint + render smoke test over the whole module |
| `stresstest` | VDOM fuzz test, no module required |

Global flags: `-f, --format <cli\|md\|json\|html>`, `-o, --output <file>`, `--pretty`, `--quiet`, `-h, --help`.
Exit codes: `0` ok, `1` usage, `2` lint errors, `3` render crash.

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

# CI smoke test — lints and renders everything
npx tutuca ./src/components.js doctor

# Fuzz the VDOM engine
npx tutuca stresstest --iterations 10000 --seed 42
```

### Wrapping

The invocation stays short even without wrapping, but common patterns:

- **`package.json` scripts** — `"docs": "tutuca ./src/components.js docs"`
- **Shell alias** — `tut() { npx tutuca ./src/components.js "$@"; }`, then `tut render Button`
- **`justfile` / `Makefile`** — one recipe per subcommand, passing through positionals
- **Programmatic** — `import "tutuca/cli"` (the bundled entry) for custom build integration

## License

MIT

## Links

- [Documentation & Playground](https://marianoguerra.github.io/tutuca/)
- [Tutorial](https://marianoguerra.github.io/tutuca/tutorial.html)
- [GitHub](https://github.com/marianoguerra/tutuca)
