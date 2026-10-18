// Port of test/paths/message-context.test.js: tasks derived in a loop handler (a send to a
// child, an ask and its reply, a notify) start from the component, wherever it is placed.

///|
struct McChild {
  count : Int32
}

///|
enum McChildMsg {
  Inc
  Act(Int32)
} derive(Debug)

///|
struct McCell {
  label : String
}

///|
struct McRow {
  cells : Vec[McCell]
}

///|
struct McPanel {
  rows : Vec[McRow]
  child : McChild
  picked : Int32?
  result : String?
}

///|
enum McPanelMsg {
  Act(Int32)
  Loaded(AskResult[String])
} derive(Debug)

///|
let mc_changed : Signal[Unit] = Signal::new("changed")

///|
let mc_load : Ask[Unit, String] = Ask::new("load")

///|
let mc_seen : Array[String] = []

///|
let mc_child : Component[McChild, McChildMsg] = component(
  "Child",
  view=() => span([], []),
  update=(s, msg, _) => {
    match msg {
      Inc => { count: s.count + 1, }
      Act(_) => s
    }
  },
)

///|
let mc_child_lens : Lens[McPanel, McChild] = field("child", p => p.child, (
  p,
  child,
) => { ..p, child, })

///|
let mc_panel : Component[McPanel, McPanelMsg] = component(
  "Panel",
  view=() => {
    div([], [
      each(
        p => p.rows.iter(),
        section([], [
          each(
            it => it.value.cells.iter(),
            button([on_event(Click, (it, _) => Some(Act(it.index)))], [
              show(it => it.value.label),
            ]),
          ),
        ]),
      ),
    ])
  },
  update=(s, msg, ctx) => {
    match msg {
      Act(key) => {
        ctx.send_to(mc_child, _ => mc_child_lens, Inc)
        ctx.ask(mc_load, (), r => Some(Loaded(r)))
        ctx.notify(mc_changed, ())
        { ..s, picked: Some(key), }
      }
      Loaded(Ok(value)) => {
        ctx.send_to(mc_child, _ => mc_child_lens, Inc)
        { ..s, result: Some(value), }
      }
      Loaded(_) => s
    }
  },
  on=[
    mc_changed.on((s, _, _) => {
      mc_seen.push("panel")
      s
    }),
  ],
)

///|
fn mc_new_panel() -> McPanel {
  {
    rows: Vec::of([{ cells: Vec::of([{ label: "cell", }]), }]),
    child: { count: 0, },
    picked: None,
    result: None,
  }
}

///|
/// Starts `comp`, clicks the button, resolves the ask later and checks the panel `panel_of`
/// finds and who heard the notify.
fn[R, M] mc_check(
  comp : Component[R, M],
  state : R,
  panel_of : (R) -> McPanel,
  expect_seen : Array[String],
) -> Unit raise {
  mc_seen.clear()
  let pending : Array[(AskResult[String]) -> Unit] = []
  let scope = Scope::new()
  // An async handler: it replies after the task that asked has committed.
  scope.handle(mc_load, (_, reply) => pending.push(reply))
  let (host, app, root, reports) = jp_mount(comp, state, scope~)
  jp_click(host, jp_elems(root, "button")[0])
  for reply in pending {
    reply(Ok("loaded"))
  }
  host.drain()
  assert_eq(jp_failures(reports), [])
  let updated = panel_of(app.state())
  assert_eq(updated.picked, Some(0))
  assert_eq(updated.child.count, 2)
  assert_eq(updated.result, Some("loaded"))
  assert_eq(mc_seen, expect_seen)
}

///|
fn[R] mc_root_of(name : String, lens : Lens[R, McPanel]) -> Component[R, Unit] {
  component("Root", view=() => main_([], [render(lens, mc_panel)]), on=[
    mc_changed.on((s, _, _) => {
      mc_seen.push(name)
      s
    }),
  ])
}

///|
test "loop handlers route derived tasks from their component: root" {
  mc_check(mc_panel, mc_new_panel(), p => p, [])
}

///|
struct McFieldRoot {
  panel : McPanel
}

///|
test "loop handlers route derived tasks from their component: field" {
  let lens : Lens[McFieldRoot, McPanel] = field("panel", r => r.panel, (
    _,
    panel,
  ) => { panel, })
  mc_check(mc_root_of("root", lens), { panel: mc_new_panel(), }, r => r.panel, [
    "root",
  ])
}

///|
struct McStorage {
  panel : McPanel
}

///|
struct McStoreRoot {
  storage : McStorage
}

///|
let mc_panel_p : Provide[McPanel] = Provide::new("panel")

///|
test "loop handlers route derived tasks from their component: provided" {
  let storage : Lens[McStoreRoot, McStorage] = field(
    "storage",
    r => r.storage,
    (_, storage) => { storage, },
  )
  let panel : Lens[McStorage, McPanel] = field("panel", s => s.panel, (_, panel) => {
    panel,
  })
  let root : Component[McStoreRoot, Unit] = component(
    "Root",
    view=() => main_([], [render_provided(mc_panel_p, mc_panel)]),
    provides=[mc_panel_p.from(storage.then(panel))],
    on=[
      mc_changed.on((s, _, _) => {
        mc_seen.push("root")
        s
      }),
    ],
  )
  mc_check(
    root,
    { storage: { panel: mc_new_panel(), }, },
    r => r.storage.panel,
    ["root"],
  )
}

///|
struct McGroup {
  panels : Vec[McPanel]
}

///|
struct McGroupsRoot {
  groups : Vec[McGroup]
}

///|
test "loop handlers route derived tasks from their component: nested loops" {
  let groups : Items[McGroupsRoot, Int32, McGroup] = items(
    "groups",
    r => r.groups,
    (_, groups) => { groups, },
  )
  let panels : Items[McGroup, Int32, McPanel] = items("panels", g => g.panels, (
    _,
    panels,
  ) => { panels, })
  let group_panels = groups.then(panels)
  let root : Component[McGroupsRoot, Unit] = component(
    "Root",
    view=() => {
      main_([], [
        each(
          r => r.groups.iter(),
          section([], [
            each(
              it => it.value.panels.iter(),
              h("article", [], [
                render_key(
                  group_panels,
                  it => (it.up.index, it.index),
                  mc_panel,
                ),
              ]),
            ),
          ]),
        ),
      ])
    },
    on=[
      mc_changed.on((s, _, _) => {
        mc_seen.push("root")
        s
      }),
    ],
  )
  mc_check(
    root,
    { groups: Vec::of([{ panels: Vec::of([mc_new_panel()]), }]), },
    r => r.groups.at(0).panels.at(0),
    ["root"],
  )
}

// forwardAt: messages are typed per component, so forwarding is a `send_to` with the child's
// own message; the DOM event stays on the parent's context.

///|
struct McFwdChild {
  got : Int32?
}

///|
struct McParent {
  child : McFwdChild
  cause : String?
}

///|
enum McParentMsg {
  Act(Int32)
} derive(Debug)

///|
test "forwardAt from an event handler forwards the sent message and keeps the DOM event as cause" {
  let child : Component[McFwdChild, McChildMsg] = component(
    "Child",
    view=() => span([], []),
    update=(s, msg, _) => {
      match msg {
        Act(n) => { got: Some(n), }
        Inc => s
      }
    },
  )
  let child_lens : Lens[McParent, McFwdChild] = field("child", p => p.child, (
    p,
    child,
  ) => { ..p, child, })
  let parent : Component[McParent, McParentMsg] = component(
    "Parent",
    view=() => {
      div([], [button([on_click(Act(7))], []), render(child_lens, child)])
    },
    update=(s, msg, ctx) => {
      let Act(n) = msg
      ctx.send_to(child, _ => child_lens, Act(n))
      { ..s, cause: ctx.event().map(e => e.name), }
    },
  )
  let (host, app, root, reports) = jp_mount(parent, {
    child: { got: None, },
    cause: None,
  })
  jp_click(host, jp_elems(root, "button")[0])
  assert_eq(jp_failures(reports), [])
  assert_eq(app.state().cause, Some("click"))
  // The child's state, as JS's `host.rootComponent.child.got`.
  assert_eq(app.state().child.got, Some(7))
}
