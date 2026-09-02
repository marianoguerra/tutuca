# Tutuca — High-Level Semantics Specification

This document specifies tutuca's semantic model: the concepts, their precise
meanings, and how they relate. It is written in specification voice — it states
what *is*, not how to learn it. For the tutorial voice see `docs/tutorial.html`;
for task-oriented LLM guidance see `docs/skill/SKILL.md` and `docs/skill/core.md`;
for a deep dive on the dispatch machinery see `docs/skill/semantics.md`, which
this document summarizes and extends.

Non-obvious claims carry a source anchor (a `src/`, `test/`, `tools/`, or
`docs/examples/` path) so they stay verifiable as the code evolves.

Its intended first use is as the concept inventory for a set of components
that teach tutuca as an explorable exploration, implemented in tutuca itself.
Section 10 maps each concept to seed examples for that work.

---

## 0. The three invariants

Everything in tutuca derives from three properties (`docs/skill/core.md`,
"Mental model"):

1. **Single immutable root.** Application state is one deeply frozen value — a
   tree of generated component instances containing scalars, native arrays,
   plain objects, native Map/Set values, and nested component instances.
2. **The view is a pure function of state.** Rendering the same value produces
   the same DOM. There is no component-local mutable state, no lifecycle
   mutation, no side effects during render.
3. **Handlers draft, the transactor commits.** Every dispatched handler receives
   an Immer draft first while `this` remains the immutable current instance.
   The runtime finalizes the draft, rebuilds the root with structural sharing,
   and swaps it atomically (`src/transactor.js`, `Transaction.run`).

From these fall out identity-based render caching (unchanged subtree ⇒ same
object ⇒ skip), time-travel debugging (every root is a complete snapshot), and
the positional dispatch model of section 5.

A fourth, deliberate design stance shapes the surface syntax: **templates only
route names**. There is no expression language in views — no arithmetic, no
comparisons, no ternaries, no dotted paths (with one scoped exception: the
one-level binding member read, section 2), no `{{…}}` interpolation slots.
A view names *what* to read, render, or call; all logic lives in named handler
blocks on the component. The linter enforces this
(`UNSUPPORTED_EXPR_SYNTAX` in `tools/core/lint-rules.js`).

---

## 1. The data model

### Components are draftable classes

`component(spec)` (`src/oo.js`) returns a generated Class marked `immerable`
and built from the `fields` declaration. The Class is the public component,
and it carries its own runtime metadata as statics — name, compiled views,
handler buckets, `provide`/`lookup` declarations, and registration scope
(`initComponent` in `src/components.js`) — marked by the well-known
`COMPONENT` symbol (`Class[COMPONENT] === Class`). Component instances
retain their prototype while being deeply frozen outside transactions.

The runtime resolves an instance through `instance.constructor[COMPONENT]`;
it does not use `instanceof`. Registering the Class binds its `scope` and
makes the Class available by component name.

There is no inheritance. Reuse happens by composition (component-typed fields
rendered with `<x render>`), by macros (section 7), and by `methods`/`statics`.

### Fields and inferred types

`fields: { name: defaultValue }` declares state. The field type is inferred
from the default value's JS type (`src/oo.js`, `classFromData`): string,
number, boolean, Array, plain Object, Map, Set, `{type, defaultValue}` for an
explicit type, `{component, args}` for a child-component reference, anything
else `any`.

Fields do not generate mutators. A handler updates the draft with ordinary JS:
assignment for scalars/objects, `push`/`splice` for arrays, `set`/`delete` for
Map, and `add`/`delete` for Set. Draft assignments are validated at commit.

Field names must not collide with explicitly declared methods because `.field`
and `$method` must remain unambiguous; the linter rejects them
(`FIELD_METHOD_NAME_COLLISION`).

### Component-typed fields

A field declared `{component: "Name", args: {…}}` holds a child component
instance. Resolution is lazy and scope-based: `make` looks the component up by
name in the registration scope at construction time (`src/oo.js`, `FieldComp`).
Type-checking is by component name, not by class identity.

### Methods, input handlers, statics

- `methods` — read-only instance functions called from views as `$name`; they
  are not event handlers and receive no draft.
- `receive` — event handler functions referenced bare (`name`) from `@on.*`,
  plus what a parent sends and every answer this component reads;
  these use the draft-first handler contract. The linter enforces that the
  sigil matches the block (`RECEIVE_HANDLER_NOT_IMPLEMENTED`,
  `EVENT_HANDLER_METHOD_NOT_ALLOWED`, `FIELD_VAL_IS_METHOD`, …).
- `statics` — functions on the Class (`Comp.fn(…)`), conventionally used
  for `fromData` factories that build nested instances from plain data
  (`docs/examples/tree.js`). Not lifecycle hooks.

### Registration scopes

Components live in a `ComponentStack` — a lexical registry chain mapping names
to Components, macros, and intent handlers (`src/components.js`).
`app.registerComponents([...])` binds each Component to a fresh child scope;
the scope owns the Class and its tag. A component spec registered into two
scopes yields two independent Components (`test/components.test.js`). Lookup
walks the parent chain; last registration wins.

---

## 2. The value language

Template attribute strings parse into value expressions (`src/value.js`).
A value is a **single token** (or a predicate application over tokens) — there
is no composition, nesting, or arithmetic.

### Token kinds and sigils

| Syntax | Kind | Resolves to |
|---|---|---|
| `.name` | field | the field `name` on the current instance (`it`) |
| `$name` | method | call the no-arg method `name` on `it`; in handler position, the function itself |
| `@name` | binding | a loop/scope binding (`@key`, `@value`, enrichment binds) |
| `@name.member` | binding member | one member read off a binding (`@value.title`); exactly one level |
| `*name` | dynamic | a `provide`/`lookup` dynamic binding (section 7) |
| `^name` | macro param | the call-site value of a macro parameter (compile-time substitution) |
| `name` (lowercase bare) | name | an event handler name — the first slot of `@on.*`, and nothing else |
| `'text'` | string literal | the literal string |
| `$'a {expr} b'` | string template | parts joined; `{…}` holds one value expression |
| `123`, `true` | constant | the literal number/boolean |
| `.seq[.key]` | sequence access | `seq.get(key)` — one field indexing another |

Bare unquoted multi-word text is not a string; it evaluates to `null`
(`docs/skill/core.md`, "Quoting & String Literals").

### Single-name resolution

`.a.b` is invalid everywhere. A value resolves exactly one name against `it`.
The three sanctioned ways to reach nested data are: render the child as its own
component (`<x render=".a">`), compute the value in a method (`$abOfA`), or
bind it during iteration/scoping (`@enrich-with`).

The one scoped exception is the **binding member read**: `@value.title` reads
exactly one member off a resolved `@`-binding. It is deliberate, not a crack in
the no-paths rule: the rule exists so path-bearing slots stay addressable, and
bindings are only ever legal in *display* slots (text, conditions, dynamic
attributes, handler args) that never need an address — a member read inherits
that same confinement (it has no `toPathItem`, so render/sequence targets and
`provide` still reject it). One level only; `@value.a.b` is a parse error
(lint `BINDING_MEMBER_TOO_DEEP`). Because `@value`/`@key` always denote the
loop item itself (see the iteration protocol below), the read is stable across
render and event replay. Deeper or derived data still belongs in a method or
an `@enrich-with` handler — but an enrich whose body is *only*
`binds.x = value.x` projections is boilerplate the member read replaces (lint
`SUGGEST_BINDING_MEMBER` flags it).

### Parse groups

Each template slot admits only certain kinds (`src/value.js`, the `G_*`
masks). The consequential ones:

- **Boolean slots** (`@show`, `@when` conditions): fields, methods, bindings,
  dynamics, constants — no string templates.
- **Render targets** (`<x render>`, `@each`): only *path-bearing* kinds —
  fields, sequence access, dynamics. `$method` is deliberately excluded: a
  method result has no address, so events inside it could not be dispatched.
- **`provide` values**: fields and sequence access only — a provide doubles as
  the path `<x render="*name">` resumes at, so it must have one (section 7).

### Predicates

The sole boolean operators are a closed, predicate-first set usable in
conditional slots (`src/value.js`, `PREDICATES`):
`empty?`, `truthy?`, `falsy?`, `null?` (unary) and `equals?` (binary,
`Object.is`-style equality). Emptiness and truthiness are size-aware: a value
with `.size`/`.length` is truthy iff non-empty.

```html
<div @hide="empty? .items">…</div>
<div @show="equals? .view 'detail'">…</div>
```

### Values are the bridge to paths

Every value class implements `toPathItem()` (`src/value.js`): a `FieldVal`
becomes a `FieldStep`, a `SeqAccessVal` a `SeqAccessStep`; other kinds return
null (unaddressable). This is the link between what a template names and where
a transaction lands (section 5).

---

## 3. The template language

Views are **real HTML**. `html` and `css` are `String.raw` — editor hints, not
processors. The template parses through the browser's own parser, then compiles
into an `ANode` tree (`src/anode.js`, `ANode.parse`): a static render program
whose leaves are value expressions.

Three syntactic families:

- **`@directive` attributes** — behavior attached to an element.
- **`:attr` dynamic attributes** — attribute value re-evaluated each render;
  plain `attr="…"` is constant. Static `class` and dynamic `:class` cannot
  coexist on one element (`DUPLICATE_ATTR_DEFINITION`).
- **`<x>` operations** — element-less control flow.

### Directive catalog

| Directive | Semantics |
|---|---|
| `@text="v"` | render `v` as a text child (prepended; existing children kept) |
| `@show="cond"` / `@hide="cond"` | conditionally render the element |
| `@if.attr="cond"` `@then="v"` `@else="v"` | conditional attribute value; multiple conditionals on one element need named branches (`@then.attr`) |
| `@on.event[+mod]="handler args…"` | attach an event handler (section 6) |
| `@each="seq"` | repeat this element per item; binds `@key`/`@value` |
| `@when="alterName"` | filter iteration items through an `alter` predicate |
| `@enrich-with="alterName"` | add derived `@`-bindings per item (or, outside a loop, to the subtree) |
| `@loop-with="alterName"` | compute shared per-loop data once; may return `{keys}` to control exactly which items render (pagination) |
| `@push-view="name"` | push a view name applied to all descendant component renders |
| `@dangerouslysetinnerhtml="v"` | raw HTML, bypassing escaping; children ignored |
| `@x` | pseudo-x: make a legal HTML child behave as `<x>` where `<x>` would be stripped by the parser (`<table>`, `<select>`, `<tr>`) |

Several directives compile to *wrapper nodes* around the element (`@each`,
`@show`, `@hide`, `@enrich-with` (used without `@each`), `@push-view` —
`src/anode.js`, `WRAPPER_NODES`); source order determines nesting,
outermost first.

### `<x>` operation catalog

(`src/anode.js`, `X_OPS`)

| Op | Semantics |
|---|---|
| `<x text="v">` | a bare text node, no element |
| `<x render="v" [as="view"]>` | render a component instance held at `v`, optionally selecting a named view |
| `<x render-it [as]>` | render the current iteration item as a component (only valid inside a loop) |
| `<x render-each="seq" [as] [@when] [@loop-with]>` | render a component per item of `seq` — sugar for `@each="seq"` wrapping a `<x render-it>` (one iteration mechanism; `@key`/`@value` stay in the loop scope, the item view sees a clean frame) |
| `<x @show="cond">` / `<x @hide="cond">` | conditional fragment |
| `<x slot="name">…</x>` | **call-site** marker: route this content into a macro's named slot |
| `<x:slot [name]>` | **body-side** placeholder: where a macro receives call-site content |
| `<x:name …>` | macro invocation (registry keys lowercased) |

`text`, `render`, `render-it`, and `render-each` ignore any child content — it is
silently dropped at parse time (the linter flags this as `X_OP_IGNORES_CHILDREN`).
Only `@show`/`@hide`, `slot`, and a bare `<x>` fragment actually use their children.

### Views and styles

A component has a default view (`view`, registered as `main`) plus any named
views in `views: {name: html`…`}` (optionally `{view, style}` pairs). View
selection: `as="name"` on a render op selects for the direct child (the name
may itself be dynamic, `as=".mode"`, evaluated against the parent; a missing
view falls back to `main` — `test/render-as-dynamic.test.js`); `@push-view`
pushes a name onto a view stack that all descendant component renders consult,
first match wins, `main` as fallback (`src/stack.js`, `lookupBestView`).

Styles: `style` is scoped to the view (selectors are prefixed with the
component's `[data-cid]`; bare declarations style the component root),
`commonStyle` applies to all of a component's views, `globalStyle` is unscoped.
Scoped styles reject top-level at-rules and `html`/`body`/`:root` selectors
(lint `TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE`, `GLOBAL_SELECTOR_IN_SCOPED_STYLE`).

---

## 4. Rendering

### Pipeline

`root value → per-component ANode render → VDOM → keyed DOM morph`
(`src/renderer.js`, `src/vdom.js`). A root swap triggers a re-render
(`src/app.js`); the VDOM diff is a keyed, preact-style reconciliation.

Because state is immutable and views are pure, rendering caches per
`(node, value, dynamic-binding values, view-selection key, render address)`: an
unchanged subtree keeps `===` identity, hits the cache, and is skipped entirely
(`src/renderer.js` `_rValComp`, `src/cache.js`). The render address is part of
the key because a subtree bakes it in — the provides it publishes are located
there, and a resumed site records the base it resumed at — so the same immutable
value rendered at two places cannot share an entry. Two consumers rendering the
same provided sequence do not alias each other's cache entries
(`test/cache-view-context.test.js`, `test/path.test.js`). Constant subtrees are additionally
memoized at compile time (`RenderOnceNode`).

### The render stack: frames vs scopes

Rendering walks the ANode tree with a `Stack` carrying `it` (the current
instance), a chain of binding frames, dynamic bindings, the view stack, and the
`DispatchPath` of where it currently is — which is what lets a provide publish
the absolute path of the value it publishes (`src/stack.js`). The chain has two frame kinds, and this single distinction
answers most name-visibility questions:

- A **frame** is a lookup *barrier*: `@name` resolution stops there. Entering
  a component (`<x render>`, `<x render-it>`, `<x render-each>`) pushes a
  frame — a child component's view sees a clean namespace, never its parent's
  loop bindings (`test/path.test.js` pins that `@key`/`@value` are invisible
  inside a `render-it` child).
- A **scope** is *transparent*: `@each` and `@enrich-with` push scopes, so
  `@key`, `@value`, and enrichment binds layer onto the surrounding frame and
  stay visible to same-frame descendants and handlers. (`@enrich-with` used
  without `@each` is the scope-only form: it adds `@`-bindings to the
  surrounding subtree without iterating.)

`it` is set by both; only `@`-binding visibility differs.

### The iteration protocol

For `@each` / `<x render-each>` over a sequence (`src/renderer.js`):

1. `@loop-with` (if present) runs once with `(seq, {lookup, filter})` and
   returns shared `iterData`, and/or an explicit `keys` list that becomes
   authoritative for which items render and in what order (the
   filter-then-paginate mechanism, `docs/examples/filter-paginate.js`).
2. `@when` (if present) filters each `(key, value, iterData)`.
3. `@enrich-with` (if present) receives `(binds, key, value, iterData)` and
   populates extra `@`-bindings for that item. `binds.key` and `binds.value`
   are **protected**: after the handler runs, the renderer re-sets them to the
   loop's own key/item and warns (`console.assert`) if the handler changed
   them (`callEnricher`, `src/renderer.js`). `@key`/`@value` therefore always
   mean the sequence position and item — enrichment can add names, never
   redefine those two.

All three name handlers in the `alter` bucket: pure functions, evaluated at
render time, producing bindings — never state changes.

Any custom collection can be iterated by installing a `SEQ_INFO` walker on
its prototype (`docs/examples/custom-collection.js`); the walker also drives
`@key` path resolution and `@loop-with` ranges (Array.slice semantics).

### DOM breadcrumbs

The DOM is the only artifact that survives from render to the next user event,
so the renderer stamps addressing data into it: `data-cid` (component/view),
`data-nid` (template node id), `data-eid` (event id) attributes, plus `§…§`
JSON comment markers at component, iteration, and scope boundaries
(`src/renderer.js`, `_renderMetadata`). A component boundary that RESUMED at an
absolute path also carries that path — as `base` in its `§Comp§` marker, and on
`data-rp` for every element root of a fragment-rooted body, since only the first
of those siblings follows the marker. Section 5's path reconstruction reads
these back.

---

## 5. Paths: position, not reference

This is tutuca's most distinctive mechanism (`docs/skill/semantics.md` covers
it in depth; `src/path.js` implements it).

A **`Path` is an array of `Step`s from the root to a value** — a *position* in
the state tree, not a captured object reference. Because handlers replace the
root, references go stale immediately; positions survive any number of root
swaps and are re-resolved against whatever root is current when they are used.

### Step taxonomy

(`src/path.js`)

| Step | Addresses |
|---|---|
| `FieldStep` | a named field |
| `SeqStep` | a sequence entry by literal key or index |
| `SeqAccessStep` | a sequence entry whose key is read live from another field (`.sheets[.selId]`) |
| `EachRenderItStep` | the current `render-each` item (a keyed `SeqStep` subclass) |
| `BindStep` / `ScopeBindStep` / `EachBindStep` | nothing — frame-only steps that carry scope bindings for stack reconstruction |

Each step knows how to `lookup` a value, `setValue` (rebuilding the spine with
structural sharing), and `enterFrame` (rebuilding the render stack).

### Dispatch paths and the two projections

A recorded position is a **`DispatchPath`**: a stack of continuation frames,
each `{base, items}`. Ordinary rendering extends the top frame; rendering a
located binding pushes a new frame based at the value's own absolute path
(section 7). From it, two projections serve two purposes:

- **`compact()` — the dispatch path.** Drops frame-only steps inside every
  frame independently, keeping exactly one step per crossed component. Popping
  one step at a time (`popStep`) walks an intent's `dyn` leg upward through
  every component, and at the top of a frame returns to the visual caller.
- **`toTransactionPath()` — the transaction path.** The ACTIVE frame alone: its
  absolute base followed by its ordinary steps. The mutation lands where the
  data physically lives; the saved caller frames affect bubbling only.

### Key pinning and async races

A `SeqAccessStep`'s key is a live read — correct for synchronous dispatch,
wrong for async answers if the selection changed meanwhile. Therefore intents
**pin keys by default**: at dispatch time each `SeqAccessStep` is frozen into a
literal-key `SeqStep`, so the answer reaches the item that raised the intent
(`src/path.js` `pinKeys`, `test/path.test.js`). `opts.livePath` opts out. If a
pinned target was deleted before the answer arrives, delivery is a silent no-op.
List *indices* are never pinned — async work should anchor on map keys.

### Reconstruction from the DOM

On a DOM event, `DispatchPath.fromNodeAndEventName` walks from the event target
up to the root, reading the breadcrumbs of section 4, and rebuilds the full path
plus the handler to run — including through `@show`-hidden iteration items,
passthrough components whose whole view is a bare `<x render>`, and bubbling DOM
events handled on an ancestor element (`src/path.js`, `test/path.test.js`).

Each crossed component contributes one part: a boundary carrying a `base`
(section 7) pushes a continuation frame, anything else pushes one step onto the
active frame. A `<x render="*name">` site contributes no step of its own — its
base does the work.

---

## 6. Transactions and dispatch

### The transaction

Every state update is a **transaction**: one handler call addressed by a path
(`src/transactor.js`). Execution: resolve the transaction path against the
*current* root → take the addressed instance as immutable `self` → create an
Immer draft of that instance → call `handler(draft, …args, ctx)` with
`this = self` → finalize and validate the draft → graft a changed leaf back
into the root with structural sharing. Returning nothing (or the draft)
commits draft mutations; returning another value replaces the addressed leaf;
mutating and returning a replacement is an error. The atomic root swap
notifies subscribers and the app re-renders.

Transactions queue FIFO and drain in time-budgeted asynchronous batches
(~10 ms per `setTimeout(0)` turn, `src/app.js`) — except DOM input events,
which transact synchronously on arrival.

### The two channels

One question separates them: **does the sender know who handles this?** If yes
it sends a **message**, which reaches one component and stops. If no it raises
an **intent**, which walks a *route* until something answers.

Component handler signature everywhere: `(draft, …args, ctx)`. `this` is the
immutable value from the start of the handler, and `ctx` is trailing. All
component handlers must be synchronous (lint `ASYNC_HANDLER`); scope-registered
intent handlers are asynchronous host-side functions and do not receive a
component draft.

| Channel | Trigger | Bucket | Semantics |
|---|---|---|---|
| **message** | DOM event via `@on.*`; `ctx.send(name, args)`; `ctx.at.…send(…)`; `app.sendAtRoot`; and the runtime delivering an intent's answer | `receive` | addressed at one component and stops there. Four origins, one bucket, and a handler cannot tell them apart — a component that answered its own click differently from the identical `ctx.send` from its parent could be driven neither from a test nor from a parent |
| **intent** | `ctx.intent(name, args, opts)` | `intent` | routed: `opts.route` is a list of legs, `"dyn"` walking the dispatch path from the sender's **parent** to the root and `"lex"` walking the handlers registered on the scope chain (`getIntentHandlers()`, run `await`ed outside the state tree). Default `["dyn","lex"]`. Depth-bounded at 64 hops |

The verb does not decide which scope answers — the route does, and it is
written at the call site where the decision is.

**A reply ends the walk; running does not.** Inside an `intent` handler,
`ctx.reply(v)` and `ctx.fail(e)` answer and end the walk; `ctx.stop()` ends it
answering nothing; `ctx.forward(opts)` hands it to the next hop, optionally
amending `args` or `route`; and a body that does none of these commits any
draft changes and lets the walk continue — that handler is an **observer**.
One rule replaces the separate listener bucket a fifth channel would have
needed. The one-shot is per *intent*, shared across hops, not per body.

An intent ends in exactly three ways, each with its own name and **one**
payload, delivered back to the sender as ordinary `receive` messages:

| outcome | dispatched name | payload |
|---|---|---|
| a hop replied | `<name>Ok` | the replied value |
| a hop failed | `<name>Error` | the error value |
| the route ran out | `<name>Unhandled` | the intent's own arguments |

Because no arm can be handed both a result and an error, no arm can read the
wrong one. What the sender hears when a route runs out depends only on what it
**declares**: `<name>Unhandled` if present, else `<name>Error` with
`"noHandler"`, else a console warning if only `<name>Ok` is declared (an answer
never disappears in silence), else nothing — which makes it a *notification*
rather than a *request*. The runtime reads this off the sender's own `receive`
bucket at the moment the walk ends, so nobody declares it twice.

A scope-registered intent handler resolves to answer, throws to fail, or
returns the exported `PASS` sentinel to **decline** — the walk then continues to
the next handler. `PASS` is what makes `<name>Unhandled` reachable: a handler
that had to respond could only invent an error, and "nothing claimed it" is a
different sentence from "a handler refused it".

`ctx` (an `EventContext`, appended as the last handler argument) also provides:
`ctx.at` — a `PathBuilder` (`.field(name)`, `.index(name, i)`, `.key(name, k)`)
for addressing descendants; and `ctx.targetPath` — on an intent hop, the fixed
originating path while `ctx.path` shortens per hop, letting an ancestor reach
the exact originator via `ctx.sendAtPath(ctx.targetPath, …)`
(`test/transactor.test.js`). In a `receive` body, `ctx.sendReply(name, args)`
answers the sender of the message under a name the replier picks — a message
declares no answer arms, so the runtime cannot derive one; it refuses
`NO_SENDER` when nobody is waiting. `ctx.lookup` / `ctx.lookupType` resolve a
name along `opts.route`, the same legs an intent walks (section 7).

`ctx.forward` is the one operation that crosses between the channels: in a
`receive` body it turns the message that arrived into an intent, keeping its
name and payload. That is what lets a view's name leave the component without
the view changing.

A bucket may declare a `$unknown` fallback handler; a named handler wins over
it, and a missing handler with no `$unknown` is a silent no-op.

DOM event handlers receive event-derived arguments resolved from the event
(`src/transactor.js`, `lookupName`; `src/value.js`, `EventMemberVal`): the
explicit `e.<member>` form reads any plain property off the event, and dotted
paths (`e.target.dataset.id`, `e.detail.x`) walk it null-safe, with a lone
`e.value` normalizing to input value / checkbox `checked` / CustomEvent
`detail`. One-level computed conveniences (`e.valueAsInt`, `e.valueAsFloat`,
`e.isCtrl`/`e.isCmd`, `e.isUpKey`, `e.isDownKey`, `e.isSend` (Enter),
`e.isCancel` (Escape), `e.isTabKey`, and the drag accessors `e.dragInfo`,
`e.dragKey`, `e.dragValue`, `e.dragType`) resolve through a handler table
(`EVENT_CONVENIENCES`). There are no bare implicit names: every handler arg
carries a sigil, and a sigil-less word fails to parse (BAD_VALUE).
Event modifiers come in two kinds. Guards decide whether the handler runs:
`+ctrl`/`+cmd`/`+meta`/`+alt` on any event, `+send`/`+cancel` on `keydown`.
Effects act on the DOM event: `+prevent` (`preventDefault`) and `+stop`
(`stopPropagation`), on any event. An effect fires only once every guard on
the same handler has passed, independent of the order they are written in.
Because handlers are dispatched from a single listener on the app root,
`+stop` only stops listeners above that root — it cannot suppress another
`@on` handler, since exactly one is resolved per event (§ path reconstruction).

### The third bucket: `alter`

`alter` handlers are not dispatched — they are pure, render-time functions
backing `@when`, `@enrich-with`, and `@loop-with` (section 4). They produce
bindings, never state changes.

### Settling and structured completion

Every transaction exposes two promises (`src/transactor.js`, `Completion`):

- `whenSettled()` — resolves once the transaction's *own* handler ran.
- `whenSubtreeSettled()` — resolves once the transaction and everything it
  transitively spawned settled: sends, intent hops, and the answers those
  answers spawn. Implemented as a structured-concurrency counter; a walk
  transfers its unit onto the eventual answer so the parent stays open across
  the async gap.

The test suite guarantees every transacted transaction settles its subtree —
including handlers that throw, handlers that return `undefined` (warned), and
intent handlers that fail (settled via the `<name>Error` answer). A hop that
throws never completes its transition, so it did not answer, and the walk
continues past it rather than stranding
(`test/transactor.test.js`). `Transactor.settle()` drains the queue and all
in-flight intent handlers to global quiescence — the primitive behind `drive()` and
CLI rendering.

### Conventions, not lifecycle

Tutuca has no built-in lifecycle hooks. `receive.init` is a convention: hosts
(storybook, playground, examples' `on: {init: …}`) call `app.sendAtRoot("init")`
after mounting. Nothing calls it automatically in a bare app.

### Observability

`app.observe(cb)` reports one normalized record per handler invocation
(`kind, name, args, path, before, after, parent, timestamp`) with zero cost
when unused; `app.onChange(cb)` fires per root swap with `{val, old, info}`
(`src/app.js`, `src/transactor.js`). These hooks power the playground's
Activity tab and are the natural substrate for explorable visualizations.

### Refusals

Dispatch failures that cannot be carried out are reported on a structured
**refusal channel** instead of ad-hoc warnings: `transactor.refuse(kind, info)`
appends `{kind, info, timestamp}` to a capped ring (`transactor.refusals`),
warns to the console, and notifies `transactor.observeRefusals(cb)`
subscribers. The runtime currently raises `NO_HANDLER` (a receive name with no
implementation — its fallback ran at dispatch time) and `FORWARD_NO_NAME`
(`ctx.forward()` from a handler whose view wrote no name). The channel is
observational: the dispatch has already failed gracefully, and handlers never
see refusals.

---

## 7. Cross-tree mechanisms

### Dynamic bindings: provide / lookup / `*name`

The escape hatch for reaching across the tree without threading data through
every intermediate component (`src/components.js`, `src/stack.js`):

- A **producer** declares `provide: {name: ".field"}` (or `".seq[.key]"` —
  the value must be addressable). When the producer renders, the evaluated
  value is pushed onto the dynamic-binding stack under its NAME.
- A **consumer** declares `lookup: ["name"]` (or `[{name, default}]`), naming
  what it wants rather than who provides it, and reads `*name` anywhere a value
  is accepted, including as a render target (`<x render="*active">`) or
  iteration source (`@each="*items"`).

A provider publishes BOTH halves of a binding: the evaluated value and the
absolute path it lives at (`LocatedValue`, `src/stack.js`). That is why a
provide must be addressable — the same declaration is read as `*name` and
resumed at by `<x render="*name">`.

Resolution walks the dynamic-binding stack at render time, nearest frame first,
then a path registered in the component's lexical scope, then the consumer's own
default. The stack is the LIVE RENDER ANCESTRY, so several components may
publish one name and the nearest rendered one shadows the rest — an ordinary
scope, with no producer to identify.

A name may also be registered **lexically** as an absolute path from the state
root: `app.registerComponents(comps, {paths: {session: path().field("session")}})`,
or `scope.registerPaths({…})` on a nested scope (nearest registration wins). A
descendant declares it in `lookup` and reads or renders `*session` with nothing
above it publishing one — no application root exists solely to `provide`. The
order stays `dyn lex`, so a rendered provider still answers first.

An **uppercase** name is a component type rather than a value:
`provide: {Cell: "self"}` publishes the producer's own class, and a handler
reads one with `ctx.lookupType(name, opts)`. A type has no path, so it can never
be a render target — `<x render="*Cell">` is unresolvable by construction. Both
`ctx.lookup` and `ctx.lookupType` take `opts.route` with the legs and defaults
an intent uses — `"dyn"` the render ancestry, `"lex"` the registration scope,
default both.

### Located continuations

When a component renders a dynamically-bound value, the data *physically lives*
where the producer published it. Rendering `*name` therefore pushes the value's
absolute path as a new **continuation frame** on the dispatch path
(`DispatchPath`, `src/path.js`), and records that base in the DOM — in the
`§Comp§` meta comment, and on `data-rp` for a fragment-rooted body.

A dispatch path is a stack of such frames. `toTransactionPath()` reads the
ACTIVE frame — its absolute base plus the ordinary steps below it — so a
mutation lands on the value's real location. The saved frames underneath are the
visual callers: `popStep()` drains the active frame and then pops it, returning
bubbling to the component that wrote the `*name` and continuing through its
ancestry (`docs/examples/dynamic-path.js`, `test/path.test.js`).

This is what makes "render the selected sheet from anywhere, edit it in place"
sound: rendering is indirect, mutation is direct. There is no producer search,
no producer-qualified target, and no path rewriting at dispatch.

### Macros and slots

A macro is **pure compile-time template expansion** (`src/anode.js`, `Macro`):
`macro(defaults, html`…`)`, invoked as `<x:name …>`. No state, no methods, no
runtime cost; recursive expansion is rejected.

- **Parameters**: the defaults object's values are value *expressions*
  (`{title: "'Card'"}` — note the quoted literal). The body reads `^title`;
  the call site overrides with plain or `:dynamic` attributes. Values and
  handlers written inside a macro body resolve against the **host** component
  that invoked it.
- **Slots**: `<x:slot>` in the body receives the call site's children; named
  slots (`<x:slot name="actions">`) are filled by `<x slot="actions">…` at the
  call site; unnamed content collects into the default `_` slot.
- Registry keys are lowercased on registration.

---

## 8. Module and app conventions

### The conventional module contract

Any module becomes consumable by the playground, storybook, and CLI — with no
glue — by exporting some of (`docs/skill/core.md`, "Conventional Module
Exports"):

- `getComponents()` — every component (omissions are invisible to lint/render/test);
- `getRoot()` — the root instance for mounting;
- `getMacros()`, `getIntentHandlers()` — registrations;
- `getExamples()` — `{title, description?, group?, items: [{title, value,
  view?, on?, intentHandlers?}]}` or an array of such sections; per-item
  `intentHandlers` mock async behavior, `on.init` drives lifecycle phases;
- `getTests({describe, test, expect, drive})` — behavior tests (section 9).

### App API

`tutuca(selectorOrNode)` builds an app. `app.registerComponents(comps)` binds
scopes and compiles views; `app.state.set(instance)` sets the root (**an
instance**, not plain data); `app.start()` renders and subscribes delegated
event listeners at the root node; `app.sendAtRoot(name, args)` dispatches a
receive to the root (the `init` idiom); `app.stop()`, `app.render()`,
`app.onChange(cb)`, `app.observe(cb)` as above (`src/app.js`, `src/index.js`).

The package ships three builds, each a superset: `tutuca` (core),
`tutuca-extra` (adds MargaUI/Tailwind class compilation), `tutuca-dev` (adds
the in-browser linter and real testing helpers; the core build ships no-op
stubs for `check`, `test`, `collectIterBindings`). Immer utilities are
available from the separate `tutuca/immer` entry point; the main entry point
contains only Tutuca APIs.

Dev-only material (stories, tests, helpers) lives in co-located `*.dev.js`
modules, auto-discovered by `tutuca storybook` and never shipped.

---

## 9. Tooling (brief)

The CLI (`tools/tutuca.js`) operates on conventional modules. The post-edit
verification recipe is `tutuca lint <mod>` → `tutuca test <mod>` →
`tutuca render <mod> --title "<example>"` (exit codes 2/4/3 respectively),
plus `tutuca storybook --dry-run` as a project-wide smoke test.

**`tutuca lint`** encodes the semantic constraints of this document as roughly 40
rules (`tools/core/lint-rules.js`). The load-bearing families: name/sigil
integrity (`.field` vs `$method` vs bare input-handler, existence and
cross-hints), `alter` handler existence/usage for the iteration directives,
dynamic-binding shape (`provide` addressability, `lookup` targets), template
structure (unknown directives/`<x>` ops/event modifiers/handler args, duplicate
attributes, `render-it` outside a loop), value-syntax rejection of JS
expressions, synchronous-handler enforcement, scoped-style hygiene, and field
field-name collisions. A separate HTML structural linter contributes `HTML_*`
codes.

**`tutuca test`** runs `getTests()` with tutuca's own runner (a subset of the
Mocha-style API — `describe` accepts a component for name-tagging; no
before/after hooks) and chai with jest-style flat matchers (`src/chai-jest.js`).
Two dev-build helpers matter semantically: `drive(value, phase)` mounts a value,
dispatches one lifecycle-phase config, and awaits full subtree settlement,
returning the settled root — the black-box way to test async cascades; and
`collectIterBindings(Comp, inst, seq, opts)` mirrors the render loop's
when/loop-with/enrich pipeline and returns the bindings each item would render
with (`src/util/testing.js`).

**`tutuca render`** mounts an example headlessly (jsdom) and prints the HTML —
the cheapest end-to-end check that a view actually renders. **`tutuca
storybook`** discovers `*.dev.js` modules, runs their tests, and serves a
zero-config catalog with the in-browser checker.

---

## 10. Appendix — concept → explorable-exploration map

Each row is a candidate teaching unit for the explorable exploration, with the
existing example(s) best suited to seed it. Ordering is a suggested narrative
arc: value model → templates → rendering → paths → dispatch → cross-tree.

| # | Teaching unit | Spec § | Seed example(s) (`docs/examples/`) |
|---|---|---|---|
| 1 | State is frozen; handlers mutate drafts; structural sharing | 1 | `counter.js` (also has `drive()` tests), `entry.js` |
| 2 | The view is a pure function of state; predicates | 0, 2 | `traffic-light.js`, `show-hide.js` |
| 3 | Sigils: the whole value language on one screen | 2 | `text-directive.js`, `attribute-binding.js` |
| 4 | Conditional attributes and display | 3 | `conditional-attributes.js`, `tabbed-ui.js` |
| 5 | Iteration: `@each`, keys, two-way binding | 3, 4 | `todo.js`, `list-iteration.js` |
| 6 | The iteration pipeline: when → loop-with → enrich | 4 | `filter-paginate.js` (three annotated strategies + `collectIterBindings` tests), `list-filter-enrich-with.js` |
| 7 | Frames vs scopes: who sees `@key`? | 4 | `render-with-scope.js`, `render-child.js` |
| 8 | Composition: render child → multiple views → push-view | 3 | `render-child.js` → `multiple-views.js` → `push-view.js` |
| 9 | Macros: params and slots | 7 | `macro-params.js`, `macro-named-slots.js`, `todo-macros.js` |
| 10 | Targeted messages vs bubbling | 6 | `send-receive.js`, `tree.js` |
| 11 | Async: intents on the `lex` leg, the three outcomes, mocking, error paths | 6 | `request-example.js` (built-in success/error/loading examples) |
| 12 | Located continuations: mutate the producer through the consumer | 5, 7 | `dynamic-path.js`, `dynamic-selected-edit.js`, `seq-item-access.js` |
| 13 | Extending iteration: the `SEQ_INFO` protocol | 4 | `custom-collection.js` |

Semantics with **no example yet** — and the strongest candidates for new,
purpose-built explorable components, since they are exactly the invisible
machinery an explorable can make visible:

- **Path anatomy** — show the recorded Step list for a clicked element, its
  `compact()` and `toTransactionPath()` projections, and key pinning racing an
  async answer (pinned by `test/path.test.js`, no example).
- **Transaction timeline / settling** — visualize a subtree of sends and intent
  walks settling (`whenSettled` vs `whenSubtreeSettled`); the
  `app.observe` records and the playground's existing Activity tab are the
  ready-made data source.
- **Frame/scope stack inspector** — render the live binding stack beside the
  template to show where `@name` lookups stop.
- **Identity caching** — highlight which subtrees re-rendered vs cache-hit
  after a mutation, demonstrating invariant 1 ⇒ performance.
