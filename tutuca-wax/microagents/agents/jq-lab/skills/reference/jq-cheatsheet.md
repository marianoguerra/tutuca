# jq cheat sheet

| filter | does |
|---|---|
| `.`, `.a`, `.a.b`, `.["k-x"]` | identity, object fields (null when missing) |
| `.a?` | like `.a` but no error when the input isn't an object |
| `.[0]`, `.[-1]`, `.[2:4]` | array index, from the end, slice |
| `.[]` | every element (or object value): several outputs |
| `a \| b` | run b on each output of a |
| `a, b` | outputs of a, then of b |
| `[ … ]` | collect outputs into one array |
| `{a: .x, b}` | build an object (`{b}` is `{b: .b}`) |
| `select(cond)` | keep the input when cond is true |
| `map(f)`, `map_values(f)` | `[.[] \| f]`, apply to each value |
| `a // b` | a, or b when a is null/false/empty |
| `length`, `keys`, `has("k")`, `in(o)` | sizes and keys |
| `add`, `min`, `max`, `min_by(f)`, `max_by(f)`, `unique`, `unique_by(f)` | aggregates |
| `sort`, `sort_by(f)`, `group_by(f)`, `reverse` | ordering |
| `to_entries`, `from_entries`, `with_entries(f)` | objects ↔ `[{key, value}]` |
| `test("re"; "flags")`, `match`, `capture`, `sub`, `gsub` | regex (Oniguruma) |
| `split(",")`, `join(",")`, `ascii_downcase`, `ltrimstr`, `startswith` | strings |
| `tostring`, `tonumber`, `type` | conversions |
| `.x as $v \| …`, `reduce .[] as $x (0; . + $x)` | variables, folds |
| `if c then a elif d then b else e end` | conditionals |
| `try f catch "fallback"`, `error("msg")` | errors |
| `def f(x): …; f(1)` | functions |
| `paths`, `getpath(["a",0])`, `del(.a)`, `to_entries` | paths |
| `limit(n; f)`, `first(f)`, `range(n)`, `any`, `all` | generators |
| `@csv`, `@tsv`, `@base64`, `@uri`, `@json` | formats (on strings / arrays) |
