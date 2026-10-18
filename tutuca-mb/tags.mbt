// Element builders for common tags; h(tag, ..) covers the rest.

///|
pub fn[X, S, M] div(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("div", props, childs)
}

///|
pub fn[X, S, M] span(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("span", props, childs)
}

///|
pub fn[X, S, M] p(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("p", props, childs)
}

///|
pub fn[X, S, M] a(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("a", props, childs)
}

///|
/// A button that doesn't submit: `type="button"` unless props set a type.
pub fn[X, S, M] button(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  let typed = props.iter().any(p => p is (Static("type", _) | Dyn("type", _)))
  Elem(
    "button",
    if typed {
      props
    } else {
      [attr("type", "button"), ..props]
    },
    childs,
  )
}

///|
pub fn[X, S, M] input(props : Array[Prop[X, M]]) -> ViewAt[X, S, M] {
  Elem("input", props, [])
}

///|
pub fn[X, S, M] textarea(props : Array[Prop[X, M]]) -> ViewAt[X, S, M] {
  Elem("textarea", props, [])
}

///|
pub fn[X, S, M] select(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("select", props, childs)
}

///|
pub fn[X, S, M] option(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("option", props, childs)
}

///|
pub fn[X, S, M] form(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("form", props, childs)
}

///|
pub fn[X, S, M] label(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("label", props, childs)
}

///|
pub fn[X, S, M] ul(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("ul", props, childs)
}

///|
pub fn[X, S, M] ol(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("ol", props, childs)
}

///|
pub fn[X, S, M] li(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("li", props, childs)
}

///|
pub fn[X, S, M] h1(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("h1", props, childs)
}

///|
pub fn[X, S, M] h2(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("h2", props, childs)
}

///|
pub fn[X, S, M] h3(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("h3", props, childs)
}

///|
pub fn[X, S, M] header(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("header", props, childs)
}

///|
pub fn[X, S, M] footer(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("footer", props, childs)
}

///|
pub fn[X, S, M] nav(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("nav", props, childs)
}

///|
pub fn[X, S, M] section(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("section", props, childs)
}

///|
pub fn[X, S, M] main_(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("main", props, childs)
}

///|
pub fn[X, S, M] strong(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("strong", props, childs)
}

///|
pub fn[X, S, M] em(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("em", props, childs)
}

///|
pub fn[X, S, M] small(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("small", props, childs)
}

///|
pub fn[X, S, M] code(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("code", props, childs)
}

///|
pub fn[X, S, M] pre(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("pre", props, childs)
}

///|
pub fn[X, S, M] img(props : Array[Prop[X, M]]) -> ViewAt[X, S, M] {
  Elem("img", props, [])
}

///|
pub fn[X, S, M] table(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("table", props, childs)
}

///|
pub fn[X, S, M] tr(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("tr", props, childs)
}

///|
pub fn[X, S, M] td(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("td", props, childs)
}

///|
pub fn[X, S, M] th(
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem("th", props, childs)
}
