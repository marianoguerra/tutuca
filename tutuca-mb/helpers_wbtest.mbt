///|
/// A dev host on a memdom <main>, without a scheduler: tests run the queue with `drain`.
fn[S, M] mount(
  comp : Component[S, M],
  state : S,
  dev~ : Bool = true,
  scope~ : Scope = Scope::new(),
) -> (Host[@memdom.MemNode], App[S, M], @memdom.MemNode, Array[Report]) {
  let doc = @memdom.document()
  let root = doc.element("main")
  let host = Host::new(doc, root, dev~, scope~)
  let reports = []
  host.set_on_report(r => {
    if !(r is (Rendered | TaskHandled(_))) {
      reports.push(r)
    }
  })
  let app = host.start(comp, state)
  (host, app, root, reports)
}

///|
fn report_text(r : Report) -> String {
  match r {
    Rendered => "rendered"
    TaskHandled(t) => "handled \{t.label}"
    TaskFailed(t, e) => "failed \{t.label}: \{e}"
    StateInvalid(issues) =>
      "invalid " + issues.map(i => i.to_string()).join("; ")
    MessageInvalid(t, issues) =>
      "message invalid \{t.label}: \{issues.join(",")}"
    RenderFailed(e) => "render failed: \{e}"
  }
}

///|
/// Clicks the first element with this tag (and text, if given).
fn click(
  host : Host[@memdom.MemNode],
  root : @memdom.MemNode,
  tag : String,
  text? : String,
  event~ : String = "click",
) -> Unit {
  let tag = tag.to_upper()
  let target = root
    .descendants()
    .iter()
    .find_first(n => {
      n.tag_name() == tag && (text is None || Some(n.text_content()) == text)
    })
  match target {
    Some(node) => ignore(host.handle_event(node, event))
    None => abort("no <\{tag}> to click")
  }
  host.drain()
}

///|
struct Picker {
  names : Array[String]
  picked : Array[String]
}

///|
enum PickerMsg {
  Pick(String)
  Rotate
} derive(Debug)

///|
test "an event's message reads the state its task runs on, as JS evaluates send arguments" {
  let picker : Component[Picker, PickerMsg] = component(
    "Picker",
    view=() => {
      div([], [
        each(
          s => s.names.iter(),
          button([on_event(Click, (it, _) => Some(Pick(it.value)))], [
            show(it => it.value),
          ]),
        ),
      ])
    },
    update=(s, msg, _) => {
      match msg {
        Pick(n) => { ..s, picked: [..s.picked, n], }
        Rotate => { ..s, names: [..s.names[1:].to_owned(), s.names[0]], }
      }
    },
  )
  let doc = @memdom.document()
  let root = doc.element("main")
  let ticks : Array[() -> Unit] = []
  let host = Host::new(doc, root, schedule=f => ticks.push(f))
  let app = host.start(picker, { names: ["a", "b"], picked: [], })
  while ticks.pop() is Some(f) {
    f()
  }
  // Queued, not yet run or rendered: the first button still shows "a".
  app.send(Rotate)
  click(host, root, "button", text="a")
  while ticks.pop() is Some(f) {
    f()
  }
  // The click's task ran after Rotate: the first item is "b" by then.
  assert_eq(app.state().picked, ["b"])
}
