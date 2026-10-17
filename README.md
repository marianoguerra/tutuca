# Tutuca

A SPA framework for humans *and* agents. A full implementation that fits in your head and the
context window.

Tutuca is a complete frontend framework with built-in support for testing: headless tests,
property-based tests derived from your schemas, a storybook with stress testing, a linter, and an
in-progress formal specification in PLT Redex (`spec/`). The core is about 1,800 lines with no
runtime dependencies.

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
| `tutuca` | components, views, schemas, the host |
| `tutuca/dev` | DevTools formatters |
| `tutuca/lint` | the linter |
| `tutuca/util` | the `tag` element builders and `collectClasses` |
| `tutuca/pbt` | property-based testing and the headless driver (bring your own `fast-check`) |
| `tutuca/storybook` | the storybook |
| `tutuca/element` | the `<tutuca-app>` custom element |
| `tutuca/vdom` | the virtual DOM |

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
