# wax-mb usage feedback

Notes from writing tutuca-wax's vdom (src/*.wax) with wax-mb at commit
`bf4f437` (`Port upstream wax from 209f43a to 004d19e`), compiling with
`wax-mb file.wax -f wasm -o file.wasm`. Each entry says whether it's a bug, a
diagnostic that could help more, or friction for a newcomer; where the
behaviour may come from upstream Wax rather than this port, it says so.

## Bugs

### A statement `match` with two type arms and a default arm fails to type-check

A `match` used as a statement, whose arms don't `return`, is rejected when it
has two or more type arms besides `_`:

```wax
type base = open { kind: i32 };
type a : base = { .., v: i32 };
type b : base = { .., w: f64 };
let out: i32 = 0;
fn use_i(x: i32) { out = x; }
#[export]
fn f(v: &base) {
    match v { x: &a => { use_i(x.v); } y: &b => { use_i(1); } _ => { use_i(2); } }
}
```

```
Error: Expecting 1 returned value(s) from the stack, but there are 0.
  ──➤  m.wax:8:82
```

The same `match` with one type arm and `_` compiles, and so does a `match`
whose every arm ends in `return` (the form `stdlib/data/immutable_value.wax`
uses, followed by `unreachable;`). It looks like the lowering of a chain of
`br_on_cast` arms leaves the scrutinee's stack slot unaccounted for when the
arms fall through. I haven't checked it against upstream Wax.

Workaround used: every arm ends in `return`, or the code switches on the
enum's `kind` field instead.

### The formatter moves comments and blank lines into an import's attribute

Inside an `import` block, a comment (or a blank line) before an attributed
declaration is moved into the attribute, between `=` and the string:

```wax
import "x" {
    #[import = "a"]
    const s_a: &extern;
    // A comment.
    #[import = "b"]
    const s_b: &extern;
}
```

`wax-mb format` prints:

```wax
import "x" {
    #[import = "a"]
    const s_a: &extern;
    #[import =
        // A comment.
        "b"]
    const s_b: &extern;
}
```

That still compiles, so `format -i` looks harmless, but the comment has left
the code it was about, and anything that edits the file by its comments
afterwards (a person moving the comment back, a script inserting before it)
breaks the attribute: that's how I found it, with an `Expecting ... an
expression` error at the next declaration. Top-level `#[export]` functions with
a comment above them are formatted fine; it's the declarations inside an
`import { }` block. I format every file but that one.

### `'"'` doesn't lex

`text_push_unit(b, '"');` is `Error: Malformed string.`, with the span running
to the end of the next line: the `"` inside the character literal seems to
start a string. `'\\'`, `'\n'` and other character literals work. Writing JSON
needs both `"` and `\`; I used `0x22` and `0x5c` constants.

- A `match` with many type arms whose bindings go unused emitted a function
  engines reject: `view_eval_into` grew to sixteen arms (five of them only
  `x: &t => { host_fail(...); return; }`) and the unoptimized module failed
  validation with `uninitialized non-defaultable local: 3`. wasm-opt still
  took it, and the optimized module trapped with `unreachable` at run time,
  far from the cause. Checking the kinds before the `match` (dropping those
  five arms) fixed it. Validating the emitted module would have reported it
  at build time.

## Diagnostics that could help more

### js-string builtin imports with non-nullable parameters compile, then fail to instantiate

```wax
import "wasm:js-string" { #[import = "length"] fn js_string_length(s: &extern) -> i32; }
```

compiles, and then `WebAssembly.compile(bytes, { builtins: ["js-string"] })`
fails with `Imported builtin function "wasm:js-string" "length" has incorrect
signature`: the builtins take `externref`, i.e. `&?extern`. Since the module
name `wasm:js-string` is reserved, the checker could know the builtins'
signatures and report the mismatch at the import, or warn about an unknown
builtin name.

### `tag`, `data`, `open` and `on` can't be parameter, field or local names

`fn f(tag: &extern)` reports `Assuming that the parameter list is complete,
expecting ')'` pointing at `tag`; the same for `data` and `open`, and `on`
as a struct field (`Expecting '..', '}', or a structure type field.`) and
`data` as a local (`let data = ...`: `Expecting '(' or a binding name.`).
They're keywords (exception tags, data segments, open struct types,
`resume ... on [...]`), which the messages don't say. DOM code wants all of
these names (an element's tag, a text node's data, an opening comment, an
event handler's "on"). A message like "`tag` is a
keyword" would save the search; better still if they were contextual keywords,
only reserved at the start of a module field.

## Formatter

`wax-mb format` kept every comment, but not always where it was: see the bug
above about comments in import blocks. Besides that, two things I'd change:

- It removes parentheses that are redundant but clarifying:
  `i = (i + 1) & mask;` becomes `i = i + 1 & mask;`. That's the same
  expression, since `+` binds tighter than `&`, but mixing arithmetic and
  bitwise operators without parentheses is the kind of code people misread
  (rustfmt keeps them; clippy even asks for them, `precedence`).
- A trailing comment after the last statement of a match arm,
  `_ => { return 1; } // absent`, is moved after the arm's closing brace,
  where it reads as a comment on the whole match rather than on that arm.

### A function where a `rec` group's function type is expected

```wax
rec {
    type get_fn = fn(&eq, i32) -> (i32, &?eq);
    type vt = { get: &get_fn };
}
fn my_get(inst: &eq, k: i32) -> (i32, &?eq) { ... }
... {vt| get: my_get }
```

is `This expression has type 'fn(inst: &eq, k: i32) -> (i32, &?eq)' but is
expected to have type '&get_fn'.` The two read the same; the difference is
that a function type in a rec group is its own type, and the fix is to
declare the function with it, `fn my_get: get_fn (inst: &eq, k: i32) ...`,
which I found in the corpus, not the docs. The message could say so when the
signatures match: "declare `my_get` as `fn my_get: get_fn (...)`".

## Friction for a newcomer

None of these are bugs; they're things that cost a compile-fix cycle each
because they differ from the Rust-like syntax Wax otherwise reads as. A short
"differences from Rust" list in the README would cover them.

- There's no `&&` / `||`. Comparisons yield `i32` 0/1, so `(a >s 0) & (b >s 0)`
  works where both sides are cheap and safe to evaluate; short-circuiting needs
  nested `if`s or an `if` expression (`if c { x; } else { 0; }`), not
  `c ? x : 0`, which evaluates `x` either way (next item). The error is
  `Expecting an expression.` at the second `&`.
- `c ? a : b` evaluates both `a` and `b`: it compiles to wasm's `select`,
  whose operands are all evaluated before it picks one.
  `fn f(c: i32) -> i32 { c ? a() : b(); }` emits
  `(select (call $a) (call $b) (local.get $c))`. Coming from C, JS or Rust,
  where the branch not taken never runs, I wrote
  `let keys = is_list ? items : map_keys(items);` and it trapped with
  `illegal cast` inside `map_keys` whenever `items` was a list. A `?:` whose
  branch does a cast, a `!`, an array or field access on something that may
  be null, or a call that can trap or has effects is a bug waiting for the
  other case. The lazy form is an `if` expression,
  `let keys = if is_list { items; } else { map_keys(items); };`, which emits
  `(if (result ...) ... (then ...) (else ...))`. `select` is the right
  lowering for cheap pure operands, so the semantics may well be intended
  (I haven't checked against upstream Wax), but the docs could say so next to
  `?:`, or a warning could flag a `?:` operand that contains a call, a cast
  or a `!`.
- Integer ordering needs an explicit sign: `<s`, `>=s`, `<u`. Plain `<` on
  `i32` is `This operator cannot be applied to operands of types 'i32' and
  'number'`, which reads as a literal typing problem rather than "use `<s`".
- There's no `else if`: the `else` takes a block (`Expecting a block.`).
- Compound assignment works on locals only: `buf.len += 1` is a parse error
  (`Expecting '!', '(', '.', ';', '=', ...`); `buf.len = buf.len + 1` works.
- `br` to a `while` loop's label continues the loop, as wasm's `br` to a
  `loop` does; leaving it takes a labeled block around it
  (`'done: do { while c { br 'done; } }`). Coming from Rust's `break 'label`,
  my first try was an infinite loop.
- `loop { }` is wasm's `loop`: its body runs once and falls out at the end
  unless something branches back to it. Coming from Rust, where `loop` repeats
  until a `break`, I wrote a hash table probe as `loop { ... }` with `return`s
  inside, which compiled, passed every test that didn't collide, and fell
  through to the `unreachable` after it on the first collision; the same
  mistake made an event-routing walk stop after one step. `while 1 { }` is
  what I meant. A warning for a `loop` whose body never branches back to it
  (so it can't repeat) would have caught both; at least the docs could say
  it doesn't repeat by itself.
- Types have to be declared before they're used, outside a `rec` group
  (`The type 'ints' is not bound.`), unlike functions, which can come in any
  order.

## What worked well

- `#[import = "..."]` inside an `import "module" { }` block made binding the
  js-string builtins and imported string constants (module `"'"`) easy, and
  V8 (Node 24, Chromium) took them as builtins with no glue.
- `const` globals initialised with struct literals give one shared instance for
  enum cases without fields.
- Types and functions live in separate namespaces, so a constructor can share
  its case type's name (`attr_str` the type and `attr_str` the function).
- The vendored `stdlib/collections` (map and vector, via
  `tools/vendor-collections.sh`) concatenated into a 3000-line module and
  compiled unchanged the first time, and passing a function by name where a
  `&phm_hash` / `&phm_visit` is expected just works. Model-based tests from JS
  (1500 list and 4000 map operations, old versions checked) found nothing.
- `v as &extern` and `e as &any as &t` convert between GC references and
  externrefs both ways, and the object JS sees is the same one.
- The diagnostics' `file:line:col` made mapping errors from the assembled file
  back to the source files a ten-line regex in the build script.
