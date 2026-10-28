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
