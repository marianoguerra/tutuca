# Tutuca semantics

A PLT Redex model of the core (`src/view.js`, `paths.js`, `events.js`, `tasks.js`, `host.js`) and `vdom.js`. It covers:

- views: every expression form
- registration
- render contexts with providers and the view stack
- normalization
- keyed matching and reconciliation with DOM node identity
- paths
- metadata comments and event routing
- the host's task queue as a reduction relation

The optimizations in `src/optimize.js` and the fast paths in `vdom.js` are not part of the
model. The model defines the meaning those optimizations must preserve.

```sh
raco test spec/            # unit tests, properties, and scenarios ported from test/*.test.js
racket spec/render.rkt     # typesets the rules into spec/semantics.pdf
```

## Layers

| File | Models | Runtime |
|---|---|---|
| `data.rkt` | values (atoms, null, arrays, records, components), `String()`, truthiness, property get/set, `entries` | plain JS values, immer drafts |
| `core.rkt` | normalized vnodes, metadata leaves and their JSON text | `VText`, `VComment`, `VNode`, `VFragment`, `Shape` |
| `normalize.rkt` | `addChild`/`toVChilds`, keys | `view.js` |
| `dom.rkt` | `toDom`, namespaces | `vdom.js` |
| `keys.rkt` | sibling matching | `morphChildren`, first half |
| `morph.rkt` | reconciliation over labeled DOM nodes | `morphNode`, `morphChildren`, `mountBefore` |
| `paths.rkt` | update paths, dispatch frames, selectors, routes: `getIn`/`setIn`, `resolve`, `toComponentPath`, `sourceKeyIn`, frame metadata, freezing | `UpdatePath`, `Frame`, `DispatchPath`, `Selector`, `Target` |
| `host.rkt` | user code as terms: loop hooks, scope binds, provides, ask handlers, message handlers | the functions passed to `component()` and `registerAskHandlers` |
| `view.rkt` | expressions, `Collect`, registration, `RenderContext`, `eval`, `renderView` | the `AstNode` subclasses, `ComponentSpec`, `RenderContext` |
| `routing.rkt` | `enclosingNodeMeta`, `getEventInfoFor` | `events.js` |
| `tasks.rkt` | `handleTask`, the task kinds, `MessageContext`, `Host` scheduling | `Task`, `NotifyTask`, `AskTask`, `EventTask`, `Host` |
| `tutuca.rkt` | everything; end-to-end scenarios | |
| `render.rkt` | `semantics.pdf` | |

## Correspondence

**Expressions.** These map directly to the runtime:

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

Three forms differ from the runtime:
- A plain value is a `Const`.
- `(frag e ...)` stands for a custom node that returns several roots, like the `Roots` node
  in the tests.
- An attribute is one of `(name e)`, `(key e)`, `(namespace uri)` or `(on event (send name arg ...))`.

**Element identity.** Every `h` node carries a template id `tid`. The id plays two runtime
roles:
- It is the element's `Shape`: `isSameKind` compares shapes, so two templates with the same
  tag replace each other instead of patching.
- It is the element's `eid`: an element with handlers renders `data-eid = tid`. The runtime
  draws eids from a counter, only for elements with handlers. Ids are opaque, so only
  uniqueness per template matters.

**Registration.** `register-classes` follows `component()` and `ComponentSpec`:
- A class needs `"main"`.
- `collect` is the `Collect` walker: an element's entry comes first, then its attribute
  expressions in order, then its children. It does not walk action arguments.
- One table covers all views of a class, and a shared template keeps one entry.

**Rendering.** A context is `(rctx it binds dynBinds viewStack depth component)`:
- `enter-frame` increments the depth and captures the providers of a component.
- `for-item-view` keeps the depth and clears the binds.
- `best-view` tries the explicit name, then the view stack, then `"main"`.
- `eval-each` produces one keyed group per entry, with item metadata around the body.
- The loop hooks `key`, `filter`, `enrich` and `view` are host expressions.

**Paths.** There are four kinds, one per job:

| Kind | Model | Runtime | Used for |
|---|---|---|---|
| update path | `upath`: property keys | `UpdatePath` | `getIn`/`setIn`, nothing else |
| dispatch path | `dpath`: frames | `DispatchPath` of `Frame`s | rendered ancestry: metadata, notify bubbling, `sourceKey` |
| selector | `sel`: builder calls | `Selector` (from `PathBuilder`) | `sendAt` targets; freezes at commit |
| route | `(dpath upath)` | `{ path, updatePath }` | where a task runs |

- A frame `(frame base keys item cf)` reads its keys, then its item key if it has one. It
  reads them from the previous frame's value or, with a provider base `(prov name depth
  suffix)`, from the value captured at that depth followed by the suffix.
- `cf` means a component boundary follows the frame. It is not serialized; routing restores
  it from the component metadata.
- `resolve` maps frames to keys left to right, which replaces the old `resolveProviders`
  splice.
- A task's target is `(at base sel)`. At commit, the selector freezes against
  `get-in(resolve(base), root)` and its frames extend the base.
- Checked: this equals resolving the base with the frozen frames appended, because selector
  frames carry no provider jumps.

Metadata comments are `{"t":"component"}` or one frame:
`{"t":"frame","p":null|{"v":name,"d":depth,"k":[…]},"k":[…],"i":item|null}`.

**Routing.** `event-info` matches `getEventInfoFor`:
- It collects eids from the target up to the first component boundary.
- It reads enclosing metadata by scanning previous siblings. Each closing comment hides one
  opening comment, and look-alike comments are skipped.
- A component boundary makes the preceding frame a component frame.
- The handler is the first one matching the event type, trying the eids innermost first,
  in the table of the class the update path reaches.

**Tasks.** `host->` has five rules:
- `event` routes against the current DOM and root, and fixes the route.
- `run` commits one transaction.
- `fail` aborts one transaction.
- `resolve` settles a pending async ask, in any order.
- `render` morphs the DOM when the root changed.

One transaction (`handle-task`) does the following:
1. Resolve the update path.
2. Run the task by kind:
   - plain: a missing handler is a no-op.
   - notify: bubbles to the parent unless at the root or after `stopNext`.
   - ask: `ok` runs `<n>ReplyOk`, `error` runs `<n>ReplyError`, a missing handler runs
     `<n>HandlerNotFound`, and `async` adds a pending reply routed to the asker's path.
   - event: evaluates the action arguments in the message context. A missing handler fails.
3. Set the new leaf.
4. Freeze each child task's selector against the new root.

Any exception aborts the whole transaction: the root and the queue stay as they were.
Handler logs are side effects, so they survive an abort. `MessageContext.path` is
`toComponentPath(route.path)`, and `sourceKey` is `source.sourceKeyIn(path)`.

**Message handlers.** They are written in a small command language:

| Command | Meaning |
|---|---|
| `(set (lv ...) hx)` | assign into the draft |
| `(replace hx)` | return a replacement leaf |
| `notify`, `ask`, `send-at`, `forward-at`, `stop-next` | `ctx.*` |
| `(log hx)` | an observable side effect, for tests |
| `(fail hx)` | throw |
| `(when hx cmd ...)` | conditional |

Inside a handler, `draft` is the current draft, `self` is the instance before the task, and
`sourceKey` is `ctx.sourceKey`.

## Exceptions

A metafunction undefined on its input stands for a thrown JS exception. Examples:
- `null[k]`
- rendering a non-component
- a `provided` render source with no provider
- duplicate sibling keys while morphing
- a selector that cannot freeze

## Optimizations erased

These do not change the meaning, so the model does not include them:
- `planElement`'s split of attributes into static and dynamic. All attributes are evaluated
  on every render. Props are kept sorted by name, because attribute order is not observable.
- `reuseConstant`'s shared vnodes, the prebuilt literal `texts`, and the shared `META_END`
  comment.
- The `source === target` and `isEqualTo` skips in `morphNode`, writing only the props that
  changed, the `innerHTML` re-parse skip, the `domWidth` snapshot, the `used` bitmap and the
  `-1` marker in `oldKeyMap`. `morph-node` patches every prop. The property tests check that
  morphing a tree into itself keeps every node.
- The 16 ms time slice and the `setTimeout` ticks. The rules are enabled
  nondeterministically: events may arrive between any two steps, and a render may happen
  between any two tasks.
- `_handlingTasks` and the staging of children until commit. Transactions are atomic, so
  reentrant draining cannot be observed.

Two of these are equivalent only when nothing but the runtime mutates the managed DOM:
- The identity skip leaves externally edited nodes alone. The model would overwrite them.
- Comparing the root by reference (`oldRoot !== root`) is modeled as structural inequality.
  Re-rendering an equal root changes nothing.

## Out of scope

- `setProp` coercion: removing `null`/`false` attributes, property vs attribute writes,
  function-valued props, `dangerouslySetInnerHTML`, `is`, and applying `value`/`checked`
  after the children (including `select` reapplying its value). The model also leaves out
  input state edited by the user.
- Loop `prepare`/`iter` (arbitrary iteration protocols).
- Scope chains, aliases and lifetimes. Ask handlers live in one table.
- `null` and `undefined` are one value.
- Arrays, records and components are the only objects.
- Dev checks (schemas, invariants, message contracts), `Host.notify`, listener registration.
  Routing already ignores unknown event types.
- `src/dev/util.js`, `src/storybook/element.js`, the storybook, pbt and lint modules.

## What the tests check

- **Morph:** `erase(morph(mount(old), old, new)) = render(new)` on random tree pairs. Morphing
  a tree into itself keeps every label. Labels are unique and either kept or fresh.
- **Normalize:** idempotent (`redex-check`).
- **Paths:**
  - frame metadata round trips through JSON
  - provider jumps resolve from their capture depth
  - freezing a selector below a base equals resolving the base with the frozen keys
    appended
- **Routing soundness:** on random component trees, every element with handlers routes to
  the instance that rendered it. The trees render through fields, `seqItem`, nested
  `provided`, `each`/`renderIt`, keyed `renderEach`, named views and the view stack.
- **Render invariant:** after every simulated click and drain, the DOM is the render of the
  root.
- **Ported scenarios:**
  - `view-semantics.test.js`: literals, truthiness, attributes, patching, meta comments,
    the main view
  - `event-metadata.test.js`: field/seqItem/provided chains, keyed reorder with node
    identity, nested multi-root loops with unmanaged DOM, renderIt boundaries
  - `source-key.test.js`: the exact sequence
  - `task-paths.test.js`: commit-time freezing, event-time selection, producer failure,
    child preparation failure, async replies (ok and error), selectors below provided frames
  - `vdom.test.js`: patching, shapes, namespaces, keyed groups

  The scheduling-only task-path tests (reentrant draining, events during rendering) are
  covered by atomic transactions and nondeterministic scheduling.
