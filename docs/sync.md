# Sync engines

Handlers keep changing immer drafts. Sync engines sit beside them: the host tells every engine
about each change it commits, and an engine applies changes made elsewhere through the link it
was attached with.

```js
import { startSynced, storageEngine } from "tutuca/sync";
import { automergeEngine } from "tutuca/automerge";

await startSynced(host, {
	make: (C) => C.Notes(), // when no engine has stored anything yet
	engines: [automergeEngine({ handle }), storageEngine(localStorage, "notes")],
});
```

## How far a field goes

`.sync(level)` sets it on a field type; engines see the fields up to their level.

| Level | Replicated | Persisted | For |
|---|---|---|---|
| `"shared"` (default) | yes | yes | the document |
| `"local"` | no | on this device | filters, selected tabs, `t.index()` positions |
| `"none"` | no | no | drafts, open menus, hover |

On restore, fields an engine didn't keep take their defaults. A `t.index()` field in shared state
can point at another item after a peer inserts before it: make it `"local"` or store an id.

## Refs: component names are scoped

The projection writes a component as `{ $: ref, ...fields }`. A name is only unique in its scope,
so the ref is the path of the scope the component was made in, then its name there:
`"Item"` at the root, `"editor/Item"` in `host.scope.enter("editor")`. Scopes need a name
for this, so `scope.enter(name)` takes one, and entering it again returns the same scope.
A field named `$` is reserved (lint: `reserved-field`).

## Engines

An engine is `{ level, load?(), attach?(link), commit(change), detach?() }`:

- `level`: `"shared"` or `"local"`, the fields it sees.
- `load()`: its stored projection, to start from. `startSynced` lays the `"shared"` ones over the
  `"local"` ones.
- `attach(link)`: `link.root()` is the current state; `link.apply(producer)` applies a change made
  elsewhere, at once, and tells the other engines.
- `commit({ prev, next, task })`: a committed change; `opsOf(change, level, scope)` gives its ops.
  A throwing `commit` fails the task, so the state stays as it was.

An engine that only persists, or only calls back, is one object:
`{ level: "local", commit: (change) => save(project(change.next, { level: "local" })) }`.

## Ops and the diff

`diff(prev, next, { level, scope })` gives the ops that turn one state (or projection) into the
other. It skips the subtrees both share, so it only walks what changed. The schema guides it:

- `t.string()` fields change with `text` splices, so concurrent typing merges.
- Enums, indices and other strings are set whole.
- Array items match by identity, so an unshift is one `insert`.
- Records and maps change key by key.

```
{ op: "set", path, value }   { op: "delete", path }
{ op: "insert", path, index, values }   { op: "remove", path, index, count }
{ op: "text", path, index, remove, insert }
```

The playground's Steps tab shows each timeline entry's ops under Changes.

## Opting in from outside the app

An app needs no sync code: engines attach to the host, so whoever boots it decides. The demos
do it from the page's query (`demos/boot.js`, `demos/sync/engines.js`):

| Query | Engines |
|---|---|
| (none) | none, the app starts as always |
| `?sync=local` | `storageEngine`: the state stays in this browser |
| `?sync=worker` | `remoteEngine` to a pretend backend in a SharedWorker, kept in IndexedDB |
| `?sync=automerge` | `automergeEngine` over a `Repo` that syncs tabs over BroadcastChannel and keeps the document in IndexedDB; its URL goes in `&doc=` |

Every mode also keeps the `"local"` fields in the browser's storage, and each demo (by its path)
keeps its own state. Apps can add `.sync("none")` or `.sync("local")` to UI fields, which does
nothing without an engine.

## Ids: ctx.uuid()

Ids made by counting (`nextId`) collide when two peers add at once. Handlers take new ids from
`ctx.uuid()` instead: random in an app, counting up in a `Driver` (and in hosts made with
`uuid: sequentialUuids()`) so runs, and the determinism property, repeat.

## The reference engines

- `remoteEngine({ transport })` (`tutuca/sync/remote`) sends each change's ops to a remote that
  orders them by version (`relay()` is its side). A change made against an older version is
  rejected and that client reloads, so the first of two concurrent changes wins.
- `automergeEngine({ handle })` (`tutuca/automerge`) keeps the shared fields in an Automerge
  document. It takes an automerge-repo `DocHandle`, or `docHandle(doc)` for a bare document.
  Peers merge concurrent edits.

The [notes demo](../demos/notes/) shows what each field level keeps in every mode.
