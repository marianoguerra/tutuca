# Examples

Complete modules that build (the files in `examples/`, which the studio's tests build):

- note: fields with defaults and constraints, a computed query, messages with `pre`, `changes`
  and `post`, input events and a key modifier, examples.
- checklist: a component holding a list of others, made by name (`ctx.make`), a child's
  `notify` handled by the parent through `sourceKey`, a loop `filter`, reading each child's
  field.
- stat: a field with a few values (a union of strings), a number, a computed query, and a
  `layoutEdit` view.
- score: whole numbers (`int` constraints), `Math.floor`, `Math.ceil`, `Math.min` and
  `Math.max`, a loop over `range`, a union argument, a query with an argument that a view reads
  (`query("targetIs", 15)`), and a `layoutEdit` view.
- tasks: what a new component starts from. A list of records edited in place (`next.items[at] =
  {...}`), messages taking an item's `sourceKey()`, a loop with `filter` and `enrich` binds, a
  select setting a field from its value, an invariant, an ask answered by the module's own
  `askHandlers` with a record whose answer asks again, a query a view tests instead of comparing,
  and a `layoutEdit` view.
