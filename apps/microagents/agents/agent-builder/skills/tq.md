# tq in brief (tdata/docs/spec.md §6)

A query takes a message and yields outputs; it matches when an output is truthy (not false or
null). A step that doesn't apply yields nothing: `.missing` is no output, not null.

- `.k`, `."k 2"`, `.[0]`, `.[]` (every element), `..` (everything below)
- On a message: `.id .kind .data .messages .meta`; a dialect: `.meta["https://…"].header`
- `a | b`, `a, b`, `a // b` (b when a yields nothing truthy), `and`, `or`, `== != < <= > >=`
- `[q]` collects the outputs into an array; `length`, `keys`, `has(k)`, `type`, `select(q)`,
  `any(q)`, `all(q)`, `first(q)`, `starts_with(s)`, `contains(s)`
- Patterns: `q ~ P` keeps the outputs that match P and binds its names. `P` is `$name`, `_`, a
  literal, `{k: P}` (open), `[P, P, ..$rest]`, `#"type/id" P`, `$x @ P`, `(P | P)`.
- `q as $x | body` binds the outputs of q.

Pattern for agents: bind each part kind, then require what's needed:

    [.messages[] ~ {kind: "a"}] as $as | [.messages[] ~ {kind: "b"}] as $bs
    | ($as | length) > 0 and ($bs | length) == 1
