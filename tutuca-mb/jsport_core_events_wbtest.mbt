// Ports of test/core/events.test.js: the IR walk, handler sites and event routing.

///|
struct EvCounter {
  id : String
  count : Int32
} derive(Debug)

///|
enum EvCounterMsg {
  EvInc
} derive(Debug)

///|
let ev_counter : Component[EvCounter, EvCounterMsg] = component(
  "Counter",
  view=() => button([on_click(EvInc)], [show(s => s.count.to_string())]),
  update=(s, msg, _) => {
    match msg {
      EvInc => { ..s, count: s.count + 1, }
    }
  },
)

///|
fn ev_kind(ir : Ir) -> String {
  match ir {
    IText(_) => "IText"
    IShow => "IShow"
    IElem(_) => "IElem"
    IIf(_, _) => "IIf"
    IFrag(_) => "IFrag"
    IEach(_) => "IEach"
    IScope(_) => "IScope"
    IRender(_) => "IRender"
    IPushView(_, _) => "IPushView"
    IProvided(_, _) => "IProvided"
  }
}

///|
fn ev_walk(ir : Ir) -> Array[String] {
  let seen = []
  ir.walk(n => seen.push(ev_kind(n)))
  seen
}

///|
struct EvS {
  on : Bool
  items : Vec[String]
} derive(Debug)

///|
enum EvMsg {
  EvGo
  EvNamed(String)
} derive(Debug)

///|
test "the default walker walks parents first, attributes before children and handlers" {
  // Attribute values and handler arguments are closures here, not nodes: the IR holds the
  // structure, and an element's attribute and event names.
  let v : View[EvS, EvMsg] = div(
    [class_(s => if s.on { "a" } else { "b" }), on_click(EvGo)],
    [
      each(
        s => s.items.iter(),
        scope(
          _ => (),
          push_view(_ => "compact", h("i", [], [show(w => w.up.value)])),
        ),
      ),
    ],
  )
  let ir = v.ir()
  assert_eq(ev_walk(ir), [
    "IElem", "IEach", "IScope", "IPushView", "IElem", "IShow",
  ])
  guard ir is IElem(e) else { fail("expected an element") }
  assert_eq(e.dyns, ["class"])
  assert_eq(e.events.map(ev => ev.dom_name()), ["click"])
}

///|
test "Walker reads children of custom nodes through childNodes" {
  // A custom node is an Ext: it states its IR, which the walk follows.
  let listed : View[EvS, EvMsg] = Ext(IScope(IText("opaque")), _ => PFrag([]))
  let v : View[EvS, EvMsg] = p([], [listed, Ext(IScope(IShow), _ => PFrag([]))])
  assert_eq(ev_walk(v.ir()), ["IElem", "IScope", "IText", "IScope", "IShow"])
}

///|
test "elements with handlers get unique IDs, and the spec maps them without copying" {
  let comp : Component[EvSeen, EvMsg] = component(
    "C",
    view=() => {
      ul([on_click(EvNamed("list"))], [
        li([on_click(EvNamed("a"))], []),
        li([], []),
        li([on_input(_ => EvNamed("c")), on(Blur, EvNamed("d"))], []),
      ])
    },
    update=ev_record,
  )
  assert_eq(comp.event_names(), ["click", "input", "blur"])
  let (host, app, root, _) = mount(comp, { seen: [], })
  let lis = elems(root, "li")
  let ids = lis.map(n => n.get_attribute(handler_attr))
  assert_eq(ids, [Some("·#2"), None, Some("·#3")])
  let list = root.find("ul").unwrap()
  assert_eq(list.get_attribute(handler_attr), Some("·#1"))
  let sites = host.handler_sites()
  sites.sort_by((a, b) => a.0.compare(b.0))
  assert_eq(sites, [
    ("·#1", ["click"]),
    ("·#2", ["click"]),
    ("·#3", ["input", "blur"]),
  ])
  // Each id maps to its own element's messages, in declaration order.
  assert_true(fire(host, list, "click"))
  assert_true(fire(host, lis[0], "click"))
  assert_true(fire(host, lis[2], "input"))
  assert_true(fire(host, lis[2], "blur"))
  assert_eq(app.state().seen, ["list", "a", "c", "d"])
}

///|
test "compilation collects handlers in attributes and children, not in action arguments" {
  // Both branches of a condition are collected, the one not rendered too. Attribute values
  // and messages are typed values, so a view can't sit in them.
  let comp : Component[EvCond, EvMsg] = component(
    "C",
    view=() => {
      div([on_click(EvNamed("parent"))], [
        if_(
          s => s.on,
          h("i", [on_click(EvNamed("yes"))], []),
          h("i", [on_dblclick(EvNamed("no"))], []),
        ),
        button([on(Focus, EvNamed("child"))], []),
      ])
    },
    update=(s, msg, _) => {
      match msg {
        EvNamed(n) => { ..s, seen: [..s.seen, n], }
        EvGo => s
      }
    },
  )
  assert_eq(comp.event_names(), ["click", "dblclick", "focus"])
  // Each element's handler sends its own message, in either branch.
  let (host, app, root, _) = mount(comp, { on: true, seen: [], })
  assert_true(fire(host, root.find("div").unwrap(), "click"))
  assert_true(fire(host, root.find("i").unwrap(), "click"))
  assert_true(fire(host, root.find("button").unwrap(), "focus"))
  assert_eq(app.state().seen, ["parent", "yes", "child"])
  let (host, app, root, _) = mount(comp, { on: false, seen: [], })
  assert_true(fire(host, root.find("i").unwrap(), "dblclick"))
  assert_eq(app.state().seen, ["no"])
}

///|
struct EvCond {
  on : Bool
  seen : Array[String]
} derive(Debug)

///|
struct EvSeen {
  seen : Array[String]
} derive(Debug)

///|
fn ev_record(s : EvSeen, msg : EvMsg, _ : Ctx[EvSeen, EvMsg]) -> EvSeen {
  match msg {
    EvNamed(n) => { seen: [..s.seen, n], }
    EvGo => s
  }
}

///|
test "shared templates keep one ID across views and components" {
  // Divergent: a view is a value lowered where it is used, so a shared template gets an id
  // per use; ids are positions in the lowering, not identities of the template.
  let shared : View[EvSeen, EvMsg] = button([on_click(EvNamed("shared"))], [
    txt("shared"),
  ])
  let a : Component[EvSeen, EvMsg] = component(
    "A",
    view=() => div([on_click(EvNamed("a"))], [shared]),
    views=() => [("compact", h("section", [], [shared]))],
    update=ev_record,
  )
  let b : Component[EvSeen, EvMsg] = component(
    "B",
    view=() => shared,
    update=ev_record,
  )
  let (host, app, root, _) = mount(a, { seen: [], })
  click(host, root, "button")
  assert_eq(app.state().seen, ["shared"])
  assert_eq(
    root.find("button").unwrap().get_attribute(handler_attr),
    Some("·#2"),
  )
  let (host, app, root) = mount_view(a, { seen: [], }, "compact")
  click(host, root, "button")
  assert_eq(app.state().seen, ["shared"])
  assert_eq(
    root.find("button").unwrap().get_attribute(handler_attr),
    Some("·#3"),
  )
  let (host, app, root, _) = mount(b, { seen: [], })
  click(host, root, "button")
  assert_eq(app.state().seen, ["shared"])
  assert_eq(
    root.find("button").unwrap().get_attribute(handler_attr),
    Some("·#1"),
  )
}

///|
test "rendering adds data-eid only to elements with handlers" {
  let comp : Component[EvS, EvMsg] = component("Root", view=() => {
    div([], [button([on_click(EvGo)], []), p([], [])])
  })
  let (_, _, root, _) = mount(comp, { on: false, items: Vec::new(), })
  assert_eq(
    root.find("button").unwrap().get_attribute(handler_attr),
    Some("·#1"),
  )
  assert_eq(root.find("p").unwrap().get_attribute(handler_attr), None)
  assert_eq(root.find("div").unwrap().get_attribute(handler_attr), None)
}

///|
test "a click runs the handler on a draft and re-renders the produced state" {
  let before = EvCounter::{ id: "", count: 0, }
  let (host, app, root, _) = mount(ev_counter, before)
  click(host, root, "button")
  click(host, root, "button")
  assert_eq(app.state().count, 2)
  // Immutable by construction: the starting state is untouched.
  assert_eq(before.count, 0)
  assert_eq(root.text_content(), "2")
}

///|
struct EvForm {
  name : String
  done : Bool
} derive(Debug)

///|
enum EvFormMsg {
  SetName(String)
  SetDone(Bool)
} derive(Debug)

///|
test "targetValue reads values and checkbox state" {
  let form_comp : Component[EvForm, EvFormMsg] = component(
    "Form",
    view=() => {
      form([], [
        input([value(s => s.name), on_input(v => SetName(v))]),
        // on_input on a checkbox reads its checked state, as targetValue does.
        input([attr("type", "checkbox"), on_input(v => SetDone(v == "true"))]),
      ])
    },
    update=(s, msg, _) => {
      match msg {
        SetName(name) => { ..s, name, }
        SetDone(done) => { ..s, done, }
      }
    },
  )
  let (host, app, root, _) = mount(form_comp, { name: "", done: false, })
  let inputs = elems(root, "input")
  inputs[0].set_value("Ada")
  assert_true(fire(host, inputs[0], "input"))
  inputs[1].set_checked(true)
  assert_true(fire(host, inputs[1], "input"))
  assert_eq(app.state().name, "Ada")
  assert_eq(app.state().done, true)
}

///|
test "a handler's return value replaces the component" {
  // update always returns the next state: there is no draft to mutate instead.
  let reset : Component[EvCounter, EvCounterMsg] = component(
    "Reset",
    view=() => button([on_click(EvInc)], []),
    update=(_, _, _) => { id: "fresh", count: 0, },
  )
  let (host, app, root, _) = mount(reset, { id: "", count: 5, })
  click(host, root, "button")
  assert_eq(app.state().count, 0)
  assert_eq(app.state().id, "fresh")
}

///|
suberror EvBoom {
  EvBoom
}

///|
test "a throwing handler keeps the state and reports taskFailed" {
  let bad : Component[EvCounter, EvCounterMsg] = component(
    "Bad",
    view=() => button([on_click(EvInc)], []),
    update=(_, _, _) => raise EvBoom,
  )
  let start = EvCounter::{ id: "", count: 0, }
  let (host, app, root, reports) = mount(bad, start)
  click(host, root, "button")
  assert_true(physical_equal(app.state(), start))
  assert_eq(reports.map(report_text), [
    "failed Bad.EvInc: marianoguerra/tutuca.EvBoom.EvBoom",
  ])
}

///|
test "events on the host, unmanaged children and unknown IDs are ignored" {
  let start = EvCounter::{ id: "", count: 0, }
  let (host, app, root, _) = mount(ev_counter, start)
  assert_false(fire(host, root, "click"))
  let unmanaged = host.doc.element("button")
  root.append_child(unmanaged)
  assert_false(fire(host, unmanaged, "click"))
  let button = root.find("button").unwrap()
  for id in ["-1", "1e9", "·#9007199254740991", "·#1[x]"] {
    button.set_attribute(handler_attr, id)
    assert_false(fire(host, button, "click"))
  }
  assert_true(physical_equal(app.state(), start))
  assert_eq(host.pending(), 0)
}

///|
test "look-alike meta comments from unmanaged DOM are skipped" {
  // The comment goes where the re-render doesn't morph (the <div> renders the same): the
  // morph, as in JS, assumes the managed DOM has no foreign nodes.
  let comp : Component[EvCounter, EvCounterMsg] = component(
    "Counter",
    view=() => div([], [h("i", [], []), button([on_click(EvInc)], [txt("+")])]),
    update=(s, msg, _) => {
      match msg {
        EvInc => { ..s, count: s.count + 1, }
      }
    },
  )
  let (host, app, root, _) = mount(comp, { id: "", count: 0, })
  let button = root.find("button").unwrap()
  root
  .find("div")
  .unwrap()
  .insert_before(host.doc.create_comment("§{\"t\":\"other\"}§"), Some(button))
  assert_true(fire(host, button, "click"))
  assert_eq(app.state().count, 1)
  assert_true(fire(host, button, "click"))
  assert_eq(app.state().count, 2)
  // JS's placement: the comment right before the button, in the root's own child list. The
  // routing skips it; the re-render then misplaces nodes, as JS's morph throws on it.
  let (host, app, root, _) = mount(ev_counter, { id: "", count: 0, })
  let button = root.find("button").unwrap()
  root.insert_before(
    host.doc.create_comment("§{\"t\":\"other\"}§"),
    Some(button),
  )
  assert_true(fire(host, button, "click"))
  assert_eq(app.state().count, 1)
}

///|
struct EvViews {
  child : EvSeen
} derive(Debug)

///|
test "all views of one instance render together and route to it" {
  let child : Component[EvSeen, EvMsg] = component(
    "Child",
    view=() => {
      h("section", [on_click(EvNamed("outer"))], [
        button([on_click(EvNamed("main")), on_input(_ => EvNamed("input"))], [
          txt("main"),
        ]),
        h("i", [on_input(_ => EvNamed("inner-input"))], []),
      ])
    },
    views=() => {
      [("compact", button([on_click(EvNamed("compact"))], [txt("compact")]))]
    },
    update=ev_record,
  )
  let child_lens : Lens[EvViews, EvSeen] = field("child", s => s.child, (_, c) => {
    child: c,
  })
  let root_comp : Component[EvViews, NoMsg] = component("Root", view=() => {
    div([], [
      render(child_lens, child),
      render(child_lens, child, view="compact"),
    ])
  })
  let (host, app, root, _) = mount(root_comp, { child: { seen: [], }, })
  let buttons = elems(root, "button")
  let (main, compact) = (buttons[0], buttons[1])
  assert_true(fire(host, main, "click"))
  assert_true(fire(host, main, "input"))
  assert_true(fire(host, compact, "click"))
  // Skip a nonmatching inner group, but still select the nearest matching group.
  assert_true(fire(host, root.find("i").unwrap(), "click"))
  assert_eq(app.state().child.seen, ["main", "input", "compact", "outer"])
}

// --- nested components with a pushed view -----------------------------------------------

///|
struct EvPanel {
  child : EvCounter
  items : Vec[EvCounter]
  selected : Int32
} derive(Debug)

///|
struct EvNest {
  panel : EvPanel
} derive(Debug)

///|
let ev_compact : Component[EvCounter, EvCounterMsg] = component(
  "Child",
  view=() => h("i", [], []),
  views=() => {
    [("compact", button([on_click(EvInc)], [span([], [txt("increment")])]))]
  },
  update=(s, msg, _) => {
    match msg {
      EvInc => { ..s, count: s.count + 1, }
    }
  },
)

///|
let ev_panel_child : Lens[EvPanel, EvCounter] = field("child", s => s.child, (
  s,
  c,
) => { ..s, child: c, })

///|
let ev_panel_items : Items[EvPanel, Int32, EvCounter] = items(
  "items",
  s => s.items,
  (s, v) => { ..s, items: v, },
)

///|
fn ev_nested(by_item : Bool) -> EvPanel raise {
  let panel : Component[EvPanel, NoMsg] = component("Panel", view=() => {
    push_view(
      _ => "compact",
      if by_item {
        render_key(ev_panel_items, s => s.selected, ev_compact)
      } else {
        render(ev_panel_child, ev_compact)
      },
    )
  })
  let nest : Component[EvNest, NoMsg] = component("Root", view=() => {
    render(field("panel", s => s.panel, (_, p) => { panel: p, }), panel)
  })
  let c = EvCounter::{ id: "", count: 0, }
  let (host, app, root, _) = mount(nest, {
    panel: { child: c, items: Vec::of([c, c]), selected: 1, },
  })
  assert_true(fire(host, root.find("span").unwrap(), "click"))
  app.state().panel
}

///|
test "nested components route through field with a pushed view" {
  let panel = ev_nested(false)
  assert_eq(panel.child.count, 1)
  assert_eq(panel.items.at(1).count, 0)
}

///|
test "nested components route through seqItem with a pushed view" {
  let panel = ev_nested(true)
  assert_eq(panel.items.at(1).count, 1)
  assert_eq(panel.child.count, 0)
}

// --- top-level collections after a keyed reorder ----------------------------------------

///|
struct EvList {
  items : Vec[EvCounter]
} derive(Debug)

///|
enum EvListMsg {
  EvListSet(EvList)
} derive(Debug)

///|
let ev_list_items : Items[EvList, Int32, EvCounter] = items(
  "items",
  s => s.items,
  (_, v) => { items: v, },
)

///|
fn ev_reorder(content : View[EvList, EvListMsg]) -> Unit raise {
  let comp : Component[EvList, EvListMsg] = component(
    "Root",
    view=() => content,
    update=(_, msg, _) => {
      match msg {
        EvListSet(s) => s
      }
    },
  )
  let (host, app, root, _) = mount(comp, {
    items: Vec::of([
      EvCounter::{ id: "a", count: 0, },
      EvCounter::{ id: "b", count: 0, },
    ]),
  })
  let buttons = elems(root, "button")
  let (a, b) = (buttons[0], buttons[1])
  assert_true(fire(host, a, "click"))
  assert_true(fire(host, b, "click"))
  app.send(
    EvListSet({
      items: Vec::from_iter(app.state().items.to_array().rev_iter()),
    }),
  )
  host.drain()
  assert_true(same_nodes(elems(root, "button"), [b, a]))
  assert_true(fire(host, b, "click"))
  assert_true(fire(host, a, "click"))
  assert_eq(app.state().items.to_array().map(c => (c.id, c.count)), [
    ("b", 2),
    ("a", 2),
  ])
}

///|
fn ev_by_id(s : EvList) -> Iter[(Int32, EvCounter)] {
  s.items.iter2().iter()
}

///|
test "top-level renderEach routes every item after keyed reorder" {
  ev_reorder(render_each(ev_list_items, ev_counter, key=(_, c) => c.id))
}

///|
test "top-level renderIt routes every item after keyed reorder" {
  ev_reorder(
    each(ev_by_id, render_key(ev_list_items, it => it.value.0, ev_counter), key=(
      v,
      _,
    ) => v.1.id),
  )
}

///|
test "top-level deep renderIt routes every item after keyed reorder" {
  ev_reorder(
    each(
      ev_by_id,
      h("section", [], [
        h("article", [], [
          render_key(ev_list_items, it => it.value.0, ev_counter),
        ]),
      ]),
      key=(v, _) => v.1.id,
    ),
  )
}

///|
struct EvPicks {
  items : Vec[EvCounter]
  picked : Int32
} derive(Debug)

///|
enum EvPicksMsg {
  EvPickIt
} derive(Debug)

///|
test "renderIt stops event lookup at its view" {
  let item : Component[EvCounter, EvCounterMsg] = component(
    "Item",
    view=() => div([], [button([on_click(EvInc)], []), h("i", [], [])]),
    update=(s, msg, _) => {
      match msg {
        EvInc => { ..s, count: s.count + 1, }
      }
    },
  )
  let picks_items : Items[EvPicks, Int32, EvCounter] = items(
    "items",
    s => s.items,
    (s, v) => { ..s, items: v, },
  )
  let comp : Component[EvPicks, EvPicksMsg] = component(
    "Root",
    view=() => {
      each(
        s => s.items.iter2().iter(),
        h("section", [on_click(EvPickIt)], [
          render_key(picks_items, it => it.value.0, item),
          button([on_click(EvPickIt)], []),
        ]),
      )
    },
    update=(s, msg, _) => {
      match msg {
        EvPickIt => { ..s, picked: s.picked + 1, }
      }
    },
  )
  let (host, app, root, _) = mount(comp, {
    items: Vec::of([EvCounter::{ id: "", count: 0, }]),
    picked: 0,
  })
  let buttons = elems(root, "button")
  let (child, sibling) = (buttons[0], buttons[1])
  assert_true(fire(host, child, "click"))
  ignore(fire(host, root.find("i").unwrap(), "click"))
  assert_eq(app.state().items.at(0).count, 1)
  assert_eq(app.state().picked, 0)
  assert_true(fire(host, sibling, "click"))
  assert_true(fire(host, root.find("section").unwrap(), "click"))
  assert_eq(app.state().picked, 2)
}

///|
test "a child-scope registration after startup adds only its event listeners" {
  // Divergent: there is no registration; the host listens for an event name the first time
  // a rendered component handles it.
  let doc = @memdom.document()
  let dom = doc.element("main")
  let names = []
  let host = Host::new(doc, dom, listen=name => names.push(name))
  let first : Component[EvCounter, EvCounterMsg] = component("Root", view=() => {
    h("i", [on_click(EvInc)], [])
  })
  ignore(host.start(first, { id: "", count: 0, }))
  assert_eq(names, ["click"])
  let late : Component[EvCounter, EvCounterMsg] = component(
    "Late",
    view=() => button([on_dblclick(EvInc), on_click(EvInc)], []),
    update=(s, _, _) => { ..s, count: s.count + 1, },
  )
  let app = host.start(late, { id: "", count: 0, })
  assert_eq(names, ["click", "dblclick"])
  assert_true(fire(host, dom.find("button").unwrap(), "dblclick"))
  assert_eq(app.state().count, 1)
}

///|
struct EvTabs {
  tab : String
} derive(Debug)

///|
enum EvTabsMsg {
  SetTab(String)
} derive(Debug)

///|
test "targetValue reads the element with the handler, not the child that was clicked" {
  let tabs : Component[EvTabs, EvTabsMsg] = component(
    "Tabs",
    view=() => {
      button([attr("value", "b"), on_value(Click, v => SetTab(v))], [
        span([], [txt("icon")]),
        txt("label"),
      ])
    },
    update=(_, msg, _) => {
      match msg {
        SetTab(tab) => { tab, }
      }
    },
  )
  let (host, app, root, reports) = mount(tabs, { tab: "a", })
  assert_true(fire(host, root.find("span").unwrap(), "click"))
  assert_eq(app.state().tab, "b")
  assert_eq(reports.length(), 0)
}
