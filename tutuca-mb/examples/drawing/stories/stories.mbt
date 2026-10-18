///|
using @storybook {story, send, event, check, css, book, type Book, type Step}

///|
using @drawing {drawing, type Drawing, type DrawingMsg, type Shape, type Style}

///|
fn style(stroke : String, fill : String, width : Int32) -> Style {
  { stroke, fill, width, }
}

///|
fn box_(
  id : String,
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
  s : Style,
) -> @drawing.Box {
  { id, style: s, x0, y0, x1, y1, }
}

///|
/// A house in the sun, as shapes.
pub fn house() -> Drawing {
  Drawing::new(
    shapes=[
      Rect(
        box_("s1", 200.0, 200.0, 360.0, 330.0, style("#880015", "#ffaec9", 4)),
      ),
      Polyline({
        id: "s2",
        style: style("#880015", "#ed1c24", 4),
        points: @tutuca.Vec::of([190.0, 205.0, 280.0, 130.0, 370.0, 205.0]),
      }),
      Rect(
        box_("s3", 260.0, 260.0, 300.0, 330.0, style("#000000", "#b97a57", 2)),
      ),
      Ellipse(
        box_("s4", 480.0, 40.0, 560.0, 120.0, style("#ff7f27", "#fff200", 4)),
      ),
      Line(box_("s5", 0.0, 330.0, 640.0, 330.0, style("#22b14c", "none", 8))),
    ],
    next_id=6,
  )
}

///|
/// Drags from (x0, y0) to (x1, y1) through a point between them.
fn drag(
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
) -> Array[Step[Drawing, DrawingMsg]] {
  [
    send(StartAt(x0, y0)),
    send(MoveTo((x0 + x1) / 2.0, (y0 + y1) / 2.0)),
    send(MoveTo(x1, y1)),
    send(End),
  ]
}

///|
fn last(d : Drawing) -> Shape {
  d.shapes.last().unwrap()
}

///|
fn by_id(d : Drawing, id : String) -> Shape? {
  d.shapes.iter().find_first(s => s.id() == id)
}

///|
fn box_of(s : Shape?) -> @drawing.Box? {
  match s {
    Some(Rect(b) | Ellipse(b) | Line(b)) => Some(b)
    _ => None
  }
}

///|
fn small(shape : Shape) -> Drawing {
  { ..Drawing::new(shapes=[shape], next_id=2), width: 240, height: 120, }
}

///|
/// The drawing book, for any DOM.
pub fn[N : @vdom.DomNode] drawing_book() -> Book[N] {
  let messages : Array[@testing.Target[Drawing, DrawingMsg]] = [
    @testing.root_messages(keep=m => {
      !(m
      is (@drawing.ExportSvg
      | @drawing.Key
      | @drawing.Down
      | @drawing.Move
      | @drawing.Up))
    }),
  ]
  let saves = (s : @tutuca.Scope) => @common.handle_in_memory(s, [])
  book(
    "Drawing",
    [
      story("Shapes/Rectangle", drawing, () => {
        small(
          Rect(
            box_("s1", 200.0, 100.0, 40.0, 20.0, style("#000000", "#99d9ea", 2)),
          ),
        )
      }),
      story("Shapes/Ellipse", drawing, () => {
        small(
          Ellipse(
            box_("s1", 20.0, 10.0, 220.0, 110.0, style("#a349a4", "#c8bfe7", 4)),
          ),
        )
      }),
      story("Shapes/Line", drawing, () => {
        small(
          Line(
            box_("s1", 20.0, 100.0, 220.0, 20.0, style("#3f48cc", "none", 8)),
          ),
        )
      }),
      story("Shapes/Polyline", drawing, () => {
        small(
          Polyline({
            id: "s1",
            style: style("#000000", "none", 4),
            points: @tutuca.Vec::of([
              10.0, 100.0, 60.0, 20.0, 120.0, 90.0, 180.0, 15.0, 230.0, 100.0,
            ]),
          }),
        )
      }),
      story(
        "Drawing/Blank",
        drawing,
        () => Drawing::new(),
        sequences=[
          (
            "one of each shape",
            [
              send(SetTool("rect")),
              send(SetFill("#fff200")),
              ..drag(40.0, 40.0, 200.0, 160.0),
              check("a yellow rectangle", s => {
                last(s).style().fill == "#fff200" &&
                last(s).box_width() == 160.0
              }),
              send(SetTool("ellipse")),
              send(SetStroke("#ed1c24")),
              send(SetFill("none")),
              ..drag(300.0, 60.0, 420.0, 180.0),
              check("a red outlined ellipse", s => {
                let st = last(s).style()
                st.stroke == "#ed1c24" &&
                st.fill == "none" &&
                last(s).box_width() / 2.0 == 60.0
              }),
              send(SetTool("line")),
              send(SetWidth("8")),
              ..drag(450.0, 300.0, 600.0, 380.0),
              check("a thick line", s => last(s).style().width == 8),
              send(SetTool("polyline")),
              send(StartAt(20.0, 300.0)),
              send(MoveTo(60.0, 250.0)),
              send(End),
              check("still drawing the polyline", s => {
                s.current is Some(_) && s.shapes.length() == 3
              }),
              send(StartAt(60.0, 250.0)),
              send(MoveTo(120.0, 320.0)),
              send(StartAt(120.0, 320.0)),
              send(Finish),
              check("a polyline of three points", s => {
                match last(s) {
                  Polyline(p) =>
                    p.points.to_array() ==
                    [20.0, 300.0, 60.0, 250.0, 120.0, 320.0]
                  _ => false
                }
              }),
            ],
          ),
          (
            "a click is not a shape",
            [
              send(SetTool("rect")),
              send(StartAt(50.0, 50.0)),
              send(End),
              check("nothing drawn", s => {
                s.shapes.is_empty() && s.current is None
              }),
            ],
          ),
          (
            "keyboard: tools and cancel",
            [
              event("keydown", css("[tabindex=\"0\"]")),
              send(SetTool("polyline")),
              send(StartAt(10.0, 10.0)),
              send(Cancel),
              check("cancelled", s => s.current is None),
            ],
          ),
        ],
        targets=messages,
        max_steps=20,
      ),
      story(
        "Drawing/House",
        drawing,
        house,
        asks=saves,
        sequences=[
          (
            "select, move and restyle",
            [
              send(ShapeDown("s4", 520.0, 80.0)),
              check("the sun is selected", s => s.selected == "s4"),
              send(MoveTo(500.0, 100.0)),
              send(MoveTo(480.0, 120.0)),
              send(End),
              check("moved down left", s => {
                box_of(by_id(s, "s4")).map(b => (b.x0, b.y0)) ==
                Some((440.0, 80.0))
              }),
              send(SetFill("#ff7f27")),
              check("an orange sun", s => {
                by_id(s, "s4").map(x => x.style().fill) == Some("#ff7f27")
              }),
              send(Undo),
              send(Undo),
              check("back where it was, yellow", s => {
                box_of(by_id(s, "s4")).map(b => b.x0) == Some(480.0) &&
                by_id(s, "s4").map(x => x.style().fill) == Some("#fff200")
              }),
              send(Redo),
              check("moved again", s => {
                box_of(by_id(s, "s4")).map(b => b.x0) == Some(440.0)
              }),
            ],
          ),
          (
            "order, duplicate and delete",
            [
              send(ShapeDown("s3", 280.0, 300.0)),
              send(End),
              send(Lower),
              check("the door went under the wall", s => {
                s.shapes[1].id() == "s3"
              }),
              send(Raise),
              send(Duplicate),
              check("a copy, selected, offset", s => {
                s.selected == "s6" &&
                box_of(by_id(s, "s6")).map(b => b.x0) == Some(270.0)
              }),
              send(Remove),
              check("deleted the copy", s => {
                by_id(s, "s6") is None && s.selected == ""
              }),
              send(ShapeDown("s2", 280.0, 140.0)),
              event("keydown", css("[tabindex=\"0\"]")),
              send(Remove),
              check("no roof", s => by_id(s, "s2") is None),
              send(Undo),
              check("roof back", s => by_id(s, "s2") is Some(_)),
            ],
          ),
          (
            "drawing over a shape starts a new one",
            [
              send(SetTool("ellipse")),
              send(ShapeDown("s1", 220.0, 220.0)),
              send(MoveTo(240.0, 240.0)),
              send(End),
              check("drawn on top", s => {
                box_of(Some(last(s))).map(b => (b.x0 + b.x1) / 2.0) ==
                Some(230.0)
              }),
            ],
          ),
          (
            "new, then undo it",
            [
              send(Clear),
              check("blank", s => s.shapes.is_empty()),
              send(Undo),
              check("all back", s => s.shapes.length() == 5),
            ],
          ),
          (
            "save as svg",
            [
              check("a standalone svg", s => {
                s
                .to_svg()
                .has_prefix("<svg xmlns=\"http://www.w3.org/2000/svg\"")
              }),
              check("with every shape", s => {
                s.to_svg().split("\n  <").count() == 6
              }),
              send(ExportSvg),
            ],
          ),
        ],
        targets=messages,
        generate=(rs, size) => @quickcheck.Arbitrary::arbitrary(size, rs),
        max_steps=20,
      ),
      story("Drawing/Selected", drawing, () => { ..house(), selected: "s1", }),
      @storybook.generated_story(
        "Drawing/Generated",
        drawing,
        (rs, size) => @quickcheck.Arbitrary::arbitrary(size, rs),
        targets=messages,
        max_steps=15,
      ),
      story(
        "Drawing/DOM events",
        drawing,
        house,
        targets=messages,
        max_steps=15,
      ),
    ],
    specs=[
      @storybook.spec(@drawing.drawing),
      @storybook.spec(@drawing.rect_shape),
      @storybook.spec(@drawing.ellipse_shape),
      @storybook.spec(@drawing.line_shape),
      @storybook.spec(@drawing.polyline_shape),
    ],
  )
}
