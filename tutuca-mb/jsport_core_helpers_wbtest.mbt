// Helpers shared by the jsport_core_* ports of test/core/*.test.js.

///|
/// Messages for components that send none.
enum NoMsg {
  NoMsg
} derive(Debug)

///|
/// The elements with this tag below `root`, in document order.
fn elems(root : @memdom.MemNode, tag : String) -> Array[@memdom.MemNode] {
  let tag = tag.to_upper()
  root.descendants().filter(n => n.tag_name() == tag)
}

///|
/// The text of the comments below `root`, in document order.
fn comment_texts(root : @memdom.MemNode) -> Array[String] {
  root.descendants().filter(n => n.kind() is CommentNode).map(n => n.data())
}

///|
/// The paths of the components rendered below `root`, from the metadata comments.
fn meta_paths(root : @memdom.MemNode) -> Array[String] {
  let out = []
  for text in comment_texts(root) {
    if parse_meta(text) is Some((_, path)) {
      out.push(path)
    }
  }
  out
}

///|
/// Whether both arrays hold the same nodes, by identity.
fn same_nodes(a : Array[@memdom.MemNode], b : Array[@memdom.MemNode]) -> Bool {
  a.length() == b.length() &&
  a.iter().zip(b.iter()).all(p => physical_equal(p.0, p.1))
}

///|
/// Every vnode of a render, parents before children.
fn all_vnodes(childs : Array[@vdom.VNode]) -> Array[@vdom.VNode] {
  let out = []
  fn go(vs : Array[@vdom.VNode]) {
    for v in vs {
      out.push(v)
      match v {
        Elem(e) => go(e.childs)
        Fragment(f) => go(f.childs)
        Text(_) | Comment(_) => ()
      }
    }
  }

  go(childs)
  out
}

///|
/// The first element vnode with this tag in a render.
fn find_velem(childs : Array[@vdom.VNode], tag : String) -> @vdom.VElem {
  for v in all_vnodes(childs) {
    if v is Elem(e) && e.shape.tag == tag {
      return e
    }
  }
  abort("no <\{tag}> vnode")
}

///|
/// Dispatches `event` on `node` and runs the queue.
fn fire(
  host : Host[@memdom.MemNode],
  node : @memdom.MemNode,
  event : String,
) -> Bool {
  let took = host.handle_event(node, event)
  host.drain()
  took
}

///|
/// `mount` with the root rendered in `view`.
fn[S, M] mount_view(
  comp : Component[S, M],
  state : S,
  view : String,
) -> (Host[@memdom.MemNode], App[S, M], @memdom.MemNode) {
  let doc = @memdom.document()
  let root = doc.element("main")
  let host = Host::new(doc, root, dev=true)
  let app = host.start(comp, state, view~)
  (host, app, root)
}
