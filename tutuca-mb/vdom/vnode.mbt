///|
pub let html_ns : String = "http://www.w3.org/1999/xhtml"

///|
pub let svg_ns : String = "http://www.w3.org/2000/svg"

///|
pub let math_ns : String = "http://www.w3.org/1998/Math/MathML"

///|
/// The value of an attribute. `Absent` is JS null/undefined: it removes the attribute, and a
/// `value` or `checked` that is `Absent` is left alone. `Html` is the markup of
/// `dangerouslySetInnerHTML`.
pub(all) enum AttrValue {
  Absent
  Str(String)
  Num(Double)
  Bool(Bool)
  Html(String)
} derive(Eq, Debug)

///|
pub extend AttrValue with Eq::{equal, not_equal}

///|
pub extend AttrValue with Debug::{to_repr}

///|
/// What `setAttribute` writes: JS string coercion.
pub fn AttrValue::to_attr_string(self : AttrValue) -> String {
  match self {
    Absent => ""
    Str(s) | Html(s) => s
    Num(d) => d.to_string()
    Bool(b) => b.to_string()
  }
}

///|
let dynamic_only : Array[String] = [
  "value", "checked", "is", "dangerouslySetInnerHTML",
]

///|
/// What every render of one template shares: tag, ns, the attrs that never change and
/// the names of the ones that do. Same-shape vnodes diff by index; different shapes replace.
pub struct Shape {
  tag : String
  ns : String?
  static_attrs : Array[(String, AttrValue)] // Set when the element is created, never diffed.
  names : Array[String]
  value_idx : Int32
  checked_idx : Int32
  is_idx : Int32
  html_idx : Int32
}

///|
pub suberror ShapeError {
  ShapeError(String)
}

///|
pub fn Shape::new(
  tag : String,
  ns? : String,
  static_attrs~ : Array[(String, AttrValue)] = [],
  names~ : Array[String] = [],
) -> Shape raise ShapeError {
  let (tag, ns) = match ns {
    Some(_) => (tag, ns)
    None =>
      match tag.to_lower() {
        "svg" => ("svg", Some(svg_ns))
        "math" => ("math", Some(math_ns))
        _ => (tag, None)
      }
  }
  for name in dynamic_only {
    if static_attrs.iter().any(a => a.0 == name) {
      raise ShapeError("\{name} must be a dynamic attr")
    }
  }
  let idx = (name : String) => names.search(name).unwrap_or(-1)
  {
    tag,
    ns,
    static_attrs,
    names,
    value_idx: idx("value"),
    checked_idx: idx("checked"),
    is_idx: idx("is"),
    html_idx: idx("dangerouslySetInnerHTML"),
  }
}

///|
/// A normalized vnode. Children are always a flat array; a `Fragment` is a virtual boundary
/// that creates no DOM node of its own.
pub(all) enum VNode {
  Text(String)
  Comment(String)
  Elem(VElem)
  Fragment(VFragment)
}

///|
pub struct VElem {
  shape : Shape
  values : Array[AttrValue] // Aligned with shape.names.
  childs : Array[VNode]
  key : String?
}

///|
pub struct VFragment {
  childs : Array[VNode]
  key : String?
}

///|
pub fn VNode::elem(
  shape : Shape,
  values : Array[AttrValue],
  childs : Array[VNode],
  key? : String,
) -> VNode {
  Elem({ shape, values, childs, key, })
}

///|
pub fn VNode::fragment(childs : Array[VNode], key? : String) -> VNode {
  Fragment({ childs, key, })
}

///|
pub fn VNode::key(self : VNode) -> String? {
  match self {
    Elem(e) => e.key
    Fragment(f) => f.key
    Text(_) | Comment(_) => None
  }
}

///|
/// All attrs by name, for tools; rendering reads shape and values directly.
pub fn VElem::attrs(self : VElem) -> Array[(String, AttrValue)] {
  let attrs = self.shape.static_attrs.copy()
  for i, name in self.shape.names {
    attrs.push((name, self.values[i]))
  }
  attrs
}

///|
pub fn VElem::is_same_kind(self : VElem, other : VElem) -> Bool {
  physical_equal(self.shape, other.shape) && self.key == other.key
}

///|
/// A pure vnode walk: much cheaper than morphing, which has to read the DOM at every element.
pub fn VNode::is_equal_to(self : VNode, other : VNode) -> Bool {
  if physical_equal(self, other) {
    return true
  }
  match (self, other) {
    (Text(a), Text(b)) | (Comment(a), Comment(b)) => a == b
    (Elem(a), Elem(b)) =>
      a.is_same_kind(b) &&
      a.values == b.values &&
      childs_equal(a.childs, b.childs)
    (Fragment(a), Fragment(b)) =>
      a.key == b.key && childs_equal(a.childs, b.childs)
    _ => false
  }
}

///|
fn childs_equal(a : Array[VNode], b : Array[VNode]) -> Bool {
  if a.length() != b.length() {
    return false
  }
  for i in 0..<a.length() {
    if !a[i].is_equal_to(b[i]) {
      return false
    }
  }
  true
}

///|
/// A fragment contributes the sum of its children's DOM widths, including zero.
fn VNode::dom_width(self : VNode) -> Int32 {
  match self {
    Fragment(f) => f.childs.fold(init=0, (n, c) => n + c.dom_width())
    _ => 1
  }
}
