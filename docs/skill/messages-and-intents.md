# Tutuca — Messages & Intents

The two dispatch channels: **messages** (`ctx.send` / `ctx.at.….send` /
`app.sendAtRoot`, and a view's own `@on.*` → a `receive` handler on one
addressed component) and **intents** (`ctx.intent` → a walk along a
*route* until something answers). Read this file when writing `receive`
/ `intent` handlers, calling `ctx.send` / `ctx.intent` / `ctx.reply` /
`ctx.fail` / `ctx.forward` / `ctx.stop`, or registering intent handlers
with `registerIntentHandlers`. General authoring lives in
[core.md](./core.md); testing these handlers is in
[testing.md](./testing.md).

## The two channels

One question separates them: **does the sender know who handles this?**

- If yes, it **sends a message**. It goes to one component and stops.
- If no, it **raises an intent**. It walks a route until something answers.

| Triggered by | handler bucket |
| --- | --- |
| DOM event (`@on.click`, `@on.input`, …) | `receive` |
| `ctx.send(name, args)` / `ctx.at.….send(…)` | `receive` |
| `app.sendAtRoot(name, args)` | `receive` |
| an answer to an intent this component raised | `receive` |
| `ctx.intent(name, args, opts)` — walks a route | `intent` |

The first four rows are one bucket, and there is **no way to tell them
apart**. That is deliberate: a component that answered its own click
differently from the identical `ctx.send` from its parent could be driven
neither from a test nor from a parent.

Every dispatched handler is called as `handler(draft, ...args, ctx)`. Mutate
`draft` and return nothing to commit; `this` remains the immutable current
instance. Returning another value swaps it into the dispatch path. `ctx` (an
`EventContext`) is always the trailing argument.

`alter` is a third block, but it isn't dispatched — the renderer invokes alter
handlers to produce binds, not to update state. See *Mental model* in
[core.md](./core.md) and *Scope Enrichment* in [iteration.md](./iteration.md).

## Messages — `ctx.send`, `receive`

`ctx.send(name, args)` delivers a message to the **current** component;
`ctx.at.<place>.send(name, args)` delivers it to an addressed one. The
target's `receive.<name>(...args, ctx)` handler runs. There is **no built-in
lifecycle** — `receive.init` is just a convention; the host must dispatch it
(typically after `app.start()`) for it to run.

```js
receive: {
  init(_draft, ctx) { ctx.at.field("status").send("flash", ["Ready"]); },
  flash(draft, text) { draft.text = text; },
}
```

Dispatch from anywhere:

```js
app.sendAtRoot("init");                                    // host code, top-level
ctx.at.field("personalSite").send("init");                 // child by field name
ctx.at.index("items", 3).send("startEditing");             // list element at index 3
ctx.at.key("byKey", "k1").send("ping");                    // map entry by key
ctx.at.field("a").field("b").index("xs", 0).send("ping");  // chain freely
ctx.send("loadData");                                      // self
```

`ctx.at` returns a `PathBuilder` with `.field(name)`, `.index(name, i)`, and
`.key(name, k)`. Each call appends a step before `.send(...)` / `.intent(...)`
fires; the handler runs inside the child instance with `this` bound to it.

### Replying to a message — `ctx.sendReply`

An intent's raiser asked a question and declared arms for the answer, so the
runtime names it (`<name>Ok`). A message carries no such expectation, so the
**replier picks the name**:

```js
receive: {
  ping(_draft, ctx) { ctx.sendReply("pong", ["from-child"]); },
}
```

The reply is an ordinary message delivered to whoever sent this one, at the
position they sent it from (pinned at dispatch, like an intent's answer). With
nobody waiting — a view's own `@on.*`, or `app.sendAtRoot` — it refuses
`NO_SENDER` and nothing is dispatched. `ctx.reply` stays intent-only.
Paths are positional, not references — see *Positional delivery* below.

**When to send.** Send when *one specific component* must be told something: a
form telling its email field to focus after a failed submit, a list telling
item 3 to enter edit mode, a "Reload" button reusing the `receive.loadData`
body that `receive.init` also calls. Don't `send` to self when a direct method
call would do — and don't send when you don't know who should answer. That is
what an intent is for.

## Intents — routes and legs

`ctx.intent(name, args, opts)` raises a job the sender does not address. The
runtime walks a **route**, offering the intent to each hop in turn.

A route is a list of **legs**, and there are two:

| leg | walks |
| --- | --- |
| `"dyn"` | the **dispatch path** — the sender's *parent*, then its parent, up to the root |
| `"lex"` | the **registration scope chain** — the handlers `registerIntentHandlers` put on the scope, then the scopes above it |

With no `opts.route`, an intent takes the default route `["dyn", "lex"]`: try
the ancestors, then the registered handlers. That default is written down in
exactly one place (`DEFAULT_ROUTE` in `src/transactor.js`), so "what does a
bare `ctx.intent` do" has one answer and no second copy.

```js
receive: {
  go(ctx) {
    ctx.intent("saveDraft", [this.name]);                        // dyn, then lex
    ctx.intent("picked", [this.page], { route: ["dyn"] });        // ancestors only
    ctx.intent("loadRows", [], { route: ["lex"] });               // the scope only
    ctx.intent("saveDraft", [this.name], { route: ["lex", "dyn"] }); // in the order written
    return this;
  },
}
```

The `dyn` leg starts at the sender's **parent**, not at the sender: an intent
is never offered to the component that raised it. (One that wanted to handle it
itself would have written the body inline.)

Walks are depth-bounded — 64 hops, after which the runtime ends the walk as an
exhaustion rather than looping, so the sender still hears something.

## Answering an intent

A component answers with an `intent.<name>` handler. Inside it:

- `ctx.reply(value)` — answer with a result. **Ends the walk.**
- `ctx.fail(error)` — answer with an error. **Ends the walk.**
- `ctx.forward(opts)` — hand the intent to the next hop (see below).
- `ctx.stop()` — end the walk **answering nothing**.
- ...or none of the above: the body runs, returns new state, and the walk goes
  on. A handler that does not reply is an **observer**.

```js
intent: {
  // Answered where it arrives.
  saveDraft(draft, text, ctx) { draft.count++; ctx.reply(draft.count); },
  // An observer: it records the intent and lets it keep walking.
  picked(draft, k) { draft.page = k; },
}
```

The one rule to hold on to: **a reply ends the walk; running does not.** An
observer and an answerer are the same construct with and without a `reply`,
which is why no separate "listener" bucket exists.

Two consequences worth knowing:

- The one-shot is **per intent, across hops** — not per body. A body may call
  `ctx.reply` twice; the first wins and the second is refused.
- A hop whose handler throws never completes its transition, so it did not
  answer, and the walk continues past it as if it had declined.

## The three outcomes

An intent has exactly three ends, each with its own name and its own payload
shape:

| outcome | dispatched name | payload |
| --- | --- | --- |
| a hop replied | `<name>Ok` | the replied value |
| a hop failed | `<name>Error` | the error value |
| the route ran out | `<name>Unhandled` | the intent's own arguments |

They arrive back at the sender as **ordinary messages, in the `receive`
bucket**. A handler cannot tell an answer from a message a parent sent, and
does not need to.

**Declaring the arms is what makes an intent a request rather than a
notification** — a sender expects an answer if and only if it declares one.
Nobody writes that down twice: at the moment a walk ends, the runtime looks the
derived names up in the sender's own `receive` bucket.

```js
receive: {
  init(draft, ctx) { draft.isLoading = true; ctx.intent("loadData", [], { route: ["lex"] }); },

  // The three ANSWERS. Declaring them is what wires `loadData` up.
  loadDataOk(draft, res)      { draft.isLoading = false; draft.items = res; },
  loadDataError(draft, err)   { draft.isLoading = false; draft.error = String(err); },
  loadDataUnhandled(draft)    { draft.isLoading = false; draft.error = "nothing answers loadData"; },
}
```

There is no arm that can be handed both a result and an error, so none can read
the wrong one. (The old combined `(res, err)` shape is gone, and so is the bug
it caused.)

`<name>Unhandled` is what a route running out means, and it carries **the
intent's own arguments** so the sender can degrade or retry without keeping a
copy. What the sender hears when a route runs out depends only on what it
declares:

1. it declares `<name>Unhandled` → that, with the intent's own args;
2. else it declares `<name>Error` → that, with `"noHandler"`;
3. else it declares only `<name>Ok` → a console warning, because an answer was
   expected and none came; an answer never disappears in silence;
4. else nothing at all → silence. That is a **notification**, and it is the
   idiomatic fire-and-forget shape.

A handler that must answer has no way to say "not mine" — it can only invent an
error — which is why declining is a separate answer from failing. "Nothing
claimed it" and "a handler refused it" are different sentences, so they have
different names.

## `ctx.forward` — one word, two sides

`ctx.forward(opts)` is the same word from both ends of a walk, and which one you
get depends on which bucket you are in:

- **In an `intent` handler** it *amends the hop*: the walk goes on, optionally
  with new `args` or a narrowed `route`. It does not push a hop itself — a walk
  advances on its own.
- **In a `receive` handler** it *starts a walk*: the message that arrived
  becomes an intent, keeping its name and payload.

```js
receive: {
  saveDraft(_draft, text, ctx) { ctx.forward(); },                    // default route
  picked(_draft, k, ctx)       { ctx.forward({ route: ["dyn"] }); },  // ancestors only
  logThenPass(draft, t, ctx)   { draft.count++; ctx.forward(); },
},
intent: {
  picked(draft, k, ctx) { draft.page = k; ctx.forward({ args: [k, "seen"] }); },
}
```

This is what lets a view's name **leave** the component. A view says
`@on.click="saveDraft .text"` — what the user asked for, not who answers it.
The component may answer it today and an ancestor may answer it tomorrow, and
the view never changes.

## Registering intent handlers — the `lex` leg

The `lex` leg walks handlers registered on the **scope**, not on components.
They are plain functions — usually `async` — registered as a **list per name**,
because the leg walks: a declining handler hands the intent to the next one.

| the handler | meaning |
| --- | --- |
| resolves a value | answered; the sender hears `<name>Ok` |
| throws / rejects | failed; the sender hears `<name>Error` |
| returns `PASS` | **declines**; the walk goes on to the next hop |

```js
import { PASS } from "tutuca";

export function getIntentHandlers() {
  return {
    async loadData() {
      const r = await fetch("https://example.com/data.json");
      return await r.json();
    },
    // A list when more than one handler can answer a name.
    persistState: [
      async (state, instance, push) => (push ? PASS : save(state)),
      async (state) => pushHistory(state),
    ],
  };
}

// register at the same scope where you registerComponents
const scope = app.registerComponents([Comp]);
scope.registerIntentHandlers(getIntentHandlers());
```

`PASS` is the handler's half of "running is not answering", and it is what
makes `<name>Unhandled` reachable. An intent name that **nothing** is
registered for is not a crash and not an error: the route runs out and the
sender hears `<name>Unhandled`. A typo surfaces there.

### The handler contract

Registered handlers run with **no `this`** (they are invoked as
`fn.apply(null, [...args, ctx])`), so they cannot read component state — pass
everything they need through `args`. Aggregate handlers from sub-modules with
spread:

```js
export function getIntentHandlers() {
  return { ...getIntentHandlersA(), ...getIntentHandlersB() };
}
```

The handler also receives an intent context as its **final argument** —
usually ignored, but available when needed. Like every ctx it exposes
`ctx.walkPath(callback)`, which walks the component instances on the issuing
path **leaf→root**, calling `callback(Component, instance)` (return `false` to
stop early). It captures the immutable dispatch root/path, so it may be called
before or after an `await`. (The storybook uses this to let an example mock the
intent handlers its component raises — per example, in isolation.)

### Chaining from an answer arm

An answer arm gets the full `ctx`, so it can raise further intents or send
messages:

```js
receive: {
  loadUserOk(draft, user, ctx) { draft.user = user; ctx.intent("loadUserDetails", [user.id], { route: ["lex"] }); },
  loadUserDetailsOk(draft, details) { draft.userDetails = details; },
}
```

## Integrating with the outside world

A tutuca app talks to the outside world in two directions, and both go through
handlers — never around them.

- **Outbound** — the app reaches out (fetch, timers, IndexedDB, external SDKs).
  `ctx.intent(name, args, { route: ["lex"] })`; the scope-registered handler
  does the async work and the answer lands back in component state as
  `<name>Ok` / `<name>Error`.
- **Inbound** — the outside world pushes an event in (a WebSocket message, a
  `postMessage`, a timer, a third-party callback). Use
  `app.sendAtRoot(name, args)` from the host / glue code. It dispatches a
  message to the **root component**, running its
  `receive.<name>(draft, ...args, ctx)` handler under the same draft-first
  transaction contract as every other handler.

```js
// host / glue code, outside the component tree
ws.onmessage = (e) => app.sendAtRoot("serverPushed", [JSON.parse(e.data)]);

// root component
receive: {
  serverPushed(msg) { return this.prependEvent(msg); },
}
```

⚠️ **Do not** reach into `app.state` and call the raw `State.set(val)` /
`State.update(fn)` methods to inject external data. That bypasses the component
handler model, the draft-first transaction discipline, scope enrichment,
and the transactor's batching — state mutated that way is invisible to the
components that own it and easily clobbered by the next transaction. Route
every inbound event through `app.sendAtRoot` instead.

`sendAtRoot` only targets the root (`Path([])`). To land an inbound event on
nested state, let the root's `receive` handler forward it with
`ctx.at.field(...).send(...)` — one entry point, still reaching deep.

## Fire-and-forget

An intent whose answer you don't need declares no answer arms, so the outcome
is dropped. Idiomatic for side-effect-only work like persisting state:

```js
receive: {
  applyFilter(draft, value, ctx) {
    draft.filter = value;
    ctx.intent("persistState", [{ key: "sectionFilter", value }], { route: ["lex"] });
  },
}
```

Fire several in one handler when needed — they go out in the order written.

## `livePath` — pinning vs following a moving key

`opts` takes `livePath`. It controls where the answer lands when the sender's
path addresses a seq-access entry (`.sheets[.selId]`): by **default** the
resolved key is *pinned* at dispatch time, so the answer updates the item that
raised the intent even if `.selId` moved while the walk was in flight (e.g. the
user switched tabs). Set `livePath: true` to opt out and re-resolve the key
live, delivering to whatever the key now points at:

```js
ctx.intent("save", [payload], { route: ["lex"] });                    // pinned
ctx.intent("refresh", [], { route: ["lex"], livePath: true });        // live
```

The pinning rules per step kind (and why list indices still slide) are in
[semantics.md](./semantics.md) (*Key resolution & async races*).

## `$unknown` fallback

`receive` and `intent` share one fallback: when no handler matches the
dispatched name, the runtime looks for `<block>.$unknown(...args, ctx)` and
runs that instead; `ctx.name` tells it which name was dispatched. Absent both
the named handler and `$unknown`, the message is silently dropped (the value
passes through unchanged). Use `$unknown` for a single catch-all (logging, a
generic router).

An `intent.$unknown` that calls `ctx.reply` would answer **every** intent that
reaches it and swallow every walk — make it an observer, or `ctx.forward()`.

## Positional delivery across async

The path a message or an answer is delivered to is **positional** — an array of
steps from the root, not a captured reference. This is why an answer survives
intervening transactions that rebuilt the root (see *Mental model* in
[core.md](./core.md)). Practical rule: anchor on map keys, not list indices,
when an async answer must reach a specific item — the per-step-kind pinning
rules are in [semantics.md](./semantics.md).

## See also

- [core.md](./core.md) — the core mental model, `view` directives, handler
  blocks overview, and *Conventional Module Exports*.
- [component-design.md](./component-design.md) — which channel to reach for when.
- [semantics.md](./semantics.md) — the path/transaction model behind these
  channels: path steps, the transaction lifecycle, teleporting, and the
  key-pinning rules `livePath` toggles.
- [testing.md](./testing.md) — driving message and intent flows from tests.
- [cli.md](./cli.md) — the full linter rule list, exit codes, and
  `render` / `test` flags.
