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
/// Takes the owned children a parent has now, for dom_snapshot_child to give
/// one by one; how many it has.
extern "wasm" fn dom_snapshot(parent : Node) -> Int32 = "dom" "snapshot"

///|
extern "wasm" fn dom_snapshot_child(i : Int32) -> Node = "dom" "snapshot_child"

///|
/// Whether the next owned sibling of a node is another (or none, at the end).
extern "wasm" fn dom_next_is(node : Node, other : Node, at_end : Bool) -> Bool = "dom" "next_is"

///|
extern "wasm" fn dom_root() -> Node = "dom" "root"

///|
/// A deep copy of a node, none of its nodes owned.
extern "wasm" fn dom_clone(node : Node) -> Node = "dom" "clone"

///|
/// Marks a node owned: one a clone made.
extern "wasm" fn dom_own(node : Node) = "dom" "own"

///|
extern "wasm" fn dom_first_child(node : Node) -> Node = "dom" "first_child"

///|
extern "wasm" fn dom_next_sibling(node : Node) -> Node = "dom" "next_sibling"

///|
/// Removes every child of a node.
extern "wasm" fn dom_clear(node : Node) = "dom" "clear"

///|
/// Whether a clone of an element has what setting a static attribute gave
/// it: an attribute is copied, a property that doesn't reflect one
/// (indeterminate, a media element's muted) isn't.
extern "wasm" fn dom_survives_clone(node : Node, name : String) -> Bool = "dom" "survives_clone"

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
/// The namespace an element is in, in a parent of namespace ns.
fn elem_ns(elem : Elem, ns : String?) -> String? {
  match elem.space {
    Some(n) => Some(n)
    None => ns
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
    VElem(e) => out.push(element_dom(e, ns))
  }
}

///|
fn element_dom(e : VElement, ns : String?) -> Node {
  let elem = e.elem
  // An element whose children the view fixes is cloned whole from its
  // template.
  if elem.plain && elem.layout is Some(kids) && kids.length() > 0 {
    return fill(dom_clone(template_of(elem, ns)), e, ns)
  }
  let el_ns = elem_ns(elem, ns)
  let custom = if elem.is_at >= 0 && kind(e.values[elem.is_at]) is Str {
    v_str_of(e.values[elem.is_at])
  } else {
    ""
  }
  let node = dom_element(elem.tag, el_ns.unwrap_or(""), custom)
  let namespaced = is_namespaced(el_ns)
  for s in elem.statics {
    dom_set_prop(node, s.0, s.1, namespaced)
  }
  set_values(node, e, namespaced)
  append_children(node, e.children, child_ns(elem, el_ns))
  apply_last(node, e, namespaced)
  node
}

///|
/// The attributes a render computes, but the ones set after the children.
fn set_values(node : Node, e : VElement, namespaced : Bool) -> Unit {
  let elem = e.elem
  for i, name in elem.names {
    if i != elem.value_at && i != elem.checked_at {
      dom_set_prop(node, name, e.values[i], namespaced)
    }
  }
}

///|
fn append_children(node : Node, children : Array[VNode], ns : String?) -> Unit {
  let kids = []
  for c in children {
    to_dom(c, ns, kids)
  }
  for k in kids {
    dom_append(node, k)
  }
}

///|
/// After the children, so a select's options exist before its value picks
/// one.
fn apply_last(node : Node, e : VElement, namespaced : Bool) -> Unit {
  let elem = e.elem
  if elem.value_at >= 0 && !is_undefined(e.values[elem.value_at]) {
    dom_apply_value(node, e.values[elem.value_at], namespaced)
  }
  if elem.checked_at >= 0 && !is_undefined(e.values[elem.checked_at]) {
    dom_set_prop(node, "checked", e.values[elem.checked_at], false)
  }
}

///|
/// The element every vnode of an element starts as, in a parent of
/// namespace ns: its static attributes set and, when its children are fixed
/// (its layout), theirs inside it.
fn skeleton_of(elem : Elem, ns : String?) -> Node {
  let el_ns = elem_ns(elem, ns)
  let node = dom_element(elem.tag, el_ns.unwrap_or(""), "")
  let namespaced = is_namespaced(el_ns)
  for s in elem.statics {
    dom_set_prop(node, s.0, s.1, namespaced)
  }
  if !namespaced {
    elem.late = elem.statics.filter(s => !dom_survives_clone(node, s.0))
  }
  if elem.layout is Some(kids) {
    let kid_ns = child_ns(elem, el_ns)
    for kid in kids {
      match kid {
        KElem(k) => dom_append(node, skeleton_of(k, kid_ns))
        KText(text) => dom_append(node, dom_text(text))
      }
    }
  }
  node
}

///|
fn template_of(elem : Elem, ns : String?) -> Node {
  match elem.template {
    Some((had, node)) if had == ns => node
    _ => {
      let node = skeleton_of(elem, ns)
      elem.template = Some((ns, node))
      node
    }
  }
}

///|
/// Makes node, a clone of the skeleton of e's element, the node element_dom
/// makes for e: owned, with the attributes that vary and the children the
/// skeleton doesn't have.
fn fill(node : Node, e : VElement, ns : String?) -> Node {
  let elem = e.elem
  dom_own(node)
  let el_ns = elem_ns(elem, ns)
  let namespaced = is_namespaced(el_ns)
  for s in elem.late {
    dom_set_prop(node, s.0, s.1, namespaced)
  }
  set_values(node, e, namespaced)
  let kid_ns = child_ns(elem, el_ns)
  match elem.layout {
    Some(kids) if kids.length() == e.children.length() => {
      let mut dom = if kids.length() > 0 {
        Some(dom_first_child(node))
      } else {
        None
      }
      for i, kid in kids {
        guard dom is Some(at) else { break }
        dom = if i + 1 < kids.length() {
          Some(dom_next_sibling(at))
        } else {
          None
        }
        match (e.children[i], kid) {
          (VText(text), KText(had)) if text == had => dom_own(at)
          (VElem(child), KElem(k)) if child.elem.id == k.id =>
            ignore(fill(at, child, kid_ns))
          (child, _) => {
            let made = []
            to_dom(child, kid_ns, made)
            for m in made {
              dom_insert_before(node, m, at, false)
            }
            dom_remove(node, at)
          }
        }
      }
    }
    Some(_) => {
      // Not what the element's view makes: its children are whatever it has.
      dom_clear(node)
      append_children(node, e.children, kid_ns)
    }
    None => append_children(node, e.children, kid_ns)
  }
  apply_last(node, e, namespaced)
  node
}

///|
/// A rendered element that isn't looked up until something in it changes:
/// the node at an index among its parent's owned children, as they were
/// before this morph changed any.
priv struct Ref {
  parent : Ref?
  index : Int32
  mut node : Node?
  mut kids : Array[Node]?
}

///|
fn Ref::get(self : Ref) -> Node {
  match self.node {
    Some(n) => n
    None => {
      let n = self.parent.unwrap().children()[self.index]
      self.node = Some(n)
      n
    }
  }
}

///|
fn Ref::children(self : Ref) -> Array[Node] {
  match self.kids {
    Some(k) => k
    None => {
      let count = dom_snapshot(self.get())
      let k = Array::makei(count, i => dom_snapshot_child(i))
      self.kids = Some(k)
      k
    }
  }
}

///|
fn Ref::at(self : Ref, index : Int32) -> Ref {
  { parent: Some(self), index, node: None, kids: None, }
}

///|
fn ref_of(node : Node) -> Ref {
  { parent: None, index: 0, node: Some(node), kids: None, }
}

///|
/// Puts the children of a render in a parent: morphs what the last one put
/// there into them, or, the first time, adds them.
fn morph(parent : Node, prev : Array[VNode]?, next : Array[VNode]) -> Unit {
  match prev {
    Some(old) => morph_list(ref_of(parent), old, next, 0, None)
    None => append_children(parent, next, None)
  }
}

///|
/// Morphs a, children whose nodes start at offset among place's, into b. Those
/// that pair by index (the same key, a fragment for a fragment), as far as
/// they do, are morphed in order, so the nodes after the ones being morphed
/// are still where place's children say. The rest, if any, are matched by key
/// (morph_children).
fn morph_list(
  place : Ref,
  a : Array[VNode],
  b : Array[VNode],
  offset : Int32,
  ns : String?,
) -> Unit {
  let count = if a.length() < b.length() { a.length() } else { b.length() }
  let mut offset = offset
  let mut i = 0
  while i < count {
    match (a[i], b[i]) {
      (VFragment(sa, ka), VFragment(sb, kb)) => {
        if ka != kb {
          break
        }
        morph_list(place, sa, sb, offset, ns)
        offset += dom_width(a[i])
      }
      (VFragment(_, _), _) | (_, VFragment(_, _)) => break
      (s, t) => {
        if s.key() != t.key() {
          break
        }
        morph_at(place, offset, s, t, ns)
        offset += 1
      }
    }
    i += 1
  }
  if i == a.length() && i == b.length() {
    return
  }
  let mut end = offset
  for k in i..<a.length() {
    end += dom_width(a[k])
  }
  let kids = place.children()
  ignore(
    morph_children(
      place.get(),
      a[i:].to_owned(),
      b[i:].to_owned(),
      ns,
      kids[offset:end].to_owned(),
      kids.get(end),
      b[:i].to_owned(),
    ),
  )
}

///|
/// Children the view fixes (an element's layout) pair by index, without
/// looking.
fn morph_fixed(
  place : Ref,
  a : Array[VNode],
  b : Array[VNode],
  ns : String?,
) -> Unit {
  for i in 0..<a.length() {
    morph_at(place, i, a[i], b[i], ns)
  }
}

///|
/// Morphs source, the vnode of the node at an index among place's children,
/// into target.
fn morph_at(
  place : Ref,
  index : Int32,
  source : VNode,
  target : VNode,
  ns : String?,
) -> Unit {
  match (source, target) {
    (VElem(a), VElem(b)) if is_same_kind(a, b) =>
      morph_element(place.at(index), a, b, ns)
    (VText(was), VText(text)) | (VComment(was), VComment(text)) =>
      if was != text {
        dom_set_data(place.children()[index], text)
      }
    _ => {
      let old = place.children()[index]
      let made = []
      to_dom(target, ns, made)
      dom_replace(dom_parent(old), made[0], old)
    }
  }
}

///|
/// Morphs source, the vnode of place's element, into target, of the same
/// kind.
fn morph_element(place : Ref, a : VElement, b : VElement, ns : String?) -> Unit {
  let elem = b.elem
  // A select reapplies its value whenever anything in it changed, since its
  // options may have.
  if elem.is_select && elem.value_at >= 0 && VElem(a).is_equal_to(VElem(b)) {
    return
  }
  let el_ns = elem_ns(elem, ns)
  let namespaced = is_namespaced(el_ns)
  for i, name in elem.names {
    if i != elem.value_at &&
      i != elem.checked_at &&
      !v_same(a.values[i], b.values[i]) {
      dom_set_prop(place.get(), name, b.values[i], namespaced)
    }
  }
  if elem.html_at < 0 || !truthy(b.values[elem.html_at]) {
    let kid_ns = child_ns(elem, el_ns)
    if elem.fixed && a.children.length() == b.children.length() {
      morph_fixed(place, a.children, b.children, kid_ns)
    } else {
      morph_list(place, a.children, b.children, 0, kid_ns)
    }
  }
  let value_at = elem.value_at
  if value_at >= 0 {
    let reselect = elem.is_select && !is_undefined(b.values[value_at])
    if !v_same(a.values[value_at], b.values[value_at]) || reselect {
      dom_apply_value(place.get(), b.values[value_at], namespaced)
    }
  }
  let checked_at = elem.checked_at
  if checked_at >= 0 && !v_same(a.values[checked_at], b.values[checked_at]) {
    dom_set_prop(place.get(), "checked", b.values[checked_at], false)
  }
}

///|
/// Morphs source, a node's vnode, into target; gives the node target has,
/// the one given or a new one.
fn morph_node(
  node : Node,
  source : VNode,
  target : VNode,
  ns : String?,
) -> Node {
  match (source, target) {
    (VElem(a), VElem(b)) if is_same_kind(a, b) => {
      morph_element(ref_of(node), a, b, ns)
      return node
    }
    (VText(was), VText(text)) | (VComment(was), VComment(text)) => {
      if was != text {
        dom_set_data(node, text)
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
/// Changes the children that don't pair by index from one render's to the
/// next's, in place: what has a key keeps its nodes wherever it moved, what
/// doesn't is matched in order. The nodes are the ones the old children have,
/// before the node after them; the keys of the siblings already paired by
/// index are taken. Gives the nodes the new children have.
fn morph_children(
  parent : Node,
  old : Array[VNode],
  next : Array[VNode],
  ns : String?,
  dom_nodes : Array[Node],
  before : Node?,
  paired : Array[VNode],
) -> Array[Node] {
  let old_groups : Array[Array[Node]] = []
  let old_keys : Map[String, Int32] = Map([])
  for sibling in paired {
    match sibling.key() {
      Some(k) => old_keys[k] = -1
      None => ()
    }
  }
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
          morph_children(parent, a, b, ns, old_nodes, before, [])
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
