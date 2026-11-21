# pure-tutuca

A tutuca component written as a [pure-js](../../pure-js/README.md) module, in the shape of
tutuca's `component({...})`. The same text loads in tutuca JS (`componentModule` in
`tutuca/pure`) and is what tutuca-wasm compiles to wasm, so a component is checked once, by one
set of rules, and means the same in both runtimes.

```ts
import { button, div, field, send, span } from "tutuca/view";

export type Counter = { count: number; step: number; readonly doubled: number };

export const Counter = {
	defaults: { count: 0, step: 1 },
	constraints: { count: { int: true, min: 0, max: 100 } },
	queries: { get doubled(): number { return this.count * 2; } },
	on: {
		inc: { pure: true, changes: ["count"], run(next, []: []) { next.count = this.count + this.step; } },
	},
	view: div({}, span({}, field("count")), button({ "on:click": send("inc") }, "+")),
};
```

## A component

A **component** is a type and a constant of the same name (TypeScript lets a type and a value
share one). The type is its **state**: its fields, and its queries as `readonly` members (so
`this` has them and `next` can't set them). The constant is a pure-js namespace: data members
say what isn't code, methods and getters are its entries.

| Member | What it is |
|---|---|
| `defaults` | each field's default, typed as the state's fields (all optional) |
| `constraints` | per field: `int`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `keyOf: "f"` (an index of field `f`), tutuca's type options by the same names (a field's type is its state member's type with them, its default, sync and public: data `componentModule` hands to `component()` as it is); a getter's, under its name, constrain what it gives (`share: { min: 0, max: 1 }`) |
| `sync`, `public` | per field: its sync level; the fields that are also queries |
| `queries` | getters (`get q(): T`) and methods with arguments |
| `on` | messages: `{ run, pure?, changes?, constraints?, why?, pre?, post?, sourceKey?, swap? }`; `constraints` are the arguments', by name, as a component's are its fields' (`{ n: { int: true } }`, `{ from: { keyOf: "items" } }`); a `swap` message's `run` returns the component it becomes (`ctx.make(...)`), or nothing to stay; what a message emits is read from its literal `ctx.notify`, `ctx.ask` and `ctx.make` calls |
| `answers` | an ask's answers: `{ a: { ok(next, [value], ctx), error(next, [error], ctx), unhandled(next, [], ctx) } }`, each as `run` |
| `examples` | `{ e: { start: { f: v }, steps: [{ send: "m", args }, { expect: { f: v } }] } }`: regression tests, an expect saying each field or query it names has the value |
| `invariants` | `n(): boolean` |
| `init` | `init(next, ctx)`: what finishes the component made from its fields, as tutuca's `init` (it runs each time one is made, `this` the fields as made); its `ctx` makes the components it holds (`ctx.make(name, fields)`), and nothing else |
| `view`, `views` | tag calls, from `tutuca/view` |
| `loops` | per loop, its hooks (`this` the state): `prepare(items)` gives what the others get last, `iter(items, prepared)` the `[key, item][]` the loop goes over, `key(key, item, prepared)` and `filter(key, item, prepared)` as tutuca calls them, and `enrich(key, item, prepared)` the binds the loop's body reads with `lookupBind`, all as tutuca calls them |
| `binds` | per scope: a method giving the record `withBinds("s", child)` puts in scope |
| `provides` | per name: a static path, as tutuca's: a field's name (`theme: "theme"`), or `{ seqItem: "tags", keyField: "current" }`, the list's item at a field's key; what descendants read with `provided("theme")` |
| `meta`, `implements` | as tutuca's component options (`implements` names interfaces, resolved where the component is registered) |

## Entries and their signatures

pure-js checks each entry against the signature its path gives it:

| Path | this | Parameters | Result |
|---|---|---|---|
| `C.on.m.run` | read C | `next`: draft C, the args (the run's annotation, `[]: []`, `[a]: [T]`), `ctx` unless `pure` | void |
| `C.on.m.pre` | read C | prev: read C, the args, info | boolean |
| `C.on.m.post` | read C | prev, next: read C, the args, info | boolean |
| `C.queries.q` | read C | as annotated | inferred |
| `C.invariants.n` | read C | | boolean |
| `C.answers.a.o` | read C | as `run` | void |
| `C.loops.l.key` | read C | as annotated: `(key, item)` | inferred |
| `C.init` | read C | `next`: draft C, `ctx`: its init handle | void |

`ctx` is tutuca's handler context, typed by a handle made for each handler: `sourceKey` (a number when the handler says
`sourceKey: { keyOf: "f" }`), `drag` (in a drag event, what is dragged: its `type`, the
`data-dragtype`, its `value` when the drag started and its `key`, the key of the child it came
from, null from elsewhere; null with no drag), `notify(name, args)` with the names of the `<C>Notifies`
interface, `ask(name, args)` with those of `<C>Asks` (whose results type the answers),
`sendAt(name, args, path)` (a message to the component at path, as tutuca's: `"f"`, `{ item: "f", key }`, `{ seqItem: "f", keyField: "g" }` or an array of steps),
`log(value)` (in the task's transition's `logs`), `stopNext()`, `uuid()` and `now()`
(nondeterministic), `make(name, fields)` for each component and interface in the module,
`tryMake(name, fields?)` for any name, whose result is `{ ok: the component }` or `{ err: {
error, issues } }` (test `r.err !== undefined`: pure-js has no `in`), `componentNames(walk?)`,
the names the handler's scope can make, sorted, with `walk` its parents' too, and `metaOf(name,
uri)`, what the type the scope makes as `name` says under `uri` (over its meta schema's
defaults), null when the scope can't make it. A message's handle is `Ctx_<C>_<message>`, an
answer's `Ctx_<C>_<ask>Answer` (a message and an answer may share a name).

A module's other top-level names: `register` (`{ Component: "name it's registered as" }`),
`askHandlers` (a namespace whose methods answer asks now, wherever the module is registered:
`loadCount(): number { return 42; }`, its parameters the ask's arguments, then maybe the
asker's context, typed `AskCtx`: `componentNames(walk?)` and `metaOf(name, uri)` of the asker's
scope, `log(value)` (the asked transition's logs), `now()` and `uuid()`; it only answers, so it
sends nothing) and `hostAsks` (the names of the asks the host answers). `componentModule` gives
`askHandlers` as `scope.registerAskHandlers` takes them.

## Types

A field's type is its state member's TypeScript type, as tutuca's type data: `number`,
`string`, `boolean`, a union of strings (an `enum`), `T | null` (an `option`), `T[]`, `{ [key:
string]: T }`, a record, `unknown` (any), a component or interface of the module by its name,
and `Component`, the host's type for any component (its members can't be read). A union of
components and interfaces (`JsonNull | JsonValue`) is one component type of those names
(tutuca's `t.component(names)`): any of them, made as the first when it's a component and the
field isn't given, so `JsonNull | JsonValue` reads "a JsonNull unless another JsonValue is
given".

## Interfaces

An `interface` declaration is a tutuca interface (a `type` is data), but `<C>Notifies` and
`<C>Asks`, which list a component's signals, and a component's own state type: children are
typed by it, a component `implements` it by name, and `tutuca.apply(child, "setDone", true)` is
typed by its methods that return the marker type `Pure` (a pure message a holder applies), as by
the components' own pure messages; methods that return `Notify` are what it tells its holder.
`componentModule` gives them as `interfaces`, what `scope.registerInterfaces` takes.

## Component modules importing each other

A module imports another component module's types with `import type`, by a specifier that ends
in `.tutuca` (the file is `.tutuca.ts`):

```ts
import type { TodoItem as TodoItemInterface } from "../todo_list/todo_list.tutuca";

export type TodoItem = { id: number; text: string; done: boolean };
export const TodoItem = { implements: ["TodoItem"], ... };
```

tutuca reads that import, not pure-js, whose modules share one namespace of types (a module
couldn't implement an interface of the name of its own component): each type it names is a type
of the module's code by its local name, an interface among them a component type (made by its
own name: `ctx.make("TodoItem")`), and the loader takes the other module's interfaces
and meta schemas (`implements` and `meta` are checked against them as the module is built). Only types are imported; a value import is rejected
(`pure-tutuca::import`), as is a name the other module doesn't declare.

## Meta schemas

A const object that says `metaSchema: "uri"`, with a type of its name, is a **meta schema**
(tutuca's `registerMetaSchemas`): what components may say under the URI. Its type's members
are its fields, and `defaults` and `constraints` are a component's (a `T | null` field
defaults to null; `{ int: true }` constrains the number, null still meets it):

```ts
export type Canvas = { width: number | null; transparent: boolean };
export const Canvas = {
	metaSchema: "https://tutuca.dev/meta/canvas",
	defaults: { transparent: false },
	constraints: { width: { int: true, min: 0, max: 4000 } },
};
```

`componentModule` gives them as `metaSchemas` (`{ uri: { key: type } }`, what
`scope.registerMetaSchemas` takes) and the model lists them (`metaSchemas`: name, uri, fields).
tutuca-wasm registers them where the module is registered, and a module that imports
one's type gives its meta under it (`tutuca-wasm/components/meta/meta.tutuca.ts`).

## Views

`import { div, field, send, ... } from "tutuca/view"` gives tutuca's tag functions (HTML's, and
SVG's and MathML's, which render in their namespaces under `svg` and `math`; `h(name, ...)` for
the rest, custom elements among them) and view constructors as a host module, with tutuca's
arguments: `each(source, child, loop?)`, `renderEach(source, loop?)`, `render(source, view?)`,
`renderIt(view?)`, `withBinds(scope, child)`, `pushView(view, child)`, `seqItem(list, keyField)`;
`eventKey()` is a key event's key, `eventProperty(name)` a property of the event (a
`CustomEvent`'s `detail`). `$if` and `$query` are `when` and `query` here: pure-js leaves
names that start with `$` to its compiler. An event's handler is `"on:type+modifier..."`, as
tutuca's (`"on:keydown+enter+prevent"`). A send's arguments are what the event gives
(`sourceKey()`, `targetValue()`, `dragKey()`, `eventKey()`, `eventProperty(name)`): one that
reads the state (`field`, `seqItem`, `provided`, `query`) is not valid there, and tutuca's lint
rejects it; send the item's `sourceKey()` and
read it in the handler. A view is evaluated once, as the module loads, so a string made of the
module's constants (`` `${MONO} text-info` ``, `BASE + " active"`) is a constant there (a class
a page can see).

## tutuca/data

What pure-js leaves out that components need, the same in both runtimes: `range(start, end)`,
`without(record, key)`, `kindOf(value)` and `get(value, key)`, an object's own member or a
list's item of a value pure-js types `unknown` (what's dragged, JSON), `undefined` otherwise;
`typeof` then says what it is (`const id = get(ctx.drag.value, "id"); if (typeof id ===
"number") ...`); `itemsOf(value)`, an `unknown` list's items (`[]` for anything else), and
`keysOf(value)`, an `unknown` object's own keys, to walk it; `toJson(value, indent)`, `JSON.stringify(value, null, indent)` (`"null"` for undefined);
and `parseJson(text)`, `JSON.parse` (undefined when the text isn't JSON).

A page's own host modules (the micro-agents' engines) are declared the same way, a specifier, a
module name and its members' signatures, and the page defines each member as `Module.member`;
what one returns is checked against its declared type.

## The model

`componentModule` gives, besides the components, their **model** (format 2): each component's
fields (name, type as TypeScript, constraints, default, sync, public), queries and their
types, messages (args, pure, changes, sourceKey, pre, post, why), invariants, views, meta and
implements; the interfaces; the meta schemas; the entries' return types. The corpus, `conformance/` (`accept/`
and `reject/`, one module each, a reject's `@expect` the code it is rejected with), records it
in `golden/` (`node scripts/pure-tutuca-goldens.js`), and any other loader is held to the same
files. tutuca-wasm loads modules with the same loader, and its tests hold its runtime to what
tutuca does with each (`tutuca-wasm/test/`).
