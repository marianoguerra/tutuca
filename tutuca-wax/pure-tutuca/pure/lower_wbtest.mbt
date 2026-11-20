///|
/// What a module lowers to, without the helpers every module carries, and
/// the codes of what couldn't be lowered.
fn lowered(src : String) -> (String, Array[String]) {
  let checked = match check_source("t.tutuca.ts", src) {
    Ok(c) => c
    Err(ds) => return ("didn't check: \{ds.map(d => d.message).join("; ")}", [])
  }
  let (pkg, diags) = build("t.tutuca.ts", src, checked)
  diags.append(@check.validate(pkg))
  guard !@diag.has_errors(diags) else {
    return ("pure-tutuca: \{diags.map(d => d.message).join("; ")}", [])
  }
  let (text, ldiags) = lower("t.tutuca.ts", src, checked, pkg)
  let start = text.find("fn T_pl_done").unwrap_or(0)
  (text.exact_view(start~).to_owned(), ldiags.map(d => d.code))
}

///|
test "a handler writes next's fields as locals, and keeps the state when nothing changed" {
  let src =
    #|export type T = { n: number; name: string; readonly twice: number };
    #|export const T = {
    #|  defaults: { n: 0, name: "" },
    #|  constraints: { n: { int: true } },
    #|  queries: { get twice(): number { return this.n * 2; } },
    #|  on: {
    #|    bump: {
    #|      run(next, [by]: [number]) {
    #|        if (by === 0) return;
    #|        next.n += by;
    #|        next.name = `n is ${next.n}`;
    #|      },
    #|    },
    #|  },
    #|};
  let (text, codes) = lowered(src)
  debug_inspect(codes, content="[]")
  inspect(
    text,
    content=(
      #|fn T_pl_done(state: &T_state, dirty: i32, n: f64, name: js_string) -> &T_state {
      #|    if !dirty {
      #|        return state;
      #|    }
      #|    if ((n == state.n) | ((n != n) & (state.n != state.n))) & str_eq(name, state.name) {
      #|        return state;
      #|    }
      #|    {T_state| n, name };
      #|}
      #|
      #|fn T_on_bump(state: &T_state, ctx: &context, by: f64) -> &T_state {
      #|    let pl_next_n = state.n;
      #|    let pl_next_name = state.name;
      #|    let pl_dirty = 0;
      #|    if (by == 0.0) {
      #|        return T_pl_done(state, pl_dirty, pl_next_n, pl_next_name);
      #|    }
      #|    pl_next_n = (pl_next_n + by);
      #|    pl_dirty = 1;
      #|    pl_next_name = js_string_concat(pl_s0, number_text(pl_next_n));
      #|    pl_dirty = 1;
      #|    T_pl_done(state, pl_dirty, pl_next_n, pl_next_name);
      #|}
      #|
      #|fn T_get_twice(state: &T_state) -> f64 {
      #|    return (state.n * 2.0);
      #|    0.0;
      #|}
      #|
    ),
  )
}

///|
test "a callback is a loop, and what tutuca-wax can't compile yet says where" {
  let src =
    #|export type T = { xs: number[]; readonly big: boolean };
    #|export const T = {
    #|  defaults: { xs: [] },
    #|  queries: { get big(): boolean { return this.xs.some((x) => x > 10); } },
    #|  on: {
    #|    more: { run(next) { next.xs = this.xs.concat([1]); } },
    #|  },
    #|};
  let (text, codes) = lowered(src)
  assert_false(text.has_prefix("didn't"))
  debug_inspect(codes, content="[\"pure.lower.unsupported\"]")
  assert_true(text.contains("while (pl_i"))
  assert_true(text.contains("> 10.0"))
}

///|
test "sort is a merge sort with the comparator inlined, written back to a draft" {
  let src =
    #|export type T = { xs: number[] };
    #|export const T = {
    #|  defaults: { xs: [] },
    #|  on: {
    #|    order: { pure: true, run(next, []: []) { next.xs.sort((a, b) => a - b); } },
    #|  },
    #|};
  let (text, codes) = lowered(src)
  debug_inspect(codes, content="[]")
  // Stable: b goes first only when the comparator says it's above 0.
  assert_true(text.contains("> 0.0 { pl_take"))
  // The sorted list is the draft's field.
  assert_true(text.contains("pl_next_xs = pl_src"))
}

///|
test "a scope's and an enrich's records are their binds structs" {
  let src =
    #|import { each, field, lookupBind, p, withBinds } from "tutuca/view";
    #|export type T = { xs: string[] };
    #|export const T = {
    #|  defaults: { xs: [] },
    #|  binds: { top() { return { count: this.xs.length }; } },
    #|  loops: { xs: { enrich(key: number, item: string) { return { shout: `${item}!` }; } } },
    #|  view: p({}, withBinds("top", lookupBind("count")), each(field("xs"), lookupBind("shout"), "xs")),
    #|};
  let (text, codes) = lowered(src)
  debug_inspect(codes, content="[]")
  assert_true(text.contains("return {T_scope_top_binds| count: value_to_f64("))
  assert_true(text.contains("return {T_loop_xs_binds| shout: pl_string_of("))
}

///|
test "ctx.tryMake's result is the runtime's outcome, ok or err, ctx.componentNames the scope's" {
  let src =
    #|export type T = { names: string[]; why: string };
    #|export const T = {
    #|  defaults: { names: [], why: "" },
    #|  on: {
    #|    pick: {
    #|      run(next, [name]: [string], ctx) {
    #|        next.names = ctx.componentNames(true);
    #|        const r = ctx.tryMake(name);
    #|        if (r.err !== undefined) next.why = r.err.error;
    #|      },
    #|    },
    #|  },
    #|};
  let (text, codes) = lowered(src)
  assert_false(text.has_prefix("didn't"))
  debug_inspect(codes, content="[]")
  assert_true(text.contains("ctx_component_names(ctx, 1)"))
  // ctx_try_make gives { ok } or { err } already: nothing converts it.
  assert_true(text.contains("ctx_try_make(ctx, "))
  assert_false(text.contains("map_assoc(map_empty(), pl_s"))
}

///|
test "init finishes a component on next, its ctx making components with init_ctx_make" {
  let src =
    #|export type Item = { n: number };
    #|export const Item = { defaults: { n: 0 } };
    #|export type T = { items: Item[] };
    #|export const T = {
    #|  defaults: { items: [] },
    #|  init(next, ctx) {
    #|    if (this.items.length > 0) return;
    #|    next.items = [ctx.make("Item", { n: 1 })];
    #|  },
    #|};
  let (text, codes) = lowered(src)
  assert_false(text.has_prefix("didn't"))
  debug_inspect(codes, content="[]")
  assert_true(
    text.contains(
      "fn T_init(state: &T_state, ctx: &init_context) -> &T_state {",
    ),
  )
  assert_true(text.contains("init_ctx_make(ctx, "))
}

///|
test "typeof says what a value is; a literal constant is read as its value" {
  let src =
    #|import { get } from "tutuca/data";
    #|const NONE = -1;
    #|export type T = { found: number; raw: unknown };
    #|export const T = {
    #|  defaults: { found: 0, raw: null },
    #|  on: {
    #|    read: {
    #|      pure: true,
    #|      run(next, []: []) {
    #|        const id = get(this.raw, "id");
    #|        next.found = typeof id === "number" ? id : NONE;
    #|      },
    #|    },
    #|  },
    #|};
  let (text, codes) = lowered(src)
  assert_false(text.has_prefix("didn't"))
  debug_inspect(codes, content="[]")
  let lines = text
    .split("\n")
    .filter(l => l.contains("pl_typeof") || l.contains("1.0"))
    .map(l => l.trim().to_owned())
    .collect()
  debug_inspect(
    lines,
    content=(
      #|[
      #|  "if js_string_equals(pl_typeof(pl_id1), pl_s1) {",
      #|  "pl_c2 = (0.0 - 1.0);",
      #|]
    ),
  )
}

///|
test "a component whose name starts another's ends its handlers with its own pl_done" {
  let src =
    #|export type Tab = { n: number };
    #|export const Tab = { defaults: { n: 0 }, on: { inc: { pure: true, run(next, []: []) { next.n = this.n + 1; } } } };
    #|export type TabList = { m: number };
    #|export const TabList = { defaults: { m: 0 }, on: { inc: { pure: true, run(next, []: []) { next.m = this.m + 1; } } } };
  let (text, codes) = lowered(src)
  assert_false(text.has_prefix("pure-tutuca:"))
  debug_inspect(codes, content="[]")
  let calls = text
    .split("\n")
    .filter(l => l.trim().has_prefix("Tab"))
    .map(l => l.trim().to_owned())
    .collect()
  debug_inspect(
    calls,
    content=(
      #|[
      #|  "Tab_pl_done(state, pl_dirty, pl_next_n);",
      #|  "TabList_pl_done(state, pl_dirty, pl_next_m);",
      #|]
    ),
  )
}

///|
test "a send argument that reads the state is an error, as tutuca's lint says" {
  let src =
    #|import { button, field, send, sourceKey } from "tutuca/view";
    #|export type T = { n: number };
    #|export const T = {
    #|  defaults: { n: 0 },
    #|  on: { pick: { pure: true, run(next, [k]: [unknown]) {} } },
    #|  view: button({ "on:click": send("pick", field("n")), title: "ok" }, button({ "on:click": send("pick", sourceKey()) })),
    #|};
  let checked = match check_source("t.tutuca.ts", src) {
    Ok(c) => c
    Err(ds) => fail("didn't check: \{ds.map(d => d.message).join("; ")}")
  }
  debug_inspect(
    view_problems("t.tutuca.ts", src, checked).map(d => d.code),
    content="[\"pure-tutuca.state-in-send\"]",
  )
}
