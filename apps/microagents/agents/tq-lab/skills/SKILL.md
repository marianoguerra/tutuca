---
name: tq-lab
description: Writing, testing and fixing tq queries (tdata's query language) against sample messages with match/no-match expectations.
---

# tq lab

A query runs on a sample message and gives solutions: an output and the bindings its patterns
made. The query **matches** when some output is truthy (anything but `false` and `null`).

Samples are tdata JSON messages: `{"id", "kind", "data" | "messages", "meta"?}`. In tdata JSON an
array is written `[[1,2]]`, a Typed value `["#","app/point",{…}]`, a Node
`["node","p",{attrs},[[children]]]`, a Set `["set",[[…]]]`, an Instant `["inst","<ns>"]`; `1` is
an Int and `1.0` a Double (and `1 == 1.0` is false in tq).

Workflow:
1. `grid` to see which cells fail.
2. `sample_shape(sample)` for the paths in a sample, `run(query, sample)` for the solutions.
3. `set_query` with the fix; its answer is the grid.
4. Add samples (`add_sample` with tdata JSON) and expectations (`set_expectation`) for the cases
   the user cares about.

Cheat sheet (full reference in `reference/tq.md`):

```
.k  ."k"  .[0]  .[]  ..            paths; a missing key yields nothing
a | b    a, b    a // b            pipe, both, fallback
and  or  not  == != < <= > >=      logic and comparisons
[q]   length  keys  type  has("k") collect and inspect
select(q)  first(q)  any(q)  all(q)
q ~ {kind: "note", data: {title: $t}}    open object pattern, binds $t
[$first, ..$rest]   [_, _]               array / message-list patterns
#"app/point" {x: $x}                     Typed pattern
<"p" {class: $c} [..]>                   Node pattern: tag, attrs, children
$m @ {kind: "note"}                      bind the whole value too
("a" | "b")                              alternatives
q as $x | body     q as {k: $v} | body   bind, then run body on the input
```
