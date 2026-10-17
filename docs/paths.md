# Paths

A component instance lives somewhere inside the root state. The rendered DOM holds no
references to instances, and every update replaces the root with a new immutable value. So
whenever the runtime needs to reach a component (to deliver an event, to apply a handler's
changes, or to send a message to another component), it does so through a **path**.

Tutuca has four kinds of path. Each has one job:

| Kind | What it is | Used for |
|---|---|---|
| `UpdatePath` | the property keys from the root state to a value | reading and writing state (`getIn`, `setIn`) |
| `DispatchPath` | a list of `Frame`s: how a component was reached while rendering | metadata comments, event routing, notify bubbling, `sourceKey` |
| `Selector` | `PathBuilder` calls (`field`, `item`, `seqItem`) | addressing a component from code (`ctx.sendAt`, `provides`) |
| `Target` | a `DispatchPath` plus a `Selector` below it | where a task goes, before its route is fixed |

A **route** pairs a dispatch path with its update path: `{ path, updatePath }`. Every task
runs with a route.

The formal model is in `spec/paths.rkt` (`upath`, `dframe`/`dpath`, `sel`, `route`). The task
side is in `spec/tasks.rkt` (`(at base sel)`).

## Update paths: where a value is

An `UpdatePath` is a list of keys: field names and collection keys.

```js
new UpdatePath(["tabs", 1, "child"]).getIn(root) // root.tabs[1].child
```

`getIn` reads one key at a time. `setIn` writes into an immer draft by assigning into the
parent. They are the only operations on an update path. The host uses one per task: it
reads the instance, runs the handler on a draft of it, and sets the result back into the
root.

An update path follows *ownership*: the fields and collections that actually contain the
component.

## Frames and dispatch paths: how a component was reached

Rendering a component means entering it from somewhere. That can be a field
(`render(field("child"))`), the selected item of a collection
(`render(seqItem("tabs", "selected"))`), a value an ancestor provides
(`render(provided("tab"))`), or a loop item (`each`, `renderEach`). Each of these entries is
one **frame**, and each frame is one render depth.

```js
new Frame(keys, item, provider, isComponent)
```

- **`keys`**: the properties the frame reads.
- **`item`**: the collection key the frame selects, or `null`. It is kept separate from
  `keys` because it is the frame's `sourceKey` (see below).
- **`provider`**: when set, `{ name, depth, keys }`. The frame doesn't start from the
  previous frame's value. It starts from the value captured by the provider at `depth`,
  reached by its `keys`.
- **`isComponent`**: a component boundary follows the frame. Loop items whose bodies are
  part of the enclosing component's own view are not component frames. Items rendered
  with `renderEach` or `renderIt` are.

`frame.accessKeys` is `keys` followed by `item`, if there is one.

These are the frames each render source produces:

| Source | Frame |
|---|---|
| `field("child")` | `keys: ["child"]` |
| `seqItem("tabs", "selected")` | `keys: ["tabs"], item: it.selected` |
| `provided("tab")` | `keys: [], provider: { name: "tab", depth, keys }` |
| a loop item `k` over any of the above | the source's `accessKeys` as `keys`, `item: k`, the same provider |

A `DispatchPath` is the list of frames from the root component down to a node. It records
*rendered ancestry*: the chain of views a node was rendered through. That chain can differ
from ownership. A provided component is owned by its provider but rendered, and bubbled
through, wherever its view put it.

### Frames in the DOM

The DOM keeps no component references, so frames are written into it. Every frame is a
comment before the nodes it covers, and a closing comment after them:

```
§{"t":"frame","p":null,"k":["tabs"],"i":1}§ … §/§
§{"t":"frame","p":{"v":"tab","d":0,"k":["tabs",1]},"k":[],"i":null}§ … §/§
§{"t":"component"}§ … §/§
```

`isComponent` is not written. When an event is routed, the frame just before a component
comment becomes a component frame.

### Event routing

To route an event, the runtime walks from the event target up to the root node:

1. It collects the `data-eid` of every element it passes, until it reaches the first
   component boundary. Elements outside the innermost component don't count.
2. For each ancestor, it scans the previous siblings for enclosing metadata. Each `§/§`
   hides one opening comment, and comments that only look like metadata are skipped.
3. It reads the metadata from the outermost in to rebuild the `DispatchPath`.
4. From the dispatch path it computes the route, and so the instance.
5. The handler is the first one matching the event type, trying the eids innermost first,
   in that instance's class.

### Component paths and parent paths

`toComponentPath()` drops trailing frames that are not component frames. A click inside a
loop item of a component's own view belongs to that component, not to the item. A
`MessageContext`'s path (`ctx.path`) is always a component path.

`toParentPath()` drops the last frame. It is where a notify goes next, so notifies bubble
along rendered ancestry. For example, a child that a `Panel` renders through
`provided("child")` notifies the `Panel`, then the `Panel`'s parent, even though the child's
state lives elsewhere.

### Resolving: from frames to keys

`resolve()` turns a dispatch path into an update path, going left to right:
- An ordinary frame continues from where the previous frame ended.
- A frame with a provider at depth `d` restarts from where the first `d` frames ended,
  followed by the provider's `keys`.
- Either way, the frame then appends its `accessKeys`.

`toUpdatePath()` is `toComponentPath().resolve()`. The route of a dispatch path is
`{ path, updatePath: path.toUpdatePath() }`.

Depth is what ties providers to frames. The root component is entered at depth 0 and every
frame adds one, so "captured at depth d" and "the first d frames" refer to the same
component.

### sourceKey

`path.sourceKeyIn(receiver)` answers which item the message came through, from the
receiver's point of view. It looks at the first frame past the receiver's own path, skipping
non-component loop frames until the last one, and returns that frame's `item`. It returns
`null` when the receiver itself or one of its ancestors sent the message.

`sourceKey()` in a send, and `ctx.sourceKey` in a handler, are computed this way from the
task's `sourcePath` and `ctx.path`:
- For an event, the key is that of the loop item holding the clicked element.
- For a notify, it is the slot of the child the notify came through.

## Selectors: addressing from code

Code builds selectors with a `PathBuilder` function:

```js
ctx.sendAt("inc", [], (b) => b.seqItem("items", "selected"));
provides: { tab: (b) => b.seqItem("tabs", "selected") }
```

A `Selector` is just the list of calls. It reads nothing until it is **frozen**:
`selector.freeze(value)` walks the calls from `value` and returns one component frame per
call:

| Call | Frame |
|---|---|
| `b.field(f)` | `keys: [f]` |
| `b.item(f, k)` | `keys: [f], item: k` |
| `b.seqItem(f, kf)` | `keys: [f], item: value[kf]`, reading `kf` when it freezes |

Providers freeze their selector against the providing instance at render time. The
resolved keys are the provider's `keys`, and the value they reach is what `provided(name)`
reads.

## Targets: where a task goes

A task is built with a `Target(base, selector)`. `base` is a dispatch path and `selector` is
the part still to be frozen. When the host prepares the task, it calls `target.freeze(root)`:
1. Resolve the base and read the value it reaches.
2. Freeze the selector against that value.
3. Append the resulting frames to the base.

The result is the task's dispatch path, and its route follows from that.

Selector frames never contain provider jumps. So resolving the frozen path gives the same
keys as resolving the base and appending the selector's keys. The spec checks this
equivalence.

## When each path is made

| Task | `sourcePath` | `target` | Route fixed |
|---|---|---|---|
| `EventTask` | the routed dispatch path | its base is the routed path | at event time, from the DOM |
| `sendAt` / `forwardAt` | `ctx.path` | `ctx.path` and the selector | at the producer's commit |
| `notify` | `ctx.path` | `ctx.path.toParentPath()` | at commit, and again at each bubble |
| `ask` | `ctx.path` | `ctx.path` | at commit |
| ask reply (async) | the ask's `sourcePath` | the same path | when the reply is created |

Two timing rules decide which state a path reads:

- **Events fix their route when they happen.** A click on the selected item goes to the item
  that was selected when the user clicked, even if older queued tasks change `selected` in
  the meantime.
- **Programmatic targets freeze at their producer's commit.** A `sendAt` with
  `seqItem("items", "selected")` reads `selected` from the state the producer committed,
  including the producer's own changes. Tasks queued after it can't change where it goes. If
  freezing fails (for example, a selector below a missing field), the whole producer
  transaction is rolled back with its children.

## A walk through

Take `Root { panel: Panel { selected: 1, items: [a, b] } }`. `Root` renders
`render(field("panel"))`, `Panel` provides `cur: (b) => b.seqItem("items", "selected")` and
renders `render(provided("cur"))`, and `b` renders a button.

1. **Render.** The button is preceded by these metadata comments:
   - `{k:["panel"]}`
   - `{t:"component"}`
   - `{p:{v:"cur",d:1,k:["items",1]},k:[]}`
   - `{t:"component"}`
2. **Click.** Routing rebuilds the dispatch path from them. The path has two component
   frames: `[["panel"]]` and `[provider cur at depth 1, keys ["items",1]]`.
3. **Resolve.** Frame 2 restarts from the end of frame 1 (`["panel"]`) and adds
   `["items", 1]`, so the update path is `["panel", "items", 1]`, which reaches `b`.
4. **Handle.** The handler runs on a draft of `b`, and `setIn` writes it back.
5. **Notify.** If `b` notifies, the target is the dispatch path's parent, `[["panel"]]`. So
   the notify goes to `Panel`, then to `Root`. The `sourceKey` each receiver sees comes
   from `b`'s dispatch path.
