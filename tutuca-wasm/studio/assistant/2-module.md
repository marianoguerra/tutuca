# A component module

A component module, `name.tutuca.ts`, is TypeScript in a checked subset (pure-js). A component
is a type and a constant of the same name: the type is its state (its fields, and its queries
as `readonly` members), the constant says the rest. Names are camelCase, types and components
PascalCase, and they reach the runtime as written (the message `setText` is `"setText"`).

```ts
import { button, div, field, input, li, send, span, targetValue, when } from "tutuca/view";

/** A line of the cart. */
export type CartLine = {
	name: string;
	price: number;
	qty: number;
	/** price × qty. */
	readonly total: number;
};

export const CartLine = {
	defaults: { name: "", price: 0, qty: 1 },
	constraints: { price: { min: 0 }, qty: { int: true, min: 1, max: 99 } },
	queries: {
		get total(): number {
			return this.price * this.qty;
		},
	},
	on: {
		setQty: {
			pure: true,
			changes: ["qty"],
			constraints: { qty: { int: true, min: 1, max: 99 } },
			post(prev, next, [qty]: [number]) {
				return next.qty === qty;
			},
			run(next, [qty]: [number]) {
				next.qty = qty;
			},
		},
	},
	view: li({}, field("name"), " × ", field("qty"), " = ", field("total")),
};

export const register = { CartLine: "CartLine" };
```

## Types

A field's type is its TypeScript type: `number` (a whole number is `{ int: true }` in
`constraints`), `string`, `boolean`, a union of strings (`"all" | "open" | "done"`), `T | null`
(an optional value, null by default), `T[]`, `{ [key: string]: T }`, a record `{ a: T; b: U }`,
`unknown` (any JSON value), a component of the module by its name, an interface, and `Component`
(any component). A union of components (`JsonNull | JsonValue`) holds any of them, and is made as
the first one when the field isn't given. Declare record types with `type`, and give them names
when more than one place uses them.

## What a component says

- `defaults`: each field's value when it isn't given, as JSON (a field of a component type is
  made as its component); give every field one, so a layout's hole can make the component with
  no fields.
- `constraints`: per field, `int`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `keyOf:
  "f"` (a key of the field `f`); under a query's name, what it gives must meet them.
- `sync: { menu: "none" }`: transient state (an open menu, a hover) that a saved layout leaves
  out.
- `queries`: getters (`get total(): number`), computed from `this`; and methods with
  arguments, which a view reads with `query("name", args...)`.
- `on`: the messages, each `{ run, pure?, changes?, constraints?, pre?, post?, sourceKey?, swap?
  }`. `run(next, [args]: [types], ctx)` changes `next` (a draft of the state: assign its fields,
  push to its lists) and reads the state before in `this`; `changes` lists the only fields it may
  change (`[]` for none); `pre(prev, [args])` is a guard on the state, `post(prev, next, [args])`
  relates the state after to the one before; `constraints` constrain the arguments, by name.
  `pure: true` makes a message whose `run` takes no `ctx`: it changes only this state, so a
  component holding this one can apply it with `tutuca.apply(child, "name", args...)` (make every
  message that doesn't need `ctx` pure). `swap: true` makes `run` return the component that takes
  this one's place (`return ctx.make("Other")`), or nothing to stay. `sourceKey: { keyOf: "items"
  }` says the message arrives from a child (a notify), and `ctx.sourceKey` says which.
- `answers`: an ask's answers, `{ name: { ok(next, [value]: [T], ctx), error(next, [error]:
  [unknown], ctx) } }`, each as a `run`; `tutuca.errorMessage(error)` is an error's text.
- `invariants: { name(): boolean }`: what every state must meet, checked in dev mode.
- `init(next, ctx)`: what finishes the component made from its fields; its `ctx` only makes
  components (`ctx.make("Hole")`).
- `loops: { name: { filter, enrich, key, prepare } }`: hooks for an `each` over a list field,
  named by its third argument: `filter(key, item, prepared): boolean` decides which items render,
  `enrich(key, item, prepared)` gives the binds its body reads with `lookupBind("b")`, `key` an
  item's sibling key, `prepare(items)` something computed once for the others.
- `meta: { "https://tutuca.dev/meta/display": { title, icon, description } }`: how pickers show
  it. A class the state computes (in an `enrich`) is listed in `"https://tutuca.dev/meta/classes":
  { classes: "a b c" }`, so the CSS has it.
- `view` and `views`: the main view, and others by name; `layoutEdit` is the one studio screens
  push while they're edited. A component with no view renders nothing.
- `examples: { name: { start: { field: value }, steps: [{ send: "m", args: [1] }, { expect: {
  field: value } }] } }`: what the studio's tests run; an expect names fields or queries.

The module's other names: `export const register = { Name: "Name" }` (what it registers, under
which names), `export const askHandlers = { name(args): T { ... } }` (asks the module answers
now; a last parameter `ctx: AskCtx` reads the asker's scope, `ctx.componentNames(walk)` and
`ctx.metaOf(name, uri)`, and has `ctx.log`, `ctx.now()` and `ctx.uuid()`; it sends nothing), and
`export const hostAsks = ["name"]` (asks the host answers).

## Signals: notifies and asks

`export interface <C>Notifies { removeMe(): void; }` lists what `C` tells its parent, with
`ctx.notify("removeMe", [])`; the parent handles a message of the same name (with `sourceKey`
to know which child). `export interface <C>Asks { suggest(taken: number): Idea; }` lists the
questions `C` asks, with `ctx.ask("suggest", [n])`; the answer arrives in `answers.suggest.ok`.

## The handler's ctx

`ctx.make(name, fields?)` a component of the module; `ctx.tryMake(name, fields?)` one by a name
only known when it runs, `{ ok }` or `{ err: { error, issues } }` (test `r.err !== undefined`);
`ctx.componentNames(walk?)`; `ctx.notify`, `ctx.ask`; `ctx.sendAt(name, args, path)` a message
to a child (`"field"`, `{ item: "items", key }`, or `[]` for itself); `ctx.sourceKey`;
`ctx.drag` (what's dragged: `{ type, value, key }`, or null); `ctx.uuid()`, `ctx.now()`;
`ctx.log(value)`; `ctx.stopNext()`.

## What the code can be

Functions are top-level `function name(params): T { }` helpers, and the components' methods.
There's no `while` (`for (const x of list)` with `break` and `continue`, and `range(start, end)`
from `tutuca/data` for counting), no recursion, no classes, no `try`, no `in`, no function
values (call a helper; give a callback inline: `items.filter((it) => !it.done)`), and no
indexing inside an optional chain (`list.at(i)?.name`, not `list[i]?.name`). A list's index
read gives `T | undefined`: check it (`const it = this.items[at]; if (it === undefined) return;`).
`tutuca/data` also has `get(value, key)` (an `unknown`'s member or item, then narrowed with
`typeof`), `itemsOf(value)` (an `unknown` list's items), `keysOf(value)` (an `unknown` object's keys), `kindOf(value)`, `without(record,
key)`, `toJson(value, indent)` and `parseJson(text)`. `Math`, `Number`, `String`, `Object.keys`,
`Object.entries` and the usual string and list methods work.

## Views

A view is tag calls from `tutuca/view`: `tag({ attributes }, children...)`, the attributes
object first (`{}` for none). Text is a string; `field("count")` reads a field or query (inside
an `each` body, the item's).

- `when(test, then, otherwise?)`: `test` is `field(x)`, `lookupBind(x)` or `query("q", args)`;
  truthy is true, a non-empty string, a non-zero number, a non-empty list. A view doesn't
  compare: add a query (`get filtered(): boolean { return this.show !== "all"; }`).
- `each(field("items"), body, "loop")`: the body for each item; `renderIt()` renders the item
  when it's a component, `lookupBind("b")` reads the loop's enrich binds, `sourceKey()` is the
  item's key. `render(field("child"))` renders a component field (nothing while it's null);
  `renderEach(field("items"), "loop")` each component of a list.
- `pushView("name", body)` renders the components in body with their view `name` when they
  have one; `h("tag", ...)` a tag that isn't a function (`h("optgroup", ...)`); `svg`, `path`
  and the other SVG and MathML tags work too.
- Events: an `"on:event"` attribute is `send("message", args...)`: `"on:click":
  send("inc")`, `"on:input": send("setText", targetValue())`, `"on:change":
  send("setDone", targetValue())` (a checkbox's target value is a boolean). Arguments are
  literals and what the event gives: `targetValue()`, `sourceKey()`, `dragKey()`, `eventKey()`,
  `eventProperty("detail")`. They can't read the state (`field`, `query`): send the item's
  `sourceKey()` and read the item in the handler (`const item = this.items[at]`). Modifiers
  follow the event: `"on:keydown+enter+prevent": send("add")`, `"on:keydown+escape":
  send("cancel")`.
- Attributes: `class`, `style`, `value`, `checked`, `placeholder`, `title`, `type`, `role`, ...
  take a string, `field(x)`, `lookupBind(x)` or a `when` of them. A class is a string constant,
  or a `when` of constants (a template of the module's constants is one too).
