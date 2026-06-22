# Tutuca CLI Reference

The `tutuca` CLI inspects, documents, lints, tests, and renders any
module that follows the
[Conventional Module Exports](./core.md#conventional-module-exports)
shape. Reach this file when you need command/flag/exit-code
details, or when reading a lint code out of `lint` output. Otherwise
[Verifying changes](./core.md#verifying-changes) in `core.md` (run
`lint`, then `test` for behavior changes, then
`render --title "<your example>"`) is enough.

## Install / invoke

```sh
# project local
npm i --save-dev tutuca
npx tutuca <command> <module-path> [name] [flags]

# global
npm i -g tutuca
tutuca <command> <module-path> [name] [flags]

# from a checkout of this repo
bun tools/tutuca.js <command> <module-path> [name] [flags]
```

The command comes **first**, the module path second, an optional component
name third. `tutuca help` prints the full reference; `tutuca help <command>`
prints a one-liner. `tutuca` ↔ `tutuca -h` prints overview.
Use `--module=<path>` if the path conflicts with positional parsing.

## Commands

| Command                  | Purpose                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `get <module>`           | Summarize which `getX()` exports are present and counts                                                                |
| `list <module> [name] [--limit n]` | List components with their views and fields (name + type). `--limit n` caps; `0` = all                  |
| `examples <module> [--limit n]` | Print `getExamples()` content (title, items, per section). `--limit n` caps total items; `0` = all                                          |
| `show <module> [name]`   | Show API docs (methods, input handlers, fields with auto-generated accessors) — all or one                             |
| `lint <module> [name]`   | Run the linter; exits **2** on any error-level finding                                                                 |
| `render <module> [name]` | Render examples to HTML in a headless DOM. Filter by component name or `--title`/`--view`. Exits **3** on render crash |
| `test <module> [name]`   | Run tests defined by `getTests({ describe, test, expect })`. Filter by component name, `--grep <pattern>`, or `--bail`. Exits **4** on any failure |
| `storybook [dir]`        | Serve a live storybook for the project, auto-discovering co-located `*.dev.js` modules. Flags: `--port`, `--out`, `--dry-run` (prep + print, don't serve), `--no-margaui`, `--no-check`, `--no-tests`. No module path needed |
| `help [cmd]`             | Show usage. No module path needed                                                                                      |
| `feedback [message]`     | Append a feedback note (positional or stdin) to `~/.tutuca/feedback.jsonl`. No module path needed                      |
| `install-skill [name]`   | Copy a bundled skill (`tutuca`, `margaui`, `immutable-js`, or `--all`) into `.claude/skills/`. No module path needed   |
| `agent-context`          | Print a versioned JSON schema of every command, flag, exit code, and error code. No module path needed                 |

## Global flags

```
    --json                       shorthand for `--format=json`. Recommended
                                 for agent/script callers — error envelopes
                                 are also JSON on stderr (see "Errors" below)
-f, --format <cli|md|json|html>  output format
                                 defaults: get/list/examples/lint → cli
                                           show/render            → md
                                 html only valid for render
                                 json works for every command
-o, --output <file>              write to file instead of stdout
    --pretty                     pretty-print HTML (md/html) via prettier;
                                 JSON formatter uses indent 2
    --module <path>              alternative to second-positional module path
-h, --help                       show help (overview, or for one command)
```

## Exit codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| `0`  | success                                                  |
| `1`  | usage error (bad args, missing module, bad module shape) |
| `2`  | lint findings at error level                             |
| `3`  | render crash                                             |
| `4`  | one or more tests failed                                 |

## Errors

Diagnostics go to **stderr**; structured output goes to **stdout**. Errors
include "did you mean" suggestions for unknown commands and unknown flags
(same shape as lint suggestions).

Under `--json`, errors are emitted as a single-line JSON envelope on stderr:

```json
{"error":{"code":"ERR_USAGE_UNKNOWN_FLAG","message":"Unknown flag '--titel'","suggestion":{"kind":"replace-name","from":"--titel","to":"--title"},"hint":"Valid flags: ..."}}
```

Stable error codes:

| Code                          | When                                          |
| ----------------------------- | --------------------------------------------- |
| `ERR_USAGE_UNKNOWN_COMMAND`   | command name not recognized                   |
| `ERR_USAGE_UNKNOWN_FLAG`      | flag not recognized for the command           |
| `ERR_USAGE_BAD_FLAG_VALUE`    | flag rejected the value (e.g. wrong type)     |
| `ERR_USAGE_MISSING_MODULE`    | command needs a module path but none was given |
| `ERR_USAGE_MISSING_ARGUMENT`  | required positional/stdin missing             |
| `ERR_USAGE_MUTUALLY_EXCLUSIVE`| conflicting flags                             |
| `ERR_FORMAT_UNKNOWN`          | `--format` value not in {cli,md,json,html}    |
| `ERR_FORMAT_UNSUPPORTED`      | format chosen doesn't support the result kind |
| `EXAMPLES_SHAPE_MISMATCH`     | module returned a non-conforming shape        |
| `ERR_SKILL_ASSETS_MISSING`    | bundled skill assets not found                |
| `ERR_SKILL_TARGET_EXISTS`     | install-skill target exists; use `--force`    |

## Examples

```sh
tutuca get ./src/components.js                        # quick overview
tutuca list ./src/components.js                       # components, views, fields
tutuca show ./src/components.js Button --json         # one component, JSON
tutuca render ./src/components.js -f html --pretty -o out/examples.html
tutuca render ./src/components.js Button --title "Disabled state"

# Post-edit verification: lint, then render the example for the feature
# you just changed (add the example first if none covers it). Add
# --pretty when you need to read the HTML to verify structure.
tutuca lint ./src/components.js
tutuca render ./src/components.js --title "Disabled state"
tutuca render ./src/components.js --title "Disabled state" --pretty

# Component-behavior verification: run the suite for one component, or
# narrow further with --grep. Add tests next to the component (the
# getTests() export) when the change isn't observable from render alone.
tutuca test ./src/components.js Counter
tutuca test ./src/components.js Counter --grep "inc()"
tutuca test ./src/components.js --bail
```

## `test` — running component tests

Use `test` after edits that change attributes, instance methods, input
handlers, or static factories — anything observable from JS rather than
from rendered HTML. The module opts in by exporting
`getTests({ describe, test, expect })`:

- `describe(Component, fn)` tags the suite with `Component.name` so
  the positional `[name]` filter can pick it.
- `describe(title, fn)` is untagged; reachable only via `--grep`.
- `describe(title, { component }, fn)` tags an explicit title with a
  custom component name.
- `test(title, fn)` — `fn` may be async; assertions use the injected
  chai `expect`.

Filters:

- `[name]` — only tests whose tagged `componentName` equals `<name>`.
- `--grep <p>` — substring match against the full path
  (e.g. `"Counter > inc() > works on a negative counter"`).
- `--bail` — stop on first failure; remaining tests reported as `skip`.

Default format is `cli` (a tree with ✓/✗/○ and per-test durations);
`-f md` and `-f json` work too.

A worked `getTests()` export covering methods, input handlers (called
via `Comp.input.x.call(inst)`), and immutability:

```js
export function getTests({ describe, test, expect }) {
  describe(Counter, () => {
    describe("inc()", () => {                           // method
      test("returns a Counter with count + 1", () => {
        const next = Counter.make().inc();
        expect(next).toBeInstanceOf(Counter.Class);
        expect(next.count).toBe(1);
      });
      test("does not mutate the original instance", () => {
        const c = Counter.make({ count: 7 });
        c.inc();
        expect(c.count).toBe(7);                    // immutability
      });
    });

    describe("dec()", () => {                           // input handler
      test("returns a Counter with count - 1", () => {
        const next = Counter.input.dec.call(Counter.make());
        expect(next.count).toBe(-1);
      });
    });

    test("inc and dec round-trip", () => {              // untagged path
      expect(Counter.input.dec.call(Counter.make().inc()).count).toBe(0);
    });
  });
}
```

`describe(Counter, fn)` auto-tags the suite path with `Counter.name`, so
`tutuca test <module> Counter` picks it up. Untagged `test(...)` at the
top of a tagged `describe` inherits the tag.

## storybook — live component catalog

`tutuca storybook [dir]` serves a browser storybook for a project with no
setup. It recursively discovers co-located `*.dev.js` modules (see the
`.dev.js` convention below), mounts them via the shipped `tutuca/storybook`
library, and serves an ephemeral page — no config, no HTML to write.

```sh
tutuca storybook                 # scan + serve the current directory
tutuca storybook ./packages/ui   # scan + serve another directory
tutuca storybook --port 4321     # preferred port (falls back to a free one if taken)
tutuca storybook --out ./_site   # write a static index.html + bootstrap instead of serving
tutuca storybook --dry-run       # do all the prep + print what would be shown, don't serve (smoke test)
tutuca storybook --dry-run --json # same, machine-readable for agents
tutuca storybook --no-tests      # skip the pre-serve getTests() run
tutuca storybook --no-margaui    # render unstyled (skip margaui)
tutuca storybook --no-check      # skip the in-browser check(app)
```

It is **batteries-included by default**: before serving it runs each module's
`getTests()` in the terminal, the page wires margaui styling, and the browser
runs `check(app)`. Each is individually disablable with the `--no-*` flags.

How tutuca itself is resolved (convention over configuration): a local
`node_modules/tutuca` install if present, else the CLI's own `dist`, else the
version-pinned CDN. All tutuca specifiers resolve to a single runtime, which
component scope/identity requires. `--out` always pins the CDN so the static
artifact is portable (host it from the project root so `/*.dev.js` paths resolve).

### Authoring `.dev.js` story modules

The `*.dev.js` convention (a dev-only module holding `getComponents()` +
`getExamples()` + `getTests()`, never shipped), the example/section shape, and
per-example request mocking are covered in [storybook.md](./storybook.md).

## Install skill assets

`tutuca install-skill` copies bundled Claude Code skill files into
`.claude/skills/<name>/` so a session in this directory picks them up.

```sh
tutuca install-skill                   # tutuca skill (default), into ./.claude/skills/tutuca/
tutuca install-skill --user            # ~/.claude/skills/tutuca/
tutuca install-skill --margaui-skill   # margaui skill instead of tutuca
tutuca install-skill --immutable-skill # immutable-js skill instead of tutuca
tutuca install-skill --all             # all bundled skills (tutuca + margaui + immutable-js)
tutuca install-skill --dot-agents      # install into ./.agents/skills/ instead of ./.claude/skills/
tutuca install-skill --all --force     # overwrite existing files
tutuca install-skill --dry-run         # print files that would be written, don't touch disk
```

`--user`/`--project` choose scope (default `--project`).
`--margaui-skill`, `--immutable-skill`, and `--all` are mutually exclusive.
`--dot-agents` swaps the `.claude` base for `.agents` (combines with any scope/selection).

## Record feedback

`tutuca feedback` appends a freeform feedback record to
`~/.tutuca/feedback.jsonl` (created on first use). Reach for it when
the CLI, the bundled skills, this reference, or the library itself
was confusing, broken, or surprising — capturing it in the moment
beats reconstructing it later.

```sh
tutuca feedback "lint code FIELD_VAL_NOT_DEFINED didn't suggest the missing field"
echo "render --pretty produced different output than -f html --pretty" | tutuca feedback
tutuca feedback < notes.txt
```

Each record is one JSON object per line: `{ts, version, message}`.
No module path is required. Empty input (no positional, no piped
stdin) exits **1** with a usage error.

## Linter Rules

`lint` reports findings at three levels — **error**, **warn**, **hint** —
and exits `2` if any finding is at error level.

The codes are not duplicated here, to keep this file from drifting out of
sync with the implementation. The authoritative, always-current list of
component-linter codes (code, level, one-line description, grouped by
category) is available straight from the CLI:

- `tutuca help lint` — human-readable table.
- `tutuca agent-context` — machine-readable: the `lintCodes` array, each
  entry `{ code, level, group, summary }`.

Categories include field/method references, input-handler ↔ method
confusion, iteration helpers (`alter`), dynamic bindings (`*name`),
template/event issues, value-expression errors, and unregistered names.
Representative codes: `FIELD_VAL_NOT_DEFINED`, `METHOD_VAL_IS_FIELD`,
`ALT_HANDLER_NOT_DEFINED`, `DYN_VAL_NOT_DEFINED`, `UNKNOWN_DIRECTIVE`,
`UNSUPPORTED_EXPR_SYNTAX`.

`lint` also runs an HTML structural linter (fragment mode) that emits
`HTML_*` codes for malformed or misnested template markup; those are
reported through the same channel.
