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
reference. This is why an async response still lands at the right slot
after intervening transactions have rebuilt the root (see *Mental
model* in [core.md](./core.md)). The flip side: if the tree at that
position changed meaning while the request was in flight — e.g. a list
re-sorted so index 3 is now a different item — the response lands on
whatever currently occupies the slot. Anchor on stable keys (map entries
by key, not list index) when an async result must reach a specific item.
