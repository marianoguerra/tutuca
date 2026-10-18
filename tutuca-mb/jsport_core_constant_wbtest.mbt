// Ports of test/core/constant.test.js: what lowering prebuilds once (PConst) and shares.

///|
struct CnS {
  name : String
  count : Int32
  on : Bool
  items : Vec[String]
  picked : String
  child : CoItem
} derive(Debug)

///|
fn cn_state() -> CnS {
  {
    name: "n",
    count: 0,
    on: false,
    items: Vec::of(["a", "b", "c"]),
    picked: "",
    child: CoItem::{ label: "c", },
  }
}

///|
enum CnMsg {
  CnSet(CnS)
  CnInc
  CnPick(Int32)
} derive(Debug)

///|
fn cn_update(s : CnS, msg : CnMsg, _ : Ctx[CnS, CnMsg]) -> CnS {
  match msg {
    CnSet(next) => next
    CnInc => { ..s, count: s.count + 1, }
    CnPick(i) => { ..s, picked: s.items.at(i), }
  }
}

///|
fn cn_is_const(v : View[CnS, CnMsg]) -> Bool {
  try v.compile() catch {
    _ => false
  } noraise {
    plan => plan is PConst(_)
  }
}

///|
let cn_child : Lens[CnS, CoItem] = field("child", s => s.child, (s, c) => {
  ..s,
  child: c,
})

///|
test "isConstant: literals, elements with constant parts and constant conditions" {
  let constants : Array[View[CnS, CnMsg]] = [
    p([], [txt("hi")]),
    p([cls("a"), attr("title", "1")], [
      h("b", [], [txt("x")]),
      empty(),
      txt("42"),
    ]),
  ]
  for v in constants {
    assert_true(cn_is_const(v))
  }
  // Divergent: an element with handlers binds them per render (its data-h names the
  // instance), and a condition is always a closure, so neither is prebuilt.
  assert_false(cn_is_const(button([on_click(CnInc)], [txt("+")])))
  assert_false(cn_is_const(if_(_ => true, h("i", [], [txt("a")]), txt("b"))))
}

///|
test "isConstant: anything reading the ctx makes it and its ancestors dynamic" {
  let dynamics : Array[View[CnS, CnMsg]] = [
    show(s => s.name),
    scope(s => s.name, show(w => w.value)),
    render(cn_child, co_item),
    each(s => s.items.iter(), li([], [txt("x")])),
    push_view(_ => "compact", txt("x")),
    p([class_(s => s.name)], [txt("x")]),
    p([], [show(s => s.name)]),
    div([], [p([], [h("b", [], [show(s => s.name)])])]),
    if_(s => s.on, txt("a"), txt("b")),
    if_(_ => true, show(s => s.name), txt("b")),
    each(s => s.items.iter(), show(it => it.index.to_string())),
    p([key(s => s.name)], [txt("x")]),
  ]
  for v in dynamics {
    assert_false(cn_is_const(v))
  }
}

///|
test "a constant element evaluates once without a ctx and returns the same vnode" {
  let comp : Component[CnS, CnMsg] = component(
    "Comp",
    view=() => {
      div([], [
        p([cls("a")], [h("b", [], [txt("x")])]),
        span([], [show(s => s.name)]),
      ])
    },
    update=cn_update,
  )
  // The constant <p> lowers to one prebuilt vnode, built without a state.
  let pv : View[CnS, CnMsg] = p([cls("a")], [h("b", [], [txt("x")])])
  match pv.compile() {
    PConst(Elem(e)) => assert_eq(e.shape.tag, "p")
    _ => fail("expected the constant <p> to be prebuilt")
  }
  // Two hosts with different states share the one prebuilt <p>; the dynamic <span> is new.
  let (h1, _, _, _) = mount(comp, cn_state())
  let (h2, _, _, _) = mount(comp, { ..cn_state(), name: "m", })
  assert_true(
    physical_equal(find_velem(h1.vnodes(), "p"), find_velem(h2.vnodes(), "p")),
  )
  assert_false(
    physical_equal(
      find_velem(h1.vnodes(), "span"),
      find_velem(h2.vnodes(), "span"),
    ),
  )
}

///|
test "constant subtrees keep their vnode identity across renders" {
  let comp : Component[CnS, CnMsg] = component(
    "Comp",
    view=() => {
      div([], [
        header([cls("top")], [h1([], [txt("Title")])]),
        span([], [show(s => s.count.to_string())]),
      ])
    },
    update=cn_update,
  )
  let (host, app, root, _) = mount(comp, cn_state())
  let head = find_velem(host.vnodes(), "header")
  let sp = find_velem(host.vnodes(), "span")
  let h1_dom = root.find("h1").unwrap()
  app.send(CnSet({ ..cn_state(), count: 1, }))
  host.drain()
  assert_true(physical_equal(find_velem(host.vnodes(), "header"), head))
  assert_false(physical_equal(find_velem(host.vnodes(), "span"), sp))
  assert_true(physical_equal(root.find("h1").unwrap(), h1_dom))
  assert_eq(root.find("span").unwrap().text_content(), "1")
}

///|
test "handlers inside constant elements still dispatch, also per loop item" {
  let comp : Component[CnS, CnMsg] = component(
    "Comp",
    view=() => {
      div([], [
        button([cls("inc"), on_click(CnInc)], [txt("+")]),
        each(
          s => s.items.iter(),
          button(
            [cls("pick"), on_event(Click, (it, _) => Some(CnPick(it.index)))],
            [txt("pick")],
          ),
        ),
        h("output", [], [show(s => s.count.to_string())]),
      ])
    },
    update=cn_update,
  )
  let (host, app, root, _) = mount(comp, cn_state())
  let picks = elems(root, "button").filter(b => {
    b.get_attribute("class") == Some("pick")
  })
  assert_eq(picks.length(), 3)
  // Divergent: each item's button is its own vnode, since its data-h names the item.
  let ids = picks.map(b => b.get_attribute(handler_attr).unwrap())
  assert_eq(ids, ["·#2[0]", "·#2[1]", "·#2[2]"])
  click(host, root, "button", text="+")
  click(host, root, "button", text="+")
  assert_eq(app.state().count, 2)
  assert_eq(root.find("output").unwrap().text_content(), "2")
  assert_true(fire(host, picks[1], "click"))
  assert_eq(app.state().picked, "b")
}

///|
test "walkers still see the attrs of constant elements" {
  let view : View[CnS, CnMsg] = div([cls("a b")], [p([cls("c")], [txt("x")])])
  assert_true(cn_is_const(view))
  let names = view.ir().class_names()
  names.sort()
  assert_eq(names, ["a", "b", "c"])
}

///|
struct CnList {
  items : Vec[CoItem]
} derive(Debug)

///|
enum CnListMsg {
  CnListSet(CnList)
} derive(Debug)

///|
test "meta closing comments are one shared vnode across positions and renders" {
  // Items of an each have no metadata comments here; components do, so the list renders
  // its items as components.
  let list_items : Items[CnList, Int32, CoItem] = items("items", s => s.items, (
    s,
    v,
  ) => {
    ignore(s)
    { items: v, }
  })
  let comp : Component[CnList, CnListMsg] = component(
    "Comp",
    view=() => ul([], [render_each(list_items, co_item)]),
    update=(_, msg, _) => {
      match msg {
        CnListSet(s) => s
      }
    },
  )
  let (host, app, _, _) = mount(comp, {
    items: Vec::of([CoItem::{ label: "a", }, CoItem::{ label: "b", }]),
  })
  let ends = () => {
    all_vnodes(host.vnodes()).filter(v => v is Comment(t) && t == meta_close)
  }
  let first = ends()
  assert_eq(first.length(), 3) // the component and each item
  app.send(
    CnListSet({
      items: Vec::of([
        CoItem::{ label: "a", },
        CoItem::{ label: "b", },
        CoItem::{ label: "c", },
      ]),
    }),
  )
  host.drain()
  assert_eq(ends().length(), 4)
  assert_true(ends().iter().all(v => physical_equal(v, first[0])))
}

///|
test "literal text children of dynamic elements keep their vnode across renders" {
  let comp : Component[CnS, CnMsg] = component(
    "Comp",
    view=() => {
      p([bind_str("title", s => s.count.to_string())], [
        txt("Count: "),
        show(s => s.count.to_string()),
        txt("7"),
      ])
    },
    update=cn_update,
  )
  let (host, app, root, _) = mount(comp, cn_state())
  let before = find_velem(host.vnodes(), "p").childs
  app.send(CnSet({ ..cn_state(), count: 1, }))
  host.drain()
  let after = find_velem(host.vnodes(), "p").childs
  assert_eq(after.length(), 3)
  assert_true(physical_equal(after[0], before[0]))
  assert_true(physical_equal(after[2], before[2]))
  assert_eq(root.find("p").unwrap().text_content(), "Count: 17")
}
