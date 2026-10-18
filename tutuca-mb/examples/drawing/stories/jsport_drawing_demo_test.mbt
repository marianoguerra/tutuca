// Ports of the drawing tests of test/demos/demos.test.js.

///|
test "drawing demo: picks a tool" {
  // The demo's state: examples/drawing/web starts with the house.
  let d = @testing.Driver::new(@drawing.drawing, @stories.house())
  assert_eq(d.state().shapes.length(), 5)
  let rect = d
    .find_all("button")
    .iter()
    .find_first(b => b.get_attribute("title") == Some("Rectangle (R)"))
  d.dispatch(rect.unwrap(), "click")
  assert_true(d.state().tool is RectTool)
  assert_eq(d.problems().map(@testing.describe), [])
  assert_true(d.root_node.children().length() > 0)
  assert_eq(@drawing.drawing.check().map(i => i.to_string()), [])
}
