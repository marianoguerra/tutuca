// A small vector drawing editor in SVG, simple like MS Paint and vector like Inkscape:
// rectangle, ellipse, line and polyline tools, a select tool to pick and move shapes, raise,
// lower, duplicate and delete, fill and stroke from a palette (click for fill, right click for
// stroke), stroke widths, undo and redo, and export as an .svg file. Pointer events turn into
// messages with coordinates (StartAt, MoveTo, End), so drawing can be scripted and tested.

///|
pub(all) enum Tool {
  SelectTool
  RectTool
  EllipseTool
  LineTool
  PolylineTool
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS names the tools: "select", "rect", ….
pub impl ToJson for Tool with fn to_json(self) {
  for t in tools {
    if t.0 == self {
      return Json::string(t.1)
    }
  }
  Json::null()
}

///|
pub impl FromJson for Tool with fn from_json(json, path) {
  for t in tools {
    if json == Json::string(t.1) {
      return t.0
    }
  }
  raise @json.JsonDecodeError((path, "a tool"))
}

///|
let tools : Array[(Tool, String, String, String)] = [
  (SelectTool, "select", "⬉", "Select and move (S)"),
  (RectTool, "rect", "▭", "Rectangle (R)"),
  (EllipseTool, "ellipse", "◯", "Ellipse (E)"),
  (LineTool, "line", "╱", "Line (L)"),
  (
    PolylineTool,
    "polyline",
    "⌇",
    "Polyline: click points, double click or Enter to finish (P)",
  ),
]

///|
fn Tool::from_name(name : String) -> Tool? {
  tools.iter().find_first(t => t.1 == name).map(t => t.0)
}

///|
fn Tool::label(self : Tool) -> String {
  tools.iter().find_first(t => t.0 == self).map(t => t.3).unwrap_or("")
}

///|
let max_history : Int32 = 50

///|
let tool_on : String = "btn btn-sm btn-square btn-primary join-item"

///|
let tool_off : String = "btn btn-sm btn-square join-item"

///|
let none_style : String = "background:repeating-linear-gradient(45deg,#fff 0 4px,#ed1c24 4px 6px)"

///|
fn swatch_style(paint : String) -> String {
  if paint == "none" {
    none_style
  } else {
    "background:\{paint}"
  }
}

///|
pub(all) struct Drawing {
  width : Int32
  height : Int32
  tool : Tool
  fill : String // For new shapes, and the selected one.
  stroke : String
  stroke_width : Int32
  shapes : Vec[Shape]
  selected : String // The selected shape's id, or "".
  current : Shape? // The shape being drawn.
  drag_from : (Double, Double)? // Where moving the selection was last.
  past : Vec[Vec[Shape]]
  future : Vec[Vec[Shape]]
  next_id : Int32
  cursor : String
} derive(Eq, Debug, ToJson, FromJson)

///|
pub fn Drawing::new(
  shapes~ : Array[Shape] = [],
  tool~ : Tool = SelectTool,
  selected~ : String = "",
  next_id~ : Int32 = 1,
) -> Drawing {
  {
    width: 640,
    height: 400,
    tool,
    fill: "#99d9ea",
    stroke: "#000000",
    stroke_width: 2,
    shapes: Vec::of(shapes),
    selected,
    current: None,
    drag_from: None,
    past: Vec::new(),
    future: Vec::new(),
    next_id,
    cursor: "",
  }
}

///|
pub fn Drawing::selected_index(self : Drawing) -> Int32? {
  self.shapes.find_index(s => s.id() == self.selected)
}

///|
pub fn Drawing::selection(self : Drawing) -> Shape? {
  self.selected_index().bind(i => self.shapes.get(i))
}

///|
/// Every change to the shapes goes through here, so it can be undone.
fn Drawing::remember(self : Drawing) -> Drawing {
  let past = if self.past.length() >= max_history {
    self.past.remove(0)
  } else {
    self.past
  }
  { ..self, past: past.push(self.shapes), future: Vec::new(), }
}

///|
fn Drawing::new_id(self : Drawing) -> (Drawing, String) {
  ({ ..self, next_id: self.next_id + 1, }, "s\{self.next_id}")
}

///|
/// Paint and width apply to the selection too, as one undoable change.
fn Drawing::restyle(self : Drawing, f : (Style) -> Style) -> Drawing {
  match self.selected_index() {
    Some(i) => {
      let d = self.remember()
      { ..d, shapes: d.shapes.update(i, s => s.with_style(f)), }
    }
    None => self
  }
}

///|
fn Drawing::commit(self : Drawing, shape : Shape) -> Drawing {
  let d = { ..self, current: None, }
  if shape.is_empty() {
    return d
  }
  let d = d.remember()
  { ..d, shapes: d.shapes.push(shape), }
}

///|
fn Drawing::deselect_missing(self : Drawing) -> Drawing {
  if self.shapes.any(s => s.id() == self.selected) {
    self
  } else {
    { ..self, selected: "", }
  }
}

///|
pub(all) enum DrawingMsg {
  SetTool(String)
  SetWidth(String)
  SetFill(String)
  SetStroke(String)
  StartAt(Double, Double)
  MoveTo(Double, Double)
  End
  Finish
  Cancel
  Down // Pointer events, turned into the messages above.
  Move
  Up
  ShapeDown(String, Double, Double) // What a pressed shape notifies, sent directly.
  Raise
  Lower
  Duplicate
  Remove
  Undo
  Redo
  Clear
  Key
  ExportSvg
  Saved(@tutuca.AskResult[String])
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
fn Drawing::start_at(self : Drawing, x : Double, y : Double) -> Drawing {
  match (self.tool, self.current) {
    (SelectTool, _) => { ..self, selected: "", }
    // A polyline being drawn takes another point; its last one follows the pointer.
    (PolylineTool, Some(shape)) =>
      { ..self, current: Some(shape.add_point(x, y)), }
    (tool, _) => {
      let (d, id) = self.new_id()
      let style = {
        fill: if tool is LineTool {
          "none"
        } else {
          self.fill
        },
        stroke: self.stroke,
        width: self.stroke_width,
      }
      let b = { id, style, x0: x, y0: y, x1: x, y1: y, }
      let shape = match tool {
        RectTool => Rect(b)
        EllipseTool => Ellipse(b)
        LineTool => Line(b)
        _ => Polyline({ id, style, points: Vec::of([x, y, x, y]), })
      }
      { ..d, current: Some(shape), }
    }
  }
}

///|
fn Drawing::move_to(self : Drawing, x : Double, y : Double) -> Drawing {
  let d = {
    ..self,
    cursor: "\{@fm.round(x).to_int()}, \{@fm.round(y).to_int()}",
  }
  match (d.current, d.drag_from, d.selected_index()) {
    (Some(shape), _, _) => { ..d, current: Some(shape.drag_to(x, y)), }
    (None, Some((x0, y0)), Some(i)) =>
      {
        ..d,
        shapes: d.shapes.update(i, s => s.move_by(x - x0, y - y0)),
        drag_from: Some((x, y)),
      }
    _ => d
  }
}

///|
/// Ends a drag; a polyline goes on until finish.
fn Drawing::end(self : Drawing) -> Drawing {
  let d = { ..self, drag_from: None, }
  match d.current {
    Some(shape) if !(d.tool is PolylineTool) => d.commit(shape)
    _ => d
  }
}

///|
fn Drawing::finish(self : Drawing) -> Drawing {
  match self.current {
    None => self
    Some(Polyline(p)) => {
      // Without the point following the pointer, and the repeats a double click adds.
      let points = p.points.to_array()
      let points = points[:points.length() - 2]
      let kept : Array[Double] = []
      let mut i = 0
      while i + 1 < points.length() {
        let n = kept.length()
        if n < 2 || kept[n - 2] != points[i] || kept[n - 1] != points[i + 1] {
          kept.push(points[i])
          kept.push(points[i + 1])
        }
        i += 2
      }
      self.commit(Polyline({ ..p, points: Vec::of(kept), }))
    }
    Some(shape) => self.commit(shape)
  }
}

///|
fn Drawing::set_tool(self : Drawing, name : String) -> Drawing {
  match Tool::from_name(name) {
    Some(tool) =>
      {
        ..self,
        tool,
        current: None,
        selected: if tool is SelectTool {
          self.selected
        } else {
          ""
        },
      }
    None => self
  }
}

///|
fn Drawing::bring_forward(self : Drawing) -> Drawing {
  match self.selected_index() {
    Some(i) if i < self.shapes.length() - 1 => {
      let d = self.remember()
      { ..d, shapes: d.shapes.swap(i, i + 1), }
    }
    _ => self
  }
}

///|
fn Drawing::send_backward(self : Drawing) -> Drawing {
  match self.selected_index() {
    Some(i) if i > 0 => {
      let d = self.remember()
      { ..d, shapes: d.shapes.swap(i - 1, i), }
    }
    _ => self
  }
}

///|
/// A copy a little down and right, above the original, which becomes the selection.
fn Drawing::duplicate(self : Drawing) -> Drawing {
  match (self.selection(), self.selected_index()) {
    (Some(s), Some(i)) => {
      let (d, id) = self.remember().new_id()
      // Toward the side with room, so a copy at the edge still shows apart.
      let nudge = (far : Double) => {
        if far + 10.0 <= coord_max {
          10.0
        } else {
          -10.0
        }
      }
      let copy = s
        .with_id(id)
        .move_by(
          nudge(s.left() + s.box_width()),
          nudge(s.top() + s.box_height()),
        )
      { ..d, shapes: d.shapes.insert(i + 1, copy), selected: id, }
    }
    _ => self
  }
}

///|
fn Drawing::remove(self : Drawing) -> Drawing {
  match self.selected_index() {
    Some(i) => {
      let d = self.remember()
      { ..d, shapes: d.shapes.remove(i), selected: "", }
    }
    None => self
  }
}

///|
fn Drawing::undo(self : Drawing) -> Drawing {
  match self.past.last() {
    Some(prev) =>
      {
        ..self,
        future: self.future.insert(0, self.shapes),
        shapes: prev,
        past: self.past.remove(self.past.length() - 1),
      }.deselect_missing()
    None => self
  }
}

///|
fn Drawing::redo(self : Drawing) -> Drawing {
  match self.future.first() {
    Some(next) => {
      let past = if self.past.length() >= max_history {
        self.past.remove(0)
      } else {
        self.past
      }
      {
        ..self,
        past: past.push(self.shapes),
        shapes: next,
        future: self.future.remove(0),
      }.deselect_missing()
    }
    None => self
  }
}

///|
fn Drawing::clear(self : Drawing) -> Drawing {
  let d = { ..self, current: None, selected: "", }
  if d.shapes.is_empty() {
    d
  } else {
    { ..d.remember(), shapes: Vec::new(), }
  }
}

///|
fn Drawing::key(self : Drawing, e : @tutuca.Event) -> Drawing {
  let key = e.key().to_lower()
  let d = if e.command_key() {
    match key {
      "z" if !e.shift_key() => self.undo()
      "y" | "z" => self.redo()
      "d" => self.duplicate()
      _ => return self
    }
  } else {
    match key {
      "delete" | "backspace" => self.remove()
      "pageup" => self.bring_forward()
      "pagedown" => self.send_backward()
      "enter" => self.finish()
      "escape" => { ..self, current: None, drag_from: None, selected: "", }
      "s" => self.set_tool("select")
      "r" => self.set_tool("rect")
      "e" => self.set_tool("ellipse")
      "l" => self.set_tool("line")
      "p" => self.set_tool("polyline")
      _ => return self
    }
  }
  e.prevent_default()
  d
}

///|
/// The drawing as a standalone SVG document.
pub fn Drawing::to_svg(self : Drawing) -> String {
  let body = self.shapes.iter().map(s => "  \{s.to_svg()}\n").join("")
  "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \{self.width} \{self.height}\" width=\"\{self.width}\" height=\"\{self.height}\">\n\{body}</svg>\n"
}

///|
fn Drawing::update(
  self : Drawing,
  msg : DrawingMsg,
  ctx : @tutuca.Ctx[Drawing, DrawingMsg],
) -> Drawing {
  match msg {
    SetTool(name) => self.set_tool(name)
    SetWidth(text) =>
      match int_or(text, 0) {
        w if [1, 2, 4, 8].contains(w) =>
          { ..self, stroke_width: w, }.restyle(s => { ..s, width: w, })
        _ => self
      }
    SetFill(p) =>
      if is_paint(p) {
        { ..self, fill: p, }.restyle(s => { ..s, fill: p, })
      } else {
        self
      }
    // A right click on a swatch, as Inkscape's shift click.
    SetStroke(p) => {
      if ctx.event() is Some(e) {
        e.prevent_default()
      }
      if is_paint(p) {
        { ..self, stroke: p, }.restyle(s => { ..s, stroke: p, })
      } else {
        self
      }
    }
    StartAt(x, y) => self.start_at(fit(x), fit(y))
    MoveTo(x, y) => self.move_to(fit(x), fit(y))
    End => self.end()
    Finish => self.finish()
    Cancel => { ..self, current: None, drag_from: None, selected: "", }
    Down =>
      match ctx.event() {
        Some(e) if e.button() == 0 =>
          match e.point() {
            Some((x, y)) => {
              e.capture_pointer()
              self.start_at(x, y)
            }
            None => self
          }
        _ => self
      }
    Move =>
      match ctx.event().bind(e => e.point()) {
        Some((x, y)) => self.move_to(x, y)
        None => self
      }
    Up => self.end()
    ShapeDown(id, x, y) => self.shape_down(id, fit(x), fit(y))
    Raise => self.bring_forward()
    Lower => self.send_backward()
    Duplicate => self.duplicate()
    Remove => self.remove()
    Undo => self.undo()
    Redo => self.redo()
    Clear => self.clear()
    Key =>
      match ctx.event() {
        Some(e) => self.key(e)
        None => self
      }
    ExportSvg => {
      ctx.ask(
        @common.save_file,
        @common.SaveFile::new(
          "drawing.svg",
          self.to_svg(),
          mime="image/svg+xml",
        ),
        r => Some(Saved(r)),
      )
      self
    }
    Saved(_) => self
  }
}

///|
/// From a pressed shape: the select tool picks it up, the others draw over it.
fn Drawing::shape_down(
  self : Drawing,
  id : String,
  x : Double,
  y : Double,
) -> Drawing {
  if !(self.tool is SelectTool) {
    return self.start_at(x, y)
  }
  if !self.shapes.any(s => s.id() == id) {
    return self
  }
  // So moving it can be undone.
  { ..self.remember(), selected: id, drag_from: Some((x, y)), }
}

///|
let shapes_items : @tutuca.Items[Drawing, Int32, Shape] = @tutuca.items(
  "shapes",
  d => d.shapes,
  (d, shapes) => { ..d, shapes, },
)

///|
let current_lens : Lens[Drawing, Shape] = Lens::partial(
  "current",
  d => d.current,
  (d, s) => { ..d, current: Some(s), },
)

///|
fn toolbar() -> View[Drawing, DrawingMsg] {
  let disabled_without_selection = bind("disabled", (d : Drawing) => {
    Bool(d.selection() is None)
  })
  let selection_button = (label : String, title : String, msg : DrawingMsg) => {
    button(
      [
        cls("btn btn-sm join-item"),
        disabled_without_selection,
        attr("title", title),
        on(Click, msg),
      ],
      [txt(label)],
    )
  }
  div([cls("flex flex-wrap items-center gap-2")], [
    div([cls("join"), attr("role", "toolbar"), aria("label", "Tools")], [
      each(
        _ => tools.iter(),
        button(
          [
            class_(it => {
              if it.up.tool == it.value.0 {
                tool_on
              } else {
                tool_off
              }
            }),
            bind_str("title", it => it.value.3),
            bind_str("aria-label", it => it.value.3),
            bind_str("value", it => it.value.1),
            on_event(Click, (it, _) => Some(SetTool(it.value.1))),
          ],
          [show(it => it.value.2)],
        ),
      ),
    ]),
    div([cls("join"), attr("role", "group"), aria("label", "Stroke width")], [
      each(
        _ => [1, 2, 4, 8].iter(),
        button(
          [
            class_(it => {
              if it.up.stroke_width == it.value {
                tool_on
              } else {
                tool_off
              }
            }),
            bind_str("title", it => "\{it.value}px stroke"),
            bind_str("value", it => it.value.to_string()),
            on_event(Click, (it, _) => Some(SetWidth(it.value.to_string()))),
          ],
          [
            span(
              [
                bind_str("style", it => {
                  "display:block;width:1.2rem;background:currentColor;height:\{it.value}px"
                }),
              ],
              [],
            ),
          ],
        ),
      ),
    ]),
    div([cls("join"), attr("role", "group"), aria("label", "Selection")], [
      selection_button("Raise", "Raise (Page Up)", Raise),
      selection_button("Lower", "Lower (Page Down)", Lower),
      selection_button("Duplicate", "Duplicate (Ctrl+D)", Duplicate),
      selection_button("Delete", "Delete (Del)", Remove),
    ]),
    div([cls("join")], [
      button(
        [
          cls("btn btn-sm join-item"),
          bind("disabled", d => Bool(d.past.is_empty())),
          attr("title", "Undo (Ctrl+Z)"),
          on(Click, Undo),
        ],
        [txt("↶")],
      ),
      button(
        [
          cls("btn btn-sm join-item"),
          bind("disabled", d => Bool(d.future.is_empty())),
          attr("title", "Redo (Ctrl+Y)"),
          on(Click, Redo),
        ],
        [txt("↷")],
      ),
    ]),
    button([cls("btn btn-sm"), on(Click, Clear)], [txt("New")]),
    button([cls("btn btn-sm"), on(Click, ExportSvg)], [txt("Save .svg")]),
  ])
}

///|
fn palette_row() -> View[Drawing, DrawingMsg] {
  div([cls("flex flex-wrap items-center gap-2")], [
    div(
      [cls("flex items-center gap-1 text-xs"), attr("title", "Fill and stroke")],
      [
        txt("Fill"),
        span(
          [
            cls("size-5 border border-base-content/40"),
            bind_str("style", d => swatch_style(d.fill)),
          ],
          [],
        ),
        txt("Stroke"),
        span(
          [
            cls("size-5 border border-base-content/40"),
            bind_str("style", d => swatch_style(d.stroke)),
          ],
          [],
        ),
      ],
    ),
    div([cls("flex flex-wrap gap-0.5")], [
      each(
        _ => ["none", ..palette].iter(),
        button(
          [
            cls("size-5 border border-base-content/30"),
            bind_str("style", it => swatch_style(it.value)),
            bind_str("title", it => {
              "\{it.value}: click for fill, right click for stroke"
            }),
            bind_str("aria-label", it => it.value),
            bind_str("value", it => it.value),
            on_event(Click, (it, _) => Some(SetFill(it.value))),
            on_event(Custom("contextmenu"), (it, _) => Some(SetStroke(it.value))),
          ],
          [],
        ),
      ),
    ]),
  ])
}

///|
fn status(d : Drawing) -> String {
  let what = match d.selection() {
    Some(s) => "\{s.id()} selected"
    None => {
      let label = d.tool.label()
      let cut = match (label.find(":"), label.find("(")) {
        (Some(i), _) | (None, Some(i)) => i
        (None, None) => label.length()
      }
      label.view(end_offset=cut).trim().to_owned()
    }
  }
  let n = d.shapes.length()
  let where_ = if d.cursor == "" { "" } else { " · \{d.cursor}" }
  "\{what} · \{n} \{if n == 1 { "shape" } else { "shapes" }}\{where_}"
}

///|
fn selection_box(d : Drawing) -> (Double, Double, Double, Double) {
  match d.selection() {
    Some(s) => {
      // A margin, so it doesn't hide thin shapes.
      let m = s.style().width.to_double() / 2.0 + 4.0
      (
        s.left() - m,
        s.top() - m,
        s.box_width() + 2.0 * m,
        s.box_height() + 2.0 * m,
      )
    }
    None => (0.0, 0.0, 0.0, 0.0)
  }
}

///|
fn Drawing::view() -> View[Drawing, DrawingMsg] {
  div(
    [
      cls(
        "flex flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-2 select-none",
      ),
    ],
    [
      toolbar(),
      palette_row(),
      div(
        [
          cls(
            "overflow-auto rounded border border-base-300 bg-base-300 p-2 outline-none",
          ),
          attr("tabindex", "0"),
          on(KeyDown, Key),
        ],
        [
          @tutuca.h(
            "svg",
            [
              cls("block max-w-full shadow"),
              bind_str("viewBox", d => "0 0 \{d.width} \{d.height}"),
              bind_str("width", d => d.width.to_string()),
              bind_str("height", d => d.height.to_string()),
              bind_str("style", d => {
                let cursor = if d.tool is SelectTool {
                  "default"
                } else {
                  "crosshair"
                }
                "cursor:\{cursor};touch-action:none;background:#ffffff;height:auto"
              }),
              attr("role", "img"),
              aria("label", "Drawing canvas"),
              on(PointerDown, Down),
              on(PointerMove, Move),
              on(PointerUp, Up),
              on(Custom("pointercancel"), Up),
              on(DblClick, Finish),
            ],
            [
              @tutuca.h("g", [], [
                @tutuca.render_each(shapes_items, shape_view, key=(_, s) => {
                  s.id()
                }),
              ]),
              render(current_lens, shape_view),
              when(
                d => d.selection() is Some(_),
                @tutuca.h(
                  "rect",
                  [
                    bind_str("x", d => num(selection_box(d).0)),
                    bind_str("y", d => num(selection_box(d).1)),
                    bind_str("width", d => num(selection_box(d).2)),
                    bind_str("height", d => num(selection_box(d).3)),
                    attr("fill", "none"),
                    attr("stroke", "#3f48cc"),
                    attr("stroke-width", "1"),
                    attr("stroke-dasharray", "4 3"),
                    attr("pointer-events", "none"),
                  ],
                  [],
                ),
              ),
            ],
          ),
        ],
      ),
      div(
        [
          cls("px-1 text-xs tabular-nums opacity-70"),
          attr("aria-live", "polite"),
        ],
        [show(status)],
      ),
    ],
  )
}

///|
fn has_unique_ids(shapes : Vec[Shape]) -> Bool {
  let ids = shapes.map(s => s.id()).to_array()
  ids.iter().all(id => ids.iter().count_if(x => x == id) == 1)
}

///|
fn all_shapes(d : Drawing) -> Array[Shape] {
  let out = d.shapes.to_array()
  for snap in d.past.iter() {
    out.append(snap.to_array())
  }
  for snap in d.future.iter() {
    out.append(snap.to_array())
  }
  out
}

///|
pub let drawing : Component[Drawing, DrawingMsg] = component(
  "Drawing",
  view=Drawing::view,
  update=Drawing::update,
  children=() => {
    let snapshots = (name : String, get : (Drawing) -> Vec[Vec[Shape]]) => {
      let outer : @tutuca.Items[Drawing, Int32, Vec[Shape]] = @tutuca.items(
        name,
        get,
        (d, _) => d,
      )
      let inner : @tutuca.Items[Vec[Shape], Int32, Shape] = @tutuca.items(
        "",
        v => v,
        (_, v) => v,
      )
      @tutuca.each_child(shape_view, outer.then(inner))
    }
    [
      @tutuca.each_child(shape_view, shapes_items),
      @tutuca.child(shape_view, current_lens),
      snapshots("past", d => d.past),
      snapshots("future", d => d.future),
    ]
  },
  fields=[
    @tutuca.field_info(
      "width",
      Whole,
      constraints=[AtLeast(16), AtMost(4000)],
      initial=640,
    ),
    @tutuca.field_info(
      "height",
      Whole,
      constraints=[AtLeast(16), AtMost(4000)],
      initial=400,
    ),
    @tutuca.field_info(
      "tool",
      OneOf(["select", "rect", "ellipse", "line", "polyline"]),
      initial="select",
    ),
    @tutuca.field_info(
      "fill",
      Text,
      constraints=[Where("colorOrNone")],
      initial="#99d9ea",
    ),
    @tutuca.field_info(
      "stroke",
      Text,
      constraints=[Where("colorOrNone")],
      initial="#000000",
    ),
    @tutuca.field_info("stroke_width", OneOf([2, 1, 4, 8]), initial=2),
    @tutuca.field_info(
      "shapes",
      ListOf(ComponentOf(["Rect", "Ellipse", "Line", "Polyline"])),
      initial=[],
    ),
    @tutuca.field_info("selected", Text, initial=""),
    @tutuca.field_info(
      "current",
      Optional(ComponentOf(["Rect", "Ellipse", "Line", "Polyline"])),
    ),
    @tutuca.field_info("drag_from", Optional(ListOf(Number))),
    @tutuca.field_info(
      "past",
      ListOf(ListOf(ComponentOf(["Rect", "Ellipse", "Line", "Polyline"]))),
      constraints=[MaxLength(50)],
      initial=[],
    ),
    @tutuca.field_info(
      "future",
      ListOf(ListOf(ComponentOf(["Rect", "Ellipse", "Line", "Polyline"]))),
      initial=[],
    ),
    @tutuca.field_info("next_id", Whole, constraints=[AtLeast(1)], initial=1),
    @tutuca.field_info("cursor", Text, initial=""),
  ],
  messages=@tutuca.json_messages(
    [
      "SetTool", "SetWidth", "SetFill", "SetStroke", "StartAt", "MoveTo", "End",
      "Finish", "Cancel", "Down", "Move", "Up", "shapeDown", "shapeMove", "shapeUp",
      "Raise", "Lower", "Duplicate", "Remove", "Undo", "Redo", "Clear", "Key", "ExportSvg",
      "Saved",
    ],
    heard=[
      @tutuca.heard(shape_down),
      @tutuca.heard(shape_move),
      @tutuca.heard(shape_up),
    ],
    replies=[@tutuca.reply("Saved", @common.save_file)],
  ),
  on=[
    shape_down.on((d, p, ctx) => {
      ctx.stop()
      d.shape_down(p.0, p.1, p.2)
    }),
    shape_move.on((d, p, ctx) => {
      ctx.stop()
      d.move_to(p.0, p.1)
    }),
    shape_up.on((d, _, ctx) => {
      ctx.stop()
      d.end()
    }),
  ],
  invariants=[
    ("unique ids", d => has_unique_ids(d.shapes)),
    // Undo and redo bring snapshots back as the shapes.
    (
      "unique ids in history",
      d => d.past.all(has_unique_ids) && d.future.all(has_unique_ids),
    ),
    // The shape being drawn is committed as a new one, also after undo or redo.
    (
      "the shape being drawn is new",
      d => {
        match d.current {
          Some(c) => !all_shapes(d).iter().any(s => s.id() == c.id())
          None => true
        }
      },
    ),
    // Only a drawing tool draws, and only its kind of shape.
    (
      "the shape being drawn matches the tool",
      d => {
        match d.current {
          Some(c) => c.kind() == d.tool
          None => true
        }
      },
    ),
    // newId hands out s<nextId> onwards, so those can't be taken yet.
    (
      "ids are fresh",
      d => {
        let shapes = all_shapes(d)
        if d.current is Some(c) {
          shapes.push(c)
        }
        shapes
        .iter()
        .all(s => {
          let id = s.id()
          match id.strip_prefix("s") {
            Some(n) => int_or(n.to_owned(), -1) < d.next_id
            None => true
          }
        })
      },
    ),
    (
      "the selection exists",
      d => d.selected == "" || d.shapes.any(s => s.id() == d.selected),
    ),
    ("paints are colors or none", d => is_paint(d.fill) && is_paint(d.stroke)),
  ],
  post=(msg, _, next) => {
    match msg {
      Finish => next.current is None
      Clear => next.shapes.is_empty()
      _ => true
    }
  },
)

///|
fn int_or(text : String, default : Int32) -> Int32 {
  @string.parse_int(text) catch {
    _ => default
  }
}

///|
/// Generated drawings keep the invariants: shapes with fresh ids, nothing drawn, a palette
/// paint.
pub impl @quickcheck.Arbitrary for Drawing with fn arbitrary(size, rs) {
  let pick = (n : Int32) => {
    rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
  }
  let coord = () => pick(600).to_double()
  let n = pick(size + 1)
  let shapes = Array::makei(n, i => {
    let style = {
      fill: palette[pick(16)],
      stroke: palette[pick(16)],
      width: [1, 2, 4, 8][pick(4)],
    }
    let id = "s\{i + 1}"
    let b = { id, style, x0: coord(), y0: coord(), x1: coord(), y1: coord(), }
    match pick(4) {
      0 => Rect(b)
      1 => Ellipse(b)
      2 => Line(b)
      _ =>
        Polyline({
          id,
          style,
          points: Vec::of([coord(), coord(), coord(), coord()]),
        })
    }
  })
  let tool = tools[pick(5)].0
  Drawing::new(shapes~, tool~, next_id=n + 1)
}

///|
/// A palette style, as generated drawings use.
fn gen_style(rs : @quickcheck.RandomState) -> Style {
  let pick = (n : Int32) => {
    rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
  }
  {
    fill: palette[pick(16)],
    stroke: palette[pick(16)],
    width: [1, 2, 4, 8][pick(4)],
  }
}

///|
/// Generated shapes on their own, for the shape components' generic properties.
pub impl @quickcheck.Arbitrary for Box with fn arbitrary(_, rs) {
  let coord = () => rs.next_uint(limit=600).reinterpret_as_int().to_double()
  {
    id: "s1",
    style: gen_style(rs),
    x0: coord(),
    y0: coord(),
    x1: coord(),
    y1: coord(),
  }
}

///|
pub impl @quickcheck.Arbitrary for Poly with fn arbitrary(size, rs) {
  let coord = () => rs.next_uint(limit=600).reinterpret_as_int().to_double()
  let n = 2 +
    rs.next_uint(limit=(size + 1).reinterpret_as_uint()).reinterpret_as_int()
  {
    id: "s1",
    style: gen_style(rs),
    points: Vec::of(Array::makei(n * 2, _ => coord())),
  }
}

///|
pub impl @quickcheck.Arbitrary for Shape with fn arbitrary(size, rs) {
  match rs.next_uint(limit=4) {
    0 => Rect(@quickcheck.Arbitrary::arbitrary(size, rs))
    1 => Ellipse(@quickcheck.Arbitrary::arbitrary(size, rs))
    2 => Line(@quickcheck.Arbitrary::arbitrary(size, rs))
    _ => Polyline(@quickcheck.Arbitrary::arbitrary(size, rs))
  }
}
