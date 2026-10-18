// The shapes a drawing holds (rectangles, ellipses, lines, polylines), their paint, and how a
// pointer draws them.

///|
using @tutuca {
  div,
  span,
  button,
  txt,
  show,
  when,
  each,
  cls,
  class_,
  attr,
  aria,
  bind,
  bind_str,
  on,
  on_event,
  render,
  component,
  type View,
  type Component,
  type Signal,
  type Lens,
  type Vec,
}

///|
pub let palette : Array[String] = [
  "#000000", "#7f7f7f", "#c3c3c3", "#ffffff", "#880015", "#ed1c24", "#ff7f27", "#fff200",
  "#22b14c", "#00a2e8", "#3f48cc", "#a349a4", "#b97a57", "#ffaec9", "#99d9ea", "#c8bfe7",
]

///|
/// A color as #rrggbb, or "none", as SVG's fill and stroke take them.
pub fn is_paint(p : String) -> Bool {
  p == "none" ||
  (
    p.length() == 7 &&
    p.has_prefix("#") &&
    p
    .view(start_offset=1)
    .iter()
    .all(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))
  )
}

///|
pub let coord_max : Double = 10000.0

///|
fn clamp(v : Double, lo : Double, hi : Double) -> Double {
  if v < lo {
    lo
  } else if v > hi {
    hi
  } else {
    v
  }
}

///|
fn fit(v : Double) -> Double {
  clamp(v, -coord_max, coord_max)
}

///|
/// A shape's paint and stroke width.
pub(all) struct Style {
  fill : String
  stroke : String
  width : Int32 // 1, 2, 4 or 8.
} derive(Eq, Debug, ToJson, FromJson)

///|
/// A rectangle, ellipse or line, drawn from one corner to the other.
pub(all) struct Box {
  id : String
  style : Style
  x0 : Double
  y0 : Double
  x1 : Double
  y1 : Double
} derive(Eq, Debug)

///|
/// As JS keeps a shape: its paint beside its other fields.
pub impl ToJson for Box with fn to_json(self) {
  {
    "id": Json::string(self.id),
    "fill": Json::string(self.style.fill),
    "stroke": Json::string(self.style.stroke),
    "width": Json::number(self.style.width.to_double()),
    "x0": Json::number(self.x0),
    "y0": Json::number(self.y0),
    "x1": Json::number(self.x1),
    "y1": Json::number(self.y1),
  }
}

///|
fn style_from(
  m : Map[String, Json],
  path : @json.JsonPath,
) -> Style raise @json.JsonDecodeError {
  {
    fill: @json.from_json(m.get("fill").unwrap_or(Json::string("none")), path~),
    stroke: @json.from_json(
      m.get("stroke").unwrap_or(Json::string("#000000")),
      path~,
    ),
    width: @json.from_json(m.get("width").unwrap_or(Json::number(2)), path~),
  }
}

///|
pub impl FromJson for Box with fn from_json(json, path) {
  guard json is Object(m) else {
    raise @json.JsonDecodeError((path, "a shape"))
  }
  let num = (k : String) => {
    @json.from_json(m.get(k).unwrap_or(Json::number(0)), path~)
  }
  {
    id: @json.from_json(m.get("id").unwrap_or(Json::string("")), path~),
    style: style_from(m, path),
    x0: num("x0"),
    y0: num("y0"),
    x1: num("x1"),
    y1: num("y1"),
  }
}

///|
/// Built a point per click; while drawing, the last point follows the pointer.
pub(all) struct Poly {
  id : String
  style : Style
  points : Vec[Double] // x, y pairs.
} derive(Eq, Debug)

///|
pub impl ToJson for Poly with fn to_json(self) {
  {
    "id": Json::string(self.id),
    "fill": Json::string(self.style.fill),
    "stroke": Json::string(self.style.stroke),
    "width": Json::number(self.style.width.to_double()),
    "points": self.points.to_json(),
  }
}

///|
pub impl FromJson for Poly with fn from_json(json, path) {
  guard json is Object(m) else {
    raise @json.JsonDecodeError((path, "a polyline"))
  }
  {
    id: @json.from_json(m.get("id").unwrap_or(Json::string("")), path~),
    style: style_from(m, path),
    points: @json.from_json(m.get("points").unwrap_or(Json::array([])), path~),
  }
}

///|
pub(all) enum Shape {
  Rect(Box)
  Ellipse(Box)
  Line(Box)
  Polyline(Poly)
} derive(Eq, Debug)

///|
/// The state of the case's component with its name as `$`, as JS's snapshot of a shape.
pub impl ToJson for Shape with fn to_json(self) {
  let (name, state) = match self {
    Rect(b) => ("Rect", ToJson::to_json(b))
    Ellipse(b) => ("Ellipse", ToJson::to_json(b))
    Line(b) => ("Line", ToJson::to_json(b))
    Polyline(p) => ("Polyline", ToJson::to_json(p))
  }
  let out : Map[String, Json] = { "$": Json::string(name) }
  if state is Object(m) {
    for k, v in m {
      out[k] = v
    }
  }
  Json::object(out)
}

///|
pub impl FromJson for Shape with fn from_json(json, path) {
  match json {
    Object(m) =>
      match m.get("$") {
        Some(String("Rect")) => Rect(@json.from_json(json, path~))
        Some(String("Ellipse")) => Ellipse(@json.from_json(json, path~))
        Some(String("Line")) => Line(@json.from_json(json, path~))
        Some(String("Polyline")) => Polyline(@json.from_json(json, path~))
        _ => raise @json.JsonDecodeError((path, "a shape"))
      }
    _ => raise @json.JsonDecodeError((path, "a shape"))
  }
}

///|
pub fn Shape::id(self : Shape) -> String {
  match self {
    Rect(b) | Ellipse(b) | Line(b) => b.id
    Polyline(p) => p.id
  }
}

///|
pub fn Shape::style(self : Shape) -> Style {
  match self {
    Rect(b) | Ellipse(b) | Line(b) => b.style
    Polyline(p) => p.style
  }
}

///|
pub fn Shape::with_style(self : Shape, f : (Style) -> Style) -> Shape {
  match self {
    Rect(b) => Rect({ ..b, style: f(b.style), })
    Ellipse(b) => Ellipse({ ..b, style: f(b.style), })
    Line(b) => Line({ ..b, style: f(b.style), })
    Polyline(p) => Polyline({ ..p, style: f(p.style), })
  }
}

///|
pub fn Shape::with_id(self : Shape, id : String) -> Shape {
  match self {
    Rect(b) => Rect({ ..b, id, })
    Ellipse(b) => Ellipse({ ..b, id, })
    Line(b) => Line({ ..b, id, })
    Polyline(p) => Polyline({ ..p, id, })
  }
}

///|
pub fn Shape::kind(self : Shape) -> Tool {
  match self {
    Rect(_) => RectTool
    Ellipse(_) => EllipseTool
    Line(_) => LineTool
    Polyline(_) => PolylineTool
  }
}

///|
fn Poly::xs(self : Poly) -> Array[Double] {
  self.points.entries().filter(e => e.0 % 2 == 0).map(e => e.1).to_array()
}

///|
fn Poly::ys(self : Poly) -> Array[Double] {
  self.points.entries().filter(e => e.0 % 2 == 1).map(e => e.1).to_array()
}

///|
fn min_of(xs : Array[Double]) -> Double {
  xs.fold(init=@double.infinity, (a, b) => if b < a { b } else { a })
}

///|
fn max_of(xs : Array[Double]) -> Double {
  xs.fold(init=@double.neg_infinity, (a, b) => if b > a { b } else { a })
}

///|
pub fn Shape::left(self : Shape) -> Double {
  match self {
    Rect(b) | Ellipse(b) | Line(b) => if b.x0 < b.x1 { b.x0 } else { b.x1 }
    Polyline(p) => min_of(p.xs())
  }
}

///|
pub fn Shape::top(self : Shape) -> Double {
  match self {
    Rect(b) | Ellipse(b) | Line(b) => if b.y0 < b.y1 { b.y0 } else { b.y1 }
    Polyline(p) => min_of(p.ys())
  }
}

///|
pub fn Shape::box_width(self : Shape) -> Double {
  match self {
    Rect(b) | Ellipse(b) | Line(b) => (b.x1 - b.x0).abs()
    Polyline(p) => max_of(p.xs()) - min_of(p.xs())
  }
}

///|
pub fn Shape::box_height(self : Shape) -> Double {
  match self {
    Rect(b) | Ellipse(b) | Line(b) => (b.y1 - b.y0).abs()
    Polyline(p) => max_of(p.ys()) - min_of(p.ys())
  }
}

///|
pub fn Shape::is_empty(self : Shape) -> Bool {
  match self {
    Polyline(p) if p.points.length() < 4 => true
    _ => self.box_width() < 1.0 && self.box_height() < 1.0
  }
}

///|
/// The far corner, or the point that follows the pointer, at (x, y).
pub fn Shape::drag_to(self : Shape, x : Double, y : Double) -> Shape {
  match self {
    Rect(b) => Rect({ ..b, x1: x, y1: y, })
    Ellipse(b) => Ellipse({ ..b, x1: x, y1: y, })
    Line(b) => Line({ ..b, x1: x, y1: y, })
    Polyline(p) => {
      let n = p.points.length()
      Polyline({ ..p, points: p.points.set(n - 2, x).set(n - 1, y), })
    }
  }
}

///|
fn Shape::add_point(self : Shape, x : Double, y : Double) -> Shape {
  match self {
    Polyline(p) => Polyline({ ..p, points: p.points.push(x).push(y), })
    other => other
  }
}

///|
/// Moves by (dx, dy), stopping at the edge of the coordinate range with its size kept.
pub fn Shape::move_by(self : Shape, dx : Double, dy : Double) -> Shape {
  let dx = clamp(
    dx,
    -coord_max - self.left(),
    coord_max - self.left() - self.box_width(),
  )
  let dy = clamp(
    dy,
    -coord_max - self.top(),
    coord_max - self.top() - self.box_height(),
  )
  let moved = (b : Box) => {
    ..b,
    x0: fit(b.x0 + dx),
    x1: fit(b.x1 + dx),
    y0: fit(b.y0 + dy),
    y1: fit(b.y1 + dy),
  }
  match self {
    Rect(b) => Rect(moved(b))
    Ellipse(b) => Ellipse(moved(b))
    Line(b) => Line(moved(b))
    Polyline(p) =>
      Polyline({
        ..p,
        points: Vec::from_iter(
          p.points
          .entries()
          .map(e => fit(e.1 + (if e.0 % 2 == 0 { dx } else { dy }))),
        ),
      })
  }
}

///|
fn num(v : Double) -> String {
  v.to_string()
}

///|
fn points_attr(p : Poly) -> String {
  let pts = p.points.to_array()
  let pairs = []
  let mut i = 0
  while i + 1 < pts.length() {
    pairs.push("\{num(pts[i])},\{num(pts[i + 1])}")
    i += 2
  }
  pairs.join(" ")
}

///|
fn style_attrs(s : Style) -> String {
  "fill=\"\{s.fill}\" stroke=\"\{s.stroke}\" stroke-width=\"\{s.width}\""
}

///|
pub fn Shape::to_svg(self : Shape) -> String {
  let a = style_attrs(self.style())
  match self {
    Rect(_) =>
      "<rect x=\"\{num(self.left())}\" y=\"\{num(self.top())}\" width=\"\{num(self.box_width())}\" height=\"\{num(self.box_height())}\" \{a}/>"
    Ellipse(b) =>
      "<ellipse cx=\"\{num((b.x0 + b.x1) / 2.0)}\" cy=\"\{num((b.y0 + b.y1) / 2.0)}\" rx=\"\{num(self.box_width() / 2.0)}\" ry=\"\{num(self.box_height() / 2.0)}\" \{a}/>"
    Line(b) =>
      "<line x1=\"\{num(b.x0)}\" y1=\"\{num(b.y0)}\" x2=\"\{num(b.x1)}\" y2=\"\{num(b.y1)}\" \{a} stroke-linecap=\"round\"/>"
    Polyline(p) =>
      "<polyline points=\"\{points_attr(p)}\" \{a} stroke-linejoin=\"round\"/>"
  }
}

// --- shape components ---------------------------------------------------------------------

///|
/// Sent when a shape is pressed, with its id and the point.
pub let shape_down : Signal[(String, Double, Double)] = Signal::new("shapeDown")

///|
pub let shape_move : Signal[(Double, Double)] = Signal::new("shapeMove")

///|
pub let shape_up : Signal[Unit] = Signal::new("shapeUp")

///|
pub(all) enum PointerMsg {
  Down
  Move
  Up
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Pressing a shape selects it or starts a new shape over it, as the tool says. The canvas
/// captures the pointer, so a drag's moves and release reach it, not the shape; where nothing
/// captures it, shapes pass them on, so a drag always ends.
fn[S] pointer_update(
  id : (S) -> String,
) -> (S, PointerMsg, @tutuca.Ctx[S, PointerMsg]) -> S {
  (s, msg, ctx) => {
    match (msg, ctx.event().bind(e => e.point())) {
      (Down, Some((x, y))) => {
        ctx.event().unwrap().capture_pointer()
        ctx.notify(shape_down, (id(s), x, y))
      }
      (Move, Some(p)) => ctx.notify(shape_move, p)
      (Up, _) => ctx.notify(shape_up, ())
      _ => ()
    }
    s
  }
}

///|
fn[S] pointer_props() -> Array[@tutuca.Prop[S, PointerMsg]] {
  [
    on(PointerDown, Down),
    on(PointerMove, Move),
    on(PointerUp, Up),
    on(Custom("pointercancel"), Up),
  ]
}

///|
fn[S] paint_props(style : (S) -> Style) -> Array[@tutuca.Prop[S, PointerMsg]] {
  [
    bind_str("fill", s => style(s).fill),
    bind_str("stroke", s => style(s).stroke),
    bind_str("stroke-width", s => style(s).width.to_string()),
  ]
}

///|
fn box_shape(b : Box) -> Shape {
  Rect(b)
}

///|
pub let rect_shape : Component[Box, PointerMsg] = component(
  "Rect",
  fields=[
    @tutuca.field_info("id", Text, initial=""),
    @tutuca.field_info(
      "fill",
      Text,
      constraints=[Where("colorOrNone")],
      initial="none",
    ),
    @tutuca.field_info(
      "stroke",
      Text,
      constraints=[Where("colorOrNone")],
      initial="#000000",
    ),
    @tutuca.field_info("width", OneOf([2, 1, 4, 8]), initial=2),
    @tutuca.field_info(
      "x0",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "y0",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "x1",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "y1",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
  ],
  messages=@tutuca.json_messages(["Down", "Move", "Up"]),
  view=() => {
    @tutuca.h(
      "rect",
      [
        bind_str("x", b => num(box_shape(b).left())),
        bind_str("y", b => num(box_shape(b).top())),
        bind_str("width", b => num(box_shape(b).box_width())),
        bind_str("height", b => num(box_shape(b).box_height())),
        ..paint_props((b : Box) => b.style),
        ..pointer_props(),
      ],
      [],
    )
  },
  update=pointer_update(b => b.id),
)

///|
pub let ellipse_shape : Component[Box, PointerMsg] = component(
  "Ellipse",
  fields=[
    @tutuca.field_info("id", Text, initial=""),
    @tutuca.field_info(
      "fill",
      Text,
      constraints=[Where("colorOrNone")],
      initial="none",
    ),
    @tutuca.field_info(
      "stroke",
      Text,
      constraints=[Where("colorOrNone")],
      initial="#000000",
    ),
    @tutuca.field_info("width", OneOf([2, 1, 4, 8]), initial=2),
    @tutuca.field_info(
      "x0",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "y0",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "x1",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "y1",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
  ],
  messages=@tutuca.json_messages(["Down", "Move", "Up"]),
  view=() => {
    @tutuca.h(
      "ellipse",
      [
        bind_str("cx", b => num((b.x0 + b.x1) / 2.0)),
        bind_str("cy", b => num((b.y0 + b.y1) / 2.0)),
        bind_str("rx", b => num((b.x1 - b.x0).abs() / 2.0)),
        bind_str("ry", b => num((b.y1 - b.y0).abs() / 2.0)),
        ..paint_props((b : Box) => b.style),
        ..pointer_props(),
      ],
      [],
    )
  },
  update=pointer_update(b => b.id),
)

///|
pub let line_shape : Component[Box, PointerMsg] = component(
  "Line",
  fields=[
    @tutuca.field_info("id", Text, initial=""),
    @tutuca.field_info(
      "fill",
      Text,
      constraints=[Where("colorOrNone")],
      initial="none",
    ),
    @tutuca.field_info(
      "stroke",
      Text,
      constraints=[Where("colorOrNone")],
      initial="#000000",
    ),
    @tutuca.field_info("width", OneOf([2, 1, 4, 8]), initial=2),
    @tutuca.field_info(
      "x0",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "y0",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "x1",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
    @tutuca.field_info(
      "y1",
      Number,
      constraints=[AtLeast(-10000), AtMost(10000)],
      initial=0,
    ),
  ],
  messages=@tutuca.json_messages(["Down", "Move", "Up"]),
  view=() => {
    @tutuca.h(
      "line",
      [
        bind_str("x1", b => num(b.x0)),
        bind_str("y1", b => num(b.y0)),
        bind_str("x2", b => num(b.x1)),
        bind_str("y2", b => num(b.y1)),
        ..paint_props((b : Box) => b.style),
        attr("stroke-linecap", "round"),
        ..pointer_props(),
      ],
      [],
    )
  },
  update=pointer_update(b => b.id),
)

///|
pub let polyline_shape : Component[Poly, PointerMsg] = component(
  "Polyline",
  fields=[
    @tutuca.field_info("id", Text, initial=""),
    @tutuca.field_info(
      "fill",
      Text,
      constraints=[Where("colorOrNone")],
      initial="none",
    ),
    @tutuca.field_info(
      "stroke",
      Text,
      constraints=[Where("colorOrNone")],
      initial="#000000",
    ),
    @tutuca.field_info("width", OneOf([2, 1, 4, 8]), initial=2),
    @tutuca.field_info("points", ListOf(Number), initial=[]),
  ],
  messages=@tutuca.json_messages(["Down", "Move", "Up"]),
  view=() => {
    @tutuca.h(
      "polyline",
      [
        bind_str("points", points_attr),
        ..paint_props((p : Poly) => p.style),
        attr("stroke-linejoin", "round"),
        ..pointer_props(),
      ],
      [],
    )
  },
  update=pointer_update(p => p.id),
)

///|
fn[C] variant(
  _name : String,
  get : (Shape) -> C?,
  make : (C) -> Shape,
) -> Lens[Shape, C] {
  Lens::variant(get, (_, c) => make(c))
}

///|
let rect_variant : Lens[Shape, Box] = variant(
  "rect",
  s => if s is Rect(b) { Some(b) } else { None },
  b => Rect(b),
)

///|
let ellipse_variant : Lens[Shape, Box] = variant(
  "ellipse",
  s => if s is Ellipse(b) { Some(b) } else { None },
  b => Ellipse(b),
)

///|
let line_variant : Lens[Shape, Box] = variant(
  "line",
  s => if s is Line(b) { Some(b) } else { None },
  b => Line(b),
)

///|
let polyline_variant : Lens[Shape, Poly] = variant(
  "polyline",
  s => if s is Polyline(p) { Some(p) } else { None },
  p => Polyline(p),
)

///|
/// A shape of any kind: it renders the component of its kind.
pub let shape_view : Component[Shape, Unit] = component(
  "Shape",
  // It only shows its case's component, as a JS field holds any shape.
  transparent=true,
  children=() => {
    [
      @tutuca.child(rect_shape, rect_variant),
      @tutuca.child(ellipse_shape, ellipse_variant),
      @tutuca.child(line_shape, line_variant),
      @tutuca.child(polyline_shape, polyline_variant),
    ]
  },
  view=() => {
    @tutuca.frag([
      render(rect_variant, rect_shape),
      render(ellipse_variant, ellipse_shape),
      render(line_variant, line_shape),
      render(polyline_variant, polyline_shape),
    ])
  },
)
