# The .wax implementation

Wax is a small, typed language that compiles to WebAssembly GC. The `.wax`
file only has functions (and string constants it needs); tcd generates the
rest and checks that every function it expects is there with its exact
signature.

## The naming convention

For a component `C`, with `c` its name in snake_case (`CheckItem` is `check_item`, `c_state` its state struct), implement:

| the .tcd declares | the .wax implements |
|---|---|
| `message m(a: A)` | `fn c_on_m(state: &c_state, ctx: &context, a: A') -> &c_state` (return `state` itself for no change) |
| `message m() -> swap` | `fn c_on_m(state: &c_state, ctx: &context) -> &c_swap_result`: `c_swap_to(component)` or `c_keep(state)` |
| `get g: T` | `fn c_get_g(state: &c_state) -> T'` |
| `ask a(...) -> T` | `fn c_reply_a_ok(state: &c_state, ctx: &context, reply: T') -> &c_state` (optional: without it the answer changes nothing); optional `c_reply_a_err(state, ctx, error: &value)` and `c_reply_a_not_found(state, ctx)` |
| `loop l { filter }` | `fn c_loop_l_filter(state: &c_state, key: &value, item: &value) -> i32` |
| `loop l { enrich { b: T } }` | `fn c_loop_l_enrich(state: &c_state, key: &value, item: &value) -> &c_loop_l_binds` |
| `loop l { key: T }` | `fn c_loop_l_key(state: &c_state, key: &value, item: &value) -> T'` |
| `loop l { prepare: T }` | `fn c_loop_l_prepare(state: &c_state, items: &value) -> T'`; the other hooks then take a last `prepared: T'` |
| `check(p)` | `fn c_check_p(state: &c_state) -> i32` |
| `init;` | `fn c_init(state: &c_state, ctx: &init_context) -> &c_state` |
| package `ask_handler a(x: X) -> T` | `fn <package>_answer_a(ctx: &context, x: X') -> &value`, returning `value_ok(...)` or `value_err(...)`; it only answers: it can read `ctx` (its scope) and log, not send |

`T'`, the Wax type of a TCD type: `i32` for `bool` (0 or 1), `s32` and enums;
`f64` for `f64`; `js_string` for `string`; `&value` for everything else (lists,
maps, records, options, components, `any`). Where the table says `T'` you may
write an alias of it instead (see Type aliases below): tcd compares signatures
up to aliases.

Generated for you to use (in the contract):
- `{c_state| f: v, g: w }` the state struct, one field per `.tcd` field, in
  the Wax type; `state.f` reads one.
- `c_with_f(state, v) -> &c_state` the state with one field changed.
- For a record a field `f` holds (`f: record {...}`, or a list, map or option
  of one), `c_f_new(members...) -> &value` makes one and `c_f_<member>(r)`
  reads a member, both in the members' Wax types (`tasks_items_new(text, 0,
  0)`, `tasks_items_text(item) -> js_string`); a record inside it has
  `c_f_<member>_<sub>` too. An ask's reply that is or holds a record gets
  `c_<ask>_reply_new` and `c_<ask>_reply_<member>`. Prefer them over
  `map_assoc` and `value_member`.
- `c_f_member` an i32 const per enum member (`stat_trend_up`), for an enum
  field `f`.
- `c_notify_n(ctx, args...)`, `c_ask_a(ctx, args...)` for its notifies and asks.
- `c_make_t(ctx, fields...) -> &component` for each `emits make t`: every
  field of `t`, in order, in Wax types; wrap the result with
  `value_component(...)` to put it in a list or field.
- `t_send_m(ctx, selector, args...)` for each `emits send t.m`; a selector is
  `selector_item(gs_items, path_key_index(i))` (the item at i of the field
  items) or `selector_field(gs_child)`.
- `c_swap_to(component)` and `c_keep(state)` for a swap message.
- A string constant for every name and string the `.tcd` uses. A name it
  declares is `gs_` and the name as written: `gs_done` is the field "done",
  `gs_set_text` the message, `gs_TodoItem` the type (types keep their case).
  Any other text (a view's, a literal argument's) is `gt_` and what it says:
  `gt_add` is "add", `gt_text` a text of only symbols ("+"), with `_2`, `_3`
  after one taken. `gs_empty` is "". A string the `.tcd` doesn't have is
  declared at the top of the `.wax`:

```wax
import "'" {
    #[import = "was "]
    const s_was: js_string;
}
```

## The language

```wax
// A function: typed parameters, a result type, a block whose last
// expression (followed by ;) is the result.
fn note_get_left(state: &note_state) -> i32 {
    280 - js_string_length(state.body);
}

fn checklist_get_left(state: &checklist_state) -> i32 {
    let n = 0;                      // let infers the type; locals can be reassigned
    let i = 0;
    while i <s list_count(state.items) {
        if !checklist_item_done(list_get(state.items, i)!) {
            n += 1;
        }
        i += 1;
    }
    n;
}
```

- Types: `i32`, `i64`, `f64`, `&T` a reference to a struct, `&?T` one that
  may be null, `js_string` a JS string and `js_string_opt` one that may be
  null. Literals: `1`, `-1`, `2.5`, `0.0` (an f64 needs the dot).
- `let x: T = e;` gives a local a type (`let` alone infers it).
- i32 comparisons are signed or unsigned: `<s`, `<=s`, `>s`, `>=s` (signed,
  what you want for counts and indexes), `==`, `!=`. f64 uses `<`, `<=`, `>`,
  `>=`. Arithmetic: `+ - *`, `/s` and `%s` for signed i32 division and
  remainder, `/` for f64. Booleans are i32: `!x`, `a & b`, `a | b` (both
  sides are evaluated).
- `if c { ... }` and `if c { ... } else { ... }`. There's no `else if`: chain
  ifs that `return`. `return x;` returns early. `while c { ... }` loops.
- `c ? a : b` evaluates both `a` and `b`: only use it with plain values, never
  with a cast, a `!` or a call that could fail. `if c { a; } else { b; }` as
  an expression evaluates one: `let x = if c { a(); } else { b(); };`.
- `x!` asserts a nullable `&?T` isn't null (traps if it is); `!!x` is "x is
  not null", `!x` "x is null". `x as &T` casts (traps if it isn't one).
- A struct literal names its type: `{note_state| title: t, body: b, pinned: 0 }`;
  `{T| a, b }` takes the locals named a and b. Every field is given.
- `let (ok, n) = parse_int(text);` destructures a tuple result.

## Type aliases

`type name = T;` names a value type: `name` is then written wherever `T`
would be, and compiles to `T`. Use aliases to say what a value means where
the bare type doesn't:

- Strings are `js_string` and `js_string_opt`, aliases of `&extern` and
  `&?extern` the runtime defines. Always write the alias, never `&extern`.
- Define your own, at the top of the `.wax` after the string constants, when
  an `i32`, `f64` or reference stands for something: an enum field's value
  (`type stat_trend = i32;`, which takes the `stat_trend_*` consts), a unit
  (`type cents = i32;`, `type ms = f64;`), an id or index into a list
  (`type check_item_index = i32;`). Then use it in your helpers' signatures
  and typed `let`s, and in the convention's functions where it fits.

```wax
// An enum field's value: one of the stat_trend_* consts.
type stat_trend = i32;

fn stat_arrow_of(trend: stat_trend) -> js_string {
    ...
}
```

- An alias names a value type, `&` included: `type stat_label = js_string;`,
  `type checklist_entry = &value;`, then `stat_label`, `checklist_entry`,
  never `&stat_label`.
- Prefix your aliases with the component's snake_case name (`stat_trend`,
  not `trend`) so they don't clash with the runtime's or the generated
  names, and don't redefine `js_string`.
- Aliases document, they don't check: a `stat_trend` is an `i32` to the
  compiler, and any `i32` can be passed for it.

## Values

Fields typed `list<...>`, `map<...>`, a component, `any`... hold a `&value`.
A value has a `kind`: `value_kind_null`, `value_kind_bool`,
`value_kind_int`, `value_kind_float`, `value_kind_string`, `value_kind_list`,
`value_kind_map`, `value_kind_result`, `value_kind_component`; cast to read
one: `(v as &value_int).value`, `(v as &value_float).value`,
`(v as &value_string).value`.

- Make: `value_null()`, `value_bool(i)`, `value_int(i)`, `value_float(f)`,
  `value_string(s)`, `value_component(c)`, `value_ok(v)`, `value_err(v)`.
- Lists (persistent: an update returns a new list): `list_empty()`,
  `list_count(l) -> i32`, `list_get(l, i) -> &?value` (null past the end),
  `list_push(l, v)`, `list_assoc(l, i, v)` (replace the item at i).
- Maps with string keys: `map_empty()`, `map_get(m, k) -> &?value`,
  `map_assoc(m, k, v)`, `map_keys(m)`, `map_values(m)`.
- Read: `value_truthy(v) -> i32`, `value_to_f64(v) -> f64` (an int or a float as
  a float; a value typed f64 in the `.tcd` is always a float, at any depth),
  `value_string_of(v) -> js_string_opt` (null when it isn't a string), `value_member(v, gs_name) -> &value` (a component's
  field or property, or a map's entry, by its runtime name).
- A child component's notify arrives as the parent's message of the same
  name; `ctx.source_key` is the child's key: `(key! as &path_key_index).index`
  for a list item.

## Strings and numbers

`js_string_length(s)`, `js_string_concat(a, b)`, `js_string_char_code_at(s,
i)`, `str_eq(a, b) -> i32`, `int_text(i) -> js_string`, `number_text(f) ->
js_string`, `parse_int(s) -> (i32, i32)` and `parse_number(s) -> (i32, f64)`
(ok first; ok is 0 when it isn't a number).

## The context

A handler's `ctx: &context` does what it asks for besides the next state:
`ctx_log(ctx, v)` logs a value, `ctx_now(ctx) -> f64` is the time in ms,
`ctx_random(ctx) -> f64` a number in [0, 1), `ctx_uuid(ctx) -> js_string`.
`ctx.source_key` (a `&?path_key`), `ctx.event` and `ctx.drag` (values) say
where the message came from. Prefer the generated `c_notify_*`, `c_ask_*`,
`c_make_*` and `*_send_*` helpers over the raw `ctx_*` functions.
