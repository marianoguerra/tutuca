// Helpers for the ports of test/paths/*.test.js.

///|
/// A dev host on a memdom <main> without a scheduler, recording every report but renders.
fn[S, M] jp_mount(
  comp : Component[S, M],
  state : S,
  scope~ : Scope = Scope::new(),
  renders~ : Bool = false,
  schedule? : (() -> Unit) -> Unit,
) -> (Host[@memdom.MemNode], App[S, M], @memdom.MemNode, Array[Report]) {
  let doc = @memdom.document()
  let root = doc.element("main")
  let host = Host::new(doc, root, dev=true, scope~, schedule?)
  let reports = []
  host.set_on_report(r => if renders || !(r is Rendered) { reports.push(r) })
  let app = host.start(comp, state)
  (host, app, root, reports)
}

///|
fn jp_elems(root : @memdom.MemNode, tag : String) -> Array[@memdom.MemNode] {
  let tag = tag.to_upper()
  root.descendants().filter(n => n.tag_name() == tag)
}

///|
fn jp_by_id(root : @memdom.MemNode, id : String) -> @memdom.MemNode {
  match
    root.descendants().iter().find_first(n => n.get_attribute("id") == Some(id)) {
    Some(n) => n
    None => abort("no #\{id}")
  }
}

///|
/// Clicks `node` and runs the queue.
fn jp_click(host : Host[@memdom.MemNode], node : @memdom.MemNode) -> Unit {
  ignore(host.handle_event(node, "click"))
  host.drain()
}

///|
/// Clicks each node in turn without running any of their tasks, as with queued work.
fn jp_queue_clicks(
  host : Host[@memdom.MemNode],
  nodes : Array[@memdom.MemNode],
) -> Unit {
  host.handling = true
  for node in nodes {
    ignore(host.handle_event(node, "click"))
  }
  host.handling = false
}

///|
fn jp_failures(reports : Array[Report]) -> Array[String] {
  reports.filter_map(r => {
    match r {
      TaskFailed(t, e) => Some("\{t.label}: \{e}")
      RenderFailed(e) => Some("render: \{e}")
      MessageInvalid(t, issues) => Some("\{t.label}: \{issues.join(",")}")
      StateInvalid(issues) => Some(issues.map(i => i.to_string()).join(";"))
      _ => None
    }
  })
}
