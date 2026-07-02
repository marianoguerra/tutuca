# Tutuca

Batteries included SPA framework with a dependency-free browser bundle.

- **Single file, no build, no dependencies, no setup** — a script tag is all you need
- **Batteries included** — state management, side effects, automatic memoization, drag and drop, testing, CLI tooling, LLM skills and more
- **Fits in your head** (and the context window)
- **View source friendly** — step through the whole stack
- **As much HTML as possible, as little JS as needed**
- ~182KB minified, ~41KB brotli compressed (the core browser bundle; the dev build adds linting and test helpers)

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
      import { component, html, tutuca } from "https://cdn.jsdelivr.net/npm/tutuca/+esm";

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
          <button @on.click="$dec">-</button>
          <div @text=".count"></div>
          <button @on.click="$inc">+</button>
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

## Concepts at a Glance

Each concept has a tutorial section with editable live examples:

- **[Components & state](https://marianoguerra.github.io/tutuca/tutorial.html#basics)** —
  typed `fields` with auto-generated mutators (`setCount`, `toggleOpen`, …),
  views as pure functions of a single immutable state tree
  ([state & updates](https://marianoguerra.github.io/tutuca/tutorial.html#state-and-updates))
- **[Collections](https://marianoguerra.github.io/tutuca/tutorial.html#collections)** —
  iterate with `@each`, filter with `@when`, paginate with `@loop-with`
- **[Rendering components](https://marianoguerra.github.io/tutuca/tutorial.html#rendering-components)** —
  compose with `<x render>`, multiple views per component, scoped styles
- **[Component communication](https://marianoguerra.github.io/tutuca/tutorial.html#component-communication)** —
  bubble events up the tree, send messages to a target, run async work with
  request/response
- **[Macros](https://marianoguerra.github.io/tutuca/tutorial.html#macros)** —
  reusable markup fragments with parameters and slots
- **[Escape hatches](https://marianoguerra.github.io/tutuca/tutorial.html#escape-hatches)** —
  drag and drop, web components, raw HTML
- **[Testing](https://marianoguerra.github.io/tutuca/tutorial.html#testing)** —
  `getTests()` suites run by the CLI or in the browser, plus a
  [linter](https://marianoguerra.github.io/tutuca/tutorial.html#linter-reference)
  that catches template mistakes before they render blank

## CLI

Tutuca ships a single-file CLI (`dist/tutuca-cli.js`) for inspecting, linting,
documenting, and rendering components defined in an ES module. The module just
needs to export `getComponents()` and, for render-time commands, `getExamples()`
in the storybook shape `{ title, description?, items: [{ title, description?, value, view? }] }` (a single section, or an array of sections).
Expose **all** of your app's components through `getComponents()` — components
left out are invisible to `lint`/`render`/`test` and silently lose coverage.

### Setup

```sh
npm install --save-dev tutuca
```

The package exposes `tutuca` via `bin`, so `npx tutuca` (or a global `npm i -g tutuca`) just works. `jsdom` (needed by `render` and `lint`) and `prettier` (used by `--pretty`) ship as regular dependencies and are installed automatically.

### Commands

```
tutuca <command> <module-path> [args] [flags]
tutuca help [command]
```

| Command | What it does |
|---|---|
| `get <module>` | Export inventory and counts for the module |
| `list <module> [name] [--limit n]` | List components and their fields/views (`--limit n` caps, `0` = all) |
| `examples <module> [--limit n]` | List the examples defined in the module's section (`--limit n` caps, `0` = all) |
| `show <module> [name]` | Component API docs — all, or one by name |
| `lint <module> [name]` | Run lint checks — all, or one by name (exit `2` on errors) |
| `render <module> [name] [--title t] [--view v]` | Render examples to HTML (exit `3` on render crash) |
| `test <module> [name] [--grep p] [--bail]` | Run `getTests()` (exit `4` on failures) |
| `storybook [dir]` | Serve a live storybook, auto-discovering co-located `*.dev.js` modules (`--port`, `--out`, `--dry-run`, `--no-margaui`, `--no-check`, `--no-tests`; no module path needed) |
| `feedback [message]` | Append a feedback note (positional or stdin) to `~/.tutuca/feedback.jsonl` (no module path needed) |
| `install-skill [--user\|--project] [--margaui-skill\|--immutable-skill\|--all] [--dot-agents] [--dry-run] [--force]` | Install bundled Claude Code skills (no module path needed) |
| `agent-context` | Print a versioned JSON schema of the entire CLI surface (no module path needed) |

Global flags: `--json`, `-f, --format <cli\|md\|json\|html>`, `-o, --output <file>`, `--pretty`, `--module <path>`, `-h, --help`.

`storybook` wires [MargaUI](https://github.com/marianoguerra/margaui) — a
Tailwind v4 / daisyUI-compatible class library — by default; `--no-margaui`
skips it. For the full flag reference, error codes, and "did you mean"
behavior, run `tutuca help <command>`, or `tutuca agent-context` for a
machine-readable schema of the whole surface.

### Usage examples

```sh
# Summary of what the module exports
npx tutuca get ./src/components.js

# API docs for one component, as markdown
npx tutuca show ./src/components.js Button --format md -o docs/button.md

# Render every example to HTML, pretty-printed
npx tutuca render ./src/components.js --format html --pretty -o dist/examples.html

# Post-edit verification: lint, then render the example covering the
# feature you just changed.
npx tutuca lint ./src/components.js
npx tutuca render ./src/components.js --title "Disabled state"
```

## Use with Claude Code

Tutuca ships an LLM-facing reference (`SKILL.md` plus topic files such as
`core.md`, `cli.md`, `advanced.md`, `testing.md`, `storybook.md`, and more)
packaged as a [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills).
Once installed, Claude auto-loads it whenever a session touches tutuca
components, views, macros, or the CLI.

```sh
# project-scoped: writes ./.claude/skills/tutuca/ (commit it for the team)
npx tutuca install-skill

# or user-scoped: writes ~/.claude/skills/tutuca/
npx tutuca install-skill --user

# companion skills: MargaUI class lists, or Immutable.js (the values
# tutuca state is made of) — or install all three
npx tutuca install-skill --margaui-skill
npx tutuca install-skill --immutable-skill
npx tutuca install-skill --all

# install into ./.agents/skills/ instead of ./.claude/skills/
npx tutuca install-skill --dot-agents

# overwrite an existing install
npx tutuca install-skill --force
```

The skill content is generated from `docs/skill/`, so the same reference
runs locally (`tutuca lint <module>` + `tutuca render <module> --title …`)
and inside Claude.

## Links

- [Documentation & Playground](https://marianoguerra.github.io/tutuca/)
- [Tutorial](https://marianoguerra.github.io/tutuca/tutorial.html)
- [GitHub](https://github.com/marianoguerra/tutuca)

## License

MIT
