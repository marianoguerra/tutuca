// Ports of the math tests of test/demos/demos.test.js.

///|
/// The demo's state: examples/math/web starts with two problems saved.
fn demo_workbench() -> Workbench {
  {
    ..Workbench::new(),
    quadratic: { a: 1.0, b: -3.0, c: 2.0, },
    history: @tutuca.Vec::of([
      SavedQuadratic({ a: 1.0, b: 2.0, c: 5.0, }),
      SavedMatrix({ a: 2, b: 4, c: 1, d: 2, }),
    ]),
  }
}

///|
test "math demo: saves, reopens and removes problems" {
  let d = @testing.Driver::new(workbench, demo_workbench())
  d.click("button", text="Save problem")
  assert_eq(d.state().history.length(), 3)
  assert_eq(d.state().history.get(0).unwrap().label(), "x² − 3x + 2 = 0")
  // Already saved: no duplicate.
  d.click("button", text="Save problem")
  assert_eq(d.state().history.length(), 3)
  let opens = d
    .find_all("button")
    .filter(b => b.get_attribute("title") == Some("Open"))
  d.dispatch(opens[2], "click")
  assert_true(d.state().tab is MatrixTab)
  assert_eq((d.state().matrix.a, d.state().matrix.d), (2, 2))
  assert_eq(d.state().matrix.det(), 0)
  let remove = d
    .find_all("button")
    .iter()
    .find_first(b => b.get_attribute("aria-label") == Some("Remove problem"))
  d.dispatch(remove.unwrap(), "click")
  assert_eq(d.state().history.length(), 2)
  assert_eq(d.problems().map(@testing.describe), [])
  assert_eq(workbench.check().map(i => i.to_string()), [])
}
