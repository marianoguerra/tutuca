///|
using @storybook {story, send, event, check, css, book, type Book}

///|
using @math {quadratic, matrix2, formula_gallery, workbench, type Quadratic}

///|
fn slider(name : String) -> @storybook.Find {
  css("[aria-label=\"Coefficient \{name}\"]")
}

///|
fn q(a : Double, b : Double, c : Double) -> Quadratic {
  { a, b, c, }
}

///|
/// The math book, for any DOM.
pub fn[N : @vdom.DomNode] math_book() -> Book[N] {
  let messages = [@testing.root_messages()]
  book(
    "Math",
    [
      story(
        "Quadratic/Two roots",
        quadratic,
        () => q(1.0, -3.0, 2.0),
        sequences=[
          (
            "roots 1 and 2",
            [
              check("Δ = 1", s => {
                s.discriminant() == 1.0 && s.kind() is TwoReal
              }),
              check("x₁ = 1, x₂ = 2", s => s.x1() == "1" && s.x2() == "2"),
              check("both marked on the plot", s => s.roots().length() == 2),
            ],
          ),
          (
            "slide b until the roots meet",
            [
              event("input", slider("b"), value="-2"),
              event("input", slider("c"), value="1"),
              check("a double root at 1", s => {
                s.kind() is Double && s.x1() == "1"
              }),
              event("input", slider("c"), value="5"),
              check("then complex: 1 ± 2i", s => {
                s.kind() is Complex &&
                s.real_part() == "1" &&
                s.imaginary_part() == "2"
              }),
              check("and nothing on the axis", s => s.roots().is_empty()),
            ],
          ),
          (
            "a can't be zero",
            [
              send(SetCoefficient(A, "0")),
              check("still quadratic", s => s.a == 1.0),
            ],
          ),
        ],
        targets=messages,
        generate=(rs, size) => @quickcheck.Arbitrary::arbitrary(size, rs),
        max_steps=10,
      ),
      story("Quadratic/Double root", quadratic, () => q(1.0, -4.0, 4.0)),
      story("Quadratic/Complex roots", quadratic, () => q(1.0, 2.0, 5.0), sequences=[
        (
          "−1 ± 2i",
          [
            check("conjugates", s => {
              s.real_part() == "−1" && s.imaginary_part() == "2"
            }),
          ],
        ),
      ]),
      story(
        "Quadratic/Negative coefficients",
        quadratic,
        () => q(-0.5, 1.0, 4.0),
        sequences=[
          (
            "signs read right",
            [
              check("−0.5x²", s => s.a_shown() == "−0.5"),
              check("parenthesized in products", s => s.a_factor() == "(−0.5)"),
              check("roots −2 and 4", s => s.x1() == "−2" && s.x2() == "4"),
            ],
          ),
        ],
      ),
      story(
        "Quadratic/Presets",
        quadratic,
        () => q(1.0, 0.0, 0.0),
        sequences=[
          (
            "each preset",
            [
              event("click", css("button[value=\"complex roots\"]")),
              check("complex", s => s.kind() is Complex),
              event("click", css("button[value=\"double root\"]")),
              check("double", s => s.kind() is Double),
            ],
          ),
        ],
        targets=messages,
        max_steps=10,
      ),
      @storybook.generated_story(
        "Quadratic/Generated",
        quadratic,
        (rs, size) => @quickcheck.Arbitrary::arbitrary(size, rs),
        targets=messages,
      ),
      story(
        "Matrix/Invertible",
        matrix2,
        () => Default::default(),
        sequences=[
          (
            "det 5, then singular",
            [
              check("det = 5", s => s.det() == 5),
              event("input", css("[aria-label=\"Entry d\"]"), value="1"),
              event("input", css("[aria-label=\"Entry a\"]"), value="1"),
              check("det = 0", s => s.det() == 0),
            ],
          ),
        ],
        targets=[@testing.root_messages()],
        max_steps=10,
      ),
      story("Matrix/Singular", matrix2, () => { a: 2, b: 4, c: 1, d: 2, }),
      story("Formula gallery", formula_gallery, () => ()),
    ],
    specs=[
      @storybook.spec(quadratic),
      @storybook.spec(matrix2),
      @storybook.spec(formula_gallery),
    ],
  )
}

///|
/// The workbench has its own book, as the demo puts it together.
pub fn[N : @vdom.DomNode] workbench_book() -> Book[N] {
  book(
    "Math workbench",
    [
      story(
        "Two saved problems",
        workbench,
        () => {
          ..@math.Workbench::new(),
          quadratic: q(1.0, -3.0, 2.0),
          history: @tutuca.Vec::of([
            SavedQuadratic(q(1.0, 2.0, 5.0)),
            SavedMatrix({ a: 2, b: 4, c: 1, d: 2, }),
          ]),
        },
        sequences=[
          (
            "switch tabs",
            [
              check("on the quadratic", s => s.tab is QuadraticTab),
              send(SetTab(MatrixTab)),
              check("on the matrix", s => s.tab is MatrixTab),
            ],
          ),
        ],
        targets=[@testing.root_messages()],
      ),
    ],
    specs=[
      @storybook.spec(quadratic),
      @storybook.spec(matrix2),
      @storybook.spec(formula_gallery),
      @storybook.spec(workbench),
    ],
  )
}
