///|
pub(all) enum MemKind {
  Document
  Element
  TextNode
  CommentNode
  FragmentNode
} derive(Eq)

///|
pub extend MemKind with Eq::{equal, not_equal}

///|
/// A DOM mutation, recorded on the document so tests can assert what a render wrote (the
/// MutationObserver of the JS tests).
pub(all) enum Mutation {
  ChildList
  Attribute(String)
  CharacterData(String)
} derive(Eq, Debug)

///|
pub extend Mutation with Debug::{to_repr}

///|
pub extend Mutation with Eq::{equal, not_equal}

///|
/// An in-memory node. `attrs` is the serialized attribute list; `props` is the live IDL
/// property bag, where `value` and `checked` live. Never derive Debug here: the `parent`
/// back-pointer would make the printer recurse forever.
pub struct MemNode {
  kind : MemKind
  tag : String
  ns : String?
  doc : MemNode?
  attrs : Array[(String, String)]
  props : Map[String, @vdom.AttrValue]
  childs : Array[MemNode]
  mut parent : MemNode?
  mut data : String
  mut created_is : String?
  mut inner_html : String?
  mutations : Array[Mutation]
}

///|
fn MemNode::make(
  kind : MemKind,
  doc : MemNode?,
  tag~ : String = "",
  ns? : String,
  data~ : String = "",
) -> MemNode {
  {
    kind,
    tag,
    ns,
    doc,
    attrs: [],
    props: {},
    childs: [],
    parent: None,
    data,
    created_is: None,
    inner_html: None,
    mutations: [],
  }
}

///|
/// A fresh document: the node every creation method is called on.
pub fn document() -> MemNode {
  MemNode::make(Document, None)
}

///|
/// An element made by this document, as a render container.
pub fn MemNode::element(self : MemNode, tag : String) -> MemNode {
  @vdom.DomNode::create_element(self, tag, None, None)
}

///|
fn MemNode::record(self : MemNode, m : Mutation) -> Unit {
  match self.doc {
    Some(d) => d.mutations.push(m)
    None => self.mutations.push(m)
  }
}

///|
/// The mutations recorded since the last call, which clears them.
pub fn MemNode::take_mutations(self : MemNode) -> Array[Mutation] {
  let out = self.mutations.copy()
  self.mutations.clear()
  out
}

///|
fn index_of(parent : MemNode, node : MemNode) -> Int32? {
  for i, c in parent.childs {
    if physical_equal(c, node) {
      return Some(i)
    }
  }
  None
}

///|
fn detach(node : MemNode) -> Unit {
  if node.parent is Some(p) {
    if index_of(p, node) is Some(i) {
      ignore(p.childs.remove(i))
    }
    node.parent = None
  }
}

///|
/// Inserts like the DOM: a fragment's children move in and the fragment empties.
fn insert_at(parent : MemNode, node : MemNode, index : Int32) -> Unit {
  parent.record(ChildList)
  if node.kind is FragmentNode {
    let moving = node.childs.copy()
    node.childs.clear()
    for i, c in moving {
      c.parent = Some(parent)
      parent.childs.insert(index + i, c)
    }
  } else {
    node.parent = Some(parent)
    parent.childs.insert(index, node)
  }
}

///|
fn MemNode::owner(self : MemNode) -> MemNode? {
  match self.kind {
    Document => Some(self)
    _ => self.doc
  }
}

///|
pub impl @vdom.DomNode for MemNode with fn create_element(
  self,
  tag,
  ns,
  is_attr,
) {
  let ns = match ns {
    Some(u) if u == @vdom.html_ns => None
    other => other
  }
  // The DOM upper-cases HTML tag names.
  let tag = if ns is None { tag.to_upper() } else { tag }
  let el = MemNode::make(Element, self.owner(), tag~, ns?)
  el.created_is = is_attr
  el
}

///|
pub impl @vdom.DomNode for MemNode with fn create_text(self, s) {
  MemNode::make(TextNode, self.owner(), data=s)
}

///|
pub impl @vdom.DomNode for MemNode with fn create_comment(self, s) {
  MemNode::make(CommentNode, self.owner(), data=s)
}

///|
pub impl @vdom.DomNode for MemNode with fn create_fragment(self) {
  MemNode::make(FragmentNode, self.owner())
}

///|
pub impl @vdom.DomNode for MemNode with fn append_child(self, child) {
  detach(child)
  insert_at(self, child, self.childs.length())
}

///|
pub impl @vdom.DomNode for MemNode with fn insert_before(
  self,
  new_node,
  ref_node,
) {
  // A moved node changes indices when it leaves its old slot, so detach first.
  detach(new_node)
  let at = match ref_node {
    Some(r) => index_of(self, r).unwrap_or(self.childs.length())
    None => self.childs.length()
  }
  insert_at(self, new_node, at)
}

///|
pub impl @vdom.DomNode for MemNode with fn remove_child(self, child) {
  if index_of(self, child) is Some(i) {
    self.record(ChildList)
    ignore(self.childs.remove(i))
    child.parent = None
  }
}

///|
pub impl @vdom.DomNode for MemNode with fn replace_child(
  self,
  new_node,
  old_node,
) {
  if index_of(self, old_node) is Some(i) {
    detach(new_node)
    let i = index_of(self, old_node).unwrap_or(i)
    ignore(self.childs.remove(i))
    old_node.parent = None
    insert_at(self, new_node, i)
  }
}

///|
pub impl @vdom.DomNode for MemNode with fn replace_children(self) {
  for c in self.childs {
    c.parent = None
  }
  if self.childs.length() > 0 {
    self.record(ChildList)
  }
  self.childs.clear()
  self.inner_html = None
}

///|
pub impl @vdom.DomNode for MemNode with fn parent_node(self) {
  self.parent
}

///|
pub impl @vdom.DomNode for MemNode with fn next_sibling(self) {
  match self.parent {
    Some(p) =>
      match index_of(p, self) {
        Some(i) => p.childs.get(i + 1)
        None => None
      }
    None => None
  }
}

///|
pub impl @vdom.DomNode for MemNode with fn child_nodes(self) {
  self.childs.copy()
}

///|
pub impl @vdom.DomNode for MemNode with fn is_same_node(self, other) {
  physical_equal(self, other)
}

///|
pub impl @vdom.DomNode for MemNode with fn set_attribute(self, name, value) {
  self.record(Attribute(name))
  for i, a in self.attrs {
    if a.0 == name {
      self.attrs[i] = (name, value)
      return
    }
  }
  self.attrs.push((name, value))
}

///|
pub impl @vdom.DomNode for MemNode with fn remove_attribute(self, name) {
  for i, a in self.attrs {
    if a.0 == name {
      self.record(Attribute(name))
      ignore(self.attrs.remove(i))
      return
    }
  }
}

///|
/// IDL properties that reflect to an attribute.
fn is_reflected_prop(name : String) -> Bool {
  name
  is ("id"
  | "className"
  | "htmlFor"
  | "title"
  | "lang"
  | "dir"
  | "type"
  | "name"
  | "src"
  | "alt"
  | "placeholder"
  | "min"
  | "max"
  | "step"
  | "hidden") ||
  @vdom.never_assign(name)
}

///|
/// Live state that is an IDL property but never reflects to an attribute.
fn is_state_prop(name : String) -> Bool {
  name
  is ("value"
  | "checked"
  | "selected"
  | "disabled"
  | "readOnly"
  | "required"
  | "indeterminate")
}

///|
/// JS `name in node`. The all-lowercase spellings of camelCase properties, `class`, and
/// `data-*`/`aria-*` are not properties, so they fall through to attributes.
pub impl @vdom.DomNode for MemNode with fn has_property(self, name) {
  self.kind is Element &&
  (is_reflected_prop(name) || is_state_prop(name) || self.props.contains(name))
}

///|
/// `throwingProp` stands for a setter that throws, to exercise the attribute fallback.
pub impl @vdom.DomNode for MemNode with fn set_property(self, name, value) {
  if name == "throwingProp" {
    return false
  }
  if self.tag == "SELECT" && name == "value" {
    select_value(self, value)
    return true
  }
  self.props[name] = value
  // `value` reflects to its attribute on these, unlike on form fields, where it is live state;
  // a checkbox's or radio's value is its attribute too (its value mode is "default/on").
  let check_like = self.tag == "INPUT" &&
    @vdom.DomNode::get_attribute(self, "type") is Some("checkbox" | "radio")
  let reflects_value = name == "value" &&
    (
      check_like ||
      self.tag
      is ("BUTTON" | "OPTION" | "LI" | "DATA" | "PARAM" | "METER" | "PROGRESS")
    )
  if is_reflected_prop(name) || reflects_value {
    @vdom.DomNode::set_attribute(
      self,
      @vdom.prop_attr_name(name),
      value.to_attr_string(),
    )
  }
  true
}

///|
/// Assigning a select's value selects the first option with that value; with no match the
/// select's value becomes "".
fn select_value(sel : MemNode, value : @vdom.AttrValue) -> Unit {
  let target = value.to_attr_string()
  let mut found = false
  for c in sel.childs {
    if c.tag == "OPTION" {
      let matches = !found && c.value() == target
      c.props["selected"] = Bool(matches)
      if matches {
        found = true
      }
    }
  }
  sel.props["value"] = Str(if found { target } else { "" })
}

///|
pub impl @vdom.DomNode for MemNode with fn get_inner_html(self) {
  match self.inner_html {
    Some(html) => html
    None => self.childs.map(c => c.to_html()).join("")
  }
}

///|
pub impl @vdom.DomNode for MemNode with fn set_inner_html(self, html) {
  for c in self.childs {
    c.parent = None
  }
  self.childs.clear()
  self.record(ChildList)
  self.inner_html = Some(html)
}

///|
pub impl @vdom.DomNode for MemNode with fn set_data(self, s) {
  self.record(CharacterData(s))
  self.data = s
}

///|
pub impl @vdom.DomNode for MemNode with fn get_data(self) {
  self.data
}

///|
pub impl @vdom.DomNode for MemNode with fn tag_name(self) {
  self.tag
}

///|
pub impl @vdom.DomNode for MemNode with fn namespace_uri(self) {
  self.ns
}

///|
pub impl @vdom.DomNode for MemNode with fn get_attribute(self, name) {
  for a in self.attrs {
    if a.0 == name {
      return Some(a.1)
    }
  }
  None
}

///|
pub impl @vdom.DomNode for MemNode with fn get_value(self) {
  self.value()
}

///|
pub impl @vdom.DomNode for MemNode with fn get_checked(self) {
  self.props.get("checked") is Some(Bool(true))
}

///|
pub fn MemNode::get_property(self : MemNode, name : String) -> @vdom.AttrValue? {
  self.props.get(name)
}

///|
/// An element's value: its `value` property, else its `value` attribute, else "".
pub fn MemNode::value(self : MemNode) -> String {
  match self.props.get("value") {
    Some(v) => v.to_attr_string()
    None => self.get_attribute("value").unwrap_or("")
  }
}

///|
pub fn MemNode::first_child(self : MemNode) -> MemNode? {
  self.childs.get(0)
}

///|
pub fn MemNode::children(self : MemNode) -> Array[MemNode] {
  self.childs
}

///|
pub fn MemNode::kind(self : MemNode) -> MemKind {
  self.kind
}

///|
pub fn MemNode::data(self : MemNode) -> String {
  self.data
}

///|
/// The text of this subtree, as `textContent`.
pub fn MemNode::text_content(self : MemNode) -> String {
  match self.kind {
    TextNode => self.data
    CommentNode => ""
    _ => self.childs.map(c => c.text_content()).join("")
  }
}

///|
/// Descendants (not self) in document order.
pub fn MemNode::descendants(self : MemNode) -> Array[MemNode] {
  let out = []
  fn go(n : MemNode) {
    for c in n.childs {
      out.push(c)
      go(c)
    }
  }

  go(self)
  out
}

///|
/// The first descendant element with this (case-insensitive) tag name.
pub fn MemNode::find(self : MemNode, tag : String) -> MemNode? {
  let tag = tag.to_lower()
  self
  .descendants()
  .search_by(n => n.kind is Element && n.tag.to_lower() == tag)
  .map(i => self.descendants()[i])
}

///|
/// Serialized HTML of the children, like `innerHTML`. Attribute order is insertion order; no
/// entity escaping (a test aid, not a serializer).
pub fn MemNode::to_html(self : MemNode) -> String {
  match self.kind {
    Document | FragmentNode => self.childs.map(c => c.to_html()).join("")
    TextNode => self.data
    CommentNode => "<!--\{self.data}-->"
    Element => {
      let tag = if self.ns is None { self.tag.to_lower() } else { self.tag }
      let attrs = self.attrs.map(a => " \{a.0}=\"\{a.1}\"").join("")
      let inner = @vdom.DomNode::get_inner_html(self)
      "<\{tag}\{attrs}>\{inner}</\{tag}>"
    }
  }
}

///|
pub fn MemNode::inner_html(self : MemNode) -> String {
  self.get_inner_html()
}

///|
pub extend MemNode with @vdom.DomNode::{
  create_element,
  create_text,
  create_comment,
  create_fragment,
  append_child,
  insert_before,
  remove_child,
  replace_child,
  replace_children,
  parent_node,
  next_sibling,
  child_nodes,
  is_same_node,
  set_attribute,
  remove_attribute,
  get_attribute,
  get_value,
  get_checked,
  has_property,
  set_property,
  get_inner_html,
  set_inner_html,
  set_data,
  get_data,
  tag_name,
  namespace_uri,
}

///|
/// Sets the live value, as a user typing would.
pub fn MemNode::set_value(self : MemNode, value : String) -> Unit {
  if self.tag == "SELECT" {
    select_value(self, Str(value))
  } else {
    self.props["value"] = Str(sanitize_value(self, value))
  }
}

///|
/// What a browser keeps of a value typed into a field: a date input drops anything that isn't
/// YYYY-MM-DD.
fn sanitize_value(node : MemNode, value : String) -> String {
  match node.get_attribute("type") {
    Some("date") => {
      let ok = value.length() == 10 &&
        value.iter().all(c => (c >= '0' && c <= '9') || c == '-') &&
        value.get_char(4) == Some('-') &&
        value.get_char(7) == Some('-')
      if ok {
        value
      } else {
        ""
      }
    }
    _ => value
  }
}

///|
/// Sets the live checked state, as a user clicking a checkbox would.
pub fn MemNode::set_checked(self : MemNode, checked : Bool) -> Unit {
  self.props["checked"] = Bool(checked)
}

///|
/// The subtree as text with each element's attributes sorted, and the live value and checked
/// state of form fields: patching may set attributes in another order than a fresh render,
/// but must end up showing the same thing.
pub fn MemNode::signature(
  self : MemNode,
  skip_live~ : (MemNode) -> Bool = _ => false,
) -> String {
  match self.kind {
    TextNode => self.data
    CommentNode => "<!--\{self.data}-->"
    Document | FragmentNode =>
      self.childs.map(c => c.signature(skip_live~)).join("")
    Element => {
      let attrs = self.attrs.map(a => "\{a.0}=\"\{a.1}\"")
      attrs.sort()
      let live = match (self.props.get("value"), self.props.get("checked")) {
        _ if skip_live(self) => ""
        (Some(v), _) => " value=\{v.to_attr_string()}"
        (_, Some(c)) => " checked=\{c.to_attr_string()}"
        _ => ""
      }
      let inner = match self.inner_html {
        Some(html) => html
        None => self.childs.map(c => c.signature(skip_live~)).join("")
      }
      "<\{self.tag} \{attrs.join(" ")}\{live}>\{inner}</\{self.tag}>"
    }
  }
}
