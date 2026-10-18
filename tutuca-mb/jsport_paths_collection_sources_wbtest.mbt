// Port of test/paths/collection-sources.test.js. JS sources map to MoonBit as:
// field("items") is an `Items` on a field; seqItem("groups", "selected") is
// `groups.then(items)` keeping the selected outer key; provided("items") is a `Provide` of the
// collection. renderEach is `render_each` (`render_provided_key` for a provided collection),
// renderIt is `render_key` in an `each`, and a loop's custom `iter` is ordinary code in the
// `each` source.

///|
struct CsItem {
  count : Int32
}

///|
enum CsItemMsg {
  Inc
} derive(Debug)

///|
struct CsPanel {
  items_a : Vec[CsItem]
  items_o : @sorted_map.SortedMap[String, CsItem]
  groups_a : Vec[Vec[CsItem]]
  groups_o : Vec[@sorted_map.SortedMap[String, CsItem]]
  selected : Int32
  picked : String?
}

///|
enum CsPanelMsg {
  Pick(String)
} derive(Debug)

///|
struct CsRoot {
  panel : CsPanel
  groups_a : Vec[Vec[CsItem]]
  groups_o : Vec[@sorted_map.SortedMap[String, CsItem]]
  selected : Int32
}

///|
enum CsMode {
  RenderEach
  Each
  RenderIt
  IterWith
}

///|
let cs_changed : Signal[Unit] = Signal::new("changed")

///|
let cs_seen : Array[String] = []

///|
let cs_item : Component[CsItem, CsItemMsg] = component(
  "Item",
  view=() => button([on_click(Inc)], [show(s => s.count.to_string())]),
  update=(s, _, ctx) => {
    ctx.notify(cs_changed, ())
    { count: s.count + 1, }
  },
)

///|
let cs_items_a : Items[CsPanel, Int32, CsItem] = items(
  "items",
  p => p.items_a,
  (p, items_a) => { ..p, items_a, },
)

///|
let cs_items_o : Items[CsPanel, String, CsItem] = entries(
  "items",
  p => p.items_o,
  (p, items_o) => { ..p, items_o, },
)

///|
let cs_groups_a : Items[CsPanel, Int32, Vec[CsItem]] = items(
  "groups",
  p => p.groups_a,
  (p, groups_a) => { ..p, groups_a, },
)

///|
let cs_groups_o : Items[CsPanel, Int32, @sorted_map.SortedMap[String, CsItem]] = items(
  "groups",
  p => p.groups_o,
  (p, groups_o) => { ..p, groups_o, },
)

///|
let cs_vec : Items[Vec[CsItem], Int32, CsItem] = items(
  "items",
  v => v,
  keep_new_vec,
)

///|
let cs_map : Items[@sorted_map.SortedMap[String, CsItem], String, CsItem] = entries(
  "items",
  m => m,
  keep_new_map,
)

///|
let cs_prov_a : Provide[Vec[CsItem]] = Provide::new("items")

///|
let cs_prov_o : Provide[@sorted_map.SortedMap[String, CsItem]] = Provide::new(
  "items",
)

///|
/// The panel's view over a collection of its own state, keeping the keys `keep` accepts.
fn[K] cs_content(
  mode : CsMode,
  its : Items[CsPanel, K, CsItem],
  keep : (CsPanel, K) -> Bool,
  key_text : (K) -> String,
) -> View[CsPanel, CsPanelMsg] {
  let src = (p : CsPanel) => (its.entries)(p).filter(e => keep(p, e.0))
  let pick : ViewAt[Item[CsPanel, (K, CsItem)], CsPanel, CsPanelMsg] = button(
    [on_event(Click, (it, _) => Some(Pick(key_text(it.value.0))))],
    [txt("pick")],
  )
  match mode {
    RenderEach => render_each(its, cs_item, filter=(p, k, _) => keep(p, k))
    Each => each(src, section([], [pick]))
    RenderIt =>
      each(src, section([], [render_key(its, it => it.value.0, cs_item)]))
    // A loop with its own iterator: the keys, then each item looked up by key.
    IterWith =>
      each(
        p => {
          src(p)
          .map(e => e.0)
          .filter_map(k => (its.get_at)(p, k).map(v => (k, v)))
        },
        section([], [pick]),
      )
  }
}

///|
/// The panel's view over the collection an ancestor provides.
fn[T, K] cs_provided_content(
  mode : CsMode,
  key : Provide[T],
  its : Items[T, K, CsItem],
  key_text : (K) -> String,
) -> View[CsPanel, CsPanelMsg] {
  let src = (w : With[CsPanel, T]) => (its.entries)(w.value)
  let pick : ViewAt[Item[With[CsPanel, T], (K, CsItem)], CsPanel, CsPanelMsg] = button(
    [on_event(Click, (it, _) => Some(Pick(key_text(it.value.0))))],
    [txt("pick")],
  )
  let render_it : ViewAt[
    Item[With[CsPanel, T], (K, CsItem)],
    CsPanel,
    CsPanelMsg,
  ] = render_provided_key(key, its, it => it.value.0, cs_item)
  match mode {
    RenderEach => when_provided(key, each(src, render_it))
    Each => when_provided(key, each(src, section([], [pick])))
    RenderIt => when_provided(key, each(src, section([], [render_it])))
    IterWith =>
      when_provided(
        key,
        each(
          w => {
            src(w)
            .map(e => e.0)
            .filter_map(k => (its.get_at)(w.value, k).map(v => (k, v)))
          },
          section([], [pick]),
        ),
      )
  }
}

///|
let cs_panel_lens : Lens[CsRoot, CsPanel] = field("panel", r => r.panel, (
  r,
  panel,
) => { ..r, panel, })

///|
let cs_root_groups_a : Items[CsRoot, Int32, Vec[CsItem]] = items(
  "groups",
  r => r.groups_a,
  (r, groups_a) => { ..r, groups_a, },
)

///|
let cs_root_groups_o : Items[
  CsRoot,
  Int32,
  @sorted_map.SortedMap[String, CsItem],
] = items("groups", r => r.groups_o, (r, groups_o) => { ..r, groups_o, })

///|
fn cs_case(source : String, object : Bool, mode : CsMode) -> Unit raise {
  cs_seen.clear()
  let content = match (source, object) {
    ("field", false) =>
      cs_content(mode, cs_items_a, (_, _) => true, i => i.to_string())
    ("field", true) => cs_content(mode, cs_items_o, (_, _) => true, k => k)
    ("seqItem", false) =>
      cs_content(mode, cs_groups_a.then(cs_vec), (p, k) => k.0 == p.selected, k => {
        k.1.to_string()
      })
    ("seqItem", true) =>
      cs_content(mode, cs_groups_o.then(cs_map), (p, k) => k.0 == p.selected, k => {
        k.1
      })
    ("provided", false) =>
      cs_provided_content(mode, cs_prov_a, cs_vec, i => i.to_string())
    _ => cs_provided_content(mode, cs_prov_o, cs_map, k => k)
  }
  let panel : Component[CsPanel, CsPanelMsg] = component(
    "Panel",
    view=() => div([], [content]),
    update=(s, msg, _) => {
      let Pick(key) = msg
      { ..s, picked: Some(key), }
    },
    on=[
      cs_changed.on((s, _, _) => {
        cs_seen.push("panel")
        s
      }),
    ],
  )
  let root : Component[CsRoot, CsPanelMsg] = component(
    "Root",
    view=() => main_([], [render(cs_panel_lens, panel)]),
    provides=[
      cs_prov_a.at(cs_root_groups_a, r => r.selected),
      cs_prov_o.at(cs_root_groups_o, r => r.selected),
    ],
    on=[
      cs_changed.on((s, _, _) => {
        cs_seen.push("root")
        s
      }),
    ],
  )
  let zero = CsItem::{ count: 0, }
  let items_a = Vec::of([zero, zero])
  let items_o = @sorted_map.SortedMap([("a", zero), ("b", zero)])
  let none_a : Vec[Vec[CsItem]] = Vec::new()
  let none_o : Vec[@sorted_map.SortedMap[String, CsItem]] = Vec::new()
  let start : CsRoot = {
    panel: {
      items_a: if source == "field" && !object {
        items_a
      } else {
        Vec::new()
      },
      items_o: if source == "field" && object {
        items_o
      } else {
        @sorted_map.new()
      },
      groups_a: if source == "seqItem" && !object {
        Vec::of([items_a])
      } else {
        none_a
      },
      groups_o: if source == "seqItem" && object {
        Vec::of([items_o])
      } else {
        none_o
      },
      selected: 0,
      picked: None,
    },
    groups_a: if source == "provided" && !object {
      Vec::of([items_a])
    } else {
      none_a
    },
    groups_o: if source == "provided" && object {
      Vec::of([items_o])
    } else {
      none_o
    },
    selected: 0,
  }
  let (host, app, dom, reports) = jp_mount(root, start)
  let buttons = jp_elems(dom, "button")
  assert_eq(buttons.length(), 2)
  jp_click(host, buttons[1])
  assert_eq(jp_failures(reports), [])
  let state = app.state()
  let key = if object { "b" } else { "1" }
  match mode {
    Each | IterWith => assert_eq(state.panel.picked, Some(key))
    RenderEach | RenderIt => {
      let count = match (source, object) {
        ("field", false) => state.panel.items_a.at(1).count
        ("field", true) => state.panel.items_o.get("b").unwrap().count
        ("seqItem", false) => state.panel.groups_a.at(0).at(1).count
        ("seqItem", true) => state.panel.groups_o.at(0).get("b").unwrap().count
        ("provided", false) => state.groups_a.at(0).at(1).count
        _ => state.groups_o.at(0).get("b").unwrap().count
      }
      assert_eq(count, 1)
      // The values the app started with are untouched.
      assert_eq(items_a.at(1).count + items_o.get("b").unwrap().count, 0)
      assert_eq(cs_seen, ["panel", "root"])
    }
  }
}

///|
test "field array collection: renderEach" {
  cs_case("field", false, RenderEach)
}

///|
test "field array collection: each" {
  cs_case("field", false, Each)
}

///|
test "field array collection: renderIt" {
  cs_case("field", false, RenderIt)
}

///|
test "field array collection: iterWith" {
  cs_case("field", false, IterWith)
}

///|
test "field object collection: renderEach" {
  cs_case("field", true, RenderEach)
}

///|
test "field object collection: each" {
  cs_case("field", true, Each)
}

///|
test "field object collection: renderIt" {
  cs_case("field", true, RenderIt)
}

///|
test "field object collection: iterWith" {
  cs_case("field", true, IterWith)
}

///|
test "seqItem array collection: renderEach" {
  cs_case("seqItem", false, RenderEach)
}

///|
test "seqItem array collection: each" {
  cs_case("seqItem", false, Each)
}

///|
test "seqItem array collection: renderIt" {
  cs_case("seqItem", false, RenderIt)
}

///|
test "seqItem array collection: iterWith" {
  cs_case("seqItem", false, IterWith)
}

///|
test "seqItem object collection: renderEach" {
  cs_case("seqItem", true, RenderEach)
}

///|
test "seqItem object collection: each" {
  cs_case("seqItem", true, Each)
}

///|
test "seqItem object collection: renderIt" {
  cs_case("seqItem", true, RenderIt)
}

///|
test "seqItem object collection: iterWith" {
  cs_case("seqItem", true, IterWith)
}

///|
test "provided array collection: renderEach" {
  cs_case("provided", false, RenderEach)
}

///|
test "provided array collection: each" {
  cs_case("provided", false, Each)
}

///|
test "provided array collection: renderIt" {
  cs_case("provided", false, RenderIt)
}

///|
test "provided array collection: iterWith" {
  cs_case("provided", false, IterWith)
}

///|
test "provided object collection: renderEach" {
  cs_case("provided", true, RenderEach)
}

///|
test "provided object collection: each" {
  cs_case("provided", true, Each)
}

///|
test "provided object collection: renderIt" {
  cs_case("provided", true, RenderIt)
}

///|
test "provided object collection: iterWith" {
  cs_case("provided", true, IterWith)
}

// --- provided collections inside provided collections ---------------------------------------

///|
struct CsGroup {
  items : @sorted_map.SortedMap[String, CsItem]
  panel : Unit // The InnerPanel has no state of its own.
}

///|
struct CsNestedRoot {
  groups : Vec[CsGroup]
  panel : Unit
}

///|
let cs_groups_p : Provide[Vec[CsGroup]] = Provide::new("items")

///|
let cs_group_items_p : Provide[@sorted_map.SortedMap[String, CsItem]] = Provide::new(
  "items",
)

///|
test "nested provided collection jumps preserve provider depths and shadowing" {
  cs_seen.clear()
  let listen = (who : String) => {
    cs_changed.on((s : Unit, _, _) => {
      cs_seen.push(who)
      s
    })
  }
  let inner : Component[Unit, CsPanelMsg] = component(
    "InnerPanel",
    view=() => {
      div([], [
        when_provided(
          cs_group_items_p,
          each(
            w => w.value.iter(),
            render_provided_key(
              cs_group_items_p,
              cs_map,
              it => it.value.0,
              cs_item,
            ),
          ),
        ),
      ])
    },
    on=[listen("inner")],
  )
  let group : Component[CsGroup, CsPanelMsg] = component(
    "Group",
    view=() => {
      section([], [
        render(
          field("panel", (g : CsGroup) => g.panel, (g, panel) => { ..g, panel, }),
          inner,
        ),
      ])
    },
    provides=[
      cs_group_items_p.from(
        field("items", g => g.items, (g, items) => { ..g, items, }),
      ),
    ],
    on=[
      cs_changed.on((s, _, _) => {
        cs_seen.push("group")
        s
      }),
    ],
  )
  let groups : Items[Vec[CsGroup], Int32, CsGroup] = items(
    "items",
    v => v,
    keep_new_vec,
  )
  let outer : Component[Unit, CsPanelMsg] = component(
    "OuterPanel",
    view=() => {
      div([], [
        when_provided(
          cs_groups_p,
          each(
            w => w.value.iter(),
            render_provided_key(cs_groups_p, groups, it => it.index, group),
          ),
        ),
      ])
    },
    on=[listen("outer")],
  )
  let root : Component[CsNestedRoot, CsPanelMsg] = component(
    "Root",
    view=() => {
      main_([], [
        render(
          field("panel", (r : CsNestedRoot) => r.panel, (r, panel) => {
            ..r,
            panel,
          }),
          outer,
        ),
      ])
    },
    provides=[
      cs_groups_p.from(
        field("groups", r => r.groups, (r, groups) => { ..r, groups, }),
      ),
    ],
    on=[
      cs_changed.on((s, _, _) => {
        cs_seen.push("root")
        s
      }),
    ],
  )
  let (host, app, dom, reports) = jp_mount(root, {
    groups: Vec::of([
      {
        items: @sorted_map.SortedMap([("a", CsItem::{ count: 0, })]),
        panel: (),
      },
    ]),
    panel: (),
  })
  jp_click(host, jp_elems(dom, "button")[0])
  assert_eq(jp_failures(reports), [])
  assert_eq(app.state().groups.at(0).items.get("a").unwrap().count, 1)
  assert_eq(cs_seen, ["inner", "group", "outer", "root"])
}

// --- a rendered seqItem collection and a send_to with a selector -----------------------------

///|
struct CsSeqRoot {
  selected : Int32
  groups : Vec[Vec[CsItem]]
}

///|
enum CsSeqMsg {
  Queue
} derive(Debug)

///|
test "rendered SeqItem collection stays frozen while sendAt captures producer commit" {
  let groups : Items[CsSeqRoot, Int32, Vec[CsItem]] = items(
    "groups",
    r => r.groups,
    (r, groups) => { ..r, groups, },
  )
  let selected_items = groups.then(cs_vec)
  let root : Component[CsSeqRoot, CsSeqMsg] = component(
    "Root",
    view=() => {
      div([], [
        button([on_click(Queue)], [txt("queue")]),
        render_each(selected_items, cs_item, filter=(r, k, _) => {
          k.0 == r.selected
        }),
      ])
    },
    update=(s, _, ctx) => {
      // groups[selected][0], with selected as this transaction commits it.
      ctx.send_to(cs_item, r => selected_items.at((r.selected, 0)), Inc)
      { ..s, selected: 1, }
    },
  )
  let zero = CsItem::{ count: 0, }
  let (host, app, dom, reports) = jp_mount(root, {
    selected: 0,
    groups: Vec::of([Vec::of([zero]), Vec::of([zero])]),
  })
  let buttons = jp_elems(dom, "button")
  // Both DOM events are queued before either runs, as with already queued work.
  jp_queue_clicks(host, [buttons[0], buttons[1]])
  host.drain()
  assert_eq(jp_failures(reports), [])
  assert_eq(app.state().groups.at(0).at(0).count, 1)
  assert_eq(app.state().groups.at(1).at(0).count, 1)
}

// --- a chain of provided collections -------------------------------------------------------

///|
struct CsNode {
  count : Int32
  id : Int32
  items : Vec[CsNode]
}

///|
let cs_nodes_p : Provide[Vec[CsNode]] = Provide::new("items")

///|
let cs_node_once : Once[Component[CsNode, CsItemMsg]] = Once::new()

///|
fn cs_node() -> Component[CsNode, CsItemMsg] {
  cs_node_once.get(() => {
    let nodes : Items[Vec[CsNode], Int32, CsNode] = items(
      "items",
      v => v,
      keep_new_vec,
    )
    component(
      "Node",
      view=() => {
        div([], [
          button([on_click(Inc)], [txt("inc")]),
          when_provided(
            cs_nodes_p,
            each(
              w => w.value.iter(),
              render_provided_key(cs_nodes_p, nodes, it => it.index, cs_node()),
            ),
          ),
        ])
      },
      update=(s, _, ctx) => {
        ctx.notify(cs_changed, ())
        { ..s, count: s.count + 1, }
      },
      provides=[
        cs_nodes_p.from(
          field("items", s => s.items, (s, items) => { ..s, items, }),
        ),
      ],
      on=[
        cs_changed.on((s, _, _) => {
          cs_seen.push(s.id.to_string())
          s
        }),
      ],
    )
  })
}

///|
fn cs_depth_case(depth : Int32) -> Unit raise {
  cs_seen.clear()
  let mut root : CsNode = { count: 0, id: depth, items: Vec::new(), }
  for i = depth - 1; i >= 0; i = i - 1 {
    root = { count: 0, id: i, items: Vec::of([root]), }
  }
  let (host, app, dom, reports) = jp_mount(cs_node(), root)
  jp_click(host, jp_elems(dom, "button")[depth])
  assert_eq(jp_failures(reports), [])
  let mut leaf = app.state()
  for _ in 0..<depth {
    leaf = leaf.items.at(0)
  }
  assert_eq(leaf.count, 1)
  assert_eq(cs_seen, Array::makei(depth, i => (depth - i - 1).to_string()))
}

///|
test "0 provided collection jumps retain all bubbling frames" {
  cs_depth_case(0)
}

///|
test "1 provided collection jumps retain all bubbling frames" {
  cs_depth_case(1)
}

///|
test "2 provided collection jumps retain all bubbling frames" {
  cs_depth_case(2)
}

///|
test "8 provided collection jumps retain all bubbling frames" {
  cs_depth_case(8)
}

// --- send_to an item by key ----------------------------------------------------------------

///|
struct CsArrObj {
  array : Vec[CsItem]
  object : @sorted_map.SortedMap[String, CsItem]
}

///|
enum CsUpdateMsg {
  Update
} derive(Debug)

///|
test "PathBuilder item updates array and object items" {
  let array : Items[CsArrObj, Int32, CsItem] = items("array", s => s.array, (
    s,
    array,
  ) => { ..s, array, })
  let object : Items[CsArrObj, String, CsItem] = entries(
    "object",
    s => s.object,
    (s, object) => { ..s, object, },
  )
  let root : Component[CsArrObj, CsUpdateMsg] = component(
    "Root",
    view=() => button([on_click(Update)], [txt("update")]),
    update=(s, _, ctx) => {
      ctx.send_to(cs_item, _ => array.at(0), Inc)
      ctx.send_to(cs_item, _ => object.at("a"), Inc)
      s
    },
  )
  let zero = CsItem::{ count: 0, }
  let (host, app, dom, reports) = jp_mount(root, {
    array: Vec::of([zero]),
    object: @sorted_map.SortedMap([("a", zero)]),
  })
  jp_click(host, jp_elems(dom, "button")[0])
  assert_eq(jp_failures(reports), [])
  assert_eq(app.state().array.at(0).count, 1)
  assert_eq(app.state().object.get("a").unwrap().count, 1)
}

///|
fn[T] keep_new_vec(_ : Vec[T], v : Vec[T]) -> Vec[T] {
  v
}

///|
fn keep_new_map(
  _ : @sorted_map.SortedMap[String, CsItem],
  m : @sorted_map.SortedMap[String, CsItem],
) -> @sorted_map.SortedMap[String, CsItem] {
  m
}

// --- not in JS: collections reached through a lens keep their paths apart -------------------

///|
struct CsRows {
  rows : Vec[Vec[CsItem]]
}

///|
test "collections reached through different lenses keep their paths and handlers apart" {
  let rows : Items[CsRows, Int32, Vec[CsItem]] = items("rows", r => r.rows, (
    _,
    rows,
  ) => { rows, })
  let root : Component[CsRows, CsUpdateMsg] = component("Rows", view=() => {
    div([], [
      render_each(rows.at(0).then_items(cs_vec), cs_item),
      render_each(rows.at(1).then_items(cs_vec), cs_item),
    ])
  })
  let zero = CsItem::{ count: 0, }
  let (host, app, dom, reports) = jp_mount(root, {
    rows: Vec::of([Vec::of([zero]), Vec::of([zero])]),
  })
  jp_click(host, jp_elems(dom, "button")[0])
  assert_eq(jp_failures(reports), [])
  assert_eq(app.state().rows.map(r => r.at(0).count).to_array(), [1, 0])
  jp_click(host, jp_elems(dom, "button")[1])
  assert_eq(app.state().rows.map(r => r.at(0).count).to_array(), [1, 1])
  assert_eq(jp_elems(dom, "button").map(b => b.get_attribute(handler_attr)), [
    Some(".rows[0].items[0]#1"),
    Some(".rows[1].items[0]#1"),
  ])
}
