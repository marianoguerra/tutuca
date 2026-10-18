// MathML and SVG element builders: h(tag, ..) with the props most of them don't need.

///|
fn[X, S, M] el(
  tag : String,
  childs : Array[@tutuca.ViewAt[X, S, M]],
) -> @tutuca.ViewAt[X, S, M] {
  @tutuca.h(tag, [], childs)
}

///|
fn[X, S, M] math_block(
  childs : Array[@tutuca.ViewAt[X, S, M]],
) -> @tutuca.ViewAt[X, S, M] {
  @tutuca.h("math", [@tutuca.attr("display", "block")], childs)
}

///|
fn[X, S, M] mrow(
  childs : Array[@tutuca.ViewAt[X, S, M]],
) -> @tutuca.ViewAt[X, S, M] {
  el("mrow", childs)
}

///|
fn[X, S, M] mi(text : String) -> @tutuca.ViewAt[X, S, M] {
  el("mi", [@tutuca.txt(text)])
}

///|
fn[X, S, M] mo(text : String) -> @tutuca.ViewAt[X, S, M] {
  el("mo", [@tutuca.txt(text)])
}

///|
fn[X, S, M] mn(text : String) -> @tutuca.ViewAt[X, S, M] {
  el("mn", [@tutuca.txt(text)])
}

///|
/// A number computed from what the view reads.
fn[X, S, M] mn_(f : (X) -> String) -> @tutuca.ViewAt[X, S, M] {
  el("mn", [@tutuca.show(f)])
}

///|
fn[X, S, M] mo_(f : (X) -> String) -> @tutuca.ViewAt[X, S, M] {
  el("mo", [@tutuca.show(f)])
}

///|
fn[X, S, M] msup(
  base : @tutuca.ViewAt[X, S, M],
  sup : @tutuca.ViewAt[X, S, M],
) -> @tutuca.ViewAt[X, S, M] {
  el("msup", [base, sup])
}

///|
fn[X, S, M] msub(
  base : @tutuca.ViewAt[X, S, M],
  sub : @tutuca.ViewAt[X, S, M],
) -> @tutuca.ViewAt[X, S, M] {
  el("msub", [base, sub])
}

///|
fn[X, S, M] mfrac(
  num : @tutuca.ViewAt[X, S, M],
  den : @tutuca.ViewAt[X, S, M],
) -> @tutuca.ViewAt[X, S, M] {
  el("mfrac", [num, den])
}

///|
fn[X, S, M] msqrt(body : @tutuca.ViewAt[X, S, M]) -> @tutuca.ViewAt[X, S, M] {
  el("msqrt", [body])
}

///|
fn[X, S, M] mspace() -> @tutuca.ViewAt[X, S, M] {
  @tutuca.h("mspace", [@tutuca.attr("width", "1em")], [])
}

///|
fn[X, S, M] svg_line(
  x1 : Int32,
  y1 : Int32,
  x2 : Int32,
  y2 : Int32,
) -> @tutuca.ViewAt[X, S, M] {
  @tutuca.h(
    "line",
    [
      @tutuca.attr("x1", x1.to_string()),
      @tutuca.attr("y1", y1.to_string()),
      @tutuca.attr("x2", x2.to_string()),
      @tutuca.attr("y2", y2.to_string()),
    ],
    [],
  )
}
