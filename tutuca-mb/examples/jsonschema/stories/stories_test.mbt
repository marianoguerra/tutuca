///|
test "the JSON Schema stories pass their sequences" {
  @storybook.check_books([@stories.schema_book(), @stories.studio_book()])
}

///|
test "the episode stress test passes from the story and from generated trees" {
  let reg = @storybook.Registry::new([@stories.schema_book()])
  let doc = @memdom.document()
  reg.mount("JSON Schema/Episode", doc, doc.element("main"))
  let a = reg.call("JSON Schema/Episode", Stress(20, 12, 1, FromStory))
  assert_eq(a.stress.map(r => (r.status, r.error)), Some(("passed", "")))
  let b = reg.call("JSON Schema/Episode", Stress(20, 10, 2, FromGenerated))
  assert_eq(b.stress.map(r => (r.status, r.error)), Some(("passed", "")))
}
