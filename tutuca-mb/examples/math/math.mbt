///|
using @tutuca {
  div,
  span,
  p,
  h3,
  button,
  input,
  label,
  txt,
  show,
  when,
  if_,
  each,
  cls,
  attr,
  aria,
  bind_str,
  value,
  on_event,
  on_input,
  component,
  type View,
  type Component,
}

///|
/// A number as MathML shows it: up to 3 decimals, a real minus sign.
pub fn fmt(n : Double) -> String {
  let v = @fm.round(n * 1000.0) / 1000.0
  let v = if v == 0.0 { 0.0 } else { v } // No −0.
  v.to_string().replace_all(old="-", new="−")
}

///|
fn abs_text(n : Double) -> String {
  fmt(n.abs())
}

///|
/// A coefficient in a product: (−2) in parentheses when negative.
fn factor(n : Double) -> String {
  if n < 0.0 {
    "(\{fmt(n)})"
  } else {
    fmt(n)
  }
}

///|
let presets : Array[(String, (Double, Double, Double))] = [
  ("two roots", (1.0, -3.0, 2.0)),
  ("double root", (1.0, -4.0, 4.0)),
  ("complex roots", (1.0, 2.0, 5.0)),
  ("upside down", (-0.5, 1.0, 4.0)),
]

// --- the quadratic --------------------------------------------------------------------------

///|
/// ax² + bx + c = 0, each coefficient in [−20, 20], a never 0.
pub(all) struct Quadratic {
  a : Double
  b : Double
  c : Double
} derive(Eq, Debug, ToJson, FromJson)

///|
/// Coefficients as the sliders make them: halves in [−10, 10], a not 0.
pub impl @quickcheck.Arbitrary for Quadratic with fn arbitrary(_, rs) {
  let pick = () => {
    (rs.next_uint(limit=41).reinterpret_as_int() - 20).to_double() / 2.0
  }
  let mut a = pick()
  while a == 0.0 {
    a = pick()
  }
  { a, b: pick(), c: pick(), }
}

///|
pub(all) enum Kind {
  TwoReal
  Double
  Complex
} derive(Eq, Debug)

///|
pub fn Quadratic::discriminant(self : Quadratic) -> Double {
  self.b * self.b - 4.0 * self.a * self.c
}

///|
pub fn Quadratic::kind(self : Quadratic) -> Kind {
  let d = self.discriminant()
  if d > 0.0 {
    TwoReal
  } else if d == 0.0 {
    Double
  } else {
    Complex
  }
}

///|
pub fn Quadratic::roots(self : Quadratic) -> Array[Double] {
  let d = self.discriminant()
  if d < 0.0 {
    return []
  }
  let r = d.sqrt()
  if d == 0.0 {
    [-self.b / (2.0 * self.a)]
  } else {
    let roots = [(-self.b - r) / (2.0 * self.a), (-self.b + r) / (2.0 * self.a)]
    roots.sort()
    roots
  }
}

///|
pub fn Quadratic::x1(self : Quadratic) -> String {
  fmt(self.roots().get(0).unwrap_or(0.0))
}

///|
pub fn Quadratic::x2(self : Quadratic) -> String {
  fmt(self.roots().get(1).unwrap_or(0.0))
}

///|
pub fn Quadratic::real_part(self : Quadratic) -> String {
  fmt(-self.b / (2.0 * self.a))
}

///|
pub fn Quadratic::imaginary_part(self : Quadratic) -> String {
  abs_text((-self.discriminant()).sqrt() / (2.0 * self.a))
}

///|
fn Quadratic::kind_text(self : Quadratic) -> String {
  match self.kind() {
    TwoReal => "Δ > 0: two real roots, where the parabola crosses the x axis."
    Double => "Δ = 0: one double root, where the parabola touches the x axis."
    Complex =>
      "Δ < 0: two complex conjugate roots; the parabola never meets the x axis."
  }
}

///|
/// The x² term's coefficient, leaving out what reads as nothing.
pub fn Quadratic::a_shown(self : Quadratic) -> String {
  if self.a == 1.0 {
    ""
  } else if self.a == -1.0 {
    "−"
  } else {
    fmt(self.a)
  }
}

///|
/// The x² term's coefficient in a product: (−0.5) in parentheses when negative.
pub fn Quadratic::a_factor(self : Quadratic) -> String {
  factor(self.a)
}

///|
fn sign(n : Double) -> String {
  if n < 0.0 {
    "−"
  } else {
    "+"
  }
}

///|
fn Quadratic::f(self : Quadratic, x : Double) -> Double {
  self.a * x * x + self.b * x + self.c
}

///|
fn clamp40(y : Double) -> Double {
  if y < -40.0 {
    -40.0
  } else if y > 40.0 {
    40.0
  } else {
    y
  }
}

///|
/// `x` with two decimals, as JS's `toFixed(2)`: the cents nearest x's exact value, ties away
/// from zero (x * 100 in doubles can round across a half, e.g. 28.305 is 28.30499…).
fn fixed2(x : Double) -> String {
  let neg = x < 0.0
  let bits = x.abs().reinterpret_as_uint64()
  let exp = ((bits >> 52) & 0x7FFUL).to_int()
  let frac = bits & 0xFFFFFFFFFFFFFUL
  // |x| = m * 2^e.
  let (m, e) = if exp == 0 {
    (frac, -1074)
  } else {
    (frac | (1UL << 52), exp - 1075)
  }
  let big = BigInt::from_uint64(m)
  let exact = if e >= 0 {
    (big << e) * 100N
  } else {
    (big * 200N + (1N << -e)) >> (1 - e)
  }
  let cents = exact.to_int64()
  let text = "\{cents / 100}.\{(cents % 100).to_string().pad_start(2, '0')}"
  // As JS, a negative x keeps its sign even when it rounds to zero (-0 has none).
  if neg {
    "-" + text
  } else {
    text
  }
}

///|
/// The parabola over x in [−10, 10], in plot coordinates (y up, clipped).
pub fn Quadratic::curve(self : Quadratic) -> String {
  let points = []
  for i in 0..<=200 {
    let x = -10.0 + i.to_double() / 10.0
    let y = clamp40(self.f(x))
    points.push("\{if i == 0 { "M" } else { "L" }}\{fixed2(x)} \{fixed2(-y)}")
  }
  points.join(" ")
}

///|
fn Quadratic::root_points(self : Quadratic) -> Array[Double] {
  self.roots().filter(x => x.abs() <= 10.0)
}

///|
fn Quadratic::vertex_x(self : Quadratic) -> Double {
  -self.b / (2.0 * self.a)
}

///|
fn Quadratic::vertex_y(self : Quadratic) -> Double {
  -clamp40(self.f(self.vertex_x()))
}

///|
/// A coefficient of the quadratic, as JS names them: "a", "b", "c".
pub(all) enum Coefficient {
  A
  B
  C
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
pub impl ToJson for Coefficient with fn to_json(self) {
  Json::string(
    match self {
      A => "a"
      B => "b"
      C => "c"
    },
  )
}

///|
pub impl FromJson for Coefficient with fn from_json(json, path) {
  match json {
    String("a") => A
    String("b") => B
    String("c") => C
    _ =>
      raise @json.JsonDecodeError(
        (path, "a coefficient: \"a\", \"b\" or \"c\""),
      )
  }
}

///|
pub(all) enum QuadraticMsg {
  SetCoefficient(Coefficient, String)
  Preset(String)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
fn section(
  title : String,
  childs : Array[View[Quadratic, QuadraticMsg]],
) -> View[Quadratic, QuadraticMsg] {
  div(
    [cls("flex flex-col gap-1")],
    [
      h3([cls("text-xs font-semibold uppercase tracking-wider opacity-60")], [
        txt(title),
      ]),
      ..childs,
    ],
  )
}

///|
fn slider(
  name : String,
  get : (Quadratic) -> Double,
  msg : (String) -> QuadraticMsg,
) -> View[Quadratic, QuadraticMsg] {
  label([cls("flex flex-col gap-1 text-sm")], [
    span([cls("flex justify-between")], [
      span([cls("font-mono")], [txt(name)]),
      span([cls("tabular-nums")], [show(s => fmt(get(s)))]),
    ]),
    input([
      attr("type", "range"),
      attr("min", "-10"),
      attr("max", "10"),
      attr("step", "0.5"),
      cls("range range-sm"),
      aria("label", "Coefficient \{name}"),
      value(s => get(s).to_string()),
      on_input(msg),
    ]),
  ])
}

///|
fn Quadratic::view() -> View[Quadratic, QuadraticMsg] {
  div([cls("flex flex-col gap-4")], [
    div([cls("flex flex-wrap gap-2")], [
      each(
        _ => presets.iter(),
        button(
          [
            cls("btn btn-xs"),
            bind_str("value", it => it.value.0),
            on_event(Click, (it, _) => Some(Preset(it.value.0))),
          ],
          [show(it => it.value.0)],
        ),
      ),
    ]),
    div([cls("grid gap-3 sm:grid-cols-3")], [
      slider("a", s => s.a, v => SetCoefficient(A, v)),
      slider("b", s => s.b, v => SetCoefficient(B, v)),
      slider("c", s => s.c, v => SetCoefficient(C, v)),
    ]),
    div([cls("grid gap-4 lg:grid-cols-2")], [
      div([cls("flex flex-col gap-4 text-lg")], [
        section("The equation", [
          math_block([
            mrow([
              mrow([mn_(s => s.a_shown()), msup(mi("x"), mn("2"))]),
              when(
                s => s.b != 0.0,
                mrow([
                  mo_(s => sign(s.b)),
                  mn_(s => if s.b.abs() == 1.0 { "" } else { abs_text(s.b) }),
                  mi("x"),
                ]),
              ),
              when(
                s => s.c != 0.0,
                mrow([mo_(s => sign(s.c)), mn_(s => abs_text(s.c))]),
              ),
              mo("="),
              mn("0"),
            ]),
          ]),
        ]),
        section("The quadratic formula, with these coefficients", [
          math_block([
            mrow([
              mi("x"),
              mo("="),
              mfrac(
                mrow([
                  mo("−"),
                  mi("b"),
                  mo("±"),
                  msqrt(
                    mrow([
                      msup(mi("b"), mn("2")),
                      mo("−"),
                      mn("4"),
                      mi("a"),
                      mi("c"),
                    ]),
                  ),
                ]),
                mrow([mn("2"), mi("a")]),
              ),
              mo("="),
              mfrac(
                mrow([
                  mn_(s => fmt(-s.b)),
                  mo("±"),
                  msqrt(
                    mrow([
                      msup(mn_(s => factor(s.b)), mn("2")),
                      mo("−"),
                      mn("4"),
                      mo("·"),
                      mn_(s => s.a_factor()),
                      mo("·"),
                      mn_(s => factor(s.c)),
                    ]),
                  ),
                ]),
                mn_(s => fmt(2.0 * s.a)),
              ),
            ]),
          ]),
        ]),
        section("The discriminant", [
          math_block([
            mrow([
              mi("Δ"),
              mo("="),
              msup(mi("b"), mn("2")),
              mo("−"),
              mn("4"),
              mi("a"),
              mi("c"),
              mo("="),
              mn_(s => fmt(s.discriminant())),
            ]),
          ]),
          p([cls("text-sm opacity-70")], [show(s => s.kind_text())]),
        ]),
        section("The roots", [
          if_(
            s => s.kind() is TwoReal,
            math_block([
              mrow([
                msub(mi("x"), mn("1")),
                mo("="),
                mn_(s => s.x1()),
                mo(","),
                mspace(),
                msub(mi("x"), mn("2")),
                mo("="),
                mn_(s => s.x2()),
              ]),
            ]),
            if_(
              s => s.kind() is Double,
              math_block([mrow([mi("x"), mo("="), mn_(s => s.x1())])]),
              math_block([
                mrow([
                  mi("x"),
                  mo("="),
                  mn_(s => s.real_part()),
                  mo("±"),
                  mn_(s => s.imaginary_part()),
                  mi("i"),
                ]),
              ]),
            ),
          ),
        ]),
      ]),
      @tutuca.h(
        "svg",
        [
          attr("viewBox", "-10.5 -10.5 21 21"),
          cls("w-full max-w-md rounded border border-base-300 bg-base-100"),
          attr("role", "img"),
          aria("label", "Plot of the parabola"),
        ],
        [
          @tutuca.h(
            "g",
            [
              attr("stroke", "currentColor"),
              attr("stroke-opacity", "0.15"),
              attr("stroke-width", "0.05"),
            ],
            [-10, -5, 5, 10]
            .map(v => [svg_line(v, -10, v, 10), svg_line(-10, v, 10, v)])
            .flatten(),
          ),
          @tutuca.h(
            "g",
            [
              attr("stroke", "currentColor"),
              attr("stroke-opacity", "0.5"),
              attr("stroke-width", "0.06"),
            ],
            [svg_line(-10, 0, 10, 0), svg_line(0, -10, 0, 10)],
          ),
          @tutuca.h(
            "path",
            [
              bind_str("d", s => s.curve()),
              attr("fill", "none"),
              attr("stroke", "#3f48cc"),
              attr("stroke-width", "0.15"),
              attr("stroke-linejoin", "round"),
            ],
            [],
          ),
          @tutuca.h(
            "circle",
            [
              bind_str("cx", s => s.vertex_x().to_string()),
              bind_str("cy", s => s.vertex_y().to_string()),
              attr("r", "0.25"),
              attr("fill", "#a349a4"),
            ],
            [],
          ),
          each(
            s => s.root_points().iter(),
            @tutuca.h(
              "circle",
              [
                bind_str("cx", it => it.value.to_string()),
                attr("cy", "0"),
                attr("r", "0.35"),
                attr("fill", "#ed1c24"),
              ],
              [],
            ),
          ),
        ],
      ),
    ]),
  ])
}

///|
/// A coefficient from a slider's text: in [−20, 20], and for `a` not 0, which would make it
/// not a quadratic any more.
fn coefficient(text : String, can_be_zero : Bool) -> Double? {
  let n = @string.parse_double(text) catch { _ => return None }
  if !n.is_nan() && n >= -20.0 && n <= 20.0 && (can_be_zero || n != 0.0) {
    Some(n)
  } else {
    None
  }
}

///|
pub let quadratic : Component[Quadratic, QuadraticMsg] = component(
  "Quadratic",
  fields=[
    @tutuca.field_info(
      "a",
      Number,
      constraints=[AtLeast(-20), AtMost(20), Where("notZero")],
      initial=1,
      checks=["a is not 0", "coefficients are in [−20, 20]"],
    ),
    @tutuca.field_info(
      "b",
      Number,
      constraints=[AtLeast(-20), AtMost(20)],
      initial=0,
      checks=["coefficients are in [−20, 20]"],
    ),
    @tutuca.field_info(
      "c",
      Number,
      constraints=[AtLeast(-20), AtMost(20)],
      initial=0,
      checks=["coefficients are in [−20, 20]"],
    ),
  ],
  messages=@tutuca.json_messages(["SetCoefficient", "Preset"]),
  view=Quadratic::view,
  update=(s, msg, _) => {
    match msg {
      SetCoefficient(A, t) =>
        coefficient(t, false).map(a => { ..s, a, }).unwrap_or(s)
      SetCoefficient(B, t) =>
        coefficient(t, true).map(b => { ..s, b, }).unwrap_or(s)
      SetCoefficient(C, t) =>
        coefficient(t, true).map(c => { ..s, c, }).unwrap_or(s)
      Preset(name) =>
        match presets.iter().find_first(p => p.0 == name) {
          Some((_, (a, b, c))) => { a, b, c, }
          None => s
        }
    }
  },
  invariants=[
    ("a is not 0", s => s.a != 0.0),
    (
      "coefficients are in [−20, 20]",
      s => [s.a, s.b, s.c].iter().all(n => n >= -20.0 && n <= 20.0),
    ),
  ],
)

// --- the matrix ------------------------------------------------------------------------------

///|
/// A 2×2 matrix of integers in [−9, 9].
pub(all) struct Matrix2 {
  a : Int32
  b : Int32
  c : Int32
  d : Int32
} derive(Eq, Debug, ToJson, FromJson)

///|
pub impl Default for Matrix2 with fn default() {
  { a: 2, b: 1, c: 1, d: 3, }
}

///|
pub impl @quickcheck.Arbitrary for Matrix2 with fn arbitrary(_, rs) {
  let pick = () => rs.next_uint(limit=19).reinterpret_as_int() - 9
  { a: pick(), b: pick(), c: pick(), d: pick(), }
}

///|
pub fn Matrix2::det(self : Matrix2) -> Int32 {
  self.a * self.d - self.b * self.c
}

///|
fn ifactor(n : Int32) -> String {
  factor(n.to_double())
}

///|
pub(all) enum Entry {
  A
  B
  C
  D
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS names the entries: "a", "b", "c", "d".
pub impl ToJson for Entry with fn to_json(self) {
  Json::string(
    match self {
      A => "a"
      B => "b"
      C => "c"
      D => "d"
    },
  )
}

///|
pub impl FromJson for Entry with fn from_json(json, path) {
  match json {
    String("a") => A
    String("b") => B
    String("c") => C
    String("d") => D
    _ =>
      raise @json.JsonDecodeError(
        (path, "an entry: \"a\", \"b\", \"c\" or \"d\""),
      )
  }
}

///|
pub(all) enum Matrix2Msg {
  SetEntry(Entry, String)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
fn imn(f : (Matrix2) -> Int32) -> View[Matrix2, Matrix2Msg] {
  mn_(m => fmt(f(m).to_double()))
}

///|
fn matrix_view(
  rows : Array[Array[(Matrix2) -> Int32]],
) -> View[Matrix2, Matrix2Msg] {
  mrow([
    mo("("),
    el("mtable", rows.map(row => el("mtr", row.map(f => el("mtd", [imn(f)]))))),
    mo(")"),
  ])
}

///|
fn entry_input(
  name : String,
  entry : Entry,
  get : (Matrix2) -> Int32,
) -> View[Matrix2, Matrix2Msg] {
  input([
    attr("type", "number"),
    attr("min", "-9"),
    attr("max", "9"),
    cls("input input-sm text-center tabular-nums"),
    aria("label", "Entry \{name}"),
    value(m => get(m).to_string()),
    on_input(v => SetEntry(entry, v)),
  ])
}

///|
fn Matrix2::view() -> View[Matrix2, Matrix2Msg] {
  div([cls("flex flex-col gap-4")], [
    div([cls("grid w-32 grid-cols-2 gap-1")], [
      entry_input("a", A, m => m.a),
      entry_input("b", B, m => m.b),
      entry_input("c", C, m => m.c),
      entry_input("d", D, m => m.d),
    ]),
    math_block([
      mrow([
        mi("A"),
        mo("="),
        matrix_view([[m => m.a, m => m.b], [m => m.c, m => m.d]]),
      ]),
    ]),
    math_block([
      mrow([
        mo("det"),
        mi("A"),
        mo("="),
        mi("a"),
        mi("d"),
        mo("−"),
        mi("b"),
        mi("c"),
        mo("="),
        el("mtext", [
          show(m => {
            "\{ifactor(m.a)}·\{ifactor(m.d)} − \{ifactor(m.b)}·\{ifactor(m.c)}"
          }),
        ]),
        mo("="),
        imn(m => m.det()),
      ]),
    ]),
    if_(
      m => m.det() != 0,
      math_block([
        mrow([
          msup(mi("A"), mrow([mo("−"), mn("1")])),
          mo("="),
          mfrac(mn("1"), imn(m => m.det())),
          matrix_view([[m => m.d, m => -m.b], [m => -m.c, m => m.a]]),
        ]),
      ]),
      p([cls("text-sm text-error")], [
        txt(
          "The determinant is 0, so A has no inverse: its columns are parallel.",
        ),
      ]),
    ),
  ])
}

///|
pub let matrix2 : Component[Matrix2, Matrix2Msg] = component(
  "Matrix2",
  fields=[
    @tutuca.field_info(
      "a",
      Whole,
      constraints=[AtLeast(-9), AtMost(9)],
      initial=2,
      checks=["entries are in [−9, 9]"],
    ),
    @tutuca.field_info(
      "b",
      Whole,
      constraints=[AtLeast(-9), AtMost(9)],
      initial=1,
      checks=["entries are in [−9, 9]"],
    ),
    @tutuca.field_info(
      "c",
      Whole,
      constraints=[AtLeast(-9), AtMost(9)],
      initial=1,
      checks=["entries are in [−9, 9]"],
    ),
    @tutuca.field_info(
      "d",
      Whole,
      constraints=[AtLeast(-9), AtMost(9)],
      initial=3,
      checks=["entries are in [−9, 9]"],
    ),
  ],
  messages=@tutuca.json_messages(["SetEntry"]),
  view=Matrix2::view,
  update=(m, msg, _) => {
    match msg {
      SetEntry(entry, text) =>
        match (@string.parse_int(text) catch { _ => 100 }) {
          n if n >= -9 && n <= 9 =>
            match entry {
              A => { ..m, a: n, }
              B => { ..m, b: n, }
              C => { ..m, c: n, }
              D => { ..m, d: n, }
            }
          _ => m
        }
    }
  },
  invariants=[
    (
      "entries are in [−9, 9]",
      m => [m.a, m.b, m.c, m.d].iter().all(n => n >= -9 && n <= 9),
    ),
  ],
)

// --- the gallery -----------------------------------------------------------------------------

///|
fn card(
  title : String,
  text : String,
  formula : View[Unit, Unit],
) -> View[Unit, Unit] {
  div(
    [
      cls(
        "flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4",
      ),
    ],
    [
      h3([cls("text-sm font-semibold")], [txt(title)]),
      @tutuca.h("math", [attr("display", "block"), cls("text-xl")], [formula]),
      p([cls("text-xs opacity-60")], [txt(text)]),
    ],
  )
}

///|
/// Classic formulas, each with a line about it.
pub let formula_gallery : Component[Unit, Unit] = component("FormulaGallery", view=() => {
  div([cls("grid gap-3 sm:grid-cols-2")], [
    card(
      "Euler's identity",
      "Five constants, three operations.",
      mrow([
        msup(mi("e"), mrow([mi("i"), mi("π")])),
        mo("+"),
        mn("1"),
        mo("="),
        mn("0"),
      ]),
    ),
    card(
      "Pythagoras",
      "The sides of a right triangle.",
      mrow([
        msup(mi("a"), mn("2")),
        mo("+"),
        msup(mi("b"), mn("2")),
        mo("="),
        msup(mi("c"), mn("2")),
      ]),
    ),
    card(
      "The Basel problem",
      "Euler again, in 1734.",
      mrow([
        el("munderover", [
          mo("∑"),
          mrow([mi("n"), mo("="), mn("1")]),
          mi("∞"),
        ]),
        mfrac(mn("1"), msup(mi("n"), mn("2"))),
        mo("="),
        mfrac(msup(mi("π"), mn("2")), mn("6")),
      ]),
    ),
    card(
      "The Gaussian integral",
      "The area under the bell curve.",
      mrow([
        el("msubsup", [mo("∫"), mrow([mo("−"), mi("∞")]), mi("∞")]),
        msup(mi("e"), mrow([mo("−"), msup(mi("x"), mn("2"))])),
        mi("d"),
        mi("x"),
        mo("="),
        msqrt(mi("π")),
      ]),
    ),
    card(
      "The golden ratio",
      "A rectangle that keeps its shape when you cut a square off it.",
      mrow([
        mi("φ"),
        mo("="),
        mfrac(mrow([mn("1"), mo("+"), msqrt(mn("5"))]), mn("2")),
        mo("≈"),
        mn("1.618"),
      ]),
    ),
    card(
      "A derivative",
      "The slope of a curve at a point.",
      mrow([
        mfrac(mi("d"), mrow([mi("d"), mi("x")])),
        msup(mi("x"), mi("n")),
        mo("="),
        mi("n"),
        msup(mi("x"), mrow([mi("n"), mo("−"), mn("1")])),
      ]),
    ),
  ])
})
