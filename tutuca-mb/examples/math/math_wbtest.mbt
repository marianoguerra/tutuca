///|
test "numbers read as MathML shows them" {
  assert_eq([1.23456, -2.0, -0.0, 1.0e-9].map(fmt), ["1.235", "−2", "0", "0"])
}

///|
test "formulas render as MathML, the plot as SVG" {
  let d = @testing.Driver::new(quadratic, { a: 2.0, b: -4.0, c: -6.0, })
  let math = d.find("math").unwrap()
  assert_eq(math.namespace_uri(), Some(@vdom.math_ns))
  assert_eq(d.find("mfrac").unwrap().namespace_uri(), Some(@vdom.math_ns))
  assert_true(d.text().contains("x1=−1,x2=3"))
  assert_eq(d.find("svg").unwrap().namespace_uri(), Some(@vdom.svg_ns))
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "sliding b and c moves through double and complex roots" {
  let d = @testing.Driver::new(quadratic, { a: 1.0, b: -3.0, c: 2.0, })
  let slider = (name : String) => {
    d
    .find_all("input")
    .iter()
    .find_first(n => {
      n.get_attribute("aria-label") == Some("Coefficient \{name}")
    })
    .unwrap()
  }
  d.dispatch(slider("b"), "input", value="-2")
  d.dispatch(slider("c"), "input", value="1")
  assert_true(d.state().kind() is Double && d.state().x1() == "1")
  d.dispatch(slider("c"), "input", value="5")
  assert_true(d.state().kind() is Complex)
  assert_eq((d.state().real_part(), d.state().imaginary_part()), ("1", "2"))
  // a can't be zero.
  d.dispatch(slider("a"), "input", value="0")
  assert_eq(d.state().a, 1.0)
}

///|
test "the matrix inverts until its determinant is 0" {
  let d = @testing.Driver::new(matrix2, Default::default())
  assert_eq(d.state().det(), 5)
  assert_true(d.text().contains("A−1="))
  d.dispatch(d.find_all("input")[3], "input", value="1")
  d.dispatch(d.find_all("input")[0], "input", value="1")
  assert_eq(d.state().det(), 0)
  assert_true(d.text().contains("hasnoinverse"))
}

///|
test "the workbench saves, opens and removes problems" {
  let d = @testing.Driver::new(workbench, Workbench::new())
  d.send_to(quadratic, quadratic_lens, Preset("complex roots"))
  d.click("button", text="Save problem")
  assert_eq(d.state().history.map(p => p.label()).to_array(), [
    "x² + 2x + 5 = 0",
  ])
  // Saving the same problem twice is disabled.
  d.click("button", text="Save problem")
  assert_eq(d.state().history.length(), 1)
  d.click("button", text="Matrix")
  d.click("button", text="Save problem")
  d.send(OpenProblem(1))
  assert_true(d.state().tab is QuadraticTab)
  d.click("button", text="×")
  assert_eq(d.state().history.length(), 1)
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "the math components have the generic properties" {
  @testing.check_component(quadratic)
  @testing.check_component(matrix2)
  @testing.check_component(workbench)
}

///|
test "random events on the workbench patch the DOM as a fresh render would" {
  @testing.run_events(workbench, Workbench::new, count=20)
}
