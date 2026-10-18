// Ports of test/core/each.test.js. JS loops (key, filter, enrich) are ordinary code in each's
// source and its `key`.

///|
struct EaRow {
  id : String
  title : String
} derive(Debug)

///|
fn ea_rows() -> Vec[EaRow] {
  Vec::of([
    EaRow::{ id: "a", title: "A", },
    EaRow::{ id: "b", title: "B", },
    EaRow::{ id: "c", title: "C", },
  ])
}

///|
struct EaList {
  items : Vec[EaRow]
  hidden : String
  picked : String
  dup : Bool // Every item gets the same key.
} derive(Debug)

///|
fn ea_list_of(items : Vec[EaRow], hidden~ : String = "") -> EaList {
  { items, hidden, picked: "", dup: false, }
}

///|
enum EaMsg {
  EaSet(EaList)
  EaPick(Int32)
} derive(Debug)

///|
fn ea_update(s : EaList, msg : EaMsg, _ : Ctx[EaList, EaMsg]) -> EaList {
  match msg {
    EaSet(next) => next
    EaPick(i) => { ..s, picked: s.items.at(i).id, }
  }
}

///|
/// The `items` loop: filtered by `hidden`, keyed by id, with the source index for `pick`.
fn ea_visible(s : EaList) -> Iter[(Int32, EaRow, String)] {
  s.items
  .iter2()
  .iter()
  .filter(e => e.1.id != s.hidden)
  .map(e => (e.0, e.1, if s.dup { "duplicate" } else { e.1.id }))
}

///|
let ea_list : Component[EaList, EaMsg] = component(
  "List",
  view=() => {
    div([], [
      each(
        ea_visible,
        button([on_event(Click, (it, _) => Some(EaPick(it.value.0)))], [
          show(it => it.value.1.title),
        ]),
        key=(v, _) => v.2,
      ),
    ])
  },
  update=ea_update,
)

///|
fn ea_rerender(
  host : Host[@memdom.MemNode],
  app : App[EaList, EaMsg],
  next : EaList,
) -> Unit {
  app.send(EaSet(next))
  host.drain()
}

///|
test "XEach keyWith preserves nodes and refreshes event index metadata after reorder/filter" {
  let (host, app, root, _) = mount(ea_list, ea_list_of(ea_rows()))
  let bs = elems(root, "button")
  let (a, b, c) = (bs[0], bs[1], bs[2])
  let reversed = Vec::from_iter(ea_rows().to_array().rev_iter())
  ea_rerender(host, app, ea_list_of(reversed))
  assert_true(same_nodes(elems(root, "button"), [c, b, a]))
  assert_true(fire(host, c, "click"))
  assert_eq(app.state().picked, "c")
  ea_rerender(host, app, ea_list_of(reversed, hidden="b"))
  assert_true(same_nodes(elems(root, "button"), [c, a]))
  assert_true(b.parent_node() is None)
  assert_true(fire(host, a, "click"))
  assert_eq(app.state().picked, "a")
}

///|
test "adjacent keyed XEach loops have independent key scopes" {
  let loop_ = (_ : Int32) => {
    each(ea_visible, h("i", [], [show(it => it.value.2)]), key=(v, _) => v.2)
  }
  let two : Component[EaList, EaMsg] = component(
    "TwoLists",
    view=() => div([], [loop_(0), loop_(1)]),
    update=ea_update,
  )
  let (host, app, root, _) = mount(two, ea_list_of(ea_rows()))
  assert_eq(elems(root, "i").length(), 6)
  ea_rerender(
    host,
    app,
    ea_list_of(Vec::from_iter(ea_rows().to_array().rev_iter())),
  )
  assert_eq(elems(root, "i").length(), 6)
  assert_eq(root.text_content(), "cbacba")
}

///|
test "XEach rejects duplicate compared keys" {
  let (host, app, root, reports) = mount(ea_list, ea_list_of(ea_rows()))
  let html = root.inner_html()
  ea_rerender(host, app, { ..ea_list_of(ea_rows()), dup: true, })
  assert_eq(reports.map(report_text), [
    "render failed: Duplicate sibling key: duplicate",
  ])
  assert_eq(root.inner_html(), html)
}

///|
struct EaGroups {
  items : Array[(String, EaRow)]
} derive(Debug)

///|
enum EaGroupsMsg {
  EaGroupsSet(EaGroups)
} derive(Debug)

///|
test "XEach supports object sources, text, conditional empty output and multiple roots" {
  // An object source is an iterator of (key, value) pairs, keyed by the key.
  let groups : Component[EaGroups, EaGroupsMsg] = component(
    "Groups",
    view=() => {
      div([], [
        each(
          s => s.items.iter(),
          when(
            it => it.value.1.title != "",
            frag([h("i", [], [txt("one")]), h("b", [], [txt("two")])]),
          ),
          key=(v, _) => v.0,
        ),
        each(s => s.items.iter(), show(it => it.value.1.title), key=(v, _) => {
          v.0
        }),
      ])
    },
    update=(_, msg, _) => {
      match msg {
        EaGroupsSet(s) => s
      }
    },
  )
  let ra = EaRow::{ id: "a", title: "A", }
  let rb = EaRow::{ id: "b", title: "B", }
  let (host, app, root, _) = mount(groups, { items: [("a", ra), ("b", rb)], })
  let set = (items : Array[(String, EaRow)]) => {
    app.send(EaGroupsSet({ items, }))
    host.drain()
  }
  let ielems = elems(root, "i")
  let (a, b) = (ielems[0], ielems[1])
  set([("b", rb), ("a", ra)])
  assert_true(same_nodes(elems(root, "i"), [b, a]))
  set([("b", rb), ("a", { ..ra, title: "", })])
  assert_true(same_nodes(elems(root, "i"), [b]))
  set([("b", rb), ("a", ra)])
  assert_eq(elems(root, "i").length(), 2)
  assert_eq(root.text_content(), "onetwoonetwoBA")
  // Divergent: loop iterations have no metadata comments, only components do.
  assert_eq(
    root
    .find("div")
    .unwrap()
    .children()
    .filter(n => n.kind() is CommentNode)
    .length(),
    0,
  )
}

///|
struct EaNested {
  rows : Vec[Array[String]]
  prefix : String
} derive(Debug)

///|
test "loops run on the component, not on the item, inside nested each" {
  let nested : Component[EaNested, NoMsg] = component("Nested", view=() => {
    div([], [
      each(
        s => s.rows.iter(),
        each(it => it.value.iter(), show(it => it.up.up.prefix + it.value)),
      ),
    ])
  })
  let (_, _, root, _) = mount(nested, {
    rows: Vec::of([["a", "b"], ["c"]]),
    prefix: ">",
  })
  assert_eq(root.text_content(), ">a>b>c")
}

///|
struct EaKeyed {
  items : @sorted_map.SortedMap[String, CoItem]
} derive(Debug)

///|
enum EaKeyedMsg {
  EaKeyedSet(EaKeyed)
} derive(Debug)

///|
test "XEach defaults to source keys without keyWith" {
  // Divergent for each: its source is an iterator, so without `key` an item is keyed by its
  // position. render_each, which reads a keyed collection, defaults to the item's key.
  let keyed_items : Items[EaKeyed, String, CoItem] = entries(
    "items",
    s => s.items,
    (_, v) => { items: v, },
  )
  let comp : Component[EaKeyed, EaKeyedMsg] = component(
    "DefaultKeys",
    view=() => div([], [render_each(keyed_items, co_item)]),
    update=(_, msg, _) => {
      match msg {
        EaKeyedSet(s) => s
      }
    },
  )
  let ia = CoItem::{ label: "A", }
  let ib = CoItem::{ label: "B", }
  let (host, app, root, _) = mount(comp, {
    items: @sorted_map.SortedMap([("a", ia), ("b", ib)]),
  })
  let b = elems(root, "b")[1]
  app.send(EaKeyedSet({ items: @sorted_map.SortedMap([("b", ib)]), }))
  host.drain()
  assert_true(same_nodes(elems(root, "b"), [b]))
}
