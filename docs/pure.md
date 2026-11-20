# Handlers as pure-js source

`tutuca/pure` (experimental) lets a handler be source text in [pure-js](../pure-js/README.md),
a subset of JavaScript and TypeScript that is checked to do nothing but read the instance,
change the draft and use `ctx`, deterministically, and to end. A handler given as text can come
from storage, a sync peer or a model, and still can't reach the page, the network or the rest
of the app.

```js
import { component, enableHandlerSources, t } from "tutuca";
import { pureHandlers } from "tutuca/pure";

enableHandlerSources(pureHandlers()); // before component() sees a source handler

const TodoList = component({
	name: "TodoList",
	fields: { text: t.string(), items: t.array(t.record({ title: t.string(), done: t.boolean() })) },
	on: {
		add: {
			args: [],
			run: `function (next) {
				const text = this.text.trim();
				if (text === "") return;
				next.items.push({ title: text, done: false });
				next.text = "";
			}`,
		},
	},
});
```

`run` (or the whole `on` entry) as a string is compiled the first time the handler runs,
against the component and the scope it runs in; a handler that doesn't check fails then, with
its diagnostics, and `lint` reports them up front (`handler-source`).

## What a handler sees

| Name | Type |
|---|---|
| `this` | the component, read-only: its fields, its queries (typed by `returns`, or by checking the getter itself), its methods |
| `next` | the component's draft, mutable |
| the args pattern | the handler's `args` types, `unknown[]` without them |
| `ctx` | `sourceKey`, `notify` and `ask` (names from `emits`), `stopNext`, `uuid`, `make(name, fields)`; a pure handler has none |
| `tutuca` | `apply(child, message, ...args)` for pure messages, `errorMessage(e)` |
| the standard host | `Math` (exact functions), `Number`, `JSON`, `Object`, `Array`, `String` |

`t.component("Todo")` is the type `Todo` when `Todo` is in reach; `ctx.event` is not there: pass
what the handler needs from the event as an argument (`targetValue()`).

`components/pure-todo/` is the site's todo list written this way, in the storybook.
`node scripts/pure-corpus.js` checks every handler in the repository as if it were source,
with its component's types, and says why the ones that aren't pure-js aren't.

## A whole component: pure-tutuca

A component can also be written entirely as a module: its state type, and a namespace of the
same name in the shape of `component({...})`, whose methods and getters are checked as
handlers, queries and invariants are. `componentModule(source)` checks and compiles it and
gives ordinary component specs (and its model); tutuca-wax compiles the same text to wasm
([its compiler](../tutuca-wax/pure-tutuca/README.md)), where every component is written so.
`components/pure-todo/todo.tutuca.ts` is the todo list written so, and
[spec/pure-tutuca](../spec/pure-tutuca/README.md) has the conventions and the shared corpus.

```js
import { componentModule } from "tutuca/pure";

const { ok, components, diagnostics } = componentModule(source);
scope.register(components);
```
