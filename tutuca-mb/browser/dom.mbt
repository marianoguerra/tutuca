///|
/// A DOM node (or the document), as the JS value it is.
#external
pub type JsNode

///|
extern "js" fn is_null(n : JsNode) -> Bool =
  #|(n) => n === null || n === undefined

///|
fn opt(n : JsNode) -> JsNode? {
  if is_null(n) {
    None
  } else {
    Some(n)
  }
}

///|
pub extern "js" fn document() -> JsNode =
  #|() => globalThis.document

///|
/// The first element matching `selector` in the document.
pub fn query(selector : String) -> JsNode? {
  opt(query_ffi(document(), selector))
}

///|
extern "js" fn query_ffi(doc : JsNode, selector : String) -> JsNode =
  #|(doc, selector) => doc.querySelector(selector)

///|
extern "js" fn create_element_ffi(doc : JsNode, tag : String) -> JsNode =
  #|(doc, tag) => doc.createElement(tag)

///|
extern "js" fn create_element_is_ffi(
  doc : JsNode,
  tag : String,
  is_attr : String,
) -> JsNode =
  #|(doc, tag, is) => doc.createElement(tag, { is })

///|
extern "js" fn create_element_ns_ffi(
  doc : JsNode,
  ns : String,
  tag : String,
) -> JsNode =
  #|(doc, ns, tag) => doc.createElementNS(ns, tag)

///|
extern "js" fn create_element_ns_is_ffi(
  doc : JsNode,
  ns : String,
  tag : String,
  is_attr : String,
) -> JsNode =
  #|(doc, ns, tag, is) => doc.createElementNS(ns, tag, { is })

///|
extern "js" fn create_text_ffi(doc : JsNode, s : String) -> JsNode =
  #|(doc, s) => doc.createTextNode(s)

///|
extern "js" fn create_comment_ffi(doc : JsNode, s : String) -> JsNode =
  #|(doc, s) => doc.createComment(s)

///|
extern "js" fn create_fragment_ffi(doc : JsNode) -> JsNode =
  #|(doc) => doc.createDocumentFragment()

///|
extern "js" fn append_child_ffi(parent : JsNode, child : JsNode) -> Unit =
  #|(parent, child) => { parent.appendChild(child); }

///|
extern "js" fn insert_before_ffi(
  parent : JsNode,
  node : JsNode,
  before : JsNode,
) -> Unit =
  #|(parent, node, ref) => { parent.insertBefore(node, ref ?? null); }

///|
extern "js" fn null_node() -> JsNode =
  #|() => null

///|
extern "js" fn remove_child_ffi(parent : JsNode, child : JsNode) -> Unit =
  #|(parent, child) => { parent.removeChild(child); }

///|
extern "js" fn replace_child_ffi(
  parent : JsNode,
  node : JsNode,
  old : JsNode,
) -> Unit =
  #|(parent, node, old) => { parent.replaceChild(node, old); }

///|
extern "js" fn replace_children_ffi(node : JsNode) -> Unit =
  #|(node) => { node.replaceChildren(); }

///|
extern "js" fn parent_node_ffi(node : JsNode) -> JsNode =
  #|(node) => node.parentNode

///|
extern "js" fn first_child_ffi(node : JsNode) -> JsNode =
  #|(node) => node.firstChild

///|
extern "js" fn next_sibling_ffi(node : JsNode) -> JsNode =
  #|(node) => node.nextSibling

///|
extern "js" fn same_ffi(a : JsNode, b : JsNode) -> Bool =
  #|(a, b) => a === b

///|
extern "js" fn set_attribute_ffi(
  node : JsNode,
  name : String,
  value : String,
) -> Unit =
  #|(node, name, value) => { node.setAttribute(name, value); }

///|
extern "js" fn remove_attribute_ffi(node : JsNode, name : String) -> Unit =
  #|(node, name) => { node.removeAttribute(name); }

///|
extern "js" fn has_attribute_ffi(node : JsNode, name : String) -> Bool =
  #|(node, name) => typeof node.hasAttribute === "function" && node.hasAttribute(name)

///|
extern "js" fn get_attribute_ffi(node : JsNode, name : String) -> String =
  #|(node, name) => node.getAttribute(name)

///|
extern "js" fn has_property_ffi(node : JsNode, name : String) -> Bool =
  #|(node, name) => name in node

///|
extern "js" fn set_str_prop_ffi(
  node : JsNode,
  name : String,
  value : String,
) -> Bool =
  #|(node, name, value) => { try { node[name] = value; return true; } catch { return false; } }

///|
extern "js" fn set_num_prop_ffi(
  node : JsNode,
  name : String,
  value : Double,
) -> Bool =
  #|(node, name, value) => { try { node[name] = value; return true; } catch { return false; } }

///|
extern "js" fn set_bool_prop_ffi(
  node : JsNode,
  name : String,
  value : Bool,
) -> Bool =
  #|(node, name, value) => { try { node[name] = value; return true; } catch { return false; } }

///|
extern "js" fn set_null_prop_ffi(node : JsNode, name : String) -> Bool =
  #|(node, name) => { try { node[name] = null; return true; } catch { return false; } }

///|
extern "js" fn get_inner_html_ffi(node : JsNode) -> String =
  #|(node) => node.innerHTML

///|
extern "js" fn set_inner_html_ffi(node : JsNode, html : String) -> Unit =
  #|(node, html) => { node.innerHTML = html; }

///|
extern "js" fn set_data_ffi(node : JsNode, s : String) -> Unit =
  #|(node, s) => { node.data = s; }

///|
extern "js" fn get_data_ffi(node : JsNode) -> String =
  #|(node) => node.nodeType === 3 || node.nodeType === 8 ? node.data : ""

///|
extern "js" fn tag_name_ffi(node : JsNode) -> String =
  #|(node) => node.tagName ?? ""

///|
extern "js" fn namespace_ffi(node : JsNode) -> String =
  #|(node) => node.namespaceURI ?? ""

///|
extern "js" fn value_ffi(node : JsNode) -> String =
  #|(node) => { const v = node.value; return v === undefined || v === null ? "" : String(v); }

///|
extern "js" fn checked_ffi(node : JsNode) -> Bool =
  #|(node) => Boolean(node.checked)

///|
pub impl @vdom.DomNode for JsNode with fn create_element(self, tag, ns, is_attr) {
  match (ns, is_attr) {
    (None, None) => create_element_ffi(self, tag)
    (None, Some(i)) => create_element_is_ffi(self, tag, i)
    (Some(n), None) => create_element_ns_ffi(self, n, tag)
    (Some(n), Some(i)) => create_element_ns_is_ffi(self, n, tag, i)
  }
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
