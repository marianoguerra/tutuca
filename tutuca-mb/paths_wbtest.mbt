// The walk-through of docs/paths.md: Root { panel: Panel { selected: 1, items: [a, b] } }.
// Root renders the panel, Panel provides `cur`, the selected item, and renders it; the item's
// button notifies.

///|
struct Leaf {
  name : String
  clicks : Int32
}

///|
enum LeafMsg {
  Press
} derive(Debug)

///|
let pressed : Signal[String] = Signal::new("pressed")

///|
let leaf : Component[Leaf, LeafMsg] = component(
  "Leaf",
  view=() => button([on_click(Press)], [show(s => s.name)]),
  update=(s, _, ctx) => {
    ctx.notify(pressed, s.name)
    { ..s, clicks: s.clicks + 1, }
  },
)

///|
struct Panel {
  selected : Int32
  items : Vec[Leaf]
  heard : Array[String]
}

///|
enum PanelMsg {
  Nothing
} derive(Debug)

///|
fn _unused() -> PanelMsg {
  Nothing
}

///|
let leaves : Items[Panel, Int32, Leaf] = items("items", p => p.items, (p, v) => {
  ..p,
  items: v,
})

///|
let cur : Provide[Leaf] = Provide::new("cur")

///|
let panel : Component[Panel, PanelMsg] = component(
  "Panel",
  view=() => div([], [render_provided(cur, leaf)]),
  on=[pressed.on((p, name, _) => { ..p, heard: [..p.heard, name], })],
  provides=[cur.at(leaves, p => p.selected)],
)

///|
struct Root {
  panel : Panel
  heard : Array[String]
}

///|
let root_panel : Lens[Root, Panel] = field("panel", r => r.panel, (r, p) => {
  ..r,
  panel: p,
})

///|
let root : Component[Root, PanelMsg] = component(
  "Root",
  view=() => main_([], [render(root_panel, panel)]),
  on=[pressed.on((r, name, _) => { ..r, heard: [..r.heard, name], })],
)

///|
fn walkthrough() -> Root {
  {
    panel: {
      selected: 1,
      items: Vec::of([{ name: "a", clicks: 0, }, { name: "b", clicks: 0, }]),
      heard: [],
    },
    heard: [],
  }
}

///|
test "a provided component updates through its provider and bubbles where it rendered" {
  let (host, app, dom, _) = mount(root, walkthrough())
  inspect(
    dom.inner_html(),
    content=(
      #|<!--§{"t":"component","n":"Root","p":"·"}§--><main><!--§{"t":"component","n":"Panel","p":".panel"}§--><div><!--§{"t":"component","n":"Leaf","p":".panel<cur>.items[1]"}§--><button type="button" data-h=".panel<cur>.items[1]#1">b</button><!--§/§--></div><!--§/§--></main><!--§/§-->
    ),
  )
  click(host, dom, "button")
  let state = app.state()
  assert_eq(state.panel.items.map(l => l.clicks).to_array(), [0, 1])
  // Panel hears it first, then Root: notify bubbles one ancestor per task.
  assert_eq(state.panel.heard, ["b"])
  assert_eq(state.heard, ["b"])
}

///|
test "a stopped signal goes no further" {
  let stopping : Component[Panel, PanelMsg] = component(
    "Stopping",
    view=() => div([], [render_provided(cur, leaf)]),
    on=[
      pressed.on((p, name, ctx) => {
        ctx.stop()
        { ..p, heard: [..p.heard, name], }
      }),
    ],
    provides=[cur.at(leaves, p => p.selected)],
  )
  let top : Component[Root, PanelMsg] = component(
    "Top",
    view=() => render(root_panel, stopping),
    on=[pressed.on((r, name, _) => { ..r, heard: [..r.heard, name], })],
  )
  let (host, app, dom, _) = mount(top, walkthrough())
  click(host, dom, "button")
  assert_eq(app.state().panel.heard, ["b"])
  assert_eq(app.state().heard, [])
}

// --- view stack, memo, contracts ----------------------------------------------------------

///|
let fancy_leaf : Component[Leaf, LeafMsg] = component(
  "FancyLeaf",
  view=() => span([], [show(s => s.name)]),
  views=() => [("fancy", strong([], [show(s => s.name)]))],
)

///|
struct Pair {
  left : Leaf
  right : Leaf
}

///|
let left : Lens[Pair, Leaf] = field("left", p => p.left, (p, l) => {
  ..p,
  left: l,
})

///|
let right : Lens[Pair, Leaf] = field("right", p => p.right, (p, l) => {
  ..p,
  right: l,
})

///|
test "push_view picks a named view below, and render's view overrides it" {
  let pair : Component[Pair, PanelMsg] = component("Pair", view=() => {
    div([], [
      push_view(_ => "fancy", render(left, fancy_leaf)),
      render(right, fancy_leaf),
      render(right, fancy_leaf, view="fancy"),
    ])
  })
  let (_, _, dom, _) = mount(pair, {
    left: { name: "l", clicks: 0, },
    right: { name: "r", clicks: 0, },
  })
  inspect(
    dom.inner_html(),
    content=(
      #|<!--§{"t":"component","n":"Pair","p":"·"}§--><div><!--§{"t":"component","n":"FancyLeaf","p":".left"}§--><strong>l</strong><!--§/§--><!--§{"t":"component","n":"FancyLeaf","p":".right"}§--><span>r</span><!--§/§--><!--§{"t":"component","n":"FancyLeaf","p":".right"}§--><strong>r</strong><!--§/§--></div><!--§/§-->
    ),
  )
}

///|
test "render(view=...) names a view the component has" {
  let bad : Component[Pair, PanelMsg] = component("Bad", view=() => {
    render(left, fancy_leaf, view="plain")
  })
  assert_eq(bad.check().map(i => i.to_string()), [
    "Bad.main view > render(FancyLeaf): FancyLeaf has no view `plain`; use one of: main, fancy",
  ])
}

///|
test "an unchanged child reuses its render and keeps its handlers" {
  let pair : Component[Pair, PanelMsg] = component("Pair", view=() => {
    div([], [render(left, leaf), render(right, leaf)])
  })
  let (host, app, dom, _) = mount(pair, {
    left: { name: "l", clicks: 0, },
    right: { name: "r", clicks: 0, },
  })
  let right_button = dom.descendants().filter(n => n.text_content() == "r")[0]
  click(host, dom, "button", text="l")
  // The right child was reused, vnode and DOM node both, and its handler still works.
  assert_true(
    physical_equal(
      dom.descendants().filter(n => n.text_content() == "r")[0],
      right_button,
    ),
  )
  click(host, dom, "button", text="r")
  inspect(app.state().right.clicks, content="1")
  inspect(app.state().left.clicks, content="1")
}

///|
test "dev mode reports a broken post-condition" {
  let liar : Component[Leaf, LeafMsg] = component(
    "Liar",
    view=() => button([on_click(Press)], [txt("x")]),
    update=(s, _, _) => s,
    post=(_, prev, next) => next.clicks == prev.clicks + 1,
  )
  let (host, _, dom, reports) = mount(liar, { name: "x", clicks: 0, })
  click(host, dom, "button")
  assert_eq(reports.map(report_text), ["message invalid Liar.Press: post"])
}

// --- recursion ----------------------------------------------------------------------------

///|
struct Tree {
  label : String
  kids : Vec[Tree]
}

///|
enum TreeMsg {
  Drop
} derive(Debug)

///|
let dropped : Signal[Unit] = Signal::new("dropped")

///|
let kids : Items[Tree, Int32, Tree] = items("kids", t => t.kids, (t, v) => {
  ..t,
  kids: v,
})

///|
let tree : Component[Tree, TreeMsg] = component(
  "Tree",
  view=() => {
    li([], [
      button([on_click(Drop)], [show(t => t.label)]),
      ul([], [render_self_each(kids)]),
    ])
  },
  update=(t, _, ctx) => {
    ctx.notify(dropped, ())
    t
  },
  on=[
    dropped.from(kids, (t, _, i, ctx) => {
      ctx.stop()
      { ..t, kids: t.kids.remove(i), }
    }),
  ],
)

///|
test "a recursive component removes the child that notified it" {
  let leaf = (label : String) => { label, kids: Vec::new(), }
  let (host, app, dom, _) = mount(tree, {
    label: "root",
    kids: Vec::of([
      leaf("a"),
      { label: "b", kids: Vec::of([leaf("b1"), leaf("b2")]), },
    ]),
  })
  click(host, dom, "button", text="b1")
  inspect(dom.text_content(), content="rootabb2")
  click(host, dom, "button", text="a")
  inspect(dom.text_content(), content="rootbb2")
  inspect(app.state().kids.length(), content="1")
}

///|
test "with meta, the DOM tells which component a node is in" {
  let doc = @memdom.document()
  let dom = doc.element("main")
  let host = Host::new(doc, dom, meta=true)
  ignore(host.start(root, walkthrough()))
  let b = dom.find("button").unwrap()
  assert_eq(host.component_at(b), Some(("Leaf", ".panel<cur>.items[1]")))
  let div = dom.find("div").unwrap()
  assert_eq(host.component_at(div), Some(("Panel", ".panel")))
  assert_true(
    dom
    .inner_html()
    .has_prefix("<!--§{\"t\":\"component\",\"n\":\"Root\",\"p\":\"·\"}§-->"),
  )
}

///|
test "all views of one instance render together and route to it" {
  let two_views : Component[Leaf, LeafMsg] = component(
    "TwoViews",
    view=() => button([on_click(Press)], [txt("main")]),
    views=() => {
      [
        (
          "other",
          button([on_click(Press), attr("title", "other")], [txt("other")]),
        ),
      ]
    },
    update=(s, _, _) => { ..s, clicks: s.clicks + 1, },
  )
  let pair : Component[Pair, PanelMsg] = component("Pair", view=() => {
    div([], [
      render(left, two_views),
      render(left, two_views, view="other"),
      render(right, two_views, view="other"),
    ])
  })
  let (host, app, dom, _) = mount(pair, {
    left: { name: "l", clicks: 0, },
    right: { name: "r", clicks: 0, },
  })
  let ids = dom
    .descendants()
    .filter(n => n.tag_name() == "BUTTON")
    .map(n => n.get_attribute(handler_attr).unwrap())
  assert_eq(ids, [".left#1", ".left#2", ".right#2"])
  click(host, dom, "button", text="other")
  assert_eq(app.state().left.clicks, 1)
  assert_eq(app.state().right.clicks, 0)
}

///|
let shelf : Provide[Vec[Leaf]] = Provide::new("shelf")

///|
let shelf_items : Items[Vec[Leaf], Int32, Leaf] = items(
  "shelf",
  v => v,
  keep_new,
)

///|
fn keep_new(_ : Vec[Leaf], v : Vec[Leaf]) -> Vec[Leaf] {
  v
}

///|
struct Picks {
  picks : Array[Int32]
}

///|
let picks_view : Component[Picks, PanelMsg] = component("Picks", view=() => {
  div([], [
    each(
      p => p.picks.iter(),
      render_provided_key(shelf, shelf_items, it => it.value, leaf),
    ),
  ])
})

///|
struct Store {
  leaves : Vec[Leaf]
  picks : Picks
  heard : Array[String]
}

///|
test "items of a provided collection render, update through the provider and bubble here" {
  let store : Component[Store, PanelMsg] = component(
    "Store",
    view=() => {
      render(
        field("picks", (s : Store) => s.picks, (s, picks) => { ..s, picks, }),
        picks_view,
      )
    },
    provides=[
      shelf.from(
        field("leaves", s => s.leaves, (s, leaves) => { ..s, leaves, }),
      ),
    ],
    on=[pressed.on((s, name, _) => { ..s, heard: [..s.heard, name], })],
  )
  let (host, app, dom, _) = mount(store, {
    leaves: Vec::of([
      { name: "a", clicks: 0, },
      { name: "b", clicks: 0, },
      { name: "c", clicks: 0, },
    ]),
    picks: { picks: [2, 0], },
    heard: [],
  })
  assert_eq(dom.text_content(), "ca")
  click(host, dom, "button", text="c")
  assert_eq(app.state().leaves.map(l => l.clicks).to_array(), [0, 0, 1])
  assert_eq(app.state().heard, ["c"])
}

///|
struct Badge {
  label : String
}

///|
let badge : Component[Badge, LeafMsg] = component("Badge", view=() => {
  span([], [show(s => s.label)])
})

///|
struct Wrap {
  badge : Badge
  clicks : Int32
}

///|
fn wrap_comp() -> Component[Wrap, LeafMsg] {
  component(
    "Wrap",
    view=() => {
      button([on_click(Press)], [
        txt("+"),
        render(
          field("badge", (w : Wrap) => w.badge, (w, badge) => { ..w, badge, }),
          badge,
        ),
      ])
    },
    update=(w, _, _) => { ..w, clicks: w.clicks + 1, },
  )
}

///|
test "an event inside a component without handlers for it stops there, as in JS" {
  let (host, app, dom, _) = mount(wrap_comp(), {
    badge: { label: "b", },
    clicks: 0,
  })
  click(host, dom, "span")
  assert_eq(app.state().clicks, 0)
  // On the wrapper's own part, its handler runs.
  click(host, dom, "button")
  assert_eq(app.state().clicks, 1)
}

///|
test "without metadata comments, an event goes to the first handler's component" {
  let doc = @memdom.document()
  let root = doc.element("main")
  let host = Host::new(doc, root, meta=false)
  let app = host.start(wrap_comp(), { badge: { label: "b", }, clicks: 0, })
  click(host, root, "span")
  assert_eq(app.state().clicks, 1)
}
