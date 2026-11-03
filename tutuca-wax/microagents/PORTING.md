# Porting a micro-agent from apps/microagents to tutuca-wax

Background: `apps/microagents/` (repo root `/home/mariano/src/tutuca`) is a JS
tutuca app whose agents are ES modules (`agents/<id>/agent.js`) over TData.
`tutuca-wax/microagents/` is its port. There an agent is **one `.wasm` module
built by tcd** from `agent.tcd` + `agent.wax`, plus metadata packed into a
custom section. The data is **plain JSON**: no TData, no tq. Read
`tutuca-wax/microagents/README.md` first. Then read the two ported agents,
which are the reference:

- `microagents/agents/regex-lab/`: the template. It has record rows edited in
  place, expectations per row, a status grid laid out as one flat list, host
  functions, and a query with args. Its host functions are in
  `microagents/engines/regex.js` and its tests in
  `test/microagents/regex-lab.test.mjs`.
- `microagents/agents/jsonpointer-lab/`: a document edited as JSON text, and
  a clickable tree.
- `tcd/README.md`: the tcd language and the Wax naming convention.
- `test/microagents/helpers.mjs`: the test helpers (`agent`, `session` with
  `call`/`json`/`text`/`send`/`get`).

## What you own (touch nothing else)

- `microagents/agents/<id>/`: `agent.tcd`, `agent.wax`, `manifest.json`,
  `prompt.md`, `skills/`, `samples/*.json`.
- `microagents/engines/<module>.js`: a stub is already there; replace it.
- `test/microagents/<id>.test.mjs`.

Do **not** edit:

- the runtime (`src/`, `prelude/`, `js/`) or tcd;
- `microagents/{agent,tools,app,main,loop,llm,elements}.js` or
  `engines/index.js`;
- `scripts/`, the kit, or other agents.

If you're blocked by something missing in a shared file, work around it inside
your own files if you reasonably can. Otherwise stop and report exactly what
you need.

## Build and test (parallel-safe commands only)

```sh
cd /home/mariano/src/tutuca/tutuca-wax
node scripts/build.mjs agent <id>        # builds + packs dist/agents/<id>.wasm (NEVER run `just build`/`just test` or a full build)
TCD=tcd/_build/native/debug/build/tutuca/tcd/cmd/tcd/tcd.exe
$TCD check microagents/agents/<id>/agent.tcd --short   # tcd diagnostics
$TCD stub microagents/agents/<id>/agent.tcd            # every Wax function to write, typed
node --test --test-timeout=30000 test/microagents/<id>.test.mjs
node --test --test-timeout=30000 --test-name-pattern="<id>" test/microagents.test.mjs   # generic checks: contract, samples open, other JSON doesn't, tool schemas, data/domain/summary
```

The generated contract (record helpers `c_<field>_new`, readers
`c_<field>_<member>`, `c_with_<field>`, string constants `gs_*`) is written to
`dist/agents/<pkg>.contract.wax` when you build. Read it when unsure of a name.

## The agent contract

- The root implements `MicroAgent`: `use "../../kit/kit.tcd".{ MicroAgent };`
  and `component X: MicroAgent`. It needs `get summary: string` (with ids, so
  the model can name things), `get domain: any` (`get_state`'s answer) and
  `get data: any` (the JSON it exports: the same shape as the samples).
- **Matching.** The root's fields are the JSON document's keys. A document
  opens with the agent when the root makes from it with no issues, other than
  missing fields that have defaults. Make the defining fields required with a
  `where`, for example `where len(xs) >= 1`. The generic test checks that
  `{ something: "else" }` does NOT open.
- **Samples.** `samples/empty.json` is required ("New" opens it) and must
  open too, so it holds one blank row where needed. Convert each original
  `apps/microagents/agents/<id>/samples/*.tdata.json` to plain JSON shaped
  like your fields:
  - TData JSON writes arrays as `[[…]]`; plain JSON writes them `[…]`.
  - Expectations in the meta dialect `https://tutuca.dev/d/expect` become a
    field of the row (as regex-lab's `expect: map<string>`).
- **`manifest.json`**: `{ id, title, description, needs, icon, version, root,
  hostFns: ["<module>"], skills: [paths], tools: [...] }`.
  - `needs` describes the JSON shape in words.
  - A tool is `{ name, kind: "message" | "view", result? }`.
  - A message tool is a root message; a view tool is a root `query` (it takes
    args) or a `get`.
  - Parameter names and types come from the tcd signature. Descriptions come
    from the member's `///` doc, so write good `///` docs on tool members.
  - Keep the original tool names and meanings where they make sense.
  - The original `module` tool kind doesn't exist here: make such tools views
    (a query) or drop them, and say which in your report.
- Copy `prompt.md` and `skills/` from the original, fixing any mention of
  TData, "parts" or the meta dialect so they describe the JSON shape.

## Host functions (the engines)

Wasm modules can't import JS. The page defines functions an agent calls
synchronously, with `host_call(name, args_list)`; it returns a result value.
Read `microagents/engines/index.js` (the convention) and `engines/regex.js`
(an example).

- Your module: `export const bundle = "<engine>" | null;` and
  `export const make = (engine) => ({ fn_name: (...args) => jsonValue })`.
  `engine` is the imported bundle `dist/engines/<bundle>.js`: ajv, jq,
  jsonpath, picomatch, vega or echarts.
  - Read the original agent to see how it loads the bundle and what it
    exports: `apps/microagents/kit.js` ENGINES and the agent's `define`. For
    example, jq is `(await engine.loadJq())`; `make` may be async.
- **Prefix every function name with your module** (`jq_run`,
  `json_schema_validate`, …): all modules share one namespace.
- Arguments and results are JSON values (objects are maps). Throw to answer
  with an error result.
- In Wax: `let r = host_call(gs_or_s_name, list_push(list_push(list_empty(),
  value_string(a)), b)) as &value_result; if r.ok { r.value }`. See
  `rx_call` in regex-lab.
- Put the heavy JS logic there (parsing a cron line, strftime, compiling a
  chart, validating). Keep in Wax what the agent *is*: state, rows, ids,
  expectations, summary, headline, views and messages.
- Cache compiled things in JS by input text. Getters run often.

## tutuca-wax runtime functions Wax can call (beyond the obvious value_/list_/map_)

- **Lists of records (maps):**
  - `list_find(list, key, value) -> i32` (index by a string member, -1 when
    there's none);
  - `list_remove_at(list, i)`, `list_insert(list, i, item)`,
    `list_move(list, from, to)`;
  - `list_next_id(list, key, prefix) -> js_string` (r1, r2, …).
- **Strings:** `str_slice(s, a, b)`, `str_index_of(s, needle, from)`,
  `str_lower`, `str_upper`, `str_trim`, `str_replace_all(s, a, b)`,
  `str_split(s, sep) -> list value`, `str_join(list, sep)`,
  `js_string_concat`, `js_string_length`, `js_string_char_code_at`,
  `js_string_equals`, `str_eq`.
- **Numbers and JSON:** `int_text`, `number_text(f64)`, `parse_int(s) -> (ok,
  n)`, `parse_number(s) -> (ok, f64)`, `json_string(s)` (quotes a string),
  `value_json(v, indent) -> js_string` (stringify any value).
  - `host_call("json_parse", [text])` is always available (gives a value).
- **Values:** `value_member(v, key)`, `value_truthy`, `value_string_of(v) ->
  js_string_opt`, `value_to_f64`, `map_get`, `map_assoc`, `map_dissoc`,
  `map_keys`.
  - Value kinds: `v.kind == value_kind_list | _map | _string | _int | _float |
    _bool | _null`.
  - Ints are i32: JSON numbers above 2^31 or with a fraction become floats.

## Wax / tcd gotchas (each cost a build round trip before)

- **`c ? a : b` evaluates BOTH branches** (wasm select). Use the lazy form,
  `let x = if c { a; } else { b; };`, whenever a branch traps, casts or calls
  something.
- There's no `else if`: chain `if … { …; return …; }`.
- There's no struct update syntax (`{T| ..state, x}`): chain the generated
  `c_with_<field>(state, v)`.
- `on`, `tag`, `data`, `open` are keywords: don't name a Wax local that. A
  record member `on` becomes `on_` in helper parameters.
- Ints compare with `<s`, `>s`, `<=s`, `>=s` and divide with `/s`, `%s`.
  Floats use plain `<`. Boolean and/or on i32 are `&`, `|` and `!`.
- An unused call result is an error: write `let _ = f();`. Null checks are
  `!x` and `!!x`; unwrap with `x!`.
- Strings you use go in an `import "'" { #[import = "text"] const s_name:
  js_string; }` block at the top. The generated `gs_<name>` constants exist
  only for names the .tcd declares (fields, members, record members,
  messages, args, types).
- **Views.**
  - Write classes as constants, or `if(...)` of constants
    (`if(field(status) == "pass", "badge badge-success", "badge")`). A class
    computed from the state is a warning and gets no CSS.
  - A view compares a value only with a literal.
  - `len(...)` is not allowed in views: make a `get has_x: bool`.
  - **A send inside a NESTED `each` reads `field(...)` from the OUTER list's
    item, so it's wrong.** Keep clickable lists one level deep: flatten a
    grid into one list and send `source_key()` (regex-lab's
    `grid_cells`/`cycle_cell`), or use one `each` over a get. Display-only
    nested `each` is fine.
  - Inside a one-level `each` over a field or a get, `send(msg, field(id),
    target_value())` works.
- A `where` on a param: `x: s32 where x >= 0`, `s: string where s in ["a",
  "b"]` (it becomes a JSON Schema enum).
  - Guard ids with `when any(rows, it.id == id)`: the model gets the
    rejection text, and the call never runs.
  - Add `changes …` and `ensures …` where obvious; dev mode checks them.
- `any` fields hold any JSON value (`&value`), for JSON documents, schemas,
  options and table rows.
- Showing SVG: `el("ma-svg", svg: field(chart_svg))`. Showing a Vega-Lite
  chart: `el("ma-vega", spec: field(chart_spec))`, with the spec as JSON text
  and its data inlined. The page defines both (`microagents/elements.js`);
  tests never render them.

## Tests (test/microagents/<id>.test.mjs)

Model them on `regex-lab.test.mjs`. Cover:

- what the main sample computes (summary or headline);
- each main tool through `s.call`/`s.json`, including a bad id giving
  `isError` and changing nothing;
- the queries with args;
- the expectations;
- `s.host.issues` empty after edits.

Check that your host functions behave by calling them through the agent;
there's no need to unit-test the engines.

## Report back

When done, report:

- the files you made;
- the JSON shape of the data;
- the tools, and any you dropped or changed;
- test results (the exact pass/fail lines);
- anything you couldn't do;
- any shared-file change you needed but didn't make.
