# Sync

A tutuca app's state can be persisted, sent to a server, or merged with other peers, without the
app changing how it handles messages. This document specifies how that works, the engines that
ship with tutuca, and what an app must and should do to sync well.

- [How it works](#how-it-works)
- [The world through ctx](#the-world-through-ctx)
- [Reference engines](#reference-engines)
- [Writing an engine](#writing-an-engine)
- [Required practices](#required-practices)
- [Best practices](#best-practices)
- [Limits](#limits)

## How it works

Handlers keep changing immer drafts. **Sync engines** sit beside the host:

1. After a task commits a new root, the host calls `commit({ prev, next, task })` on every engine
   attached to it. An engine that throws fails the task: the root stays as it was and the task's
   child messages are dropped, as for any failed handler.
2. A change made elsewhere (by a peer, a server, a reload) reaches the host through the engine's
   link: `link.apply(producer)` runs `producer` on a draft of the current root, commits it at
   once, tells every *other* engine, checks the state in dev mode and renders.

Engines never see components. They see the **projection**, the state as plain JSON, and the
**ops** that change it.

```js
import { startSynced, storageEngine } from "tutuca/sync";
import { automergeEngine } from "tutuca/automerge";

await startSynced(host, {
	engines: [automergeEngine({ handle }), storageEngine(localStorage, "notes")],
	make: (C) => C.Notes(), // when no engine has stored anything yet
});
```

`startSynced` loads what each engine stored, hydrates it into components, starts the host with
it (or with `make(C)` when nothing is stored) and attaches the engines.

### The projection

`project(state, { level })` turns a state into JSON:

- A component becomes `{ $: ref, ...fields }`, with only its declared fields that the level sees.
- Arrays, plain objects (records and maps), strings, finite numbers, booleans and `null` stay as
  they are.
- Anything else (`undefined`, `NaN`, class instances, functions) throws with its path.

`hydrate(plain, scope)` makes the state back through each component's `make`. A field that the
projection doesn't have takes its default, and so does a value that doesn't match its type.

### Refs: component names are scoped

A component's name is only unique in the scope it is registered in, and scopes form a tree. A
ref is the path of the scope the component was **made** in, then the name it is looked up by
there:

| Made in | Ref |
|---|---|
| `host.scope` | `"Item"` |
| `host.scope.enter("editor")` | `"editor/Item"` |
| `host.scope.enter("editor").enter("preview")` | `"editor/preview/Item"` |

`scope.enter(name)` needs a name for this, and entering the same name again returns the same
scope, so a reloaded app finds it. The name in a ref is the registered one, so an alias
(`register({ Item: Other })`) round-trips as `"Item"`.

### Levels: how far a field goes

`.sync(level)` on a field type says which engines see it:

| Level | Replicated | Persisted | For |
|---|---|---|---|
| `"shared"` (default) | yes | yes | the document: what every peer must agree on |
| `"local"` | no | on this device | filters, the open tab, layout, `t.index()` selections |
| `"none"` | no | no | text being typed, open menus, drags, hover, undo history |

An engine has a level too: `"shared"` engines (servers, CRDTs) see shared fields; `"local"`
engines (the browser's storage) see shared and local ones. `startSynced` lays the shared
engines' projections over the local ones'.

### Ops and the diff

`diff(prev, next, { level, scope })` gives the ops that turn one state, or one projection, into
the other. Paths are keys into the projection.

```
{ op: "set",    path, value }                set a value (plain data)
{ op: "delete", path }                       remove a record or map key
{ op: "insert", path, index, values }        insert into the array at path
{ op: "remove", path, index, count }         remove from the array at path
{ op: "text",   path, index, remove, insert } splice the string at path
```

The diff is guided by the schemas:

- It skips the subtrees `prev` and `next` share. Immer keeps what a task didn't touch, so after a
  task it only walks what changed.
- `t.string()` fields change with `text` splices (common prefix and suffix kept), so concurrent
  typing can merge. Enums, `t.index()` and other strings are set whole.
- Array items match by identity, then by value for primitives: an unshift is one `insert`, and an
  item replaced in place is diffed into, so its own edits merge.
- Records and maps change key by key. A component whose spec changed is set whole.

`applyOps(root, ops)` applies ops to a projection; `applyStateOps(draft, ops, scope)` applies
them to a state draft, hydrating the components they bring. An op whose path isn't there throws
`OpConflictError`. The playground's Steps tab lists each timeline entry's ops under Changes.

## The world through ctx

Sync and testing need the same thing: handlers that compute the same state from the same inputs.
A handler that reads the clock or randomness itself gives every run, and every peer, a different
result. Handlers read the world through `ctx` instead:

| Instead of | Use | In an app | In a `Driver` |
|---|---|---|---|
| `Date.now()`, `new Date()`, `performance.now()` | `ctx.now()` | ms since the epoch | a clock stopped at `start` until `env.advance(ms)` |
| `Math.random()` | `ctx.random()` | a number in [0, 1) | a generator seeded with `seed` |
| `crypto.randomUUID()` | `ctx.uuid()` | a random UUID | UUID-shaped ids counting up |

Each `ctx` method mirrors the global it replaces, with the same result. The host takes them as
`env`: `new Host({ env })`, `browserEnv` by default. `testEnv({ seed, start })` makes one whose runs
repeat. `Driver` uses it, so pbt's determinism property holds for handlers that use `ctx`. Lint
warns (`nondeterministic-call`) when a handler calls one of the globals.

Asks (`ctx.ask("now")`) remain for what comes later or from outside: timers, files, the network.

## Reference engines

### `storageEngine(storage, key)` (`tutuca/sync`)

A `"local"` engine that writes the whole projection to a `Storage` (such as `localStorage`)
under `key` after each change, and loads it on start. It's the simplest persistence: one
browser, one writer.

### `remoteEngine({ transport })` (`tutuca/sync/remote`)

Sends each change's ops to a remote and applies the ops other clients send.

- The remote (`relay()`) keeps the projection and a version. It applies a batch only if it was made
  against its current version, and rejects it otherwise. A rejected client reloads the remote's
  state, so the first of two concurrent changes wins.
- Ops are batched per microtask: one batch per run of tasks.
- `transport` is `{ push(batch), subscribe(onMessage), load() }`. `memoryRemote()` connects clients
  to one relay in-process, for tests.

### `automergeEngine({ handle })` (`tutuca/automerge`)

Keeps the shared fields in an Automerge document, so peers merge concurrent edits.

- `handle` is an automerge-repo `DocHandle`, or `docHandle(doc)` for a document without a repo.
- `t.string()` fields are Automerge text, so concurrent typing interleaves. Every other string,
  refs included, is stored as an `ImmutableString`.
- Remote changes are diffed between the document before and after them: Automerge keeps
  untouched subtrees `===`, so this costs what changed.
- `@automerge/automerge` is an optional peer dependency. Nothing else in tutuca imports it.

### The demos' query switch (`demos/boot.js`, `demos/sync/engines.js`)

Every demo takes a `sync` query parameter and attaches engines without the app knowing:

| Query | Engines |
|---|---|
| (none) | none: the app starts as always and loads no sync code |
| `?sync=local` | `storageEngine`: the state stays in this browser |
| `?sync=worker` | `remoteEngine` to a pretend backend: a relay in a SharedWorker, kept in IndexedDB |
| `?sync=automerge` | `automergeEngine` over a `Repo` that syncs tabs over a BroadcastChannel and keeps the document in IndexedDB, with no server; its URL goes in `&doc=` |

Every mode also keeps the `"local"` fields in the browser's storage, and each demo (by its path)
keeps its own state. The [notes demo](../demos/notes/) shows what each field level keeps.

## Writing an engine

An engine is an object:

```js
{
	level: "shared" | "local",   // the fields it sees
	load() {},                   // optional: its stored projection, or null
	attach(link) {},             // optional: link.host, link.root(), link.apply(producer, info)
	commit(change) {},           // { prev, next, task }; task is null for changes from elsewhere
	detach() {},                 // optional
}
```

- `opsOf(change, level, host.scope)` gives a change's ops. It is computed once per change and
  level for every engine that asks.
- To bring in a change from elsewhere, use
  `link.apply((draft) => applyStateOps(draft, ops, link.host.scope))`. Apply it **when it
  arrives**, not later: its ops are paths into the state as it is now.
- A one-object engine that only persists, or only calls back:
  `{ level: "local", commit: (c) => save(project(c.next, { level: "local" })) }`.

## Required practices

An app that syncs must:

1. **Read the world through `ctx`.** Use `ctx.now()`, `ctx.random()` and `ctx.uuid()`, never the
   globals, in handlers. Lint warns about the globals.
2. **Make ids with `ctx.uuid()`, never by counting.** A `nextId` counter gives two peers that add
   at once the same id, and merging the counter doesn't undo that.
3. **Keep state JSON-shaped.** Use only the schema types: strings, finite numbers, booleans,
   `null`, arrays, records, maps and components. No `undefined`, `Date`, `Map`, `Set` or class
   instances. A change that can't be projected fails its task.
4. **Make components through scopes.** Use `scope.make`, `C.Name()` or `scopeOf(this).make`, so
   each one knows its scope. Name every scope you enter: `scope.enter(name)`.
5. **Don't name a field `$`.** It marks components in the projection; lint reports it
   (`reserved-field`).
6. **Keep the app's behavior inside handlers.** Engines see committed changes only. State changed
   any other way (by mutating outside a task, or by keeping values in closures or module
   variables) never syncs.

## Best practices

- **Give every field its level.**
  - Anything that only describes this person's view is `"local"` or `"none"`: the open tab,
    filters, search text, selections, drags, menus and dialogs, text being typed.
  - So is undo history: shared undo lets one tab undo another's edit.
  - Levels do nothing without an engine, so add them freely.
- **Point at items by id, not position.** A `t.index()` in shared state can point at another
  item after a peer inserts before it. Store the item's id, or make the index `"local"`.
- **Use `t.string()` for text people type, and enums for choices.** Text merges character by
  character, while enums and other strings are set whole, which is what a choice needs.
- **Keep derived values out of shared state when you can.** Counts, groupings and labels computed
  from other fields sync as extra ops, and two peers' merged edits can leave them stale. Compute
  them in getters, or recompute them in the handler that changes their inputs.
- **Keep invariants local to a component.** Merged concurrent edits are each valid but can
  combine into states no single task made. Dev mode checks the state after every applied change
  and reports `stateInvalid`; invariants that span many components are the ones that break.
- **Test with a `Driver`.** It uses `testEnv`, so handlers that use `ctx` repeat. The
  `test/sync` properties (generated edits on two peers, then convergence) show how to check an
  app's sync.

## Hot reload

The playground re-runs edited code without losing the app's state. `carry(prev, scope)`
(`tutuca/sync`) makes a state again with new versions of its components:

1. `project(prev, { level: "none" })`. The projection holds refs, not specs, so it outlives the
   module that made them.
2. `hydrate` it through `scope`, the scope tree the new components are registered in.
3. `diff` the projection before and after to tell what didn't come through.

It returns `{ root, added, reset, dropped, broken }`:

- `added` fields the old state lacked, now at their default.
- `reset` values the new type rejects (`{ path, before, after }`), now at their default. A
  narrower type keeps the values that still fit it: `number` → `number().int()` keeps integers.
- `dropped` fields the components no longer declare.
- `broken` what `findInvalidFields` finds in `root`, invariants included. The state is still
  carried; post-conditions belong to messages and aren't checked, since a reload runs none.

It throws when a component the state holds is gone, when a new field has no default, and when a
value can't be projected (a `Date` in a `t.any()`). The caller then starts fresh.
`specChanges(prevScope, scope)` lists the fields that changed by ref, as `typeText`, to tell what
a reload did; the values decide, not the types.

In the playground, Run (Ctrl/Cmd+Enter) carries each mounted story's state and its place in the
sequence; Reset and loading an example start fresh. The timeline starts with a "hot reload" entry
whose problems are the reset values and broken invariants; the Steps tab's "Hot reload" card
lists the spec changes, added and dropped fields. Tasks in flight are dropped and the old
timeline isn't replayed.

## Limits

- **Concurrency depends on the engine.** `remoteEngine` keeps the first of two concurrent
  changes and reloads the other client. Automerge merges both: last writer wins per field,
  inserts interleave and text merges.
- **Tasks already queued** when a remote change arrives were routed against the state before it.
  The queue usually drains in the same tick, but a remote insert can shift an index such a task
  holds.
- **The playground and storybook don't sync.** Their story runner rewinds a timeline of states,
  which live sync would fight.
