# tq reference (tdata spec §6)

tq asks a message a question. It is like jq, but open: a missing key, a value of another kind
or an unknown type makes a step produce **nothing**, never an error and never `null`. An output
is truthy unless it is `false` or `null`; a query matches when one output is truthy, and the
match is the first such solution.

## Paths

| Query | Output |
|---|---|
| `.` | the input |
| `.k`, `."k"`, `.["k"]` | key `k` of an Object. Of a Message: `id`, `kind`, `data` (a Value payload), `messages` (the child list), `meta` (dialect URI → headers). Of a Node: `tag`, `attrs`, `children`. Of a Typed: `value` |
| `[n]` | element n of an Array or a message list; negative counts from the end |
| `[]` | each element of an Array, Set or message list; each value of an Object |
| `..` | the input, then `..` of every part (recursive descent) |

## Expressions

- `a | b` runs b on each output of a, with its bindings. `a, b` gives a's outputs then b's.
- `a // b`: a's truthy outputs, or b's when there are none.
- `a and b`, `a or b`: Bools; `and` keeps the bindings of b's first truthy output.
- `==` `!=` are structural equality (`1 == 1.0` is false); `<` `<=` `>` `>=` order numbers,
  strings and instants; anything else compares false. Comparisons don't chain.
- `$name` is a bound value; `[q]` collects outputs into an Array; literals: strings, numbers,
  `true false null`, `ref("uri")`, `inst("ns")`.
- Functions: `select(q)`, `not`, `empty`, `type` (null bool int double string bytes instant ref
  array object set typed node message messages), `type_id`, `length`, `keys`, `has(k)`,
  `starts_with(s)`, `ends_with(s)`, `contains(s)`, `first(q)`, `any(q)`, `all(q)`.

## Patterns and bindings

`q ~ P` outputs each output of q that matches P, with P's bindings added. `q as P | body` runs
body on the input once per way q's outputs match P.

| Pattern | Matches |
|---|---|
| `$name` | anything, binding it; a name already bound only matches an equal value |
| `_` | anything, binding nothing |
| literal | an equal value |
| `{k: P, …}` | an Object or a Message with every listed key (others ignored) |
| `[P1, …, Pn]` | an Array or message list of exactly n elements |
| `[P1, …, ..]`, `[P1, …, ..$rest]` | at least n elements; the rest ignored or bound |
| `#"type_id" P` | a Typed with that type whose value matches P |
| `<Pt Pa Pc>` | a Node: tag, attributes, children |
| `$name @ P` | what P matches, binding the whole value too |
| `(P1 \| P2)` | any alternative, left to right |

## Examples

```
.kind == "order" and .data.total > 100
.messages[] ~ {kind: "note", data: {author: {name: $who}}} | select($who != "bot")
[.messages[] ~ {kind: "regex"}] as $regexes | ($regexes | length) > 0
.. ~ #"app/point" {x: $x, y: $y}
.meta."https://tutuca.dev/d/trace".at
.data ~ <"a" {href: $url} _>
```
