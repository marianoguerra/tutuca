// Port of test/paths/task-paths.test.js: which state a task's route reads. DOM events fix
// their route when they happen; `send_to` reads the state its producer commits; failures roll
// a producer back with what it queued.

///|
struct TpItem {
  count : Int32
  selected : Int32
  children : Vec[TpItem]
  reply : String?
}

///|
enum TpItemMsg {
  Inc
  Request
  Bump
  Replied(AskResult[String])
} derive(Debug)

///|
struct TpRoot {
  selected : Int32
  committed : Int32
  items : Vec[TpItem]
}

///|
enum TpRootMsg {
  Queue
  Change
  Fail
  Keep
} derive(Debug)

///|
fn tp_item(count~ : Int32 = 0, children~ : Array[TpItem] = []) -> TpItem {
  { count, selected: 0, children: Vec::of(children), reply: None, }
}

///|
let tp_changed : Signal[Unit] = Signal::new("changed")

///|
let tp_load : Ask[Unit, String] = Ask::new("load")

///|
let tp_selected_p : Provide[TpItem] = Provide::new("selectedItem")

///|
let tp_seen : Array[String] = []

///|
let tp_items : Items[TpRoot, Int32, TpItem] = items("items", r => r.items, (
  r,
  items,
) => { ..r, items, })

///|
let tp_children : Items[TpItem, Int32, TpItem] = items(
  "children",
  i => i.children,
  (i, children) => { ..i, children, },
)

///|
let tp_item_once : Once[Component[TpItem, TpItemMsg]] = Once::new()

///|
let tp_item_update : Ref[
  (TpItem, TpItemMsg, Ctx[TpItem, TpItemMsg]) -> TpItem raise,
] = Ref((s, _, _) => s)

///|
/// The item component; `tp_item_update` is its update, so each test sets its own handlers.
fn tp_item_c() -> Component[TpItem, TpItemMsg] {
  tp_item_once.get(() => {
    component(
      "Item",
      view=() => button([attr("id", "item"), on_click(Inc)], [txt("inc")]),
      update=(s, msg, ctx) => (tp_item_update.val)(s, msg, ctx),
      on=[
        tp_changed.on((s, _, _) => {
          tp_seen.push("item")
          s
        }),
      ],
    )
  })
}

///|
fn tp_default_item(
  s : TpItem,
  msg : TpItemMsg,
  _ : Ctx[TpItem, TpItemMsg],
) -> TpItem {
  match msg {
    Inc => { ..s, count: s.count + 1, }
    _ => s
  }
}

///|
/// A root with a button per message in `buttons`, rendering the selected item (through a
/// provider when `provided`).
fn tp_setup(
  buttons : Array[(String, TpRootMsg)],
  update : (TpRoot, TpRootMsg, Ctx[TpRoot, TpRootMsg]) -> TpRoot raise,
  item_update? : (TpItem, TpItemMsg, Ctx[TpItem, TpItemMsg]) -> TpItem raise,
  provided~ : Bool = false,
  scope~ : Scope = Scope::new(),
  start~ : TpRoot = {
    selected: 0,
    committed: 0,
    items: Vec::of([tp_item(), tp_item()]),
  },
  schedule? : (() -> Unit) -> Unit,
  extra~ : View[TpRoot, TpRootMsg] = empty(),
) -> (
  Host[@memdom.MemNode],
  App[TpRoot, TpRootMsg],
  @memdom.MemNode,
  Array[Report],
) {
  tp_seen.clear()
  tp_item_update.val = match item_update {
    Some(f) => f
    None => (s, msg, ctx) => tp_default_item(s, msg, ctx)
  }
  let rendered : View[TpRoot, TpRootMsg] = if provided {
    render_provided(tp_selected_p, tp_item_c())
  } else {
    render_key(tp_items, r => r.selected, tp_item_c())
  }
  let root : Component[TpRoot, TpRootMsg] = component(
    "Root",
    view=() => {
      div(
        [],
        [
          ..buttons.map(b => {
            button([attr("id", b.0), on_click(b.1)], [txt(b.0)])
          }),
          rendered,
          extra,
        ],
      )
    },
    update~,
    provides=[tp_selected_p.at(tp_items, r => r.selected)],
    on=[
      tp_changed.on((s, _, _) => {
        tp_seen.push("root")
        s
      }),
    ],
  )
  jp_mount(root, start, scope~, renders=true, schedule?)
}

///|
fn tp_counts(app : App[TpRoot, TpRootMsg]) -> Array[Int32] {
  app.state().items.map(i => i.count).to_array()
}

///|
fn tp_click_ids(
  host : Host[@memdom.MemNode],
  dom : @memdom.MemNode,
  ids : Array[String],
) -> Unit {
  jp_queue_clicks(host, ids.map(id => jp_by_id(dom, id)))
}

///|
test "generated paths capture producer commit before intervening tasks run" {
  let (host, app, dom, reports) = tp_setup(
    [("queue", Queue), ("change", Change)],
    (s, msg, ctx) => {
      match msg {
        Queue => {
          ctx.send_to(tp_item_c(), r => tp_items.at(r.selected), Inc)
          { ..s, selected: 1, }
        }
        _ => { ..s, selected: 0, }
      }
    },
  )
  tp_click_ids(host, dom, ["queue", "change"])
  host.drain()
  assert_eq(tp_counts(app), [0, 1])
  assert_eq(app.state().selected, 0)
  assert_eq(jp_failures(reports), [])
}

///|
test "DOM event paths retain event-time selection behind older queued work" {
  let (host, app, dom, _) = tp_setup([("change", Change)], (s, _, _) => {
    ..s,
    selected: 1,
  })
  tp_click_ids(host, dom, ["change", "item"])
  host.drain()
  assert_eq(tp_counts(app), [1, 0])
}

///|
suberror TpBoom {
  TpBoom
}

///|
test "failed producers discard drafts and children but preserve older tasks" {
  let (host, app, dom, reports) = tp_setup([("fail", Fail), ("keep", Keep)], (
    s,
    msg,
    ctx,
  ) => {
    match msg {
      Fail => {
        let _ = { ..s, selected: 1, }
        ctx.send_to(tp_item_c(), r => tp_items.at(r.selected), Inc)
        raise TpBoom
      }
      _ => { ..s, committed: s.committed + 1, }
    }
  })
  tp_click_ids(host, dom, ["fail", "keep"])
  host.drain()
  assert_eq(app.state().selected, 0)
  assert_eq(app.state().committed, 1)
  assert_eq(tp_counts(app), [0, 0])
  assert_eq(jp_failures(reports), [
    "Root.Fail: marianoguerra/tutuca.TpBoom.TpBoom",
  ])
  assert_true(reports.last() is Some(Rendered))
  assert_true(dom.descendants().any(n => n.get_attribute("id") == Some("item")))
  assert_false(host.handling)
}

///|
test "child path preparation failure rolls back the producer and all its children" {
  // Divergent: a send_to's lens is computed from the committed state and can't fail to
  // freeze, so the producer commits; the child whose lens finds nothing fails when it runs.
  let kept : Ref[Ctx[TpRoot, TpRootMsg]?] = Ref(None)
  let missing : Lens[TpRoot, TpItem] = Lens::partial("missing", _ => None, (
    r,
    _,
  ) => r)
  let (host, app, dom, reports) = tp_setup([("fail", Fail), ("keep", Keep)], (
    s,
    msg,
    ctx,
  ) => {
    match msg {
      Fail => {
        kept.val = Some(ctx)
        ctx.send_to(tp_item_c(), r => tp_items.at(r.selected), Inc)
        ctx.send_to(tp_item_c(), _ => missing, Inc)
        { ..s, selected: 1, }
      }
      _ => { ..s, committed: s.committed + 1, }
    }
  })
  tp_click_ids(host, dom, ["fail", "keep"])
  host.drain()
  assert_eq(app.state().selected, 1)
  assert_eq(app.state().committed, 1)
  assert_eq(tp_counts(app), [0, 1])
  assert_eq(jp_failures(reports), [
    "Item.Inc: marianoguerra/tutuca.RouteError.RouteError",
  ])
  // A retained context must not revive children of a finished transaction.
  kept.val.unwrap().send_to(tp_item_c(), _ => tp_items.at(0), Inc)
  assert_eq(host.pending(), 0)
}

///|
fn tp_async_reply(rejected : Bool) -> Unit raise {
  let pending : Ref[((AskResult[String]) -> Unit)?] = Ref(None)
  let scope = Scope::new()
  scope.handle(tp_load, (_, reply) => pending.val = Some(reply))
  let (host, app, dom, reports) = tp_setup(
    [("queue", Queue), ("change", Change)],
    (s, msg, ctx) => {
      match msg {
        Queue => {
          ctx.send_to(tp_item_c(), r => tp_items.at(r.selected), Request)
          { ..s, selected: 1, }
        }
        _ => { ..s, selected: 0, }
      }
    },
    item_update=(s, msg, ctx) => {
      match msg {
        Inc => { ..s, count: s.count + 1, }
        Request => {
          ctx.ask(tp_load, (), r => Some(Replied(r)))
          s
        }
        Replied(r) => {
          ctx.send(Inc)
          let reply = match r {
            Ok(v) | Err(v) => v
            NotFound => "not found"
          }
          { ..s, reply: Some(reply), }
        }
        Bump => s
      }
    },
    scope~,
  )
  tp_click_ids(host, dom, ["queue"])
  host.drain()
  let ask = reports
    .iter()
    .filter_map(r => {
      if r is TaskHandled(t) && t.kind == Ask {
        Some(t)
      } else {
        None
      }
    })
    .collect()
  assert_eq(ask.length(), 1)
  tp_click_ids(host, dom, ["change"])
  host.drain()
  pending.val.unwrap()(if rejected { Err("result") } else { Ok("result") })
  assert_eq(host.pending(), 1)
  // The reply goes where the ask came from, not to what is selected now.
  assert_eq(host.tasks[0].path, ask[0].path)
  assert_eq(host.tasks[0].kind, Reply)
  host.drain()
  assert_eq(app.state().items.at(1).reply, Some("result"))
  assert_eq(app.state().items.at(0).reply, None)
  assert_eq(tp_counts(app), [0, 1])
  assert_eq(jp_failures(reports), [])
}

///|
test "async success reply reuses captured caller path" {
  tp_async_reply(false)
}

///|
test "async error reply reuses captured caller path" {
  tp_async_reply(true)
}

///|
test "reentrant draining cannot execute children before their producer commits" {
  let drain : Ref[() -> Unit] = Ref(() => ())
  let (host, app, dom, _) = tp_setup([("queue", Queue)], (s, _, ctx) => {
    ctx.send_to(tp_item_c(), r => tp_items.at(r.selected), Inc)
    (drain.val)()
    { ..s, selected: 1, }
  })
  drain.val = () => host.handle_tasks()
  tp_click_ids(host, dom, ["queue"])
  host.drain()
  assert_eq(tp_counts(app), [0, 1])
}

///|
fn tp_events_during_render(render_fails : Bool) -> Unit raise {
  let ticks : Array[() -> Unit] = []
  let armed : Ref[(() -> Unit)?] = Ref(None)
  let duplicate = Ref(false)
  // While rendering: a click on the item, and keys that make the render fail if asked.
  let extra : View[TpRoot, TpRootMsg] = frag([
    show(_ => {
      if armed.val is Some(f) {
        armed.val = None
        f()
      }
      ""
    }),
    each(_ => (if duplicate.val { ["x", "x"] } else { [] }).iter(), txt(""), key=(
      v,
      _,
    ) => v),
  ])
  let (host, app, dom, reports) = tp_setup(
    [("change", Change)],
    (s, _, _) => { ..s, committed: s.committed + 1, },
    schedule=f => ticks.push(f),
    extra~,
  )
  ticks.clear()
  tp_click_ids(host, dom, ["change"])
  let checked = Ref(false)
  armed.val = Some(() => {
    ignore(host.handle_event(jp_by_id(dom, "item"), "click"))
    // The click's task waits: it doesn't run while the host renders, and no tick is
    // scheduled until the render is over (JS's `scheduled == 0` inside `render`).
    checked.val = app.state().items.at(0).count == 0 &&
      host.pending() == 1 &&
      ticks.length() == 0
  })
  duplicate.val = render_fails
  host.handle_tasks()
  duplicate.val = false
  assert_true(checked.val)
  assert_false(host.handling)
  if render_fails {
    assert_true(reports.iter().any(r => r is RenderFailed(_)))
  }
  assert_eq(app.state().committed, 1)
  assert_eq(ticks.length(), 1)
  ticks[0]()
  assert_eq(app.state().items.at(0).count, 1)
  assert_eq(host.pending(), 0)
}

///|
test "events during rendering wait for the next tick" {
  tp_events_during_render(false)
}

///|
test "events during rendering wait for the next tick even when rendering throws" {
  tp_events_during_render(true)
}

///|
test "dynamic selectors below provided frames capture commit and retain bubbling" {
  let (host, app, dom, reports) = tp_setup(
    [("change", Change)],
    (s, _, _) => { ..s, items: s.items.update(0, i => { ..i, selected: 0, }), },
    item_update=(s, msg, ctx) => {
      match msg {
        Inc => {
          ctx.send_to(tp_item_c(), i => tp_children.at(i.selected), Bump)
          { ..s, selected: 1, }
        }
        Bump => {
          ctx.notify(tp_changed, ())
          { ..s, count: s.count + 1, }
        }
        _ => s
      }
    },
    provided=true,
    start={
      selected: 0,
      committed: 0,
      items: Vec::of([tp_item(children=[tp_item(), tp_item()]), tp_item()]),
    },
  )
  tp_click_ids(host, dom, ["item", "change"])
  host.drain()
  assert_eq(app.state().items.at(0).children.map(c => c.count).to_array(), [
    0, 1,
  ])
  assert_eq(tp_seen, ["item", "root"])
  assert_eq(jp_failures(reports), [])
}
