///|
/// The DOM surface the renderer drives. The document is itself a node: creation methods are
/// only called on the document passed to `render`.
///
/// `has_property` is JS `name in node`. `set_property` is `node[name] = value` and returns
/// false where JS would throw.
pub(open) trait DomNode {
  fn create_element(Self, tag : String, ns : String?, is_attr : String?) -> Self
  fn create_text(Self, String) -> Self
  fn create_comment(Self, String) -> Self
  fn create_fragment(Self) -> Self
  fn append_child(Self, Self) -> Unit
  fn insert_before(Self, new_node : Self, ref_node : Self?) -> Unit
  fn remove_child(Self, Self) -> Unit
  fn replace_child(Self, new_node : Self, old_node : Self) -> Unit
  fn replace_children(Self) -> Unit // The clear-all form only.
  fn parent_node(Self) -> Self?
  fn next_sibling(Self) -> Self?
  fn child_nodes(Self) -> Array[Self] // A snapshot, not a live collection.
  fn is_same_node(Self, Self) -> Bool
  fn set_attribute(Self, name : String, value : String) -> Unit
  fn remove_attribute(Self, String) -> Unit
  fn get_attribute(Self, String) -> String?
  fn get_value(Self) -> String // The `value` property, "" when there is none.
  fn get_checked(Self) -> Bool // The `checked` property.
  fn has_property(Self, String) -> Bool
  fn set_property(Self, name : String, value : AttrValue) -> Bool
  fn get_inner_html(Self) -> String
  fn set_inner_html(Self, String) -> Unit
  fn set_data(Self, String) -> Unit // Text and comment character data.
  fn get_data(Self) -> String // Text and comment character data, "" for other nodes.
  fn tag_name(Self) -> String // Uppercase for HTML elements, as in the DOM.
  fn namespace_uri(Self) -> String? // None for HTML.
}

///|
pub suberror DuplicateKey {
  DuplicateKey(String)
}

///|
fn[N : DomNode] is_namespaced(node : N) -> Bool {
  match node.namespace_uri() {
    Some(ns) => ns != html_ns
    None => false
  }
}

///|
fn el_ns_of(shape : Shape, ns : String?) -> String? {
  match shape.ns {
    Some(_) as own => own
    None => ns
  }
}

///|
fn child_ns(shape : Shape, ns : String?) -> String? {
  if ns == Some(svg_ns) && shape.tag.to_lower() == "foreignobject" {
    None
  } else {
    ns
  }
}

///|
/// Names that are DOM properties but must be set as attributes.
pub fn never_assign(name : String) -> Bool {
  name
  is ("width"
  | "height"
  | "href"
  | "list"
  | "form"
  | "tabIndex"
  | "download"
  | "rowSpan"
  | "colSpan"
  | "role"
  | "popover")
}

///|
/// The attribute a property reflects to.
pub fn prop_attr_name(name : String) -> String {
  match name {
    "className" => "class"
    "htmlFor" => "for"
    _ => name
  }
}

///|
fn is_prefixed_attr(name : String) -> Bool {
  name.length() > 4 && name.code_unit_at(4) == '-'
}

///|
fn[N : DomNode] set_prop(
  node : N,
  name : String,
  value : AttrValue,
  namespaced : Bool,
) -> Unit {
  if name == "dangerouslySetInnerHTML" {
    match value {
      Absent => node.replace_children()
      v => {
        let html = v.to_attr_string()
        // Skip the re-parse when the markup is identical (preact does the same).
        if html != node.get_inner_html() {
          node.set_inner_html(html)
        }
      }
    }
    return
  }
  let uses_prop = !namespaced && !never_assign(name) && node.has_property(name)
  if uses_prop && !(value is Absent) && node.set_property(name, value) {
    return
  }
  if value is (Absent | Bool(false)) &&
    !(value is Bool(false) && is_prefixed_attr(name)) {
    if uses_prop {
      ignore(node.set_property(name, Str("")))
      node.remove_attribute(prop_attr_name(name))
    } else {
      node.remove_attribute(name)
    }
  } else {
    node.set_attribute(name, value.to_attr_string())
  }
}

///|
fn[N : DomNode] apply_value_last(node : N, value : AttrValue) -> Unit {
  if node.tag_name() == "PROGRESS" && value is (Absent | Num(0.0)) {
    node.remove_attribute("value")
  } else {
    set_prop(node, "value", value, is_namespaced(node))
  }
}

///|
fn[N : DomNode] to_dom(vnode : VNode, doc : N, ns : String?) -> N {
  match vnode {
    Fragment(f) => {
      let node = doc.create_fragment()
      append_child_nodes(node, f.childs, doc, ns)
      node
    }
    Text(t) => doc.create_text(t)
    Comment(t) => doc.create_comment(t)
    Elem({ shape, values, childs, .. }) => {
      let el_ns = el_ns_of(shape, ns)
      let is_attr = if shape.is_idx == -1 {
        None
      } else {
        match values[shape.is_idx] {
          Absent => None
          v => Some(v.to_attr_string())
        }
      }
      let node = doc.create_element(shape.tag, el_ns, is_attr)
      let namespaced = is_namespaced(node)
      for attr in shape.static_attrs {
        set_prop(node, attr.0, attr.1, namespaced)
      }
      for i, name in shape.names {
        if i != shape.value_idx && i != shape.checked_idx {
          set_prop(node, name, values[i], namespaced)
        }
      }
      append_child_nodes(node, childs, doc, child_ns(shape, el_ns))
      // After the children, so a select's options exist before its value picks one.
      if shape.value_idx != -1 && !(values[shape.value_idx] is Absent) {
        apply_value_last(node, values[shape.value_idx])
      }
      if shape.checked_idx != -1 && !(values[shape.checked_idx] is Absent) {
        set_prop(node, "checked", values[shape.checked_idx], false)
      }
      node
    }
  }
}

///|
fn[N : DomNode] append_child_nodes(
  parent : N,
  childs : Array[VNode],
  doc : N,
  ns : String?,
) -> Unit {
  for child in childs {
    parent.append_child(to_dom(child, doc, ns))
  }
}

///|
/// A shared vnode skips by identity, an equal one by the cheaper vnode walk.
fn[N : DomNode] morph_node(
  dom_node : N,
  source : VNode,
  target : VNode,
  doc : N,
  ns : String?,
) -> N raise DuplicateKey {
  if source.is_equal_to(target) {
    return dom_node
  }
  match (source, target) {
    (Text(_), Text(t)) | (Comment(_), Comment(t)) => {
      dom_node.set_data(t)
      dom_node
    }
    (Elem(s), Elem(t)) if s.is_same_kind(t) => {
      let shape = t.shape
      let a = s.values
      let b = t.values
      let namespaced = is_namespaced(dom_node)
      for i, name in shape.names {
        if i != shape.value_idx && i != shape.checked_idx && a[i] != b[i] {
          set_prop(dom_node, name, b[i], namespaced)
        }
      }
      if shape.html_idx == -1 || b[shape.html_idx] is (Absent | Bool(false)) {
        let el_ns = el_ns_of(shape, ns)
        ignore(
          morph_children(
            dom_node,
            s.childs,
            t.childs,
            doc,
            child_ns(shape, el_ns),
          ),
        )
      }
      let vi = shape.value_idx
      if vi != -1 {
        // A select reapplies its value whenever it changed, since its options may have.
        if a[vi] != b[vi] {
          apply_value_last(dom_node, b[vi])
        } else if dom_node.tag_name() == "SELECT" && !(b[vi] is Absent) {
          apply_value_last(dom_node, b[vi])
        }
      }
      let ci = shape.checked_idx
      if ci != -1 && a[ci] != b[ci] {
        set_prop(dom_node, "checked", b[ci], false)
      }
      dom_node
    }
    _ => {
      let new_node = to_dom(target, doc, ns)
      dom_node.parent_node().unwrap().replace_child(new_node, dom_node)
      new_node
    }
  }
}

///|
fn[N : DomNode] mount_before(
  parent : N,
  vnode : VNode,
  doc : N,
  ns : String?,
  before : N?,
) -> Array[N] {
  let dom = to_dom(vnode, doc, ns)
  let nodes = if vnode is Fragment(_) { dom.child_nodes() } else { [dom] }
  parent.insert_before(dom, before)
  nodes
}

///|
/// Snapshots references before editing; virtual indices need not equal DOM indices.
fn[N : DomNode] morph_children(
  parent_dom : N,
  old_childs : Array[VNode],
  new_childs : Array[VNode],
  doc : N,
  ns : String?,
  dom_nodes? : Array[N],
  before? : N,
) -> Array[N] raise DuplicateKey {
  let dom_nodes = dom_nodes.unwrap_or_else(() => parent_dom.child_nodes())
  let mut before = before
  let old_groups : Array[Array[N]] = []
  let old_key_map : Map[String, Int32] = Map([])
  let mut offset = 0
  for i, child in old_childs {
    let width = child.dom_width()
    // Nodes someone else added or removed shift what follows, as in JS; past the end, a group
    // just comes out short instead of reading out of range.
    let len = dom_nodes.length()
    let start = if offset < len { offset } else { len }
    let end = if offset + width < len { offset + width } else { len }
    old_groups.push(dom_nodes[start:end].to_owned())
    offset += width
    if child.key() is Some(key) {
      if old_key_map.contains(key) {
        raise DuplicateKey("Duplicate sibling key: \{key}")
      }
      old_key_map[key] = i
    }
  }
  let used = FixedArray::make(old_childs.length(), false)
  let mut unkeyed_cursor = 0
  // Match unkeyed children in forward order, independently of placement order.
  let matches : Array[Int32] = []
  for child in new_childs {
    let mut index = -1
    match child.key() {
      Some(key) =>
        match old_key_map.get(key) {
          Some(previous) => {
            if previous == -1 || used[previous] {
              raise DuplicateKey("Duplicate sibling key: \{key}")
            }
            index = previous
          }
          // Remember newly introduced keys in the map we already use for matching.
          None => old_key_map[key] = -1
        }
      None =>
        while unkeyed_cursor < old_childs.length() {
          let candidate = unkeyed_cursor
          unkeyed_cursor += 1
          if old_childs[candidate].key() is None {
            index = candidate
            break
          }
        }
    }
    if index >= 0 {
      used[index] = true
    }
    matches.push(index)
  }
  let new_groups : Array[Array[N]] = Array::make(new_childs.length(), [])
  // The next already-placed group provides a real insertion reference. Empty groups leave it
  // unchanged, including through arbitrarily nested fragments.
  for j = new_childs.length() - 1; j >= 0; j = j - 1 {
    let target = new_childs[j]
    let index = matches[j]
    let nodes = if index == -1 {
      mount_before(parent_dom, target, doc, ns, before)
    } else {
      let source = old_childs[index]
      let old_nodes = old_groups[index]
      match (source, target) {
        (Fragment(s), Fragment(t)) =>
          morph_children(
            parent_dom,
            s.childs,
            t.childs,
            doc,
            ns,
            dom_nodes=old_nodes,
            before?,
          )
        (Fragment(_), _) | (_, Fragment(_)) => {
          let nodes = mount_before(parent_dom, target, doc, ns, before)
          for node in old_nodes {
            parent_dom.remove_child(node)
          }
          nodes
        }
        _ if old_nodes.is_empty() =>
          mount_before(parent_dom, target, doc, ns, before)
        _ => {
          let node = morph_node(old_nodes[0], source, target, doc, ns)
          let in_place = match (node.next_sibling(), before) {
            (Some(next), Some(b)) => next.is_same_node(b)
            (None, None) => true
            _ => false
          }
          if !in_place {
            parent_dom.insert_before(node, before)
          }
          [node]
        }
      }
    }
    new_groups[j] = nodes
    if nodes.length() > 0 {
      before = Some(nodes[0])
    }
  }
  for i in 0..<old_childs.length() {
    if !used[i] {
      for node in old_groups[i] {
        parent_dom.remove_child(node)
      }
    }
  }
  new_groups.flatten()
}

///|
/// Renders childs (a flat array of vnodes) into container, morphing from prev if given.
pub fn[N : DomNode] render(
  doc : N,
  container : N,
  childs : Array[VNode],
  prev? : Array[VNode],
) -> Unit raise DuplicateKey {
  match prev {
    Some(prev) => ignore(morph_children(container, prev, childs, doc, None))
    None => {
      container.replace_children()
      append_child_nodes(container, childs, doc, None)
    }
  }
}
