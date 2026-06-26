# Storybook

Reach this file when authoring `*.dev.js` story modules or running
`tutuca storybook` — defining `getExamples()` sections, mocking requests per
example, or rendering a live component catalog. For the framework primer see
[core.md](./core.md); for the full CLI flag/exit-code table see
[cli.md](./cli.md); for the `getTests` shape see [testing.md](./testing.md).

## Mental model

`tutuca storybook [dir]` recursively discovers co-located `*.dev.js` modules,
mounts them via the shipped `tutuca/storybook` library, and serves an ephemeral
page — no config, no HTML to write. It is **batteries-included by default**:
before serving it runs each module's `getTests()` in the terminal, the page
wires margaui styling, and the browser runs `check(app)`. Each is individually
disablable with a `--no-*` flag. All tutuca specifiers resolve to **one
runtime** — component scope and identity require it.

## The `.dev.js` module

A `*.dev.js` file is a **dev-only module**: it holds stories, tests, and
development-time helpers for nearby components, and is **never shipped to
production or the UI**. The `.dev.js` suffix is the contract — your app imports
its real components directly and never a `.dev.js`, and a production build glob
can exclude `**/*.dev.js`. Because it follows the full module convention, the
same file is a valid target for `tutuca lint` / `test` / `render` too.

| Export | Returns | Used for |
| ------ | ------- | -------- |
| `getComponents()` | `[Comp, ...]` | stories — return **every** component the module defines, children and helpers included. Components dedup by identity, so re-listing a leaf that another module also lists is safe (a composition module can re-list every leaf it uses). |
| `getExamples()` | one section, or an array of sections | the catalog cards |
| `getTests({ describe, test, expect })` | tests | the pre-serve test run (optional) |
| `getMacros()` | `{ name: macro }` | macros referenced in views (optional) |
| `getRequestHandlers()` | `{ name: async fn }` | the module's **real** request handlers (optional) |
| `getRoot()` | `Root.make({...})` | root state when examples need it (optional) |

## Authoring stories (`getExamples`)

Return one section, or an array of sections to group examples under multiple
headings. A section is `{ title, description?, items: [...] }`. An array of one
section behaves exactly like returning that section directly — both go through
the same `Section.fromData`, which **throws** on a malformed section (missing
`title`, not an object) rather than rendering a placeholder title. (If you saw
broken titles from a one-element array in an older build, that predates array
support — it has shipped since well before 0.9.88.)

```js
import { component, html } from "tutuca";
import { Counter } from "./counter.js";

export function getComponents() {
  return [Counter];
}
export function getExamples() {
  return {                                    // one section, or an array of these
    title: "Counter",
    description: "A button that counts clicks.", // optional
    items: [
      { title: "Basic", description: "starts at zero", value: Counter.make({ count: 0 }) },
      { title: "Pre-filled", value: Counter.make({ count: 5 }) },
    ],
  };
}
```

Item fields:

- `title` — required.
- `description?` — shown under the card title.
- `value` — required, the instance to render, usually `Comp.make({...})`.
- `view?` — selects a pushed named view, rendered via `@push-view` in the card.
- `requestHandlers?` — per-example request mocks (next section).
- `on?` — lifecycle hooks; messages sent to `value` as sections are navigated
  ([Lifecycle hooks](#lifecycle-hooks-on)).

The storybook sorts sections by title and renders a sidebar with a filter, so
one example item per meaningful state reads as a state matrix.

## Mocking requests per example

An item's optional `requestHandlers` map holds async functions keyed by request
name that override the module's real `getRequestHandlers()` handler **for that
one example instance only** — so two examples of the same component show
different responses side by side. The three idioms:

```js
items: [
  { title: "Loaded", value: Widget.make({ isLoading: true }),
    requestHandlers: { async load() { return [{ id: 1, name: "Ada" }]; } } },   // fixture
  { title: "Error", value: Widget.make({ isLoading: true }),
    requestHandlers: { async load() { throw new Error("boom"); } } },           // error path
  { title: "Loading", value: Widget.make({ isLoading: true }),
    requestHandlers: { load() { return new Promise(() => {}); } } },            // never resolves
  { title: "Default", value: Widget.make() },         // no mock → real handler / "Request not found"
]
```

How it resolves: the storybook registers one meta-handler per request name. On
dispatch it walks the issuing component's path leaf→root to find the nearest
example carrying a mock for that name (**nearest example wins**), else falls
back to the module's real handler, else surfaces `Request not found: <name>`.
This is **storybook-only** — at runtime your real `getRequestHandlers()` apply.
See [request-response.md](./request-response.md) for the handler contract (the
`ctx` is the handler's final argument). `tutuca storybook --dry-run --json`
lists each example's mocked names.

## Lifecycle hooks (`on`)

An item's optional `on` field declares messages dispatched to the example's
component (`value`) as the user navigates sections — for examples that need to be
"kicked" into a state (load data, open a panel, focus an input) rather than
constructed in it. Three phases:

- **`init`** — the first time a section is displayed, sent to each of its examples.
- **`resume`** — each subsequent time that section is re-displayed.
- **`suspend`** — when a section is navigated away from.

```js
items: [
  { title: "Loaded", value: Grid.make({}),
    on: {
      init:    { request: [{ name: "load", args: [] }] },     // fetch on first show
      resume:  { send:    [{ name: "refresh", args: [] }] },  // re-poll on return
      suspend: { send:    [{ name: "pause", args: [] }] },    // stop work when hidden
    } },
]
```

Each phase holds **action buckets** — `send` (→ a `receive` handler), `bubble`,
`request` (→ a `response` handler), `input` — each an array of
`{ name, args?, opts? }`. `args` is a plain array, or a **function** `(self) =>
[...]` called with the example's component instance:

```js
on: { init: { send: [{ name: "select", args: (self) => [self.firstId()] }] } }
```

For ordering **across** kinds, use `do` — an explicit sequence where each item
carries its own `type`:

```js
on: { init: { do: [
  { type: "send",    name: "reset", args: [] },
  { type: "request", name: "load",  args: [] },   // runs after reset
] } }
```

`request` actions honor the example's `requestHandlers` mocks. A phase message
with no matching handler on the component is a silent no-op.

## Stories as tests (`getTests`)

`getTests` runs through the same machinery as `tutuca test`; the storybook runs
it in the terminal before serving (skip with `--no-tests`). `describe(Comp, fn)`
auto-tags the suite by `Comp.name`:

```js
export function getTests({ describe, test, expect }) {
  describe(Counter, () => {
    test("starts at zero", () => expect(Counter.make({}).count).toBe(0));
  });
}
```

See [testing.md](./testing.md) for the full `getTests` shape and how to call
methods / input / receive / bubble / response / alter handlers.

## Running it

```sh
tutuca storybook                  # scan + serve the current directory
tutuca storybook ./packages/ui    # scan + serve another directory
tutuca storybook --dry-run        # prep + print what would be shown, don't serve (smoke test)
tutuca storybook --dry-run --json # same, machine-readable for agents
tutuca storybook --out ./_site    # write a static index.html + bootstrap instead of serving
tutuca storybook --no-tests       # skip the pre-serve getTests() run
```

Runtime resolution (convention over configuration): a local
`node_modules/tutuca` install if present, else the CLI's own `dist`, else the
version-pinned CDN. `--out` always pins the CDN so the artifact is portable —
host it from the project root so `/*.dev.js` paths resolve. See [cli.md](./cli.md)
for the exhaustive flag list and exit codes.

## Footguns

- ⚠️ `value` must be a real instance (`Comp.make(...)`), not a plain object or
  the class itself — examples need an addressable instance for event dispatch.
- ⚠️ `requestHandlers` mocks are **storybook-only** and per-instance; don't rely
  on them in `getTests` or production code.
- ⚠️ Never import a `.dev.js` from app/production code — the suffix is the
  ship / no-ship boundary.
- ⚠️ An example whose component triggers a request with no real handler and no
  per-example mock surfaces `Request not found: <name>`.
- ⚠️ Keep one tutuca runtime — mixed specifiers or installs break scope identity.

## Verify

After editing a `*.dev.js`: `tutuca lint <module>.dev.js` →
`tutuca test <module>.dev.js` → `tutuca storybook --dry-run --json <dir>`
(smoke-test discovery, counts, and mocked names without serving), then
`tutuca storybook <dir>` to view it live.
