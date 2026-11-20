// The virtual DOM, as tutuca's src/vdom/index.js: nodes a render gives, made
// into the page's own the first time and changed into the next render's
// after, keyed children moved rather than made again. The page's nodes are
// the host's; every one made here is marked owned, and only those are ever
// touched.

///|
#external
priv type Node

///|
extern "wasm" fn dom_element(
  tag : String,
  ns : String,
  custom : String,
) -> Node = "dom" "element"

///|
extern "wasm" fn dom_text(text : String) -> Node = "dom" "text"

///|
extern "wasm" fn dom_comment(text : String) -> Node = "dom" "comment"

///|
/// A property or attribute of an element, as JavaScript's vdom sets one.
extern "wasm" fn dom_set_prop(
  node : Node,
  name : String,
  value : Val,
  namespaced : Bool,
) = "dom" "set_prop"

///|
/// An element's value, set once its children are there.
extern "wasm" fn dom_apply_value(node : Node, value : Val, namespaced : Bool) = "dom" "apply_value"

///|
extern "wasm" fn dom_set_data(node : Node, text : String) = "dom" "set_data"

///|
extern "wasm" fn dom_append(parent : Node, child : Node) = "dom" "append"

///|
/// Before the owned node at an index of the ones given to hold; the end for -1.
extern "wasm" fn dom_insert_before(
  parent : Node,
  node : Node,
  before : Node,
  at_end : Bool,
) = "dom" "insert_before"

///|
extern "wasm" fn dom_remove(parent : Node, node : Node) = "dom" "remove"

///|
extern "wasm" fn dom_replace(parent : Node, node : Node, old : Node) = "dom" "replace"

///|
extern "wasm" fn dom_parent(node : Node) -> Node = "dom" "parent"

///|
extern "wasm" fn dom_owned_count(parent : Node) -> Int32 = "dom" "owned_count"

///|
extern "wasm" fn dom_owned_child(parent : Node, i : Int32) -> Node = "dom" "owned_child"

///|
/// Whether the next owned sibling of a node is another (or none, at the end).
extern "wasm" fn dom_next_is(node : Node, other : Node, at_end : Bool) -> Bool = "dom" "next_is"

///|
extern "wasm" fn dom_root() -> Node = "dom" "root"

///|
priv struct VElement {
  elem : Elem
  values : Array[Val]
  children : Array[VNode]
  key : String?
}

///|
priv enum VNode {
  VText(String)
  VComment(String)
  VElem(VElement)
  VFragment(Array[VNode], String?)
}

///|
fn VNode::key(self : VNode) -> String? {
  match self {
    VElem(e) => e.key
    VFragment(_, key) => key
    _ => None
  }
}

///|
fn is_same_kind(a : VElement, b : VElement) -> Bool {
  a.elem.id == b.elem.id && a.key == b.key
}

///|
fn children_equal(a : Array[VNode], b : Array[VNode]) -> Bool {
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
fn VNode::is_equal_to(self : VNode, other : VNode) -> Bool {
  match (self, other) {
    (VText(a), VText(b)) | (VComment(a), VComment(b)) => a == b
    (VElem(a), VElem(b)) => {
      if !is_same_kind(a, b) || a.children.length() != b.children.length() {
        return false
      }
      for i in 0..<a.values.length() {
        if !v_same(a.values[i], b.values[i]) {
          return false
        }
      }
      children_equal(a.children, b.children)
    }
    (VFragment(a, ka), VFragment(b, kb)) => ka == kb && children_equal(a, b)
    _ => false
  }
}

///|
let html_ns : String = "http://www.w3.org/1999/xhtml"

///|
let svg_ns : String = "http://www.w3.org/2000/svg"

///|
fn is_namespaced(ns : String?) -> Bool {
  match ns {
    Some(n) => n != html_ns
    None => false
  }
}

///|
/// The namespace an element's children are in: an svg foreignObject's are
/// back in the page's.
fn child_ns(elem : Elem, ns : String?) -> String? {
  if ns == Some(svg_ns) && elem.tag.to_lower() == "foreignobject" {
    None
  } else {
    ns
  }
}

///|
fn index_of(names : Array[String], name : String) -> Int32 {
  for i, n in names {
    if n == name {
      return i
    }
  }
  -1
}

///|
/// The page's nodes of a virtual node: one, or a fragment's children's.
fn to_dom(vnode : VNode, ns : String?, out : Array[Node]) -> Unit {
  match vnode {
    VFragment(children, _) =>
      for c in children {
        to_dom(c, ns, out)
      }
    VText(text) => out.push(dom_text(text))
    VComment(text) => out.push(dom_comment(text))
    VElem(e) => {
      let elem = e.elem
      let el_ns = match elem.space {
        Some(n) => Some(n)
        None => ns
      }
      let value_at = index_of(elem.names, "value")
      let checked_at = index_of(elem.names, "checked")
      let is_at = index_of(elem.names, "is")
      let custom = if is_at >= 0 && kind(e.values[is_at]) is Str {
        v_str_of(e.values[is_at])
      } else {
        ""
      }
      let node = dom_element(elem.tag, el_ns.unwrap_or(""), custom)
      let namespaced = is_namespaced(el_ns)
      for s in elem.statics {
        dom_set_prop(node, s.0, s.1, namespaced)
      }
      for i, name in elem.names {
        if i != value_at && i != checked_at {
          dom_set_prop(node, name, e.values[i], namespaced)
        }
      }
      let kids = []
      for c in e.children {
        to_dom(c, child_ns(elem, el_ns), kids)
      }
      for k in kids {
        dom_append(node, k)
      }
      if value_at >= 0 && !is_undefined(e.values[value_at]) {
        dom_apply_value(node, e.values[value_at], namespaced)
      }
      if checked_at >= 0 && !is_undefined(e.values[checked_at]) {
        dom_set_prop(node, "checked", e.values[checked_at], false)
      }
      out.push(node)
    }
  }
}

///|
fn morph_node(
  node : Node,
  source : VNode,
  target : VNode,
  ns : String?,
) -> Node {
  if source.is_equal_to(target) {
    return node
  }
  match (source, target) {
    (VText(_), VText(text)) | (VComment(_), VComment(text)) => {
      dom_set_data(node, text)
      return node
    }
    (VElem(a), VElem(b)) if is_same_kind(a, b) => {
      let elem = b.elem
      let el_ns = match elem.space {
        Some(n) => Some(n)
        None => ns
      }
      let namespaced = is_namespaced(el_ns)
      let value_at = index_of(elem.names, "value")
      let checked_at = index_of(elem.names, "checked")
      let html_at = index_of(elem.names, "dangerouslySetInnerHTML")
      for i, name in elem.names {
        if i != value_at && i != checked_at && !v_same(a.values[i], b.values[i]) {
          dom_set_prop(node, name, b.values[i], namespaced)
        }
      }
      if html_at < 0 || !truthy(b.values[html_at]) {
        ignore(
          morph_children(
            node,
            a.children,
            b.children,
            child_ns(elem, el_ns),
            None,
            None,
          ),
        )
      }
      if value_at >= 0 {
        let reselect = elem.tag.to_upper() == "SELECT" &&
          !is_undefined(b.values[value_at])
        if !v_same(a.values[value_at], b.values[value_at]) || reselect {
          dom_apply_value(node, b.values[value_at], namespaced)
        }
      }
      if checked_at >= 0 && !v_same(a.values[checked_at], b.values[checked_at]) {
        dom_set_prop(node, "checked", b.values[checked_at], false)
      }
      return node
    }
    _ => ()
  }
  let made = []
  to_dom(target, ns, made)
  dom_replace(dom_parent(node), made[0], node)
  made[0]
}

///|
fn dom_width(vnode : VNode) -> Int32 {
  match vnode {
    VFragment(children, _) => children.fold(init=0, (n, c) => n + dom_width(c))
    _ => 1
  }
}

///|
fn insert(parent : Node, node : Node, before : Node?) -> Unit {
  match before {
    Some(b) => dom_insert_before(parent, node, b, false)
    None => dom_insert_before(parent, node, node, true)
  }
}

///|
fn next_is(node : Node, before : Node?) -> Bool {
  match before {
    Some(b) => dom_next_is(node, b, false)
    None => dom_next_is(node, node, true)
  }
}

///|
/// Changes a parent's owned children from one render's to the next's, in
/// place: what has a key keeps its nodes wherever it moved, what doesn't is
/// matched in order. Gives the nodes the new children have.
fn morph_children(
  parent : Node,
  old : Array[VNode],
  next : Array[VNode],
  ns : String?,
  nodes : Array[Node]?,
  before : Node?,
) -> Array[Node] {
  let dom_nodes = match nodes {
    Some(ns_) => ns_
    None =>
      Array::makei(dom_owned_count(parent), i => dom_owned_child(parent, i))
  }
  let old_groups : Array[Array[Node]] = []
  let old_keys : Map[String, Int32] = Map([])
  let mut offset = 0
  for i, child in old {
    let width = dom_width(child)
    old_groups.push(dom_nodes[offset:offset + width].to_owned())
    offset += width
    match child.key() {
      Some(k) => old_keys[k] = i
      None => ()
    }
  }
  let used = Array::make(old.length(), false)
  let mut cursor = 0
  let matches = next.map(child => {
    let mut index = -1
    match child.key() {
      Some(k) =>
        match old_keys.get(k) {
          Some(previous) if previous >= 0 && !used[previous] => index = previous
          Some(_) => ()
          None => old_keys[k] = -1
        }
      None =>
        while cursor < old.length() {
          let candidate = cursor
          cursor += 1
          if old[candidate].key() is None {
            index = candidate
            break
          }
        }
    }
    if index >= 0 {
      used[index] = true
    }
    index
  })
  let new_groups : Array[Array[Node]] = Array::make(next.length(), [])
  let mut before = before
  for k in 0..<next.length() {
    let j = next.length() - 1 - k
    let target = next[j]
    let index = matches[j]
    let nodes_ : Array[Node] = if index < 0 {
      mount_before(parent, target, ns, before)
    } else {
      let source = old[index]
      let old_nodes = old_groups[index]
      match (source, target) {
        (VFragment(a, _), VFragment(b, _)) =>
          morph_children(parent, a, b, ns, Some(old_nodes), before)
        (VFragment(_, _), _) | (_, VFragment(_, _)) => {
          let made = mount_before(parent, target, ns, before)
          for n in old_nodes {
            dom_remove(parent, n)
          }
          made
        }
        _ => {
          let node = morph_node(old_nodes[0], source, target, ns)
          if !next_is(node, before) {
            insert(parent, node, before)
          }
          [node]
        }
      }
    }
    new_groups[j] = nodes_
    if nodes_.length() > 0 {
      before = Some(nodes_[0])
    }
  }
  for i in 0..<old.length() {
    if !used[i] {
      for n in old_groups[i] {
        dom_remove(parent, n)
      }
    }
  }
  new_groups.flatten()
}

///|
fn mount_before(
  parent : Node,
  vnode : VNode,
  ns : String?,
  before : Node?,
) -> Array[Node] {
  let made = []
  to_dom(vnode, ns, made)
  for n in made {
    insert(parent, n, before)
  }
  made
}
