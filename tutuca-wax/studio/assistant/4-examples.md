# Examples

Complete modules that build, each a `.tcd` and its `.wax` (the files in
`examples/`, which the studio's tests build):

- note: fields with defaults and `where`, a computed property, messages with
  `when`, `changes` and `ensures`, input events and a key modifier, examples.
- checklist: a component holding a list of others, made by name (`emits make`),
  a child's `notify` handled by the parent through `source_key`, a loop
  `filter`, reading each child's property with `value_member`.
- stat: an enum field and its consts, an f64, a computed property, a struct
  literal, string constants of the `.wax`'s own, a type alias for the enum's value, and a `layout_edit` view.
- score: whole-number arithmetic on `s32` fields with the i32 operators
  (`>=s`, `/s`, `%s`, `&` and `|` for and and or), the runtime's `int_min`,
  `int_max`, `int_abs` and `int_clamp`, an f64 detour rounded up with `.ceil()`
  (`as f64_s`, `as i32_s`), enum arguments read as `i32` indexes with an alias
  and a const, getters that compose, and a `layout_edit` view.
- tasks: what a new component starts from. A list of records edited in place
  (made with the generated `tasks_items_new`, read with `tasks_items_text`,
  `_done` and `_priority`, replaced with `list_assoc`), messages taking an `index<items>` from `source_key()`, a loop
  with `filter` and `enrich` binds, an enum set from a select, an
  `invariant`, an ask answered by the package's own `ask_handler` with a
  record (read with `tasks_suggest_reply_idea`) whose reply asks again
  (`emits ask suggest`), a view comparing a field with a literal
  (`field(show) != "all"`), a button sending an item's field (`send(set_draft,
  field(text))`), type aliases, and a `layout_edit` view.
