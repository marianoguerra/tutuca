// Metadata comments, as JS writes them: with `meta`, each component's render sits between
// `§{"t":"component","n":<name>,"p":<path>}§` and `§/§`, so tools can tell which component a
// DOM node belongs to, without the handlers.

///|
pub let meta_close : String = "§/§"

///|
/// The closing comment's vnode: one, shared by every component render, as in JS.
let meta_close_vnode : @vdom.VNode = Comment(meta_close)

///|
fn meta_open(name : String, path : DispatchPath) -> String {
  let json : Json = {
    "t": "component",
    "n": Json::string(name),
    "p": Json::string(path.to_string()),
  }
  "§\{json.stringify()}§"
}

///|
/// The component a metadata comment opens, as (name, path), when it is one.
pub fn parse_meta(text : String) -> (String, String)? {
  guard text.length() > 2 && text.has_prefix("§{") && text.has_suffix("§") else {
    return None
  }
  let body = text.view(start_offset=1, end_offset=text.length() - 1).to_owned()
  let json = @json.parse(body) catch { _ => return None }
  match json {
    { "t": String("component"), "n": String(name), "p": String(path), .. } =>
      Some((name, path))
    _ => None
  }
}

///|
/// The innermost component `node` was rendered in, as (name, path): read from the metadata
/// comments a host with `meta` writes, scanning back through the siblings at each level up.
pub fn[N : @vdom.DomNode] Host::component_at(
  self : Host[N],
  node : N,
) -> (String, String)? {
  let mut at = node
  while !at.is_same_node(self.root_node) {
    guard at.parent_node() is Some(parent) else { return None }
    let siblings = parent.child_nodes()
    let mut i = siblings.search_by(s => s.is_same_node(at)).unwrap_or(0) - 1
    let mut closes = 0
    while i >= 0 {
      let s = siblings[i]
      if s.tag_name() == "" {
        let data = s.get_data()
        if data == meta_close {
          closes += 1
        } else if parse_meta(data) is Some(found) {
          if closes == 0 {
            return Some(found)
          }
          closes -= 1
        }
      }
      i -= 1
    }
    at = parent
  }
  None
}

///|
/// The path of the component a metadata comment before `node`, among its siblings, opens and
/// still has open at it: `node` is (part of) that component's render.
fn[N : @vdom.DomNode] opens_component(node : N) -> String? {
  guard node.parent_node() is Some(parent) else { return None }
  let siblings = parent.child_nodes()
  let mut i = siblings.search_by(s => s.is_same_node(node)).unwrap_or(0) - 1
  let mut closes = 0
  while i >= 0 {
    let s = siblings[i]
    if s.tag_name() == "" {
      let data = s.get_data()
      if data == meta_close {
        closes += 1
      } else if parse_meta(data) is Some((_, path)) {
        if closes == 0 {
          return Some(path)
        }
        closes -= 1
      }
    }
    i -= 1
  }
  None
}
