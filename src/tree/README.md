# src/tree: addresses, messages and the scheduler

The part of tutuca that [`spec/tree/`](../../spec/tree/README.md) models: where a node is in the
state, how a message reaches it, and what happens to the message when the tree changes under it.

It imports nothing from outside this directory, and `test/paths/tree-isolation.test.js` checks
that. It knows nothing about components, views, the DOM or immer. A host plugs those in through
the four interfaces in `scheduler.js`. It ships as `tutuca/tree`.

| File | What it holds |
|---|---|
| `identity.js` | `idOf`, `isNode` (internal), `mint`: a node's identity ι; `copy`, a copy whose every node is new (M8) |
| `path.js` | `KeyPath` (keys into the state), `Frame` and `DispatchPath` (π, the frames a message went through), `Selector`/`selectorFrom` and `Target` (a written path, before it is fixed) |
| `address.js` | `Address` (`(at π ι)`), `HOST` (`host`) |
| `messages.js` | the envelope: `Task`, `NotifyTask`, `AskTask`, `AnswerTask` |
| `settle.js` | `SettleScope`: what a watched `sendAt` caused, counted until it settles |
| `context.js` | `MessageContext`: what a handler sends with |
| `scheduler.js` | `Scheduler`: the queue and `tree->` |
| `text.js` | how keys and values print |

## From spec/tree to the code

| spec/tree | here |
|---|---|
| identity `ι` | `idOf(node)`, given once by `mint`; updates keep it |
| `(copy pp)`, `(share pp)` | `copy(node)` (fresh identities); putting the same value in a second place (shared ones) |
| path step `(field f)`, `(index f i)`, `(key f κ)` | a `Frame`: `keys` `[f]`, `item` `i` or `κ` |
| written path `(sel f g)` | the selector op `seqItem(f, g)`, which `Selector.freeze` turns into an `item` |
| address `(at π ι)` | `Address`: `path` (a `DispatchPath`) and `id` |
| `host` | `HOST`: the `from` of env events and of ask answers |
| envelope `(msg mode m from to)` | `Task`: `name`, `args`, `from`, `to`; `mode` is the class |
| `hkey`: `(send n)`, `(notify n)`, `(ok n)`, ... | `task.hkey`: `{ mode, name, outcome }`, looked up through `Kinds.handler` |
| `(notify n e ...)` | `ctx.notify`. The hops are fixed by `Address.ancestors` when the bubble starts |
| `(request n e ...)` | `ctx.ask`. Its handler is `Kinds.askHandler` (the host answering) |
| `(send-at pp n e ...)` | `ctx.sendAt(name, args, (p) => p.field(...))`, fixed against the committed tree |
| `(reply n e ...)` | `ctx.reply`: a `Task` to `task.from` |
| `stop`, `pass` | `ctx.stopNext()`; a hop with no handler passes |
| transaction | one `Transact` call. `ctx.tasks` is staged and queued only on commit |
| rule `env` | `Scheduler.arrive`: ahead of the queue, behind tasks that `runsBeforeEnv` |
| rule `respond`, urgent / normal | `AskTask.start`: `{ now }` goes to `Scheduler.urgent`, `{ later }` to `Scheduler.push` |
| rule `run` | `Scheduler.step` and `deliver` |
| granularity `turn` | `NotifyTask.run` puts the next hop in `ctx.nextHop`, which runs next |
| policy `by-path-checked` | `Address.resolve` and `Scheduler.receiver` |
| observations `stale`, `orphaned`, `lost`, `unhandled` | `Hooks.observe(type, info)` |

`Frame.provider` has no counterpart in spec/tree. It is a frame that starts from an ancestor's
frame (the one at `provider.depth`, plus `provider.keys`) instead of from the frame before it.
That's where a node reads a value an ancestor provides, and `DispatchPath.resolve` is where it
matters.

[spec/tree's README](../../spec/tree/README.md#what-tutuca-does) lists where tutuca's choices
still differ from `core.rkt`.

## The interfaces

```js
new Scheduler({
	kinds: {
		handler(instance, hkey) {},        // the handler a node has for hkey, or undefined
		askHandler(instance, name) {},     // what answers an ask made from instance, or null
	},
	store: { get() {}, set(root) {} },     // where the root lives
	transact(root, keyPath, fn) {},     // a new root, with fn(draft of the leaf) at the path
	hooks: {
		context(task, instance, nextRequest) {}, // a MessageContext, or a host's subclass
		beforeCommit(prev, next, task) {},       // optional: returns what to call after commit
		committed(task, ctx, info) {},           // optional
		observe(type, info) {},
		wake() {},                               // optional: something was queued
	},
});
```

Tutuca's own bindings are `componentKinds`, `TutucaContext` and `HostTask` in `src/tasks.js`,
plus immer's `produce` and the hooks in `Host` (`src/host.js`).
