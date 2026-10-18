///|
/// A DOM node (or the document, or an event), as the externref it is.
#external
pub type JsNode

///|
extern "wasm" fn is_null(n : JsNode) -> Bool = "tdom" "is_null"

///|
fn opt(n : JsNode) -> JsNode? {
  if is_null(n) {
    None
  } else {
    Some(n)
  }
}

///|
pub extern "wasm" fn document() -> JsNode = "tdom" "document"

///|
extern "wasm" fn query_ffi(selector : String) -> JsNode = "tdom" "query"

///|
/// The first element matching `selector` in the document.
pub fn query(selector : String) -> JsNode? {
  opt(query_ffi(selector))
}

///|
extern "wasm" fn create_element_ffi(
  doc : JsNode,
  tag : String,
  ns : String,
  is_attr : String,
) -> JsNode = "tdom" "create_element"

///|
extern "wasm" fn create_text_ffi(doc : JsNode, s : String) -> JsNode = "tdom" "create_text"

///|
extern "wasm" fn create_comment_ffi(doc : JsNode, s : String) -> JsNode = "tdom" "create_comment"

///|
extern "wasm" fn create_fragment_ffi(doc : JsNode) -> JsNode = "tdom" "create_fragment"

///|
extern "wasm" fn append_child_ffi(parent : JsNode, child : JsNode) -> Unit = "tdom" "append_child"

///|
extern "wasm" fn insert_before_ffi(
  parent : JsNode,
  node : JsNode,
  before : JsNode,
) -> Unit = "tdom" "insert_before"

///|
extern "wasm" fn null_node() -> JsNode = "tdom" "null"

///|
extern "wasm" fn remove_child_ffi(parent : JsNode, child : JsNode) -> Unit = "tdom" "remove_child"

///|
extern "wasm" fn replace_child_ffi(
  parent : JsNode,
  node : JsNode,
  old : JsNode,
) -> Unit = "tdom" "replace_child"

///|
extern "wasm" fn replace_children_ffi(node : JsNode) -> Unit = "tdom" "replace_children"

///|
extern "wasm" fn parent_node_ffi(node : JsNode) -> JsNode = "tdom" "parent_node"

///|
extern "wasm" fn first_child_ffi(node : JsNode) -> JsNode = "tdom" "first_child"

///|
extern "wasm" fn next_sibling_ffi(node : JsNode) -> JsNode = "tdom" "next_sibling"

///|
extern "wasm" fn same_ffi(a : JsNode, b : JsNode) -> Bool = "tdom" "same"

///|
extern "wasm" fn set_attribute_ffi(
  node : JsNode,
  name : String,
  value : String,
) -> Unit = "tdom" "set_attribute"

///|
extern "wasm" fn remove_attribute_ffi(node : JsNode, name : String) -> Unit = "tdom" "remove_attribute"

///|
extern "wasm" fn has_attribute_ffi(node : JsNode, name : String) -> Bool = "tdom" "has_attribute"

///|
extern "wasm" fn get_attribute_ffi(node : JsNode, name : String) -> String = "tdom" "get_attribute"

///|
extern "wasm" fn has_property_ffi(node : JsNode, name : String) -> Bool = "tdom" "has_property"

///|
extern "wasm" fn set_str_prop_ffi(
  node : JsNode,
  name : String,
  value : String,
) -> Bool = "tdom" "set_str_prop"

///|
extern "wasm" fn set_num_prop_ffi(
  node : JsNode,
  name : String,
  value : Double,
) -> Bool = "tdom" "set_num_prop"

///|
extern "wasm" fn set_bool_prop_ffi(
  node : JsNode,
  name : String,
  value : Bool,
) -> Bool = "tdom" "set_bool_prop"

///|
extern "wasm" fn set_null_prop_ffi(node : JsNode, name : String) -> Bool = "tdom" "set_null_prop"

///|
extern "wasm" fn get_inner_html_ffi(node : JsNode) -> String = "tdom" "get_inner_html"

///|
extern "wasm" fn set_inner_html_ffi(node : JsNode, html : String) -> Unit = "tdom" "set_inner_html"

///|
extern "wasm" fn set_data_ffi(node : JsNode, s : String) -> Unit = "tdom" "set_data"

///|
extern "wasm" fn get_data_ffi(node : JsNode) -> String = "tdom" "get_data"

///|
extern "wasm" fn tag_name_ffi(node : JsNode) -> String = "tdom" "tag_name"

///|
extern "wasm" fn namespace_ffi(node : JsNode) -> String = "tdom" "namespace"

///|
extern "wasm" fn value_ffi(node : JsNode) -> String = "tdom" "value"

///|
extern "wasm" fn checked_ffi(node : JsNode) -> Bool = "tdom" "checked"

///|
pub impl @vdom.DomNode for JsNode with fn create_element(self, tag, ns, is_attr) {
  create_element_ffi(self, tag, ns.unwrap_or(""), is_attr.unwrap_or(""))
}

///|
pub impl @vdom.DomNode for JsNode with fn create_text(self, s) {
  create_text_ffi(self, s)
}

///|
pub impl @vdom.DomNode for JsNode with fn create_comment(self, s) {
  create_comment_ffi(self, s)
}

///|
pub impl @vdom.DomNode for JsNode with fn create_fragment(self) {
  create_fragment_ffi(self)
}

///|
pub impl @vdom.DomNode for JsNode with fn append_child(self, child) {
  append_child_ffi(self, child)
}

///|
pub impl @vdom.DomNode for JsNode with fn insert_before(self, node, ref_node) {
  insert_before_ffi(self, node, ref_node.unwrap_or(null_node()))
}

///|
pub impl @vdom.DomNode for JsNode with fn remove_child(self, child) {
  remove_child_ffi(self, child)
}

///|
pub impl @vdom.DomNode for JsNode with fn replace_child(self, node, old) {
  replace_child_ffi(self, node, old)
}

///|
pub impl @vdom.DomNode for JsNode with fn replace_children(self) {
  replace_children_ffi(self)
}

///|
pub impl @vdom.DomNode for JsNode with fn parent_node(self) {
  opt(parent_node_ffi(self))
}

///|
pub impl @vdom.DomNode for JsNode with fn next_sibling(self) {
  opt(next_sibling_ffi(self))
}

///|
pub impl @vdom.DomNode for JsNode with fn child_nodes(self) {
  let out = []
  let mut at = opt(first_child_ffi(self))
  while at is Some(n) {
    out.push(n)
    at = opt(next_sibling_ffi(n))
  }
  out
}

///|
pub impl @vdom.DomNode for JsNode with fn is_same_node(self, other) {
  same_ffi(self, other)
}

///|
pub impl @vdom.DomNode for JsNode with fn set_attribute(self, name, value) {
  set_attribute_ffi(self, name, value)
}

///|
pub impl @vdom.DomNode for JsNode with fn remove_attribute(self, name) {
  remove_attribute_ffi(self, name)
}

///|
pub impl @vdom.DomNode for JsNode with fn get_attribute(self, name) {
  if has_attribute_ffi(self, name) {
    Some(get_attribute_ffi(self, name))
  } else {
    None
  }
}

///|
pub impl @vdom.DomNode for JsNode with fn get_value(self) {
  value_ffi(self)
}

///|
pub impl @vdom.DomNode for JsNode with fn get_checked(self) {
  checked_ffi(self)
}

///|
pub impl @vdom.DomNode for JsNode with fn has_property(self, name) {
  has_property_ffi(self, name)
}

///|
pub impl @vdom.DomNode for JsNode with fn set_property(self, name, value) {
  match value {
    Absent => set_null_prop_ffi(self, name)
    Str(s) | Html(s) => set_str_prop_ffi(self, name, s)
    Num(d) => set_num_prop_ffi(self, name, d)
    Bool(b) => set_bool_prop_ffi(self, name, b)
  }
}

///|
pub impl @vdom.DomNode for JsNode with fn get_inner_html(self) {
  get_inner_html_ffi(self)
}

///|
pub impl @vdom.DomNode for JsNode with fn set_inner_html(self, html) {
  set_inner_html_ffi(self, html)
}

///|
pub impl @vdom.DomNode for JsNode with fn set_data(self, s) {
  set_data_ffi(self, s)
}

///|
pub impl @vdom.DomNode for JsNode with fn get_data(self) {
  get_data_ffi(self)
}

///|
pub impl @vdom.DomNode for JsNode with fn tag_name(self) {
  tag_name_ffi(self)
}

///|
pub impl @vdom.DomNode for JsNode with fn namespace_uri(self) {
  match namespace_ffi(self) {
    "" => None
    ns if ns == @vdom.html_ns => None
    ns => Some(ns)
  }
}
