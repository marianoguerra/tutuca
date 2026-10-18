# Tutuca

A small framework for web apps in the browser, small enough to read in full, for people and for
coding agents.

Tutuca covers components, typed state, rendering and event handling, and the tools to check them:
tests that run without a browser, property-based tests generated from your field types, a
storybook with stress tests, and a linter. State changes can be saved or shared with other tabs
and devices through sync engines you plug in ([`docs/sync.md`](docs/sync.md)). A formal model of
the semantics is being written in PLT Redex (`spec/`). The core is about 2,000 lines of
JavaScript with no npm dependencies (it includes a copy of immer).

- Site: https://marianoguerra.github.io/tutuca/
- Storybook: https://marianoguerra.github.io/tutuca/storybook.html

## Install

```sh
npm install tutuca@next
```

Or from a CDN, without a build step:

```js
import { component, h, Host } from "https://cdn.jsdelivr.net/npm/tutuca@next/dist/tutuca.min.js";
```

## Example

```js
import { component, field, h, Host, send } from "tutuca";

const Counter = component({
	name: "Counter",
	fields: (t) => ({ count: t.number() }),
	view: h("button", { "@on.click": send("inc") }, "Clicked ", field("count")),
	on: {
		inc(draft) {
			draft.count += 1;
		},
	},
});

const host = new Host({ document, rootNode: document.getElementById("app") });
host.scope.register({ Counter });
host.start(host.scope.components.Counter());
```

## Modules

| Import | What |
|---|---|
| `tutuca` | components, views, schemas, the host, the `tag` and `button` element builders |
| `tutuca/dev` | DevTools formatters |
| `tutuca/lint` | the linter |
| `tutuca/classes` | `collectClasses`, `classNamesOf` and `ClassCompiler`, for CSS compilers that need class names listed |
| `tutuca/pbt` | property-based testing and the headless driver (bring your own `fast-check`) |
| `tutuca/storybook` | the storybook |
| `tutuca/element` | the `<tutuca-app>` custom element |
| `tutuca/vdom` | the virtual DOM |
| `tutuca/sync` | sync engines: projection, schema-guided diff, ops, `startSynced`, `storageEngine` |
| `tutuca/sync/remote` | an engine that sends diffs to a remote and applies the ones it sends |
| `tutuca/automerge` | an engine over an Automerge document (bring your own `@automerge/automerge`) |

## Docs

- [`docs/paths.md`](docs/paths.md): how update paths, dispatch paths and selectors route messages.
- [`docs/sync.md`](docs/sync.md): persisting and syncing state with sync engines.
- [`spec/README.md`](spec/README.md): the formal semantics in PLT Redex and how it maps to `src/`.

## Development

Tasks are in the `justfile`; `just` lists them.

```sh
just install    # npm install
just check      # lint, then test
just storybook  # serve the storybook from the repo
just site       # build the landing page and storybook into _site/ and serve it
just smoke      # build dist/ and check what would be published
just publish    # publish to npm under the next tag
```

## License

MIT
