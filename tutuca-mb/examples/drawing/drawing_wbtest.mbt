///|
fn style() -> Style {
  { fill: "none", stroke: "#000000", width: 2, }
}

///|
fn rect(
  id : String,
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
) -> Shape {
  Rect({ id, style: style(), x0, y0, x1, y1, })
}

///|
fn at(x : Double, y : Double) -> @tutuca.EventInfo {
  @tutuca.EventInfo::new(point=(x, y))
}

///|
test "shapes render as SVG elements inside the canvas" {
  let shapes = [
    rect("a", 50.0, 40.0, 10.0, 10.0),
    Polyline({
      id: "b",
      style: style(),
      points: Vec::of([0.0, 0.0, 10.0, 20.0, 30.0, 5.0]),
    }),
  ]
  let d = @testing.Driver::new(
    drawing,
    Drawing::new(shapes~, selected="a", next_id=1),
  )
  assert_eq(d.problems().map(@testing.describe), [])
  let canvas = d.find("svg").unwrap()
  assert_eq(canvas.namespace_uri(), Some(@vdom.svg_ns))
  let r = d.find("rect").unwrap()
  assert_eq(r.namespace_uri(), Some(@vdom.svg_ns))
  assert_eq(
    ["x", "y", "width", "height"].map(a => r.get_attribute(a).unwrap()),
    ["10", "10", "40", "30"],
  )
  assert_eq(
    d.find("polyline").unwrap().get_attribute("points"),
    Some("0,0 10,20 30,5"),
  )
  let dashed = d
    .find_all("rect")
    .filter(n => n.get_attribute("stroke-dasharray") is Some(_))
  assert_eq(dashed[0].get_attribute("width"), Some("50"))
}

///|
// Releasing over the dragged shape itself must end the drag: the shape, not the canvas, is the
// event's target when nothing captured the pointer.
test "a drag ends on release over the shape, so later moves don't move it" {
  let d = @testing.Driver::new(
    drawing,
    Drawing::new(shapes=[rect("a", 10.0, 10.0, 50.0, 40.0)]),
  )
  let r = () => d.find("rect").unwrap()
  d.dispatch(r(), "pointerdown", info=at(20.0, 20.0))
  assert_eq(d.state().selected, "a")
  d.dispatch(r(), "pointermove", info=at(25.0, 30.0))
  guard d.state().shapes[0] is Rect(b) else { fail("a rect") }
  assert_eq((b.x0, b.y0), (15.0, 20.0))
  d.dispatch(r(), "pointerup", info=at(25.0, 30.0))
  assert_true(d.state().drag_from is None)
  d.dispatch(d.find("svg").unwrap(), "pointermove", info=at(200.0, 200.0))
  d.dispatch(r(), "pointermove", info=at(100.0, 100.0))
  guard d.state().shapes[0] is Rect(b) else { fail("a rect") }
  assert_eq((b.x0, b.y0), (15.0, 20.0))
  assert_eq(d.state().selected, "a")
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
// Shapes stay within the coordinate range: a duplicate at the edge goes the other way, and a
// drag past it stops the shape there, keeping its size.
test "duplicating and moving shapes at the edge keeps them in range" {
  let d = @testing.Driver::new(
    drawing,
    Drawing::new(
      shapes=[rect("a", 9990.0, 0.0, 10000.0, 20.0)],
      selected="a",
      next_id=1,
    ),
  )
  let corners = (s : Shape) => {
    match s {
      Rect(b) => [b.x0, b.y0, b.x1, b.y1]
      _ => []
    }
  }
  d.send(Duplicate)
  assert_eq(corners(d.state().shapes[1]), [9980.0, 10.0, 9990.0, 30.0])
  assert_eq(d.state().selected, "s1")
  // A press on it, as the shape notifies: picked up for a move.
  d.send(ShapeDown("s1", 10000.0, -10000.0))
  assert_eq(d.state().selected, "s1")
  assert_eq(d.state().drag_from, Some((10000.0, -10000.0)))
  d.send(MoveTo(-10000.0, 10000.0)) // 20000 each way, more than the room left on either axis.
  assert_eq(corners(d.state().shapes[1]), [-10000.0, 9980.0, -9990.0, 10000.0])
  d.send(MoveTo(-9999.5, 9999.5))
  assert_eq(corners(d.state().shapes[1]), [-9999.5, 9979.5, -9989.5, 9999.5])
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "drawing a rectangle, a polyline, undo and redo, and export" {
  let saved = []
  let scope = @tutuca.Scope::new()
  @common.handle_in_memory(scope, saved)
  let d = @testing.Driver::new(drawing, Drawing::new(tool=RectTool), scope~)
  let canvas = () => d.find("svg").unwrap()
  d.dispatch(canvas(), "pointerdown", info=at(10.0, 10.0))
  d.dispatch(canvas(), "pointermove", info=at(60.0, 40.0))
  d.dispatch(canvas(), "pointerup", info=at(60.0, 40.0))
  assert_eq(d.state().shapes.length(), 1)
  d.send(SetTool("polyline"))
  // A click per point; between clicks the last point follows the pointer.
  d.send(StartAt(0.0, 0.0))
  for p in [(10.0, 20.0), (30.0, 5.0)] {
    d.send(MoveTo(p.0, p.1))
    d.send(StartAt(p.0, p.1))
  }
  d.send(Finish)
  guard d.state().shapes[1] is Polyline(p) else { fail("a polyline") }
  assert_eq(p.points.to_array(), [0.0, 0.0, 10.0, 20.0, 30.0, 5.0])
  // Ctrl+Z on the canvas's box undoes the polyline, then the button undoes the rectangle.
  let keys = d
    .find_all("div")
    .iter()
    .find_first(n => n.get_attribute("tabindex") == Some("0"))
    .unwrap()
  d.dispatch(
    keys,
    "keydown",
    info=@tutuca.EventInfo::new(key="z", ctrl_key=true),
  )
  assert_eq(d.state().shapes.length(), 1)
  d.click("button", text="↶")
  assert_eq(d.state().shapes.length(), 0)
  d.send(Redo)
  d.send(Redo)
  assert_eq(d.state().shapes.length(), 2)
  d.click("button", text="Save .svg")
  assert_true(
    saved[0].text.has_prefix("<svg xmlns=\"http://www.w3.org/2000/svg\""),
  )
  assert_eq(saved[0].mime, "image/svg+xml")
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "random messages and events keep the drawing's invariants" {
  @testing.run_messages(
    drawing,
    () => Drawing::new(tool=RectTool),
    [@testing.root_messages()],
    count=40,
  )
  @testing.check_component(drawing)
  @testing.run_events(
    drawing,
    () => Drawing::new(shapes=[rect("a", 10.0, 10.0, 50.0, 40.0)]),
    count=20,
  )
}
