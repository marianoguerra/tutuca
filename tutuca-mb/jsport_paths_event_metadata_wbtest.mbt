// Port of test/paths/event-metadata.test.js: routing events through views without wrapper
// elements, keyed reorders, multi-root loops and the boundaries of a rendered component.

///|
struct EmChild {
  count : Int32
}

///|
enum EmMsg {
  Inc
} derive(Debug)

///|
struct EmPanel {
  selected : Int32
  child : EmChild
  items : Vec[EmChild]
}

///|
struct EmRoot {
  panel : EmPanel
}

///|
let em_changed : Signal[Unit] = Signal::new("changed")

///|
let em_seen : Array[String] = []

///|
let em_child_p : Provide[EmChild] = Provide::new("child")

///|
fn em_wrapperless(source : String) -> Unit raise {
  em_seen.clear()
  let child : Component[EmChild, EmMsg] = component(
    "Child",
    view=() => h("i", [], []),
    views=() => {
      [("compact", button([on_click(Inc)], [span([], [txt("increment")])]))]
    },
    update=(s, _, ctx) => {
      ctx.notify(em_changed, ())
      { count: s.count + 1, }
    },
  )
  let child_lens : Lens[EmPanel, EmChild] = field("child", p => p.child, (
    p,
    child,
  ) => { ..p, child, })
  let items : Items[EmPanel, Int32, EmChild] = items("items", p => p.items, (
    p,
    items,
  ) => { ..p, items, })
  let rendered : View[EmPanel, EmMsg] = match source {
    "field" => render(child_lens, child)
    "seqItem" => render_key(items, p => p.selected, child)
    _ => render_provided(em_child_p, child)
  }
  // No wrapper elements: the root renders the panel, the panel pushes a view and renders.
  let panel : Component[EmPanel, EmMsg] = component(
    "Panel",
    view=() => push_view(_ => "compact", rendered),
    provides=[em_child_p.from(child_lens)],
    on=[
      em_changed.on((s, _, _) => {
        em_seen.push("panel")
        s
      }),
    ],
  )
  let root : Component[EmRoot, EmMsg] = component(
    "Root",
    view=() => {
      render(
        field("panel", (r : EmRoot) => r.panel, (_, panel) => { panel, }),
        panel,
      )
    },
    on=[
      em_changed.on((s, _, _) => {
        em_seen.push("root")
        s
      }),
    ],
  )
  let c = EmChild::{ count: 0, }
  let (host, app, dom, reports) = jp_mount(root, {
    panel: { selected: 1, child: c, items: Vec::of([c, c]), },
  })
  jp_click(host, jp_elems(dom, "span")[0])
  assert_eq(jp_failures(reports), [])
  let p = app.state().panel
  let count = if source == "seqItem" {
    p.items.at(1).count
  } else {
    p.child.count
  }
  assert_eq(count, 1)
  assert_eq(em_seen, ["panel", "root"])
}

///|
test "wrapperless component chain preserves field paths and named view ownership" {
  em_wrapperless("field")
}

///|
test "wrapperless component chain preserves seqItem paths and named view ownership" {
  em_wrapperless("seqItem")
}

///|
test "wrapperless component chain preserves provided paths and named view ownership" {
  em_wrapperless("provided")
}

// --- keyed reorder -------------------------------------------------------------------------

///|
struct EmPicks {
  picked : Array[String]
  items : Vec[String]
}

///|
enum EmPickMsg {
  Pick(Int32)
  Reverse
} derive(Debug)

///|
test "top-level each routes every item after keyed reorder" {
  let root : Component[EmPicks, EmPickMsg] = component(
    "Root",
    view=() => {
      each(
        s => s.items.iter(),
        button([on_event(Click, (it, _) => Some(Pick(it.index)))], [
          show(it => it.value),
        ]),
        key=(id, _) => id,
      )
    },
    update=(s, msg, _) => {
      match msg {
        Pick(i) => { ..s, picked: [..s.picked, s.items.at(i)], }
        Reverse => { picked: [], items: Vec::of(s.items.to_array().rev()), }
      }
    },
  )
  let (host, app, dom, reports) = jp_mount(root, {
    picked: [],
    items: Vec::of(["a", "b"]),
  })
  let (a, b) = match jp_elems(dom, "button") {
    [a, b] => (a, b)
    _ => abort("two buttons")
  }
  jp_click(host, a)
  jp_click(host, b)
  assert_eq(app.state().picked, ["a", "b"])
  app.send(Reverse)
  host.drain()
  let now = jp_elems(dom, "button")
  // The keyed buttons moved: the same DOM nodes, in the new order.
  assert_true(physical_equal(now[0], b) && physical_equal(now[1], a))
  jp_click(host, b)
  jp_click(host, a)
  assert_eq(app.state().picked, ["b", "a"])
  assert_eq(jp_failures(reports), [])
  // Loop items write no metadata of their own.
  assert_false(dom.inner_html().contains("\"t\":\"it\""))
}

// --- multi-root loops ----------------------------------------------------------------------

///|
struct EmVisible {
  visible : Bool
}

///|
struct EmGroup {
  items : Vec[EmVisible]
}

///|
struct EmMulti {
  groups : Vec[EmGroup]
  picked : Array[Int32?]
}

///|
enum EmMultiMsg {
  PickAt(Int32?)
} derive(Debug)

///|
test "nested multi-root loops retain paths across text, comments, empty scopes and siblings" {
  let pick : ViewAt[
    Item[Item[EmMulti, EmGroup], EmVisible],
    EmMulti,
    EmMultiMsg,
  ] = button([on_event(Click, (it, _) => Some(PickAt(Some(it.index))))], [])
  let root : Component[EmMulti, EmMultiMsg] = component(
    "Root",
    view=() => {
      frag([
        each(
          s => s.groups.iter(),
          each(
            g => g.value.items.iter(),
            // An empty scope for the invisible items, several roots for the visible one.
            when(
              it => it.value.visible,
              frag([
                pick,
                txt("text between roots"),
                comment("ordinary comment"),
                scope(_ => (), frag([])),
                pick,
              ]),
            ),
          ),
        ),
        button([on_click(PickAt(None))], []),
      ])
    },
    update=(s, msg, _) => {
      let PickAt(k) = msg
      { ..s, picked: [..s.picked, k], }
    },
  )
  let (host, app, dom, reports) = jp_mount(root, {
    groups: Vec::of([
      {
        items: Vec::of([
          { visible: false, },
          { visible: true, },
          { visible: false, },
        ]),
      },
    ]),
    picked: [],
  })
  for button in jp_elems(dom, "button") {
    jp_click(host, button)
  }
  assert_eq(jp_failures(reports), [])
  assert_eq(app.state().picked, [Some(1), Some(1), None])
  // An element the host didn't render has no handler, whatever it looks like.
  let unmanaged = host.doc.element("button")
  dom.append_child(unmanaged)
  jp_click(host, unmanaged)
  assert_eq(app.state().picked, [Some(1), Some(1), None])
  // As JS: an unmanaged element carrying a rendered handler id is ignored, because it is
  // outside the metadata comments of the component that id belongs to.
  let sibling = jp_elems(dom, "button")[2]
  let forged = host.doc.element("button")
  forged.set_attribute(
    handler_attr,
    sibling.get_attribute(handler_attr).unwrap(),
  )
  dom.append_child(forged)
  jp_click(host, forged)
  assert_eq(app.state().picked, [Some(1), Some(1), None])
}

// --- component boundaries --------------------------------------------------------------------

///|
struct EmCounter {
  count : Int32
}

///|
struct EmList {
  picked : Array[Int32]
  items : Vec[EmCounter]
}

///|
enum EmListMsg {
  PickIt(Int32)
} derive(Debug)

///|
test "renderIt promotes only its own scope and stops event lookup at its view" {
  let item : Component[EmCounter, EmMsg] = component(
    "Item",
    view=() => frag([button([on_click(Inc)], []), h("i", [], [])]),
    update=(s, _, _) => { count: s.count + 1, },
  )
  let items : Items[EmList, Int32, EmCounter] = items("items", s => s.items, (
    s,
    items,
  ) => { ..s, items, })
  let root : Component[EmList, EmListMsg] = component(
    "Root",
    view=() => {
      each(
        s => s.items.iter(),
        section([on_event(Click, (it, _) => Some(PickIt(it.index)))], [
          render_key(items, it => it.index, item),
          button([on_event(Click, (it, _) => Some(PickIt(it.index)))], []),
        ]),
      )
    },
    update=(s, msg, _) => {
      let PickIt(k) = msg
      { ..s, picked: [..s.picked, k], }
    },
  )
  let (host, app, dom, reports) = jp_mount(root, {
    picked: [],
    items: Vec::of([{ count: 0, }]),
  })
  let (child, sibling) = match jp_elems(dom, "button") {
    [c, s] => (c, s)
    _ => abort("two buttons")
  }
  jp_click(host, child)
  // The <i> is the item's: its click stops at the item's view, which has no handler for it.
  jp_click(host, jp_elems(dom, "i")[0])
  assert_eq(app.state().items.at(0).count, 1)
  assert_eq(app.state().picked, [])
  jp_click(host, sibling)
  jp_click(host, jp_elems(dom, "section")[0])
  assert_eq(app.state().picked, [0, 0])
  assert_eq(jp_failures(reports), [])
}
