# Tutuca — Runtime Semantics (paths · transactions · dispatch)

How a click becomes a state mutation, and what survives across async.
Read this when reasoning about **why** a handler ran where it did,
debugging a dispatch or async-timing bug, or changing `src/path.js` /
`src/transactor.js`. Not needed for ordinary component authoring — for
that start at [core.md](./core.md).

The step and transaction names below are the ones in the source; confirm
behavior against `src/path.js` / `src/transactor.js` (or grep the
`tutuca-source` skill) rather than trusting this doc when they disagree.

## State & identity (in one paragraph)

The application is a single immutable root value; the view is a pure
function of it; every component handler receives an Immer draft while `this`
remains the immutable current value, and the transactor swaps the produced
root atomically. Updating a deep child
produces a new root that shares structure with the old one along the
unchanged spine, so the renderer's `===`-keyed cache skips untouched
subtrees. Full version: *Mental model* in [core.md](./core.md).

## Paths are positional addresses

A `Path` is an array of `Step`s from the root to the value a handler runs
against — a **position**, not a captured reference (see *Paths, not
references* in [core.md](./core.md)). The step kinds:

| Step                | Addresses                          | Source syntax            |
| ------------------- | ---------------------------------- | ------------------------ |
| `FieldStep`         | a named field                      | `.field`                 |
| `SeqStep`           | a sequence entry by **literal** key/index | `.items[2]`       |
| `SeqAccessStep`     | a sequence entry whose key is **read from another field** | `.sheets[.selId]` |
| `EachRenderItStep`  | an iterated `render-it` item       | `<x render-it>` per iter |
| `BindStep` / `EachBindStep` | nothing — frame-only (carry scope binds, no addressing) | `@each`, `@enrich-with` |

`SeqAccessStep` is the important one for async correctness: it stores the
field *names* `seqField` and `keyField`, and resolves the key from the
live data each time it runs — see *Key resolution & async races* below.

### A dispatch path is a stack of continuation frames

What reconstruction actually returns is a `DispatchPath`: a list of frames,
each `{ base, items }`. Ordinary rendering extends the top frame's `items`;
rendering a located binding (`<x render="*sel">`) pushes a NEW frame based
at the value's own absolute path — see *Rendering with a resumed path*
below. Two projections come off it:

- **`compact()` → the dispatch path.** Drops frame-only steps inside every
  frame independently, keeping one step per crossed component. `popStep()`
  over it walks every component, and at the top of a frame returns to the
  visual caller. Used to drive `ctx.send` / `ctx.intent` and to locate
  handlers.
- **`toTransactionPath()` → the transaction path.** The ACTIVE frame alone:
  its absolute base followed by its own steps, so a mutation lands on the
  data's real location. The saved caller frames affect bubbling only. Used
  by `lookup` / `setValue` to read and write state.

## Reconstructing a path from the DOM

The DOM is the only thing that survives between render and click, so the
renderer leaves breadcrumbs: `data-cid` / `data-nid` / `data-eid` on
elements, and `§…§` comment "metas" adjacent to component boundaries,
iteration entries, and scope boundaries (loop-less `@enrich-with`, so
their custom binds can be replayed). On an event, `Path.fromNodeAndEventName` walks from the
target up to the root, reads the breadcrumbs, and rebuilds the path. Along
the way it resolves the handler: normally on the **leaf** component, but
for DOM-bubbling events it can resolve on an
**ancestor**, in which case the descending steps below that ancestor are
dropped so the path resolves to the ancestor's value.

## The transaction lifecycle

Each dispatch is a `Transaction`. The `Transactor` holds a FIFO queue;
`App` drains it in time-budgeted batches on a `setTimeout(…, 0)` (see
`src/app.js`), so transactions complete **asynchronously and interleaved**
— which is exactly why an intent's answer can land after other
transactions have rebuilt the root.

The core of applying one is `Transaction.run`:

```js
const txnPath = this.getTransactionPath(); // transaction path, or a pinned path
const curLeaf = txnPath.lookup(curRoot); // immutable value addressed now
const newLeaf = produce(curLeaf, (draft) => {
  const result = this.callHandler(curRoot, curLeaf, draft, comps);
  if (result === undefined || result === draft) validateDraftFields(curLeaf, draft);
  return result;
});
return curLeaf !== newLeaf ? txnPath.setValue(curRoot, newLeaf) : curRoot;
```

Returning nothing (or the draft) commits draft mutations; returning another
value replaces the addressed leaf. Immer rejects a handler that both mutates
the draft and returns a replacement. `Path.setValue` uses a second, short
recipe to rebuild only the path spine. The root swap is atomic and
identity-cheap: unchanged subtrees keep their references, so re-render is
incremental. Per-dispatch completion is tracked by `Completion`
(counter-based): `whenSettled()` resolves once a transaction's own work
finishes, `whenSubtreeSettled()` once the subtree it spawned (intents,
follow-on sends) settles too.

## Dispatch channels, semantically

The authoring API (`ctx.send` / `ctx.intent`, the handler blocks) is in
[messages-and-intents.md](./messages-and-intents.md). Underneath there are two
channels, and one question separates them: **does the sender know who handles
this?**

| Channel | Transaction | Notes |
| --- | --- | --- |
| DOM event → `receive` | `InputEvent` | transacted **synchronously** (`transactInputNow`), not queued; resolves its handler from the compiled view |
| `ctx.send` → `receive` | `SendEvent` | queued; addressed at one component and stops there |
| an intent's answer → `receive` | `SendEvent` | queued; named `<name>Ok` / `<name>Error` / `<name>Unhandled`, and indistinguishable from any other message |
| `ctx.intent` → `intent` | `IntentEvent` per `dyn` hop; no transaction for a `lex` hop | queued; the walk state lives in `IntentWalk`, shared **by reference** across hops |

The `dyn` leg is walking up the dispatch path one `popStep` at a time, starting
at the sender's **parent**. `targetPath` (the originator's path) stays fixed as
`path` shortens, so a hop can reach the originator via
`ctx.sendAtPath(ctx.targetPath, …)`.

The walk object is shared across hops on purpose: that is what makes the
one-shot **per intent** rather than per hop, so a second `ctx.reply` — from this
handler or one three hops up — finds the walk already ended.

## Rendering with a resumed path

A component rendered through `<x render="*sel">` *physically lives* at the
producer that declared `provide: { sel: … }`, not under the consumer that
wrote the render. A provider evaluates both halves of a lowercase binding:
its value, and the absolute path of that value. A descendant retrieves the
nearest pair and renders the value after pushing its path as a continuation
frame; the frame's base is recorded in the DOM (`base` in the `§Comp§` meta,
`data-rp` on a fragment-rooted body) so reconstruction can rebuild it.

Consequently:

- mutation uses the ACTIVE frame, so an event inside the resumed component
  updates the provider's data, and the consumer's view of it updates in
  lock-step;
- bubbling reaches the top of that frame and pops directly back to the
  visual caller, then continues through the caller's ancestry.

There is no producer search, producer id, interior list, or path rewriting
at dispatch. Nested providers therefore shadow by live render ancestry: the
nearest one that actually rendered wins. Authoring view: *Resuming at the
value's path* in [advanced.md](./advanced.md).

When the producer's `provide` value is a seq-access (`.sheets[.selId]`), the
frame's base ends in a `SeqAccessStep` — which is where async key races come
from.

## Key resolution & async races

A `SeqAccessStep` resolves `keyField` from the live root **every time it
runs**. For synchronous dispatch this is invisible — the key cannot change
mid-transaction. For an async intent it is the whole problem: between
raising the intent and applying its answer, the key may move (e.g. the
user switches the selected tab, so `.selId` changes), and a naive
re-resolution would deliver the answer to **whatever item is selected
now**, not the one that raised the intent.

**Key pinning is the default.** `pushIntent` snapshots the resolved key
at dispatch time by running `Path.pinKeys(curRoot)` over the transaction
path — each `SeqAccessStep(seq, keyField)` becomes a literal
`SeqStep(seq, resolvedKey)`. The pinned path is stored on the
`IntentWalk`, so the answer updates the item that raised the intent
regardless of later key changes. (Pinning runs on the transaction path,
because the `SeqAccessStep` may have come from a resumed frame's base. The
answer still DISPATCHES at the raiser's position, frames and all; the pinned
path only decides where its mutation lands.)

**Opt out per intent with `livePath: true`:**

```js
ctx.intent("save", [payload], { route: ["lex"], livePath: true }); // re-resolve live
```

With `livePath`, the answer re-evaluates the key at apply time — the old
"follow the latest selection" behavior. Use it only when the answer is
*meant* to follow wherever the key now points.

Edge cases:

- **Pinned target deleted before the answer arrives** — the pinned
  `SeqStep` resolves to nothing, the handler runs against a null leaf, and
  the result equals the input → a safe no-op (root unchanged). With
  `livePath` it would instead hit the current item.
- **The `EventContext` path stays live (un-pinned).** An answer arm that
  itself re-dispatches via `ctx.send` / `ctx.intent` re-resolves
  against current state — pinning covers the *update*, not nested
  re-dispatch.

## What "positional delivery" guarantees

Because a path is a position, an async response survives intervening
transactions that rebuild the root — but "the right slot" means different
things per step kind:

- **`SeqAccessStep` (`.seq[.key]`)** — the key is **pinned by default**, so
  the answer reaches the entry that raised the intent even if the key
  field moved. Opt out with `livePath: true`.
- **`SeqStep` with a list index (`.items[3]`)** — the index is literal and
  **not** pinned to identity: if the list re-sorted or an item was inserted
  ahead of it, index 3 is now a different item and the answer lands
  there. Anchor on **map keys**, not list indices, when an async result
  must reach a specific item.
- **`FieldStep`** — a named field is stable; no ambiguity.

## See also

- [core.md](./core.md) — *Mental model* and *Paths, not references* (the
  high-level invariants this file expands on), `view` directives, handler
  blocks.
- [messages-and-intents.md](./messages-and-intents.md) — the dispatch **API**:
  addressed `send`-`receive` vs routed `intent`, `ctx.at`, `$unknown`,
  intent-handler registration, and the `livePath` option.
- [advanced.md](./advanced.md) — dynamic bindings (`*x`), lexically
  registered paths, and the authoring view of resuming at a value's path.
