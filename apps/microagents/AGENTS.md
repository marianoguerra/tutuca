# Writing a micro-agent

A micro-agent is a TData message of kind `microagent`. It holds a manifest with a tq query, a
system prompt, skills, tool descriptions, an ES module and samples. When a dropped TData
message matches the query, the agent opens it: its module's root component is the workspace,
and a model edits the data through the tools.

Built-in agents are folders in `apps/microagents/agents/<id>/`, packed into that
message by `packAgent` (core/pack.js). `regex-lab/` is the reference: read it first.

```
<id>/
  manifest.json        { id, title, description, needs, icon, version, query, skills: [paths], samples: [ids] }
  prompt.md            the system prompt (the app appends the skills index and the root's summary)
  skills/<path>        the read-only skills filesystem; SKILL.md first, with name/description frontmatter
  tools.json           [{ name, kind, description, params?, result? }]
  agent.js             export default function define(kit) { … }
  samples/<id>.tdata.json   tdata JSON messages; "empty" is required and opens with "New"
```

## The manifest

- `id`: kebab-case, unique, and the folder's name.
- `needs`: one sentence saying what data the agent opens. It is shown when a file doesn't match.
- `query`: a tq query (tdata/docs/spec.md §6). It matches when it yields a truthy output, and the
  bindings it makes are passed to `decode`. Bind the parts the agent works on:
  ```
  [.messages[] ~ {kind: "regex"}] as $regexes | [.messages[] ~ {kind: "text"}] as $texts
  | ($regexes | length) > 0 and ($texts | length) > 0
  ```
  In tq, a missing key yields nothing (not null), `~ {k: P}` matches objects openly, and
  `[q]` collects the outputs.
- The `empty` sample doesn't need to match the query; every other sample must.

## Data conventions

- The input is a message whose payload is `messages`, with one child per part. Each part has a
  `kind` the agent names (`regex`, `json-schema`, `table`, …), an `id`, and data.
- Expectations go in the meta dialect `https://tutuca.dev/d/expect`. Headers must be Scalars,
  e.g. `{"outcome": "pass"}` or `{"r1": "match"}`.
- tdata JSON: objects are plain JSON objects, but **an array is written `[[…]]`**. A bare
  `[1,2]` is a decode error, and `[[1,2]]` is the array `[1,2]`. `1` is an Int and `1.0` a
  Double. In JS, decoded Objects are `Map`s, Ints are `bigint`s and arrays are arrays.
  `kit.tdata.toJson(value)` / `fromJson(json)` convert to and from plain JSON. A string is
  usually the easiest way to carry a document such as CSS, a cron line or a filter.

## The module

`agent.js` has **no imports**. Everything comes in through `kit`:

- `kit.tutuca`: all of tutuca (`component`, `t`, `tag`, `button`, `field`, `send`, `each`,
  `renderEach`, `renderIt`, `render`, `$if`, `sourceKey`, `targetValue`, `lookupBind`, …).
- `kit.tdata`: tdata and tq (`message`, `messages`, `meta`, `encodeMessage`, `decodeMessage`,
  `getIn`, `setIn`, `toJson`, `fromJson`, `dataJson`, `headers`, `queries` (a tq `Query`:
  `.match(q, msg)`, `.run(q, msg)`, `.parse(q)`), `Typed`, `TdataError`, …).
- `kit.engines`: lazy loaders for heavy libraries, each `() => Promise<module>`:
  - `ajv`: `{ Ajv2020, addFormats }`
  - `jq`: jq-wasm `{ json(input, filter), raw(input, filter, flags) }`
  - `jsonpath`: `{ JSONPath }` (jsonpath-plus)
  - `picomatch`: `{ default }` (posix)
  - `vega`: `{ vega, compile, embed }`
  - `echarts`: echarts; `init(null, null, { ssr: true, renderer: "svg", width, height })` then
    `renderToSVGString()` works without a DOM, but always `dispose()` the chart or Node won't
    exit.

`define(kit)` may be `async`: await the engines there so getters can use them synchronously.

It returns `{ components, root, decode, encode, tools?, asks?, toolViews? }`:

- `components`: the agent's tutuca components, registered in a scope of their own.
- `root`: the name of the workspace's root component.
- `decode(C, bindings, msg) → root instance`: `bindings` is a plain object from the query's
  names to what they bound (messages, arrays of messages, values). The `empty` sample decodes
  with `{}`, so fall back to reading `msg.messages` by kind.
- `encode(root, original) → msg`: writes the root's state back into the original message.
  **Parts that didn't change must stay the same objects**, so they re-encode to the same bytes.
  Change only what changed, keep parts of other kinds where they are, and add new parts at the
  end. Tests check that `encode(decode(s), s)` gives back the same bytes for every sample.
- `tools`: module-tool functions, `async (domain, args) => ({ result, domain? })`.
- `asks`: ask handlers for this agent's scope, for async work started from handlers.
- `toolViews`: `{ tool name: component name }`. These are the components the chat shows a
  call of that tool with, instead of the generic one. One is made with `{ call, result, kind }`:
  `call` is pi's toolCall block (`{ id, name, arguments }`), `result` is its toolResult message
  (`{ content: [{ type: "text", text }], isError, details: { changed } }`, and null while the
  call runs), and `kind` is the tool's kind. Make it one line that opens: a `details` element
  with a `summary` holding `kit.ui.kindBadge(kind)`, the tool's name, what the call means in the
  agent's terms (e.g. `/pattern/flags`) and how it went. regex-lab's `SetRegexCall` is the
  example. Tools without one get `kit.ui.ToolCall`. Build yours from
  `fields: { ...kit.ui.toolCallFields }`, `queries: kit.ui.toolCallQueriesWith({ get glimpse()
  {…} })` (it gives `kindClass`, `toolName`, `resultText`, `resultJson`, `state` and
  `stateClass`), and `view: kit.ui.toolCallFrame("glimpse", …body)`.

## Shared helpers and components (use them, don't copy them)

`kit.lib` holds plain functions:
- `json`:
  - `parse(text, {emptyError})` → `{value, error}`. It is remembered: never mutate `value`,
    and use `parseFresh` (a copy) for a value you keep in state or change.
  - `pretty`, `clip`, `preview`, `isObject`, `typeOf`, `memo(fn, size)`, `sameAsPart(m, text)`.
  - `pointer.{parse, format, escape, resolve, set, remove}`: RFC 6901, immutable, with reasons
    in words.
  - `nodes(value, {rootKey, quoteKeys, max})`: tree rows. `indent(depth)` gives a row's style.
- `table`:
  - `parseCsv`, `formatCsv`, `columnsOf`, `describe`, `previewRows`, `CSV`, `KINDS`.
  - `readPart(m)` → `{id, kind, rows, delimiter}`, and `writePart(m | null, x)`.
- `parts`:
  - `kidsOf(msg, kind | kinds)`, `withKids`, `strOf(m, key)`,
    `headerOf(m, dialect, key, fallback)`, `withData(m | null, values, {dropEmpty})`,
    `withPart(msg, kind, id, update, create)` (one part, e.g. a spec),
    `withJsonPart(msg, {kind, id, text, newId})` (one part holding JSON text), `nextId(prefix, items)`.
  - `encodeParts(msg, { kind: { items, id?, same(m, x), update(m, x), create(x) } })` writes
    the lossless encode for you (`create` may return null to skip an item). With `{ keepOthers: true }`, parts of those kinds with no
    item stay (for agents that edit only some of them).
- `expect`:
  - `DIALECT`, `OUTCOMES`, `read(m, {accept})`, `get`, `same`, `withAll(meta, obj)`,
    `withHeader(meta, dialect, key, value)`, `metaFor(obj)`.
  - `cycle(expect, key)`, `status(expected, matched)`, `BADGE`, `headline(statuses)`.
- `grid.grid({rows, cols, cell, rowLabel, colLabel, corner, columns})` → `{cells, gridStyle,
  statuses, at(i)}`: a status grid laid out for one `each`.
- `time`: `parseIso` (UTC), `MONTHS`, `DAYS`, `pad`.

`kit.ui` holds components and view fragments:
- `components`: `{ JsonView, ToolCall, DataTable }`. List them among the agent's own
  (`components: { ...kit.ui.components, MyRoot }`) to use them with `t.component("JsonView")`.
- **Show any raw JSON (or similar data text) with a `JsonView`**, never in a bare `pre` or
  `textarea`. It has a tree view, a raw view and a copy button. Make one with
  `C.JsonView(kit.ui.jsonViewArgs(value, { label, mode }))`. For one the user edits, pass
  `{ editable: true, id, on: "set_x_text", rows }`: its raw view is a textarea, and every edit
  notifies `on` with `[id, text]`, so the root updates its own data (and the view's `text`).
- `DataTable`: `{ id, kind, rows, delimiter, edited }`, a table's rows, paged.
- **Tables page their rows.** Give a component with a table `...kit.ui.pagerFields` in its fields,
  `kit.ui.mix(kit.ui.pagerQueries("rowsGetter"), { … })` as its queries, and
  `...kit.ui.pagerHandlers` in its on. Then render `each(field("pagedRows"), …)` with
  `kit.ui.pagerView()` over it (on top, so it doesn't move when a page has fewer rows). The bar has first, previous, next and last buttons and "11–20 of
  120"; its ⚙ button chooses the rows per page. It shows once there are more rows than the
  smallest page size.
- JsonViews open as trees (editable ones too; Raw edits). Each view scrolls past a fixed height.
  Clicking a node folds or unfolds it; Ctrl/Cmd+click does the same to all its siblings.
- `toolCallView(C, call, result, kind)`, `kindBadge(kind)`, `jsonViewArgs`.
- Text that isn't JSON (generated CSS, a payload in another format) also goes in a
  `JsonView`: it shows raw text with the Copy button.
- Fragments for views: `labHeader(title, headlineGetter)`, `section(text, …)`,
  `addButton(label, handler, …args)`, `messageList(listGetter, cls)`, and
  `gridView(prefix, handler)`. gridView reads the getters `<prefix>Cells` and `<prefix>Style`
  and sends `handler(index)`.
- **Lists of items are a `List` component** (`kit.ui.List`, in `kit.ui.components`: list those
  among the agent's components, or `listOf` fails with "Component List is not registered"). Hold one in
  a field, `regexes: t.component("List")`, made with `kit.ui.listOf(C, "regexes", items, { addLabel
  })`. Its items are `this.regexes.items`. Render it with `render(field("regexes"))`. It shows
  each item's own view with:
  - a drag handle (drop on another row: above it on its upper half, below on its lower half);
  - a round red ✕ remove button;
  - an add button (with `addLabel`);
  - over the items, a pager (first/previous/next/last, "11–20 of 120", ⚙ rows per page), shown
    only when there are more items than fit in a page.

  The List changes nothing itself: it notifies its holder, whose handlers come from
  `...kit.ui.listHandlers("regexes", { make, removed, changed, id })`:
  - `move_regexes(from, to)`, `remove_regexes_at(i)`, `add_regexes()` (shows the new item's
    page) and `reorder_regexes(id, index)`. Expose that last one as a message tool so the model
    can reorder.
  - `make(self, ctx, next)` gives a new item (and may change `next`); `removed(self, next, item,
    ctx)` cleans up what referred to it; `changed(self, next)` runs after any change to the
    items or their order (no ctx: it keeps `reorder_<name>` pure).
  - Rows render only their own view: copy root state they show (selection, problems) onto the
    items, e.g. in `changed`.
  - In encode, give the kind's spec `ordered: true` (and read `root.regexes.items`).
- `defineAttrElement(name, attr, { draw(el, value), dispose(el) })`: a custom element drawn
  from one attribute, guarded for Node.

## The root component and tools

- What every agent's root has:
  - `summary`, a query (a getter in `queries`): a short text the system prompt includes ("3 regexes, 4 texts: 5 pass, 1
    fail…"), with ids, so the model can name things.
  - `toDomain()`, a method: plain JSON of the state, which `get_state` returns.
- **Message tools** (`kind: "message"`): the tool's name is the name of a handler on the root
  (snake_case, verbatim). `params` lists the argument names in order, and the types come from
  the handler's `args` (`t.string()`, `t.enum(…)`, `t.number()`, `t.any()` for JSON values,
  …). Use `pre: (self, args) => …` to reject bad ids or pointers, with `why: (self, args) =>
  "…"` saying why in words: the model reads it ("can't run with these arguments now: …"), and
  without one only that the precondition doesn't hold. A `t.any()` argument's schema names
  every JSON type (some providers' parsers pass objects as JSON text when there's no type), and
  a precondition that fails on an object sent as JSON text says so. `result` names a root query whose value is the tool's answer; it defaults to
  `summary`.
- **Make message handlers pure** when they can be: `{ pure: true, args, run(next, args) }`, no
  ctx. A pure tool is applied to the root at once (`host.apply`), and a broken `args`, `pre`,
  `post` or invariant undoes it and tells the model why. One that needs ctx (a new id from
  `ctx.uuid()`, `ctx.scope`, a notify or an ask) is sent and waited for, as before. Make
  components in a pure handler through `scopeOf(this).make(...)`.
- **View tools** (`kind: "view"`): a query of the root (in `queries`): a getter, or a function
  called with the args in `params` order. A method isn't one: check reports it. They change
  nothing, so give `params` as `[{ "name": "x", "type": "string" }]`, or type the query
  (`{ args: [t.string()], run(x) { … } }`) and the tool's parameters come from it.
- **Module tools** (`kind: "module"`): `def.tools[name](root.toDomain(), args)`. A returned
  `domain` goes back through the root's `replace_domain` handler.
- The shared tools `skills_list`, `skills_read`, `get_state` and `export_preview` are added
  for you.
- UI edits should go through the same handlers. Child rows `ctx.notify("set_x", [...])` with
  their id, and the root handles `set_x`, so a button and the model take one path.
- `List` changes through its pure messages: `add_item(item)`, `remove_item_at(i)`,
  `move_item(from, to)`, `show_last_page()`; `JsonView` through `set_text`/`set_label`,
  `DataTable` through `set_rows`. Dev mode reports a handler that writes a child's fields
  directly (`foreign-write:<Child>.<field>`), and tests fail on it.
- The root changes a row through the row's own pure messages, not its fields:
  `next.rows.items[i] = apply(next.rows.items[i], "set_pattern", pattern, flags)` (regex-lab).

## tutuca rules that bite

- A handler is `{ args: [types], pre?, run(next, args, ctx) }`. `next` is an immer draft:
  mutate it. `this` is the state before. Never pass `next` or parts of it to `ctx.ask`; pass
  values read from `this`.
- `send(name, ...args)` in a view: args may be constants, `targetValue()` or `sourceKey()`.
  Inside `each(...)`, use **`sourceKey()`** (the item's index or key) and look the item up in
  the handler. `field(...)` and `lookupBind(...)` are not allowed as send args.
- `each(field("x"), child)` iterates a field or query (plain values are fine). Inside it,
  `field("k")` reads the item's key k. The source must be a `field`, not a `lookupBind`.
  `renderEach(field("xs"))` renders component items; its second argument is a *loop* name,
  so a view other than main goes through `loops: { xs: { view: "name" } }`.
- Computed classes and texts are getters in `queries`, read with `field("name")`.
  `$if(field("flag"), a, b)` takes a boolean one. `methods` holds the component's own helper
  functions, not getters (lint: `getter-in-methods`). A query that takes args is read with
  `$query("name", ...args)`.
- There's no `ctx.send` to self. Do the work inline, through a helper function, or `apply` one
  of your own pure messages to `next`.
- An ask's answer handler gets its result as one argument: `ok(next, [value])`.
- Element builders: `const { div, p, span, … } = kit.tutuca.tag;`, plus `kit.tutuca.button`
  (type="button"). Classes are margaui (daisyUI-like) + Tailwind utilities.
- To show raw SVG or HTML, use a custom element. `customElements.define("ma-svg", …)` must be
  guarded with `globalThis.customElements` and `customElements.get(...)`, because tests run in
  jsdom and Node. Tutuca sets attributes; the element renders from them.

## Testing (test/microagents/<id>.test.js)

`test/microagents/helpers.js` has `loadAgent(id)`, `drive(registry, agent, sample)` (a Driver:
`d.send(ROOT, "set_x", [..])`, `d.state`, `d.problems`), `toolRunner(id, sample)`
(`await call("tool", {args})` → a ToolResultMessage) and `lintErrors(agent)`. Every agent
tests:
- that each sample but `empty` matches its query, and `empty` decodes;
- the byte-for-byte round-trip of `encode(decode(s), s)`, plus that an edit changes only its
  part;
- its main tools through `toolRunner`, including a bad id giving `isError`;
- `lintErrors(agent)` is `[]`, and `d.problems` is `[]` after edits.
