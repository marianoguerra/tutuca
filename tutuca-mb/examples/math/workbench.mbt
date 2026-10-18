// A workbench over the math components: they sit under tabs, and the problems solved along the
// way are kept in a history to go back to.

///|
fn term(n : Double, x : String, first : Bool) -> String {
  if n == 0.0 {
    return ""
  }
  let sign = if n < 0.0 { "−" } else if first { "" } else { "+" }
  let k = if n.abs() == 1.0 && x != "" { "" } else { fmt(n.abs()) }
  if first {
    "\{sign}\{k}\{x}"
  } else {
    " \{sign} \{k}\{x}"
  }
}

///|
/// "x² − 3x + 2 = 0" for a, b, c.
pub fn quadratic_label(a : Double, b : Double, c : Double) -> String {
  "\{term(a, "x²", true)}\{term(b, "x", false)}\{term(c, "", false)} = 0"
}

///|
pub fn matrix_label(a : Int32, b : Int32, c : Int32, d : Int32) -> String {
  "(\{a} \{b} | \{c} \{d}), det \{fmt((a * d - b * c).to_double())}"
}

///|
pub(all) enum Tab {
  QuadraticTab
  MatrixTab
  FormulasTab
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
let tab_names : Array[(Tab, String)] = [
  (QuadraticTab, "quadratic"),
  (MatrixTab, "matrix"),
  (FormulasTab, "formulas"),
]

///|
/// As JS names the tabs: "quadratic", "matrix", "formulas".
pub impl ToJson for Tab with fn to_json(self) {
  for t in tab_names {
    if t.0 == self {
      return Json::string(t.1)
    }
  }
  Json::null()
}

///|
pub impl FromJson for Tab with fn from_json(json, path) {
  for t in tab_names {
    if json == Json::string(t.1) {
      return t.0
    }
  }
  raise @json.JsonDecodeError((path, "a tab"))
}

///|
/// A saved problem.
pub(all) enum Problem {
  SavedQuadratic(Quadratic)
  SavedMatrix(Matrix2)
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS keeps a history entry: its kind, label and values.
pub impl ToJson for Problem with fn to_json(self) {
  let values = match self {
    SavedQuadratic(q) => [q.a, q.b, q.c]
    SavedMatrix(m) => [m.a, m.b, m.c, m.d].map(n => n.to_double())
  }
  {
    "kind": Json::string(self.kind()),
    "label": Json::string(self.label()),
    "values": Json::array(values.map(n => Json::number(n))),
  }
}

///|
pub impl FromJson for Problem with fn from_json(json, path) {
  let values : Array[Double] = match json {
    Object(m) =>
      match m.get("values") {
        Some(v) => @json.from_json(v, path~)
        None => []
      }
    _ => []
  }
  match (json, values) {
    (Object(m), [a, b, c]) if m.get("kind") == Some(Json::string("quadratic")) =>
      SavedQuadratic({ a, b, c, })
    (Object(m), [a, b, c, d]) if m.get("kind") == Some(Json::string("matrix")) =>
      SavedMatrix({
        a: a.to_int(),
        b: b.to_int(),
        c: c.to_int(),
        d: d.to_int(),
      })
    _ => raise @json.JsonDecodeError((path, "a history entry"))
  }
}

///|
pub fn Problem::label(self : Problem) -> String {
  match self {
    SavedQuadratic(q) => quadratic_label(q.a, q.b, q.c)
    SavedMatrix(m) => matrix_label(m.a, m.b, m.c, m.d)
  }
}

///|
fn Problem::kind(self : Problem) -> String {
  match self {
    SavedQuadratic(_) => "quadratic"
    SavedMatrix(_) => "matrix"
  }
}

///|
pub(all) struct Workbench {
  tab : Tab
  quadratic : Quadratic
  matrix : Matrix2
  history : @tutuca.Vec[Problem]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn Workbench::new() -> Workbench {
  {
    tab: QuadraticTab,
    quadratic: { a: 1.0, b: 0.0, c: 0.0, },
    matrix: Default::default(),
    history: @tutuca.Vec::new(),
  }
}

///|
/// The problem on the current tab, if it has one.
pub fn Workbench::problem(self : Workbench) -> Problem? {
  match self.tab {
    QuadraticTab => Some(SavedQuadratic(self.quadratic))
    MatrixTab => Some(SavedMatrix(self.matrix))
    FormulasTab => None
  }
}

///|
pub fn Workbench::cannot_save(self : Workbench) -> Bool {
  match self.problem() {
    None => true
    Some(p) => self.history.any(h => h.label() == p.label())
  }
}

///|
pub(all) enum WorkbenchMsg {
  SetTab(Tab)
  SaveProblem
  OpenProblem(Int32)
  RemoveProblem(Int32)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let quadratic_lens : @tutuca.Lens[Workbench, Quadratic] = @tutuca.field(
  "quadratic",
  w => w.quadratic,
  (w, quadratic) => { ..w, quadratic, },
)

///|
let matrix_lens : @tutuca.Lens[Workbench, Matrix2] = @tutuca.field(
  "matrix",
  w => w.matrix,
  (w, matrix) => { ..w, matrix, },
)

///|
let gallery_lens : @tutuca.Lens[Workbench, Unit] = @tutuca.field(
  "gallery",
  _ => (),
  (w, _) => w,
)

///|
fn tab_button(label : String, tab : Tab) -> View[Workbench, WorkbenchMsg] {
  button(
    [
      attr("role", "tab"),
      @tutuca.class_(w => if w.tab == tab { "tab tab-active" } else { "tab" }),
      @tutuca.on_click(SetTab(tab)),
    ],
    [txt(label)],
  )
}

///|
fn Workbench::view() -> View[Workbench, WorkbenchMsg] {
  div([cls("flex flex-col gap-4 lg:flex-row lg:items-start")], [
    div([cls("card flex-1 border border-base-300 bg-base-100 p-4 shadow-sm")], [
      div([cls("mb-4 flex flex-wrap items-center justify-between gap-2")], [
        div([cls("tabs tabs-box"), attr("role", "tablist")], [
          tab_button("Quadratic", QuadraticTab),
          tab_button("Matrix", MatrixTab),
          tab_button("Formulas", FormulasTab),
        ]),
        button(
          [
            cls("btn btn-sm btn-primary"),
            @tutuca.bind("disabled", w => Bool(w.cannot_save())),
            @tutuca.on_click(SaveProblem),
          ],
          [txt("Save problem")],
        ),
      ]),
      when(
        w => w.tab is QuadraticTab,
        @tutuca.render(quadratic_lens, quadratic),
      ),
      when(w => w.tab is MatrixTab, @tutuca.render(matrix_lens, matrix2)),
      when(
        w => w.tab is FormulasTab,
        @tutuca.render(gallery_lens, formula_gallery),
      ),
    ]),
    @tutuca.h(
      "aside",
      [
        cls(
          "card w-full border border-base-300 bg-base-100 p-4 shadow-sm lg:w-80",
        ),
      ],
      [
        @tutuca.h2(
          [
            cls(
              "mb-2 text-sm font-semibold uppercase tracking-wider opacity-60",
            ),
          ],
          [txt("Saved problems")],
        ),
        if_(
          w => w.history.length() > 0,
          @tutuca.ul([cls("flex flex-col gap-1")], [
            each(
              w => w.history.iter(),
              @tutuca.li([cls("flex items-center gap-1")], [
                button(
                  [
                    cls("btn btn-ghost btn-sm flex-1 justify-start font-mono"),
                    attr("title", "Open"),
                    on_event(Click, (it, _) => Some(OpenProblem(it.index))),
                  ],
                  [
                    span([cls("badge badge-soft badge-sm")], [
                      show(it => it.value.kind()),
                    ]),
                    show(it => it.value.label()),
                  ],
                ),
                button(
                  [
                    cls("btn btn-ghost btn-sm btn-circle text-error"),
                    attr("title", "Remove"),
                    aria("label", "Remove problem"),
                    on_event(Click, (it, _) => Some(RemoveProblem(it.index))),
                  ],
                  [txt("×")],
                ),
              ]),
            ),
          ]),
          p([cls("text-sm opacity-60")], [
            txt("Save a quadratic or a matrix to come back to it."),
          ]),
        ),
      ],
    ),
  ])
}

///|
pub let workbench : Component[Workbench, WorkbenchMsg] = component(
  "Workbench",
  view=Workbench::view,
  children=() => {
    [
      @tutuca.child(quadratic, quadratic_lens),
      @tutuca.child(matrix2, matrix_lens),
      @tutuca.child(formula_gallery, gallery_lens),
    ]
  },
  fields=[
    @tutuca.field_info(
      "tab",
      OneOf(["quadratic", "matrix", "formulas"]),
      initial="quadratic",
    ),
    @tutuca.field_info("quadratic", ComponentOf(["Quadratic"])),
    @tutuca.field_info("matrix", ComponentOf(["Matrix2"])),
    // The gallery's state is nothing; JS keeps its instance in a field.
    @tutuca.field_info("gallery", ComponentOf(["FormulaGallery"])),
    @tutuca.field_info(
      "history",
      ListOf(
        RecordOf([
          ("kind", OneOf(["quadratic", "matrix"])),
          ("label", Text),
          ("values", ListOf(Number)),
        ]),
      ),
      initial=[],
    ),
  ],
  messages=@tutuca.json_messages([
    "SetTab", "SaveProblem", "OpenProblem", "RemoveProblem",
  ]),
  update=(w, msg, _) => {
    match msg {
      SetTab(tab) => { ..w, tab, }
      SaveProblem =>
        match w.problem() {
          Some(p) if !w.cannot_save() =>
            { ..w, history: w.history.insert(0, p), }
          _ => w
        }
      OpenProblem(i) =>
        match w.history.get(i) {
          Some(SavedQuadratic(quadratic)) =>
            { ..w, quadratic, tab: QuadraticTab, }
          Some(SavedMatrix(matrix)) => { ..w, matrix, tab: MatrixTab, }
          None => w
        }
      RemoveProblem(i) => { ..w, history: w.history.remove(i), }
    }
  },
  post=(msg, prev, next) => {
    match msg {
      RemoveProblem(i) =>
        i < 0 ||
        i >= prev.history.length() ||
        next.history.length() == prev.history.length() - 1
      _ => true
    }
  },
)
