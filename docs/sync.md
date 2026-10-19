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

1. After a task makes a new root, the host tells every engine attached to it in two steps. First
   `prepare({ prev, next, task })`, the work that can fail on the change itself, such as
   computing its ops or projecting a value that can't be stored. A prepare that throws fails the
   task before any engine wrote anything: the root stays as it was and the task's child messages
   are dropped, as for any failed handler. Then, with the new root in place,
   `commit(change, prepared)` writes what prepare returned. A commit that throws (a full
   storage, a closed connection) is reported as `syncFailed` with the engine and the error, and
   the change stands for the host and the other engines.
2. A change made elsewhere (by a peer, a server, a reload) reaches the host through the engine's
   link: `link.apply(producer)` runs `producer` on a draft of the current root, commits it at
   once, tells every *other* engine, checks the state in dev mode and renders. A prepare that
   throws there skips that engine and reports `syncFailed`, since the change already happened.
   An apply made while engines are committing waits until they all have, so every engine sees
   changes in the order the host made them.

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

`startSynced` loads what each engine stored, rebuilds it into components (see
[Other versions of the app](#other-versions-of-the-app)), starts the host with it (or with
`make(C)` when nothing is stored) and attaches the engines.

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
engines' projections over the local ones' (`overlay`): the shared data wins, and the fields the
shared level doesn't see come from the local projection, inside components, records and maps.
An array keeps its local fields only when both projections hold the same components at the same
places; otherwise they take their defaults.

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
them to a state draft, hydrating the components they bring and making each op fit this
version's components (see [Other versions of the app](#other-versions-of-the-app)). An op that
doesn't fit the state it's applied to throws `OpConflictError` before changing anything:
`opFits(root, op)` says why. It checks the path through own keys only, indices as integers in
range, `set` inside arrays only on items that exist, `delete` on record keys only, and `text`
on strings, so a relay can apply what clients send. A map key named `__proto__` is data like any
other. The playground's Steps tab lists each timeline entry's ops under Changes.

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

- The remote (`relay()`) keeps the projection and a version. It applies a batch whole, and only
  if it was made against its current version and every op fits; it rejects it otherwise. So the
  first of two concurrent changes wins.
- A client has one batch in flight at a time, so every batch is made against the version before
  it. Ops committed meanwhile wait, and go as one batch when the remote confirms. At most one
  batch per run of tasks.
- The engine keeps a copy of the remote's projection, and makes each batch fit it (see
  [Other versions of the app](#other-versions-of-the-app)).
- Another client's batch that arrives while this one's ops are in flight, or committed and not
  yet pushed, means those ops were made against a state the remote moved past.
- A rejected client, one that got another's batch before its own ops went through, or one that
  missed a message (a gap in versions), resyncs: it loads the remote's state and
  applies the difference as ops (`applyProjection`), so its "local" and "none" fields stay. Its
  unconfirmed ops are dropped and reported as `syncRejected` with `ops`. Messages it has seen
  already are ignored.
- The engine subscribes before it loads, and applies what arrived meanwhile once attached, so
  a batch sent between the two isn't missed.
- `transport` is `{ push(batch), subscribe(onMessage), load() }` and delivers each direction's
  messages in order. A batch is `{ clientId, seq, base, ops }`; the remote answers every client
  with `{ type: "batch", clientId, seq, version, ops }` or `{ type: "reject", clientId, seq }`.
  `memoryRemote()` connects clients to one relay in-process, for tests.

### `automergeEngine({ handle })` (`tutuca/automerge`)

Keeps the shared fields in an Automerge document, so peers merge concurrent edits.

- `handle` is an automerge-repo `DocHandle`, or `docHandle(doc)` for a document without a repo.
- `t.string()` fields are Automerge text, so concurrent typing interleaves. Every other string,
  refs included, is stored as an `ImmutableString`.
- Remote changes are diffed between the document before and after them: Automerge keeps
  untouched subtrees `===`, so this costs what changed. A change that doesn't apply to the state
  (the state and the document parted ways) reports `syncFailed`, and the state is brought to the
  whole document instead.
- A document that changed between `load` and `attach` (a peer merged in meanwhile), or one
  `load` wasn't called for, brings the state to it on attach (`applyProjection`).
- Each change is written made to fit the document, which can lack a field this version added or
  hold a value of another type.
- `@automerge/automerge` is an optional peer dependency. Nothing else in tutuca imports it.

### The demos' query switch (`demos/boot.js`, `demos/sync/engines.js`)

Every demo takes a `sync` query parameter and attaches engines without the app knowing:

| Query | Engines |
|---|---|
| (none) | none: the app starts as always and loads no sync code |
| `?sync=local` | `storageEngine`: the state stays in this browser |
| `?sync=worker` | `remoteEngine` to a pretend backend: a relay in a SharedWorker, kept in IndexedDB |
| `?sync=automerge` | `automergeEngine` over a `Repo` that syncs tabs over a BroadcastChannel and keeps the document in IndexedDB, with no server; its URL goes in `&doc=` |
| `?sync=relay` | the same, and the `Repo` also syncs through the Automerge community relay (`wss://sync.automerge.org`), so other browsers and machines that open the same `&doc=` URL join in. The relay makes no uptime promises and anyone with the URL can read and edit the document |

Every mode also keeps the `"local"` fields in the browser's storage, and each demo (by its path)
keeps its own state. The [notes demo](../demos/notes/) shows what each field level keeps.

## Writing an engine

An engine is an object:

```js
{
	level: "shared" | "local",   // the fields it sees
	load() {},                   // optional: its stored projection, or null
	attach(link) {},             // optional: link.host, link.root(), link.apply(producer, info)
	prepare(change) {},          // optional: { prev, next, task }; task is null for changes from
	                             // elsewhere. The work that can fail on the change; returns what
	                             // commit writes
	commit(change, prepared) {}, // writes it: storage, the network
	detach() {},                 // optional
}
```

- `opsOf(change, level, host.scope)` gives a change's ops. It is computed once per change and
  level for every engine that asks.
- To bring in a change from elsewhere, use
  `link.apply((draft) => applyStateOps(draft, ops, link.host.scope, { level, onMigrate }))`.
  Apply it **when it arrives**, not later: its ops are paths into the state as it is now.
  `onMigrate(report)` is called when ops from a peer on another version had to be changed to
  fit; the included engines pass it on as `host.notify("stateMigrated", { engine, ...report })`.
- An engine that keeps a copy of the state (a document, a server's projection) writes each
  change's ops with `writeFitting(copy, ops, next, { scope, level, write })`, so they fit the
  copy even where this version of the components made the state differ from it. To bring the
  state to the whole copy (a reload), use `applyProjection(link, plain, { level, onMigrate })`:
  it keeps the fields other levels see.
- A one-object engine that only persists, or only calls back:
  `{ level: "local", prepare: (c) => project(c.next, { level: "local" }), commit: (c, p) => save(p) }`.

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

## Other versions of the app

Stored state, a peer's changes and the code before an edit can all come from another version of
the components. `tutuca/sync` makes them fit this one with hydrate's rules: fields a component
doesn't declare are dropped, values their type rejects take its default, and missing fields take
theirs. Each value is fitted where it is: one rejected item of an array, or value of a map,
takes its default and the others stay, whether it came in a stored projection or in an op. Each use says what it changed, as `{ added, reset, dropped }`:

- `added`: paths of fields the data lacked, now at their default. Only fields the level sees
  count: a "shared" projection lacking a "local" field isn't missing it.
- `reset`: `{ path, before, after }` for values the type rejects, now at its default. A narrower
  type keeps the values that still fit it: `number` → `number().int()` keeps integers.
- `dropped`: paths of fields the components don't declare, and of values that can't be made.

`rebuild(plain, scope, { level })` makes a projection into a state this way and returns
`{ root, added, reset, dropped, broken }`, `broken` being what `findInvalidFields` finds in
`root`, invariants included. It throws when a component the data holds is gone or a field has no
default. `startSynced` and `remoteEngine`'s reload use it; when the stored data didn't fit as is,
the host gets `stateMigrated` with the report (`engine` is `null` for `startSynced`).

`applyStateOps` applies a peer's ops the same way, op by op (`applyFitting`): an op under a field
this version doesn't declare is dropped (Automerge's diff already skips those fields, and they
stay in the document for the peers that know them), a value is rebuilt and reset to its type's
default when the type rejects it, and an op whose value can't be made, such as a component this
version doesn't have, is dropped. Types are checked without their owner, since a later op of the
same change can make an index valid; the dev checks see the result.

The other way round, `writeFitting` writes a change into an engine's copy made by another
version: up to the first op that doesn't fit the copy the ops go as they are, and from there the
copy gets the diff to the new state. A field this version added is written whole the first time
it changes, then as ops; a value of a type that changed is set whole. Nothing is written back
unless a task changes it, so peers on two versions don't fight over a field.

### Hot reload

The playground re-runs edited code without losing the app's state. `carry(prev, scope)` is
`rebuild(project(prev, { level: "none" }), scope)`: the projection holds refs, not specs, so it
outlives the module that made them, and `rebuild` makes it again with the new components. The
state is carried with broken invariants; post-conditions belong to messages and aren't checked,
since a reload runs none. `carry` also throws for a value a projection can't hold (a `Date` in a
`t.any()`), and the playground then starts fresh. `specChanges(prevScope, scope)` lists the
fields that changed by ref, as `typeText`, to tell what a reload did; the values decide, not the
types.

In the playground, Run (Ctrl/Cmd+Enter) carries each mounted story's state and its place in the
sequence; Reset and loading an example start fresh. The timeline starts with a "hot reload" entry
whose problems are the reset values and broken invariants; the Steps tab's "Hot reload" card
lists the spec changes, added and dropped fields. Tasks in flight are dropped and the old
timeline isn't replayed.

## Limits

- **Concurrency depends on the engine.** `remoteEngine` keeps the first of two concurrent
  changes and reloads the other client. Automerge merges both: last writer wins per field,
  inserts interleave and text merges.
- **Local fields under arrays** come back on start only when the shared array still holds the
  same components at the same places as the stored local one.
- **Tasks already queued** when a remote change arrives were routed against the state before it.
  The queue usually drains in the same tick, but a remote insert can shift an index such a task
  holds.
- **The playground and storybook don't sync.** Their story runner rewinds a timeline of states,
  which live sync would fight.
