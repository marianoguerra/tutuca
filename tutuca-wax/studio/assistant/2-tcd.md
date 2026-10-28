# The .tcd language

A `.tcd` file is a package of components. Every name in it is snake_case; the
runtime sees members in camelCase (the message `set_text` is `setText`) and
types in PascalCase (`check_item` is `CheckItem`), and Wax sees the
snake_case names. View names are kept as written: `push_view` takes the
name the view is declared with (`"layout_edit"`), literal or computed.

```wit
package tutuca:shop@0.1.0;           // first line: the package, its last part is the package name (shop)

use "other.tcd".{ priced };          // interfaces declared in another file of the library

/// What a cart needs of its lines.  (an interface: what implementing types must have)
interface priced {
    field price: f64;
    message set_qty(qty: s32);
}

/// A line of the cart.
component cart_line: priced {        // implements priced; checked
    field name: string;
    field price: f64 where price >= 0;
    field qty: s32 = 1 where 1 <= qty <= 99;
    get total: f64;                  // computed by cart_line_get_total in the .wax
    message set_qty(qty: s32 where 1 <= qty <= 99) changes qty ensures next.qty == qty;
    view main = li(field(name), " × ", field(qty), " = ", field(total));
}

register cart_line;                   // optional; by default every component, under its own name
```

## Types

`bool`, `s32`, `f64`, `string`, `any`, `null`, `enum { a, b }`, `option<T>`,
`list<T>`, `map<T>` (string keys), `record { a: T, b: U }`, `one_of<A, B>`,
`result<T, E>`, a component or interface name (a component of that type),
`component` (any component). `index<f>` is not a type but `f`'s key type (s32
for a list, string for a map) with the constraint that it's a key of `f`.

## Members of a component

- `field name: T [= default] [where c] [@sync(level)];` State. The default is
  a literal (number, string, `true`, `false`, `null`, list, record) or, for a
  component type, `make(c)`: a `c` made with no fields. Without one it starts
  as its type's default (`0`, `0.0`, `""`, `false`, the first enum member, an
  empty list or map); a field whose type's default breaks its `where` is
  required. `@sync(none)` marks transient state (an open menu, a hover) that a
  saved layout leaves out; `local` and `shared` (the default) are kept.
- `get name: T [where c];` A computed, read-only property, written in Wax.
- `message name(arg: T [where c], ...) [-> swap] [source_key: T] [when c]
  [changes f, g | nothing] [ensures c] [emits ...];` What the component can be
  sent. `when` is a guard on the state and arguments; `changes` lists the only
  fields it may change; `ensures` relates `next.field` to the state before;
  `emits` lists what it may do: `notify n`, `ask a`, `send type.message`,
  `make type`, or `nothing`. `-> swap` makes it return another component to
  take this one's place. `source_key: index<items>` says the message arrives
  from a child (a notify), and the handler reads which in `ctx.source_key`.
- `notify name(args);` A message to the parent component, which handles a
  message of the same name.
- `ask name(args) -> T;` A question answered later (by a package
  `ask_handler`, or the host); the reply arrives in `c_reply_name_ok`.
- `invariant name: c;` A condition every state must meet, checked in dev mode.
- `init;` Run `c_init` after init makes the state from its fields.
- `loop name { prepare: T; iter; key: T; filter; enrich { b: T, ... } }` Hooks
  for rendering a list field (each part optional): `filter` decides which
  items render, `enrich` adds binds the body reads with `bind(b)`, `key` gives
  each item's sibling key, `prepare` computes something once for the others.
- `view name = ...;` A view. `main` is required; others are pushed by name
  (`layout_edit` is the one studio screens push while editing).

## Package level

`interface`, `component c: iface, ...`, `register a, b as c;` (registers `b`
under the name `c`), `ask_handler name(args) -> T;` (answered in the `.wax` by
`<package>_answer_name`), `host_ask name;` (answered by the host), `use`, and
examples the studio's tests run:

```wit
example add_one for checklist {
    start { draft: "milk" }      // fields; the rest take their defaults
    send add();
    expect len(items) == 1 and draft == "";
}
```

## Conditions and where

Conditions (`when`, `ensures`, `invariant`, `expect`) take `and`, `or`,
`not`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `len(x)`, `keys(x)`,
`values(x)`, `x in [..]`, `x in keys(f)`, `x matches "re"`, `all(xs, cond)`
and `any(xs, cond)` (where `it` is the item), and `check(p)` (a predicate
written in Wax as `c_check_p`). `ensures` reads `next.field` for the state
after.

`where` takes only what a schema can hold, joined with `and`: comparisons of
the subject with literals (`0 <= count < 100`), `len(x) <= 10`, `x in [..]`,
`x not in [..]`, `x in keys(f)`, `x in values(f)`, `x matches "re"`,
`check(p)`. tcd reports clauses that can never hold or are implied by others.

## Views

A view is a call tree: an element is `tag(attributes..., children...)`, with
every attribute (`name: value`) before every child, never mixed. Text is
always quoted; a bare name is a name (`field(count)` reads the field `count`).
Attribute names with dashes are quoted (`"aria-label": "Close"`). `key:`
keys an element among its siblings; `namespace: "uri"` (a constant) makes it
in that namespace (`svg(...)` and `math(...)` set theirs).

- `field(f)` a field or property's value; inside an `each` body, the item's.
- `if(c, then, else)` / `if(c, then)`: `c` is `field(x)` or `bind(x)`; truthy
  is true, a non-empty string, a non-zero number, a non-empty list.
- `each(field(items), body)` / `each(loop: l, field(items), body)`: the body
  for each item; `render_it()` renders the item itself when it's a component,
  `bind(b)` reads the loop's enrich binds, `source_key()` is the item's key.
- `render(field(child))` renders a component field; `render_each(field(items))`
  / `render_each(loop: l, field(items))` renders each component of a list.
- `push_view("name", body)` renders the components in body with their view
  `name` when they have one. `frag(a, b)` groups children without an element.
- `el("tag", ...)` for a tag that isn't a name; `svg(...)`, `path(...)` and the
  other SVG and MathML tags work as elements.
- Events: an `on_<event>` attribute is `send(message, args...)`: `on_click:
  send(inc)`, `on_input: send(set_text, target_value())`, `on_change:
  send(set_done, target_value())` (a checkbox's target value is a bool).
  Arguments are literals, `target_value()`, `source_key()`, `drag_key()`,
  `event("key")`, or an `if` of them; they're checked against the message's
  types. Modifiers go in a quoted name: `"on_keydown+enter+prevent":
  send(add)`, `"on_keydown+escape": send(cancel)`.
- Attributes: `class`, `style`, `value`, `checked`, `placeholder`, `title`,
  `type`, `role`, ... take a constant, `field(x)`, `bind(x)` or an `if` of
  them.
