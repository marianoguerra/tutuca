///|
test "the drawing stories pass their sequences" {
  @storybook.check_books([@stories.drawing_book()])
}

///|
test "the house stress test passes, from the story and from generated drawings" {
  let reg = @storybook.Registry::new([@stories.drawing_book()])
  let doc = @memdom.document()
  reg.mount("Drawing/Drawing/House", doc, doc.element("main"))
  let a = reg.call("Drawing/Drawing/House", Stress(20, 15, 1, FromStory))
  assert_eq(a.stress.map(r => (r.status, r.error)), Some(("passed", "")))
  let b = reg.call("Drawing/Drawing/House", Stress(20, 15, 2, FromGenerated))
  assert_eq(b.stress.map(r => (r.status, r.error)), Some(("passed", "")))
}
