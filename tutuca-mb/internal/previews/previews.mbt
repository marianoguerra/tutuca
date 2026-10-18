// Shared preview lifecycle. Backends only adapt the element request and DOM operations.

///|
pub(all) struct Request[N] {
  key : String
  root : N
  adopt_css : (String) -> N
  adopt_link : (String) -> Unit
  emit : (String, Json) -> Unit
  mount : (() -> Unit) -> Unit
}

///|
priv struct Preview[N] {
  req : Request[N]
  style : N
}

///|
fn parse_key(key : String, prefix : String) -> (String, UInt64)? {
  guard key.has_prefix(prefix) else { return None }
  let rest = key.view(start_offset=prefix.length()).to_owned()
  match rest.rev_find("@") {
    Some(at) => {
      let mut seed : UInt64 = 0
      for c in rest.view(start_offset=at + 1) {
        guard c >= '0' && c <= '9' else { return Some((rest, 0)) }
        seed = seed * 10 + (c.to_int() - '0'.to_int()).to_uint64()
      }
      Some((rest.view(end_offset=at).to_owned(), seed))
    }
    None => Some((rest, 0))
  }
}

///|
/// Installs preview requests and returns the registry's change listener.
/// Scans are scheduled after rendering, on both browser backends.
pub fn[N : @vdom.DomNode] bind_previews(
  registry : @storybook.Registry[N],
  doc : N,
  listen~ : ((Request[N]) -> Unit) -> Unit,
  schedule~ : (() -> Unit) -> Unit,
  connect~ : (@tutuca.Host[N]) -> Unit,
  set_text~ : (N, String) -> Unit,
  css~ : String,
  links~ : Array[String],
  compile? : (Array[String], (String) -> Unit) -> Unit,
  known~ : Array[String],
  prefix~ : String,
) -> (String) -> Unit {
  let previews : Map[String, Preview[N]] = Map([])
  let styles : Ref[String] = Ref("")
  let classes = match compile {
    Some(compile) => {
      let all : Array[String] = [..known]
      Some(
        @dev.ClassCollector::new(known~, fresh => {
          all.append(fresh)
          compile(all.copy(), out => {
            styles.val = out
            for p in previews.values() {
              set_text(p.style, out)
            }
          })
        }),
      )
    }
    None => None
  }
  let changed = id => {
    if previews.get(id) is Some(p) {
      if classes is Some(c) {
        schedule(() => {
          // A queued scan must not inspect a preview after replacement or disposal.
          if previews.get(id) is Some(current) &&
            current.req.root.is_same_node(p.req.root) {
            c.scan(p.req.root)
          }
        })
      }
      let summary = registry.call(id, Show) catch { _ => return }
      (p.req.emit)("state", summary.to_json())
    }
  }
  listen(req => {
    guard parse_key(req.key, prefix) is Some((id, seed)) &&
      registry.stories.contains(id) else {
      return
    }
    for href in links {
      (req.adopt_link)(href)
    }
    if css != "" {
      ignore((req.adopt_css)(css))
    }
    let style = (req.adopt_css)(styles.val)
    previews[id] = { req, style, }
    registry.mount(id, doc, req.root, seed~, schedule~, connect~)
    (req.mount)(() => {
      if previews.get(id) is Some(p) && p.req.root.is_same_node(req.root) {
        previews.remove(id)
        registry.unmount(id)
      }
    })
    changed(id)
  })
  changed
}
