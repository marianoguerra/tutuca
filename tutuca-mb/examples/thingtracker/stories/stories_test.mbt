///|
test "the thing tracker stories pass their sequences" {
  @storybook.check_books([@stories.thing_tracker_book()])
}

///|
test "a runner stress tests the app from its story" {
  let reg = @storybook.Registry::new([@stories.thing_tracker_book()])
  let doc = @memdom.document()
  let root = doc.element("main")
  reg.mount("Thing tracker/App/Track", doc, root)
  let summary = reg.call("Thing tracker/App/Track", ToEnd)
  assert_true(summary.steps.iter().all(s => s.status == "ok"))
  let stressed = reg.call(
    "Thing tracker/App/Track",
    Stress(10, 10, 7, FromStory),
  )
  assert_eq(stressed.stress.map(r => r.status), Some("passed"))
  reg.mount("Thing tracker/App/Generated", doc, root)
  let generated = reg.call(
    "Thing tracker/App/Generated",
    Stress(10, 10, 7, FromGenerated),
  )
  assert_eq(generated.stress.map(r => r.status), Some("passed"))
}
