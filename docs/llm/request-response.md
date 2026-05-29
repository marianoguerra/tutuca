# Tutuca — Request / Response & Orchestration

The three event-driven orchestration channels beyond local `input`
handlers: `bubble` (events up the tree), `send` / `receive` (messages
to a target path), and async `request` / `response` (host-registered
async work routed back into component state). Read this file when
wiring `bubble` / `receive` / `response` handlers, calling
`ctx.bubble` / `ctx.send` / `ctx.request`, or registering request
handlers with `registerRequestHandlers`. General authoring lives in
[core.md](./core.md); testing these handlers is in
[testing.md](./testing.md).

## The four channels

Each channel pairs a trigger with a same-shape handler block:

| Triggered by                                | Handler block       |
| ------------------------------------------- | ------------------- |
| DOM event (`click`, `input`, …)             | `input:    { ... }` |
| `ctx.bubble(name)` — event up the tree      | `bubble:   { ... }` |
| `ctx.send(name)` — message to a target path | `receive:  { ... }` |
| `ctx.request(name)` — async request         | `response: { ... }` |

Every handler is called as `handler(...args, ctx)` and returns a
(possibly updated) instance of `this`; the framework swaps the returned
value into the dispatch path. `ctx` (an `EventContext`) is always the
trailing argument and exposes `ctx.send`, `ctx.bubble`, `ctx.request`,
`ctx.at` (a `PathBuilder`), `ctx.name` (the dispatched name), and —
inside bubble handlers — `ctx.stopPropagation()`.

`alter` is a fifth handler block, but it isn't event-triggered — the
renderer invokes alter handlers to produce binds, not to update state.
See *Mental model* and *Scope Enrichment* in [core.md](./core.md).

## Bubble Events

```js
input:  { onClick(ctx) { ctx.bubble("treeItemSelected", [this]); return this; } },
bubble: {
  treeItemSelected(selected, ctx) {  // ctx.stopPropagation() to halt
    return this.insertInLogAt(0, `selected ${selected.label}`);
  },
}
```

`ctx.bubble("name", args)` emits an event that walks the dispatch path
back toward the root. Each ancestor whose component defines
`bubble.<name>(...args, ctx)` runs it (others are skipped silently);
bubbling stops at the root or when a handler calls
`ctx.stopPropagation()`. Ancestors see the event *after* descendants
have transacted, so bubble handlers are the place for aggregate state
(logs, selections, totals).

When to bubble: handle the event locally if the current component owns
the state needed to respond. Bubble when the action belongs to an
ancestor (a list item's "remove" must reach the list that owns the
items), or when an ancestor may want to react to or record something
that happened (selection, logging, analytics). Don't bubble events
with no consumer.

## Send / Receive

`ctx.send(name, args)` delivers a message to a specific target
component (addressed by path; on its own `ctx.send` targets `this`).
The target's `receive.<name>(...args, ctx)` handler runs. There is
**no built-in lifecycle** — `receive.init` is just a convention; the
host must dispatch it (typically after `app.start()`) for it to run.

```js
receive: { init(ctx) { ctx.request("loadData"); return this.setIsLoading(true); } }
```

Dispatch from anywhere:

```js
app.sendAtRoot("init");                            // host code, top-level
ctx.at.field("personalSite").send("init");                 // child by field name
ctx.at.index("items", 3).send("init");                     // list element at index 3
ctx.at.key("byKey", "k1").send("init");                    // map entry by key
ctx.at.field("a").field("b").index("xs", 0).send("ping");  // chain freely
ctx.send("name");                                          // self
ctx.bubble("name", [arg]);                                 // bubble up
```

`ctx.at` returns a `PathBuilder` with `.field(name)`, `.index(name, i)`,
and `.key(name, k)`. Each call appends a step to the path before
`.send(...)` / `.bubble(...)` fires; the handler runs inside the child
instance with `this` bound to it. Paths are positional, not references —
see *Positional delivery* below and *Mental model* in
[core.md](./core.md) for why this matters across async boundaries.

When to send: bubble emits an *event* that any ancestor with a
matching handler can observe; send delivers a *message* to one
specific target (or to self). Reach for `ctx.at.…send("name")` when
one component needs to address another by path — e.g. a form telling
its email field to focus after a failed submit
(`ctx.at.field("email").send("focus")`), or a list telling item 3 to
enter edit mode (`ctx.at.index("items", 3).send("startEditing")`).
Reach for `ctx.send("name")` on self to reuse a handler from multiple
call sites without duplicating its body — e.g. a "Reload" button and
`receive.init` both calling `ctx.send("loadData")`. Don't `send` to
self when a direct method call on the same component would do.

## Integrating with the outside world

A tutuca app talks to the outside world in two directions, and both go
through handlers — never around them.

- **Outbound** — the app reaches out (fetch, timers, IndexedDB, external
  SDKs). Use `ctx.request("name", args)`; the host-registered handler does
  the async work and the result lands back in component state via
  `response.<name>`. See *Async Requests* below.
- **Inbound** — the outside world pushes an event in (a WebSocket message,
  a DOM event fired outside the app, a `postMessage`, a timer, a
  third-party callback). Use `app.sendAtRoot("name", args)` from the host /
  glue code. It dispatches a `send` to the **root component**, running its
  `receive.<name>(...args, ctx)` handler under the same immutable
  `return this.set…()` contract as every other handler.

```js
// host / glue code, outside the component tree
ws.onmessage = (e) => app.sendAtRoot("serverPushed", [JSON.parse(e.data)]);

// root component
receive: {
  serverPushed(msg, ctx) { return this.prependEvent(msg); },
}
```

This keeps the root component the single owner of how external inbound
events mutate state — the logic lives in one `receive` block, in the same
place and shape as the rest of the app's handlers, and is testable like
any other (see [testing.md](./testing.md)).

⚠️ **Do not** reach into `app.state` and call the raw `State.set(val)` /
`State.update(fn)` methods to inject external data. That bypasses the
component handler model, the immutable `return this.set…()` discipline,
scope enrichment, and the transactor's batching — state mutated that way is
invisible to the components that own it and easily clobbered by the next
transaction. Route every inbound event through `app.sendAtRoot` instead.

`sendAtRoot` only targets the root (`Path([])`). To land an inbound event
on nested state, let the root's `receive` handler forward it with
`ctx.at.field(...).send(...)` (see *Send / Receive* above) — one entry
point, still reaching deep. For async/external delivery, anchor on stable
map keys rather than list indices (see *Positional delivery across async*
below).

## Async Requests

`ctx.request("name", args)` triggers a host-registered async handler
and routes the result back to the issuing component's
`response.<name>(res, err, ctx)`. Use it for fetch / timer / IndexedDB
work that should land back in component state.

```js
export function getRequestHandlers() {
  return {
    async loadData() {
      const r = await fetch("https://example.com/data.json");
      return await r.json();
    },
  };
}

// register at the same scope where you registerComponents
const scope = app.registerComponents([Comp]);
scope.registerRequestHandlers(getRequestHandlers());
```

In a component:

```js
receive:  { init(ctx) { ctx.request("loadData"); return this.setIsLoading(true); } },
response: { loadData(res, err, ctx) { return this.setIsLoading(false).setItems(res); } },
```

### The `err` argument and the error path

The default handler is `response.<name>(res, err, ctx)`. On success the
host handler's resolved value is `res` and `err` is `null`; on failure
`res` is `null` and `err` is the thrown / rejected value. Branch on
`err` when failure needs different state:

```js
response: {
  loadData(res, err) {
    if (err) return this.setIsLoading(false).setError(String(err));
    return this.setIsLoading(false).setItems(res);
  },
}
```

A **request name that isn't registered** doesn't crash — the runtime
throws `Request not found: <name>` internally and routes it to the same
error path, so it arrives as `err`. (A `!name` reference written in a
*template* is caught earlier by the `UNKNOWN_REQUEST_NAME` lint; a
`ctx.request("name")` string call is not, so a typo there surfaces only
at runtime as an `err`.)

### Per-call handler-name overrides — and their signature

The third argument to `ctx.request` overrides which `response` handler
runs, with three keys:

- `onResName` — base name for **both** outcomes (replaces `<name>`); the
  handler still takes `(res, err, ctx)`.
- `onOkName` — name for the **success** path only.
- `onErrorName` — name for the **error** path only.

⚠️ When `onOkName` / `onErrorName` is used, the split handler receives a
**single** payload arg — *not* `(res, err, ctx)`:

```js
methods: {
  load(ctx) {
    ctx.request("loadData", [], { onOkName: "loadDataOk", onErrorName: "loadDataErr" });
    return this.setIsLoading(true);
  },
},
response: {
  loadDataOk(res, ctx)  { return this.setIsLoading(false).setItems(res); }, // res only
  loadDataErr(err, ctx) { return this.setIsLoading(false).setError(String(err)); }, // err only
},
```

The combined `(res, err, ctx)` shape is only for the default /
`onResName` case. Mixing them up — a split handler declaring `(res, err)`
— means the second param is `ctx`, a common bug. (See
[testing.md](./testing.md) for how this changes the test call.)

### `livePath` — pinning vs following a moving key

The same opts object takes `livePath`. It controls where the response
lands when the request path addresses a seq-access entry
(`.sheets[.selId]`): by **default** the resolved key is *pinned* at
request time, so the response updates the item that issued the request
even if `.selId` moved while the request was in flight (e.g. the user
switched tabs). Set `livePath: true` to opt out and re-resolve the key
live, delivering to whatever the key now points at:

```js
ctx.request("save", [payload]);                    // pinned: lands on the originating sheet
ctx.request("refresh", [], { livePath: true });    // live: lands on the currently selected sheet
```

Pinning only affects field-resolved keys; named fields are already stable
and list **indices** are not pinned (a reorder still slides them). Full
model in [semantics.md](./semantics.md) (*Key resolution & async races*).

### Fire-and-forget requests

A request whose result you don't need can omit the `response` handler
entirely — when no `response.<name>` (and no `$unknown`) matches, the
result is silently dropped. Idiomatic for side-effect-only work like
persisting state:

```js
input: {
  onApplyFilter(value, ctx) {
    ctx.request("persistState", [{ key: "sectionFilter", value }]);
    return this.setFilter(value);
  },
}
```

You can also fire several in one handler
(`ctx.request(...); ctx.request(...); return ...;`).

### The request-handler contract

Registered request handlers run with **no `this`** (they're invoked as
`fn.apply(null, args)`), so they can't read component state — pass
everything they need through `args`
(`ctx.request("persistState", [{ key, value }])`). They're plain async
functions or closures. Aggregate handlers from sub-modules with spread:

```js
export function getRequestHandlers() {
  return { ...getRequestHandlersA(), ...getRequestHandlersB() };
}
```

### Chaining from a response handler

A `response` handler gets the full `ctx`, so it can issue further
`ctx.request` (request → response → request chains), `ctx.send`, or
`ctx.bubble`:

```js
response: {
  loadUser(user, err, ctx) {
    if (!err && user) ctx.request("loadUserDetails", [user.id]);
    return this.setUser(user);
  },
  loadUserDetails(details, err) { return this.setUserDetails(details); },
}
```

## `$unknown` fallback

`receive` / `bubble` / `response` all share one fallback: when no
handler matches the dispatched name, the runtime looks for
`<block>.$unknown(...args, ctx)` and runs that instead; `ctx.name` tells
it which name was dispatched. Absent both the named handler and
`$unknown`, the message is silently dropped (the value passes through
unchanged). Use `$unknown` for a single catch-all (logging, a generic
router); rely on the silent drop for fire-and-forget requests.

## Positional delivery across async

The path a response (or `send` / `bubble`) is delivered to is
**positional** — an array of steps from the root, not a captured
reference. This is why an async response survives intervening
transactions that rebuilt the root (see *Mental model* in
[core.md](./core.md)). Per step kind:

- **Map entry by key** (`.sheets[.selId]`) — the resolved key is *pinned*
  at request time by default, so the response reaches the originating
  entry even if the key field moved. `livePath: true` opts out (above).
- **List index** (`.items[3]`) — not pinned: if the list re-sorted so
  index 3 is now a different item, the response lands on whatever occupies
  the slot. Anchor on map keys, not list indices, when an async result
  must reach a specific item.

Full model in [semantics.md](./semantics.md).

## See also

- [core.md](./core.md) — the core mental model, `view` directives, handler
  blocks overview, and *Conventional Module Exports*.
- [semantics.md](./semantics.md) — the path/transaction model behind these
  channels: path steps, the transaction lifecycle, teleporting, and the
  key-pinning rules `livePath` toggles.
- [testing.md](./testing.md) — calling `bubble` / `receive` / `response`
  handlers from tests.
- [cli.md](./cli.md) — `UNKNOWN_REQUEST_NAME` and the full linter rule list,
  exit codes, and `render` / `test` flags.
