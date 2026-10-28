# Tutuca semantics

A PLT Redex model of tutuca. It has two sides, joined by a binding layer:

- **Tutuca**, which is declarative. It covers:
  - components: classes with typed fields, invariants and a protocol of messages, each handled by a TLA+-style action
  - views, which evaluate to a semantic tree
  - routing on that tree
  - the host's task queue
- **The virtual DOM** (`vdom.js`). It covers normalized vnodes, the DOM they render to, and reconciliation with node identity. It knows nothing about tutuca.
- **The binding** lowers the semantic tree to vnodes, writing metadata comments and `data-eid` attributes. It also decodes events back from the DOM. The comments are an implementation detail of this layer.

The optimizations in `src/optimize.js` and the fast paths in `vdom.js` are not part of the
model. The model defines the meaning those optimizations must preserve.

```sh
raco test spec/            # unit tests, properties, and scenarios ported from test/
raco test spec/vdom/       # any layer on its own, with the layers below it
racket spec/render.rkt     # typesets the rules into spec/semantics.pdf
```

In `semantics.pdf`, the tutuca side and the binding are the main chapters, and the virtual
DOM is Appendix A.

## Layers

Each directory requires only the ones above it in this table, plus `data.rkt`.

| Directory | File | Models | Runtime |
|---|---|---|---|
| | `data.rkt` | values (atoms, null, arrays, records, components), `String()`, truthiness, property get/set, `entries` | plain JS values, immer drafts |
| `vdom/` (Appendix A) | `vnode.rkt` | normalized vnodes; comments are plain text | `VText`, `VComment`, `VNode`, `VFragment`, `Shape` |
| | `dom.rkt` | `toDom`, namespaces | `vdom.js` |
| | `keys.rkt` | sibling matching | `morphChildren`, first half |
| | `morph.rkt` | reconciliation over labeled DOM nodes, among the ones render made | `morphNode`, `morphChildren`, `mountBefore`, `owned` |
| `component/` | `paths.rkt` | update paths, dispatch frames, selectors, routes: `getIn`/`setIn`, `resolve`, `toComponentPath`, `sourceKeyIn`, freezing | `UpdatePath`, `Frame`, `DispatchPath`, `Selector`, `Target` |
| | `expr.rkt` | the expression language user functions are written in | the functions passed to `component()` |
| | `types.rkt` | field types, `valid`, defaults, `make` | `t.*`, `AnyType` and its subclasses in `schema.js` |
| | `class.rkt` | classes: fields, invariants, handlers with contracts and actions | `fields`, `invariants`, `on`, `MessageSpec` |
| | `action.rkt` | `act` (one message on one instance), `message-issues`, `invalid-in` | `call`/`run` in `tasks.js`, `messageIssues`, `findInvalidFields` |
| `view/` | `sem.rkt` | the semantic tree | (what `renderView` means) |
| | `normalize.rkt` | `addChild`/`toVChilds`, keys | `view.js` |
| | `view.rkt` | view definitions, expressions, registration, `RenderContext`, `eval`, `renderView` | the `AstNode` subclasses, `ComponentSpec`, `RenderContext` |
| | `route.rkt` | routing on the semantic tree | (what `getEventInfoFor` means) |
| | `wf.rkt` | well-formed views | lint's `unknown-handler`, `send-arity`, `send-arg-type` |
| `bind/` | `meta.rkt` | metadata comment text | `wrapMeta`'s objects, `parseMeta` |
| | `lower.rkt` | semantic tree → vnodes | `wrapMeta`, `planElement`'s `data-eid`, loop fragments |
| | `decode.rkt` | `enclosingNodeMeta`, `getEventInfoFor` | `events.js` |
| `system/` | `host.rkt` | `handleTask`, the task kinds, `MessageContext`, `Host` scheduling, dev checks | `Task`, `NotifyTask`, `AskTask`, `EventTask`, `Host` |
| | `tutuca.rkt` | end-to-end scenarios, routing soundness, the binding theorem | |
| | `render.rkt` | `semantics.pdf` | |

## Two theorems join the parts

- **Virtual DOM:** `erase(morph(mount(old), old, new)) = render(new)`, and morphing a tree into
  itself keeps every node. This is all the binding relies on.
- **Binding:** for every element of a semantic tree, `event-info` on `render(lower(s))` gives
  the same handler and route as `site-info` on `s`. Combined with the vdom theorem, routing on
  the live DOM means what `route.rkt` says.

## Components

`component()` is split the way `ComponentSpec` keeps its options apart:
- `(class C (fields …) (invariants …) (on …))` is the model half.
- `(view-of C (views …) (loops …) (scopes …) (provides …))` is the view half.

The combined form `(component C section …)` is what scenarios write, and `split-component`
divides it.

Instances are values: there is no identity and no inheritance. The route is the only identity
an instance has.

**Types** mirror `t.*`:

| Model | Runtime |
|---|---|
| `Any`, `String`, `Number`, `Boolean` | `t.any()`, `t.string()`, `t.number()`, `t.boolean()` |
| `(Enum v …)`, `(Option τ)`, `(Array τ)`, `(Map τ)` | `t.enum`, `t.option`, `t.array`, `t.map` |
| `(Record (f τ) …)`, `(OneOf τ …)`, `(Index f)`, `(Component C …)` | `t.record`, `t.oneOf`, `t.index`, `t.component` |
| `(Refine τ check …)` | `.int()`, `.min()`, `.max()`, `.len()`, `.where()` |
| `(Default τ v)` | `.default(v)` |

An owner is the component holding the field. Inside arrays, maps and records there is none,
as in the runtime. A class without a `fields` section has no schema: its fields are not
checked. That lets scenarios leave out schemas, where the runtime would report every field as
undeclared.

**Handlers** are actions in the style of TLA+:

```racket
(inc (by)
     (args (Refine Number (min 0)))               ; MessageSpec.args
     (pre (< by 5))                               ; pre(prev, args)
     (post (= (get next n) (+ (get self n) by)))  ; post(prev, next, args)
     (emits (notify changed))                     ; emits
     (step (next (n) (+ (get self n) by))         ; next.n = self.n + by
           (notify changed)))                     ; ctx.notify("changed")
```

- A body is one `(step part …)`, or `(cases (guard body) …)`, where the first truthy guard's
  body runs. With no enabled case, the handler throws.
- `(next (lv …) e)` assigns into `next`. Every update reads `self`, never `next`, so updates
  are simultaneous. A field no update names keeps its value (UNCHANGED).
- `(become e)` replaces the instance, as returning a value from a handler does.
- Effects run in order and may read `next`: `notify`, `ask`, `send-at`, `forward-at`, `stop`
  (`stopNext`), `log` and `fail` (throw).
- Handlers are deterministic. All nondeterminism is in the host: when events arrive, the order
  replies settle in, and when renders happen.

**Contracts and checks** are dev mode, which the model always runs:
- After each committed task, the fields of what changed are checked against their types
  (`state-invalid`).
- The handler that ran is checked against its contract (`message-invalid`). These checks
  report violations and do not abort.
- Invariants are checked at start and when the queue is empty (`settle`): a task may break
  them for a task it queued to repair, so they are invariants of quiescent states.
- `pre` is the enabling condition, as in `pbt.js`.
- Property tests check that handlers refine their contracts from valid states that meet `pre`.

## Views

A context is `(rctx it binds dynBinds viewStack depth component)`:
- `enter-frame` increments the depth and captures the providers of a component.
- `for-item-view` keeps the depth and clears the binds.
- `best-view` tries the explicit name, then the view stack, then `"main"`.

Evaluation builds the semantic tree:

| Node | Meaning |
|---|---|
| `(el tid tag ns? key? (prop …) (on-attr …) (snode …))` | an element, with its handlers |
| `(component C (snode …))` | the render of an instance of `C` |
| `(enter dframe (snode …))` | rendered at a frame: a field, `seqItem` or `provided` |
| `(items (item key? dframe (snode …)) …)` | a loop: each item's key, frame and body |
| `(group key? (snode …))`, `(text s)`, `(comment s)` | as in the vdom |

These expressions map directly to the runtime:

| Model | Runtime |
|---|---|
| `(field f)` | `field` |
| `(seq-item s k)` | `seqItem` |
| `(provided n)` | `provided` |
| `(lookup-bind n)` | `lookupBind` |
| `(if c t e)` | `$if` |
| `(h tid tag (attr ...) child ...)` | `h` |
| `(x-render src view)` | `render` |
| `(each src body loop)` | `each` |
| `(render-each src loop)` | `renderEach` |
| `(render-it view)` | `renderIt` |
| `(scope name body)` | `scope` |
| `(push-view e body)` | `pushView` |
| `(send name arg ...)` | `send` |
| `(target-value)` | `targetValue` |
| `(source-key)` | `sourceKey` |
| `(drag-key)` | `dragKey` |

Three forms differ from the runtime:
- A plain value is a `Const`.
- `(frag e ...)` stands for a custom node that returns several roots, like the `Roots` node
  in the tests.
- An attribute is one of `(name e)`, `(key e)`, `(namespace uri)` or `(on event (send name arg ...))`.

Other points:
- **Element identity:** every `h` node carries a template id `tid`. It is the element's
  `Shape`, which `isSameKind` compares, and lowering uses it as the `data-eid` of an element
  with handlers. Ids are opaque, so only uniqueness per template matters.
- **Registration:** `register` follows `component()`. A class needs `"main"`, and `collect` is
  the `Collect` walker: an element's entry, then its attribute expressions, then its children.
- **Wrappers:** a wrapper holds its children normalized. The runtime keeps `wrapMeta`'s triple
  unnormalized until `addChild`. The two differ only for a render used as a prop value whose
  view evaluates to a component instance, which would throw in text position.
- **Routing on the tree:** an element's dispatch path is the frames of the wrappers above it,
  and a component wrapper makes the frame before it a component frame. Its candidate handlers
  are its own, then those of the elements above it up to the nearest component wrapper.
- **Drop events bubble:** `dragenter`, `dragover`, `dragleave` and `drop` reach the nearest
  enclosing component that handles them. When the nearest one doesn't, the elements of the next
  one above it are tried, routed at the frame of the child the event came through (not a
  component frame), so the route is that component's and the source key the child's.

## Paths

There are four kinds, one per job:

| Kind | Model | Runtime | Used for |
|---|---|---|---|
| update path | `upath`: property keys | `UpdatePath` | `getIn`/`setIn`, nothing else |
| dispatch path | `dpath`: frames | `DispatchPath` of `Frame`s | rendered ancestry: notify bubbling, `sourceKey` |
| selector | `sel`: builder calls | `Selector` (from `PathBuilder`) | `sendAt` targets; freezes at commit |
| route | `(dpath upath)` | `{ path, updatePath }` | where a task runs |

Paths sit in `component/` because a route is where a message is delivered, and selectors
freeze into frames.

- A frame `(frame base keys item cf)` reads its keys, then its item key if it has one. It
  reads them from the previous frame's value or, with a provider base `(prov name depth
  suffix)`, from the value captured at that depth followed by the suffix.
- A `seqItem` whose key field is null makes a frame with no item, which points at the whole
  sequence (`item ?? null`).
- `cf` means a component boundary follows the frame.
- `resolve` maps frames to keys left to right.
- A task's target is `(at base sel)`. At commit, the selector freezes against
  `get-in(resolve(base), root)` and its frames extend the base.

## Binding

Metadata comments are `{"t":"component"}` or one frame:
`{"t":"frame","p":null|{"v":name,"d":depth,"k":[…]},"k":[…],"i":item|null}`, closed by `§/§`.
`cf` is not written: decoding restores it from the component boundary that follows.

`lower` turns each wrapper into its metadata comment, its children and the closing comment. A
loop becomes an unkeyed group of keyed item groups, and an element with handlers gets
`data-eid`.

`event-info` decodes the way `getEventInfoFor` does:
- It collects eids from the target up to the first component boundary, or for a drop event,
  the eids of each enclosing component in turn, nearest first.
- It reads enclosing metadata by scanning previous siblings. Each closing comment hides one
  opening comment, and look-alike comments are skipped.
- The handler is the first one matching the event type, trying the eids innermost first, in
  the table of the class the update path reaches.

## The host

As TLA+: a configuration is the state, and `host->` is `Next`, with six actions:
- `event` decodes against the current DOM and root, and fixes the route. A `dragstart`
  first starts a drag: the closest `draggable="true"` element (the target or an ancestor)
  rendered in a component, remembered by its dispatch path. A `dragend` ends it after it's
  handled. An event task keeps the drag as of its event, and `(drag-key)` reads the key of the
  handling component's child the drag started in (`Drag.keyIn`), or null.
- `run` commits one transaction.
- `fail` aborts one transaction.
- `resolve` settles a pending async ask, in any order.
- `render` morphs the DOM when the root changed.
- `settle` checks invariants when the queue is empty and the root changed.

One transaction (`handle-task`) does the following:
1. Resolve the update path.
2. Run the task by kind, stepping the handler with `act`:
   - plain: a missing handler is a no-op.
   - notify: bubbles to the parent unless at the root or after `stop`.
   - ask: `ok` runs `<n>ReplyOk`, `error` runs `<n>ReplyError`, a missing handler runs
     `<n>HandlerNotFound`, and `async` adds a pending reply routed to the asker's path.
   - event: evaluates the action arguments in the message context and makes them the task's
     arguments, so `forward-at` forwards them. A missing handler fails; for well-formed views
     it never happens.
3. Set the new leaf.
4. Freeze each child task's selector against the new root.
5. Report invalid fields and contract issues.

Any exception aborts the whole transaction: the root and the queue stay as they were. That
includes a `<n>ReplyOk` that throws: it fails the ask, it does not run `<n>ReplyError`.
Effects evaluated before the throw survive, so their logs are observed.

## Exceptions

A metafunction undefined on its input stands for a thrown JS exception. Examples:
- `null[k]`
- rendering a non-component
- a `provided` render source with no provider
- duplicate sibling keys while morphing
- a selector that cannot freeze
- a field with no default (`NoDefaultError`)

## Optimizations erased

These do not change the meaning, so the model does not include them:
- `planElement`'s split of attributes into static and dynamic. All attributes are evaluated
  on every render. Props are kept sorted by name, because attribute order is not observable.
- `reuseConstant`'s shared vnodes, the prebuilt literal `texts`, and the shared `META_END`
  comment.
- The `source === target` and `isEqualTo` skips in `morphNode`, writing only the props that
  changed, the `innerHTML` re-parse skip, the `childNodes` snapshot taken before editing, the
  `nextSibling` check before `insertBefore`, the `used` bitmap and the `-1` marker in
  `oldKeyMap`. `morph-node` patches every prop.
- The 16 ms time slice and the `setTimeout` ticks. The rules are enabled
  nondeterministically.
- `_handlingTasks` and the staging of children until commit. Transactions are atomic, so
  reentrant draining cannot be observed.

Other code may add nodes to a rendered element (an extension, a third-party widget): render
didn't make them, so they're foreign (`(foreign lbl dom)` in `morph.rkt`). Morphing matches
vnodes to the nodes render made only, as the runtime's `owned` WeakSet does, and leaves the
foreign ones in place. The vdom theorem is about the nodes render made:
`erase-owned(morph(…)) = render(new)`, and the foreign nodes of the container are all still
there. Where one lands among the rendered nodes is not part of the meaning; the model keeps it
after the rendered node it followed.

Two of these are equivalent only when other code doesn't edit or remove the nodes render made:
- The identity skip leaves externally edited nodes alone. The model would overwrite them.
- Comparing the root by reference (`oldRootComponent !== this.rootComponent`) is modeled as
  structural inequality. The same holds for `findInvalidFields`'s `value === prev` skip.

## Out of scope

- `setProp` coercion: removing `null`/`false` attributes, property vs attribute writes,
  function-valued props, `dangerouslySetInnerHTML`, `is`, and applying `value`/`checked`
  after the children. The model also leaves out input state edited by the user.
- Loop `prepare`/`iter` (arbitrary iteration protocols).
- `methods` and getters: `field` reads only own fields. In the TLA+ reading they would be
  operator definitions.
- `.match()` (regular expressions), sync levels and pbt generators on types.
- Scope chains, aliases and lifetimes. A `Component` type checks class names, not scope
  lookups, and has no default (the runtime makes one through the scope). Ask handlers live
  in one table and are pure. Class names are unique.
- `null` and `undefined` are one value; an absent field is undefined.
- JS coercions of property keys and values.
- Malformed frame comments: the model skips any comment that is not a well-formed frame.
- `Host.notify` (reports are observations instead), `Host.stop`, `clearTasks`, listener
  registration.
- The host env: `ctx.now()`, `ctx.random()`, `ctx.uuid()`. Also `ctx.event`, `ctx.node` and
  `task.parent`.
- Of a drag, everything but where it started and `dragKey`: its `data-dragtype` and the value
  it had (`ctx.drag`), the `data-dragging` and `data-draggingover` marks, and
  `preventDefault`/`dropEffect` over a drop target.
- Sync engines (`src/sync/`).
- `src/tag.js`, `src/dev/`, `src/css/`, `src/embed/`, `src/playground/`, the storybook, the
  test driver and pbt, and the lint modules (beyond `wf.rkt`).

## What the tests check

- **Virtual DOM:** `erase(morph(mount(old), old, new)) = render(new)` on random tree pairs.
  Morphing a tree into itself keeps every label. Labels are unique and either kept or fresh.
  With foreign nodes put in anywhere, the nodes render made are `render(new)`, the container's
  foreign nodes stay, and morphing into itself keeps every node in place.
- **Normalize:** idempotent (`redex-check`).
- **Types:** `make` keeps valid arguments, otherwise yields the default, and always yields a
  valid value when every `.default(v)` has its type (`redex-check`). A record's default makes
  each key, and a union's its first alternative, as a field with no argument.
- **Actions:** handlers refine their contracts from valid states that meet `pre`, and a
  handler that breaks its contract is caught (`redex-check`).
- **Paths:** frame metadata round trips through JSON; provider jumps resolve from their
  capture depth; freezing a selector below a base equals resolving the base with the frozen
  keys appended.
- **Routing soundness:** on random component trees, every element with handlers routes to
  the instance that rendered it.
- **Binding theorem:** on the same trees, decoding agrees with routing on the semantic tree,
  for every element and event type, drop events included.
- **Well-formedness:** on random trees of well-formed components, every click runs without
  a missing-handler failure.
- **Render invariant:** after every simulated click and drain, the DOM is the render of the
  root.
- **Dev checks:** undeclared fields and broken invariants at start; invalid fields and
  contract issues after a task; invariants deferred until the queue is empty.
- **Ported scenarios:**
  - `test/core/view-semantics.test.js`: literals, truthiness, attributes, patching, meta
    comments, the main view
  - `test/paths/event-metadata.test.js`: field/seqItem/provided chains, keyed reorder with node
    identity, nested multi-root loops with unmanaged DOM, renderIt boundaries
  - `test/paths/source-key.test.js`: the exact sequence
  - `test/paths/task-paths.test.js`: commit-time freezing, event-time selection, producer failure,
    child preparation failure, async replies (ok and error), a throwing sync reply, selectors
    below provided frames
  - `test/paths/message-context.test.js`: `forwardAt` from an event handler
  - `test/vdom/vdom.test.js`: patching, shapes, namespaces, keyed groups
