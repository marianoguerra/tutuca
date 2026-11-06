# Changelog

## Unreleased

### Added

- **Settle scopes (structured concurrency).** `ctx.sendAt(name, args, selector, watch)` with
  a watch opens a settle scope (`src/tree/scope.js`). The message and everything it causes are
  in it: what it sends, the notifications it bubbles, its asks and their answers (later ones
  too), recursively. Once none of it is left, the sender gets `settled`, a name or
  `[name, args]`, with a report `{ id, outcome, tasks, failed }` after the args. The outcome is
  `ok`, `failed` (a handler threw), `cancelled` or `timeout`.
  - `progress` tells the sender how far it got, at most one queued at a time.
  - `timeout` (ms) cancels it.
  - `sendAt` returns the scope's id, and `ctx.cancel(id)` cancels it: its queued tasks are
    dropped, its asks' `signal` (in the ask handler's read context) is aborted and their
    answers ignored, and the scopes inside it are cancelled too.
  - A scope inside another counts as one open unit of it.
  - `ask(name, args, { detached: true })` and `sendAt(..., { detached: true })` leave the scope,
    for background work nothing should wait for.
- **The Agent waits for its tools.** A tool that needs a context is sent in a settle scope. Its
  call is answered once everything it caused ran, such as the asks it made or other agents it
  prompted, and the answer says how many of its steps failed. A ■ Stop button cancels what's
  running, stops the agents of a target that holds some (`stopAgents`), and closes the calls
  left without a result. `maxSteps` in agent meta raises the 12 steps. `layout: "side"` puts the
  chat in a narrow column beside a wide target. `lastAnswer` reads what the model said last.
  `status` isn't kept (`sync("none")`), so nothing is running after a reload.
- **An agent uses the model of the agent that prompts it.** `useModel(model)` tells an agent
  (or a target that holds agents, like the canvas) which model the agent driving it uses. The
  canvas's agent passes its model to the canvas on every step, and the canvas passes it to an
  item's agent when it enables or prompts it. `modelFrom` records where an agent's model came
  from: `default` (echo, then the first the server offers), `given` (by `useModel`) or `chosen`
  (picked in its select). A chosen model is kept.
- **The canvas says agent meta.** Its agent lists the kinds it can add (`list_kinds`;
  `componentKinds` now says each kind's `agent` and `samples`) and adds one (`add_component`,
  placed after the others unless given x and y). It moves, resizes, titles and removes items by
  key. It gives an item an agent of its own (`enable_agent`), prompts that agent and waits for
  it (`delegate`, which answers with what that agent said), reads an item's summary and tools,
  and ejects the agent (`eject_agent`). `withAssistant(C, canvas)` puts a canvas in an agent.
  In the canvas demo, `?agent` puts any bundle's canvas in an agent (`?bundle=music&agent`; the
  demo bar's 🤖 Agent link toggles it), and `?bundle=agent` comes in one, with the notebook's
  kinds and a board. Without `?agent`, the root is the canvas, as saved documents expect.
- **Agent meta.** Under `AGENT_META` (`https://tutuca.dev/meta/agent`), a component says how an
  LLM agent drives it:
  - `tools`, each one of its own messages or queries, with `params` naming its positional args
    and a `description`;
  - a `prompt` on its domain;
  - a `summary` query, which goes in every system prompt;
  - `skills`, read-only texts.

  What its whole content is as data is the data meta's (below), which gives the agent
  `get_state`, `set_state` and its samples.

  Register `agentMetaSchemas` in a scope to check its shape. `agentProblems(c)` checks what the
  shape can't express, such as a tool naming a message or query the component doesn't have, or
  `params` that don't match the args. Lint reports these as `agent-meta`.
- **Data meta.** Under `DATA_META` (`https://tutuca.dev/meta/data`, src/data.js), a component
  says what its whole content is as plain JSON:
  - `load`, a pure message of one arg that replaces the content (`"load"` by default);
  - `data`, a zero-arg query whose value `load` takes back;
  - `schema`, the JSON Schema of what `load` takes, for when its arg type can't say it (an any
    with a where check). Without it, `dataSchema(c)` derives the schema from the arg type
    (`typeSchema`, now in src/data.js);
  - `samples` to start from.

  Everything that sets a component from data reads it:
  - an agent's `get_state` and its new `set_state`, whose `value` parameter has that schema;
  - a dropped JSON file;
  - a canvas hole's samples.

  `loadData(c, json)` gives `{ next }` or `{ error }`, in the words `contractErrorText` uses
  for any `ContractError`. `dataProblems(c)` checks that `load` and `data` are a pure one-arg
  message and a zero-arg query, and lint reports these as `data-meta`. The law is that
  `load(data)` reads back as `data`. test/components/data.test.js checks it for every bundle's
  kinds.
  - Who says it: kanban's `Board`, `JsonRoot`, `SchemaRoot`, `JsonSchemaEditor`,
    `HttpRequest`, `HttpResponse`, `ApiOperation`, `HttpExchange` and `Transcript`.
    `ApiOperation` also loads the first operation of a whole OpenAPI document. The HTTP cards
    check what they load against a JSON Schema (`schemaChecked` in
    components/common/data.js), which lists the paths that don't fit.
  - components/common/drop.js: `jsonDrop(load)` is now `dataDrop({ after })`, which loads a
    dropped file through the component's data `load`.
  - On the canvas, an item whose content says its data gets a ⤓ button in its chrome that
    downloads it as JSON, named after its title. A JSON file dropped on its content loads into
    it, and the item shows why when it doesn't fit.
- **The agent's pure core,** for any host:
  - `toolsFor(c)` gives pi-ai tools whose JSON Schema comes from the args' types (`typeSchema`),
    plus the shared tools the meta calls for.
  - `systemPrompt(c)` and `nextAction(transcript)`.
  - `planToolCall(c, call)` runs a query or a pure message at once, and turns a `ContractError`
    into words the model reads. A message that needs a context is checked but not run: the host
    sends it.
  - `withSample(c, name)` and `sampleChoices(spec)` for the data meta's samples.
- **`Agent` (components/agent):** a generic agent for any component that says agent meta.
  - It drives the component through its tools, shown beside a `Transcript` (components/llm).
    In the transcript every message is a card. A tool call and its result are one card, its
    header saying how it went (… running, ✓ done, ✗ failed); collapsed by default, it opens to
    its arguments, a JSON tree, and its result. Consecutive calls are grouped in a collapsible
    `MessageGroup` that says each one's mark.
  - Its model is picked from what the tutuca-wax studio server's `/api/check` offers. That
    server's `/api/infer` now answers local origins (CORS). The echo model, which needs no key
    and runs the tool a prompt names (`/move_card {...}`), is always offered.
  - On its own, the agent starts with a hole that lists only components that say agent meta.
    A Hole takes a `meta` URI to filter by, and then offers their samples or empty.
- **Agents on the canvas.** Once a canvas starts, it asks whether the host has a model
  (`checkInference`, the `inferenceAvailable` ask). If it does, an item whose component says
  agent meta gets a 🤖 button that wraps the component in an agent, and a wrapped one gets ⏏ to
  eject it. Ejecting puts the component back as the agent left it, as wide as it was. The
  kanban `Board` says agent meta: add, move, rename and remove cards, add columns, and a week
  sample. The canvas demo has `?bundle=agent`, and the storybook has an Agent book and a
  Transcript section in the LLM book.
- **More components an agent can drive.** These canvas components now have agent meta, each
  with a summary that has ids and tools that take ids or names (`agentTool` builds one):
  - **TodoApp:** `add_task` (a quick-add line), plus completing, reopening, renaming,
    describing, dating, prioritizing, labelling, moving and removing a task by id, at any depth
    (TodoTask's `applyDeep` and `removeDeep`); `add_project`; `clear_completed`.
  - **Notes:** add, edit, tick off and remove notes by index.
  - **Drawing:** add a rect, ellipse, line or polyline, then move, style, layer and remove it
    by id; undo, redo and clear (now pure).
  - **HTTP:** a request's or response's headers by name and its body (`set_header`,
    `remove_header`, `set_body`, `set_status`); an operation's parameters, request body and
    responses by status; an exchange's request, response and operation, with its checks in the
    summary. Each has an `outline` query for the agent.
  - **JsonSchemaEditor:** `check_value` checks a value against the schema; it's rewritten with
    `set_state`.
  - **InferenceRequest:** the system prompt, messages, tool calls and results, tools by name,
    the output schema and options.
  - **Music:** the chord explorer, interval picker and circle of fifths take note names
    (`parseNoteName`: C, F♯, Bb, E♭4); the piano and guitar neck mark notes by name in the
    palette's colors.
  - **TrackerCell:** log a thing by id.
- **A demo as an app.** `node scripts/app.js <demo> [port]` (`just app canvas`) serves a demo
  without the demos' chrome, with the inference API beside it:
  - `/` redirects to `/demos/<demo>/app.html`, keeping `?sync=`, `?doc=` and `?bundle=`. That
    page is the demo's own `index.html` without its demo bar, its body marked
    `data-chrome="none"`, so `boot` adds no time travel bar or sync log. A
    `<meta name="tutuca-api">` points the canvas's agents at this server.
  - The API is tutuca-wax's, now its own module (`tutuca-wax/scripts/inference-api.mjs`,
    `GET /api/check` and `POST /api/infer`), which the studio server builds on. Keys come from
    `tutuca-wax/.env`.
  - `--no-inference` serves a demo without it, as does a missing tutuca-wax install.

## 1.0.0-beta.3

Components have a public interface (pure messages, queries and interfaces), the routing core
is a standalone package, and each core concept now has one name: a view node's class, its
walker kind and its builder match, paths are named after what they hold, and the host hands
drag, sync and dev checks to collaborators.

### Breaking

- **View nodes.** `XEach` → `Each`, `XRender` → `Render`, `XRenderEach` → `RenderEach`,
  `XRenderIt` → `RenderIt`, `XPushView` → `PushView`, `DomNode` → `Element`, `Const` →
  `Constant`, `LookupBindName` → `LookupBind`. `Send`'s kind is `send` (was `action`), so a
  walker overrides `send(node)`. `RenderEach` no longer extends `Each`. `XScope` keeps its name
  for now. `TargetValue`, `SourceKey` and `DragKey` are one `EventArg` node, whose `name` is
  `"targetValue"`, `"sourceKey"` or `"dragKey"`; its kind is `eventArg`, so a walker overrides
  `eventArg(node)` and switches on `node.name`. The `targetValue()`, `sourceKey()` and
  `dragKey()` builders are unchanged.
- **Walkers.** `Walker` only defines `node`, `element`, `attr`, `child` and `handler`. A kind a
  walker doesn't override is visited as a plain node (`renderIt` falls back to `render`,
  `renderEach` to `each`), so `super.field(node)` and the like become `super.node(node)`.
- **Paths.** `UpdatePath` → `KeyPath`. `DispatchPath.resolve()` → `toKeyPath()`,
  `toUpdatePath()` → `toComponentKeyPath()`, `Address.updatePath` → `Address.keyPath`,
  `Drag.keyIn` → `Drag.sourceKeyIn`. `PathBuilder` is gone: a selector function gets a
  `Selector`, which has `field`, `item` and `seqItem`.
- **Types.** `Type` is the base of every field type, and `AnyType` is the one `t.any()` makes,
  so `instanceof AnyType` becomes `instanceof Type`. `UnionType` → `OneOfType`.
- **Handlers.** `MessageSpec` → `HandlerSpec`. `ctx.handled` → `ctx.ran`.
- **Host.** `host.rootComponent` → `host.root`. Drag state lives in `host.drags` (a
  `DragTracker`; `host.drag` still reads the current drag), sync engines in `host.engines` (a
  `SyncEngines`), and dev mode's checks in `host.checks` (a `DevChecks`, null outside dev).
  `startDrag`, `dragOver`, `markDragOver`, `endDrag`, `prepareEngines`, `checkState`,
  `checkSettled`, `reportInvalid` and `checkMessage` are gone from `Host`.
- **Dev mode.** `new Host({ dev: true })` → `new Host({ checks: DevChecks })`, with `DevChecks`
  from `tutuca/dev` (now `src/tutuca.dev.js`), so the core and `dist/tutuca.js` no longer
  carry the checks. On a CDN, `dist/tutuca.dev.js` is the whole core plus dev mode in one file:
  import everything from it instead of `dist/tutuca.js`. `host.dev` is gone. `tutuca/dev` still exports
  the DevTools formatters. `mountTutucaApp` and `startStorybook` keep their `dev` flag.
- **Tasks.** A task's fourth argument is where it goes: a `Target`, fixed by `prepare`, or an
  `Address`. `AnswerTask(ask, outcome, args, request, to, parent)` always comes from the host,
  and `AskTask` takes its request id.
- **Host input.** `EventTask` → `HostTask`, built by `host.send(name, args, { to, now, event,
  node, drag })`, the one way into the tree: a DOM event is routed, its send's args are worked
  out when it arrives (an arg that throws is reported as `eventFailed`, not `taskFailed`), and
  it is sent with `now: true`: ahead of the queue, run before `send` returns. `Task.event` is only on `HostTask`. Build a
  `Task` and call `pushTask` only for a sender other than the host.
- **Names.** A field, a method and a query can't share a name: defining a component where one
  does throws.
- **Environments.** `testEnv` is exported from `tutuca/pbt` instead of `tutuca`; `browserEnv`
  still comes from `tutuca`.
- **pbt.** `EventCommand` and `DragCommand` are no longer exported.

### Added

- **Headless hosts.** `new Host()` needs no `document` or `rootNode`: it renders nothing and
  listens to no events. A component with no views at all renders nothing.
  `host.whenIdle()` resolves once no task is queued and no ask is waiting for its answer
  (`scheduler.pending`, `scheduler.isIdle`).
- **Pure messages.** A handler marked `pure: true` takes no `ctx`: it's sent like any message
  and can also be applied synchronously with `apply(c, name, ...args)`, joining the caller's
  transaction on a draft or returning a new instance. A handler may give `why(self, args)` to
  say why its precondition fails.
- **Queries.** `queries` (getters and functions, installed on the prototype) are
  side-effect-free reads: `query(c, name, ...args)` runs one on a frozen view, and views read
  zero-arg ones with `field()` and others with `$query`. `t.x().public()` publishes a field
  as a query.
- **Interfaces.** `iface(name, operations)` declares pure messages, messages, queries and
  notifies; scopes register them with `registerInterfaces`, and `implements: ["Counter"]` is
  resolved where the component is registered and checked structurally. `t.component` accepts
  interface names and instances. Failures throw `ContractError { code, issues, detail }`;
  `contractOf`, `supports`, `canApply`, `canQuery` and `implementsIface` inspect a component,
  and `host.apply` / `host.query` reach one by selector.
- **Foreign writes.** In dev mode, a handler that writes another component's fields instead of
  applying its pure messages is reported as `messageInvalid` `foreign-write:<Owner>.<field>`.
- **Lint.** New rules: `pure-uses-ctx`, `pure-emits`, `query-mutates-this`, `unknown-query`,
  `query-arity`, `query-arg-type` and `getter-in-methods`.
- **`tutuca/tree`.** The routing core (identities, paths, addresses, the message envelope,
  `MessageContext` and a `Scheduler`) is a standalone package that imports only its siblings.
- **Storybook.** `openStorybook({ document, rootNode, uiStyle, fc, books, compile })` compiles
  the storybook's and the stories' classes and starts it; `ClassCompiler.attach` keeps
  compiling the classes views compute as they render.

### Changes

- A message nobody handled is warned about in one line (its name, the component's and the
  path) instead of with the whole context.
- A task's back references (`parent`, `event`, `node`, `drag`) are non-enumerable, so a failing
  assertion doesn't print the whole DOM.

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
