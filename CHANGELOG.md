# Changelog

## 1.0.0-beta.2

Messages are delivered by identity as well as by path, following the tree model in
`spec/tree`: a reply, a `sendAt` or a notification's next hop no longer reaches whatever
component took the path in the meantime. See [`docs/paths.md`](docs/paths.md).

### Breaking

- **Asks are answered in an `answers` section.** `answers: { load: { ok, error, unhandled } }`
  replaces the `xReplyOk` / `xReplyError` / `xHandlerNotFound` messages, and a send can't forge
  one. `ctx.ask` returns a request id, which the answer's handler reads as `ctx.request`.
  Stories answer asks with `step.answer`, tests with `driver.answer`. The lint checks the
  section and warns about an ask a message emits with no answers for it.
- **An ask handler only answers.** It's called with the ask's arguments and `ctx.readOnly()`,
  a frozen view of the asker's scope, path, source key and `now` / `random` / `uuid`, with
  nothing to send with. The ask starts once the task that asked commits, so a failed task
  never starts one, and its answer runs as a task of its own; an answer that throws fails only
  itself.
- **A task made outside a handler is addressed with `task.prepare(root)`.**
  `Host.prepareTask` is gone.
- **A message's context stages what its handler sends** in its own list, which the host
  queues once the task commits.

### Changes

- **Messages carry a sender and a receiver `Address`**, each a path and the identity it
  reached. Every component instance has an identity, fresh when it's made or when a handler
  returns a new one, and kept by updates. `ctx.reply(name, args)` sends to the sender of the
  message being handled; `HOST` is the sender of DOM events and ask answers. A task whose
  receiver was replaced is dropped and reported `stale`; one whose path reaches no component is
  reported `orphaned`.
- **Notifications bubble in one turn.** Their hops are the sender's ancestors when the
  bubble starts and run back to back, ahead of the queue. An ancestor without a handler passes
  one on silently; one that no hop handled is reported `unhandled` once, at the root.
- **A message with no handler is a no-op that's reported** (`Host.notify("unhandled", { task,
  message })`), whatever sent it, a DOM event included: components compose dynamically, so a
  view can send a message its component lacks.
- **The host reports instead of throwing**: a render that throws is `renderFailed`, an event
  the DOM can't route is `eventFailed`, and a stopped host drops late tasks.
- A handler's `emits` contract counts only what that handler emitted.
- `sourceKey` is `null` for a sender in another branch.
- Records and `oneOf` defaults meet the constraints of what they are made of: a record key
  whose default breaks its constraints throws `NoDefaultError` naming the key, and a `oneOf`
  makes its first alternative.

### Fixes

- Morphing matches vnodes only to the nodes render made, so nodes other code puts in a
  rendered element (an extension, a third-party widget, a foreign comment) stay in place.
- Routing and drags read `data-eid`, `data-dragtype` and the drag marks as attributes instead of
  through `dataset`, which MathML elements lack, so a click on a formula reaches its handler.
- The vdom prebuilds constant children and elements once per view, and decides by itself
  which attributes must stay dynamic.

## 1.0.0-beta.1

Tutuca 1.0 is a rewrite. It keeps the core ideas of 0.x, but the API, the view language and the
tooling change a lot, so 0.x apps don't run on it without being ported. The 0.x line ends at
0.15.0.

### What stays the same

- **One immutable state tree.** The app state is a tree of component instances, and every
  update replaces the root with a new value. Views are functions of that state.
- **Handlers mutate a draft.** A handler gets an immer draft and changes it in place.
  Returning a value replaces the component. immer is still vendored, so the core has no npm
  dependencies.
- **Typed fields and named views.** Components declare typed `fields`, a `main` view plus other
  named views, and `methods` that views and handlers can read.
- **Rendering through paths.** The DOM holds no references to instances. Events are routed
  through the dispatch path recorded at render time, and the update goes back in through the
  path to the value that owns it.
- **Messages up, down and across.** A component handles its own events, can send messages to
  components found by a selector, and can raise a message that bubbles up to its parents. A
  request with `Ok` / `Error` replies becomes `ask` with `ReplyOk` / `ReplyError`.
- **Values passed down without threading them through props.** 0.x's `provide` / `lookup` is
  now `provides` / `lookupBind`.
- **Iteration with filters and loop state** (`each` and loops, which were `@each`, `@when` and
  `@loop-with`), **pushed views** for nested components, and **drag and drop**.
- **The checks are part of the library**: a linter, tests that run without a browser, and a
  storybook built from the same component definitions.

### What changes

- **Views are built in JavaScript, not parsed from HTML.** `h(tag, attrs, ...children)`, the
  `tag` / `button` builders and AST helpers (`field`, `send`, `each`, `render`, `$if`,
  `pushView`, `scope`, ...) replace the `html\`...\`` templates, the `@`/`:` directives and the
  value grammar (`.x`, `$x`, `@x`, `^x`, `*x`). Macros are gone; use JavaScript functions that
  return view nodes.
- **Explicit schemas.** Field types come from `t.*` (`t.number()`, `t.string()`, `t.array()`,
  `t.option()`, `t.enum()`, `t.record()`, `t.oneOf()`, `t.map()`, `t.component()`, ...) rather than being inferred
  from default values. They feed validation, the lint, property-based tests and sync.
- **Handlers.** `receive` and `intent` merge into one `on` table. A handler is called as
  `handler(next, args, ctx)`, with `next` being the draft, and can declare a contract (`args`,
  `sourceKey`, `pre`, `post`, `emits`). Components can declare `invariants`. Contracts and
  invariants are checked in development and in tests.
- **The host.** `tutuca("#app")`, `registerComponents` and `app.state.set` are replaced by
  `new Host({ document, rootNode })`, `host.scope.register({...})` and `host.start(instance)`.
  Scopes nest, and they also hold the handlers that answer `ask`.
- **A controlled world.** Handlers read time and randomness through `ctx.now()`,
  `ctx.random()` and `ctx.uuid()`, so test runs and sync replays repeat.
- **Styling.** The scoped `style` / `commonStyle` / `globalStyle` CSS is gone. `tutuca/classes`
  lists the class names a view uses, for CSS tools that need them.
- **Packaging.** The package ships its ES module sources (`src/`) with one export per area
  (`tutuca`, `/vdom`, `/dev`, `/lint`, `/classes`, `/pbt`, `/storybook`, `/element`,
  `/playground`, `/history`, `/sync`, `/sync/remote`, `/automerge`). The CDN bundles are
  `dist/tutuca.js` and `dist/tutuca.min.js`. jsdom, prettier and chai are no longer
  dependencies. `fast-check` and `@automerge/automerge` are optional peers.
- **Removed:** the `tutuca` CLI (`get`, `list`, `show`, `lint`, `render`, `test`,
  `storybook`, `install-skill`, `agent-context`, ...), the bundled agent skill, the
  `tutuca/components` inspector components, the `getTests()` / `getExamples()` module
  conventions and the `.dev.js` auto-discovery. The linter, tests and storybook are now used
  as libraries.

### New

- **Property-based testing** (`tutuca/pbt`): arbitraries generated from field schemas and a
  headless `Driver` that runs message sequences and shrinks failures.
- **Sync** (`tutuca/sync`, `tutuca/sync/remote`, `tutuca/automerge`): a schema-guided diff,
  per-field sync levels and pluggable engines that persist state or share it across tabs and
  devices. State saved by another version of the components is adapted and reported. See
  [`docs/sync.md`](docs/sync.md).
- **History** (`tutuca/history`, `tutuca/history/bar`): step through states one user action
  at a time. Going back is applied as a change, so storage and peers follow.
- **Storybook stress tests**, with a log of each run and its shrink attempts.
- **`<tutuca-app>`** (`tutuca/element`) and **`<tutuca-playground>`**
  (`tutuca/playground`), which edits a book of stories in CodeMirror and runs it live, keeping
  state across edits.
- **DevTools formatters and an inspector panel** (`tutuca/dev`).
- **A formal model** of the semantics in PLT Redex (`spec/`), kept in sync with `src/`.
