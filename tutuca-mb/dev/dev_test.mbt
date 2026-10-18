///|
test "brief says a value in a few words" {
  assert_eq(@dev.brief(Json::string("hello")), "“hello”")
  assert_eq(
    @dev.brief(Json::array([Json::number(1), Json::number(2)])),
    "list of 2",
  )
  assert_eq(@dev.brief(Json::array([])), "empty list")
  assert_eq(@dev.brief(Json::object({ "a": Json::null() })), "1 entry")
  assert_eq(@dev.brief(Json::null()), "nothing")
}

///|
test "dev nodes open into their rows and close keeping them" {
  let value : Json = { "title": "T", "tags": ["a", "b"] }
  let d = @testing.Driver::new(
    @dev.dev_node,
    @dev.DevNode::of("state", @dev.Inspected::json(value)),
  )
  assert_eq(d.text(), "▸state2entries")
  d.click("button", text="▸")
  assert_eq(d.text(), "▾state2entriestitle“T”▸tagslistof2")
  d.click("button", text="▸")
  assert_eq(
    d.text(),
    "▾state2entriestitle“T”▾tagslistof20“a”1“b”",
  )
  d.click("button", text="▾")
  assert_eq(d.text(), "▸state2entries")
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "the dev panel shows the state, tasks, components and lint, readable or as code" {
  let spec = @dev.SpecInfo::of(@dev.dev_lint)
  let d = @testing.Driver::new(
    @dev.dev_panel,
    @dev.DevPanel::new().updated(
      state=@dev.Inspected::state(spec, { "issues": [] }),
      tasks=[("", @dev.Inspected::task_label("DevLint.Refresh"))],
      specs=[spec],
    ),
  )
  let text = d.text()
  assert_true(text.contains("State▸DevLintissuesemptylist"))
  assert_true(text.contains("Tasks▸message“Refresh”"))
  assert_true(
    text.contains("Components▸DevLintcomponent1field·1view·0messages"),
  )
  assert_true(text.contains("LintClean"))
  d.click("button", text="Code")
  assert_true(d.text().contains("‹DevLintissues=[0]›"))
  assert_true(d.text().contains("ComponentSpecDevLint"))
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "class collection reports constant classes, then computed ones from the DOM" {
  let reported = []
  let collector = @dev.ClassCollector::new(fresh => {
    reported.push(fresh.join(" "))
  })
  collector.add(@dev.dev_panel.class_names())
  let d = @testing.Driver::new(@dev.dev_panel, @dev.DevPanel::new())
  collector.scan(d.root_node)
  assert_true(reported[0].contains("join"))
  // The picked view's button class is computed: the DOM scan finds it.
  assert_true(reported.length() == 2 && reported[1].contains("btn-primary"))
}

///|
test "dev components have the generic properties" {
  @testing.check_component(@dev.dev_node, count=20)
  @testing.check_component(@dev.dev_section, count=20)
  @testing.check_component(@dev.dev_lint, count=20)
  @testing.check_component(@dev.dev_panel, count=20)
}
