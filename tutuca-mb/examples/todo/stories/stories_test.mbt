///|
test "the todo stories pass their sequences" {
  @storybook.check_books([@stories.todo_book()])
}

///|
test "a runner steps through a sequence and back" {
  let reg = @storybook.Registry::new([@stories.todo_book()])
  let doc = @memdom.document()
  let root = doc.element("main")
  reg.mount("Todo/Task/With subtasks", doc, root)
  let summary = reg.call("Todo/Task/With subtasks", ToEnd)
  assert_true(summary.steps.iter().all(s => s.status == "ok"))
  assert_eq(summary.timeline.length(), 11)
  let back = reg.call("Todo/Task/With subtasks", Goto(2))
  assert_eq(back.cursor, 2)
  // The preview shows the state of the entry: the subtasks before the reorder.
  assert_true(root.text_content().contains("Pack books"))
  let stressed = reg.call(
    "Todo/Task/With subtasks",
    Stress(10, 10, 7, FromStory),
  )
  assert_eq(stressed.stress.map(r => r.status), Some("passed"))
}

///|
test "the storybook UI asks the registry and shows the summary" {
  let books = [@stories.todo_book()]
  let reg = @storybook.Registry::new(books)
  let scope = @tutuca.Scope::new()
  reg.serve(scope)
  let d = @testing.Driver::new(
    @storybook.storybook,
    @storybook.Storybook::of(books),
    scope~,
  )
  d.click("button", text="Task/With subtasks")
  assert_eq(d.state().selected, "Todo/Task/With subtasks")
  // The shell mounts the story where the UI put its <tutuca-app>, then refreshes the UI.
  let preview = d.find("tutuca-app").unwrap()
  reg.set_on_change(_ => d.send(Refresh))
  reg.mount(d.state().selected, @memdom.document(), preview)
  assert_true(d.state().summary is Some(_))
  let to_end = d
    .find_all("button")
    .iter()
    .find_first(b => b.get_attribute("title") == Some("Run to end"))
    .unwrap()
  d.dispatch(to_end, "click")
  assert_eq(d.problems().map(@testing.describe), [])
  let summary = d.state().summary.unwrap()
  assert_true(summary.steps.iter().all(s => s.status == "ok"))
  assert_true(d.text().contains("collapsed"))
}
