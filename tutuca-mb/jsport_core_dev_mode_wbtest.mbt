// Ports of test/core/dev-mode.test.js. Field schemas are struct field types here, so what dev
// mode checks at runtime is invariants and message contracts (pre, post).

///|
struct DmItem {
  count : Int32
} derive(Debug)

///|
enum DmItemMsg {
  DmInc
} derive(Debug)

///|
let dm_item : Component[DmItem, DmItemMsg] = component(
  "Item",
  view=() => button([on_click(DmInc)], [show(s => s.count.to_string())]),
  update=(s, msg, _) => {
    match msg {
      // JS sets "many", which breaks the number schema; here it breaks the invariant.
      DmInc => { count: if s.count > 0 { 99 } else { s.count + 1 }, }
    }
  },
  invariants=[("count is at most 1", s => s.count <= 1)],
)

///|
struct DmList {
  items : Vec[DmItem]
  title : String
} derive(Debug)

///|
enum DmListMsg {
  DmRename
  DmRetitle(String)
} derive(Debug)

///|
let dm_items : Items[DmList, Int32, DmItem] = items("items", s => s.items, (
  s,
  v,
) => { ..s, items: v, })

///|
let dm_list : Component[DmList, DmListMsg] = component(
  "List",
  view=() => div([on_click(DmRename)], [render_each(dm_items, dm_item)]),
  update=(s, msg, _) => {
    match msg {
      DmRename => { ..s, title: "", }
      DmRetitle(t) => { ..s, title: t, }
    }
  },
  invariants=[("title is not empty", s => s.title != "")],
)

///|
fn dm_new_list(counts : Array[Int32]) -> DmList {
  { items: Vec::of(counts.map(c => DmItem::{ count: c, })), title: "t", }
}

///|
test "findInvalidFields skips subtrees shared with the previous state" {
  // A child whose state is the same object as last render reuses its render, which was
  // checked already: its broken invariant is reported once, not on every render.
  let (host, app, _, reports) = mount(dm_list, dm_new_list([0, 5]))
  assert_eq(reports.map(report_text), [
    "invalid Item at .items[1]: invariant `count is at most 1` does not hold",
  ])
  app.send(DmRetitle("other"))
  host.drain()
  assert_eq(reports.length(), 1)
  assert_eq(app.state().title, "other")
}

///|
test "dev mode checks the root on start and the state after each task" {
  let (host, app, root, reports) = mount(dm_list, dm_new_list([0, 0]))
  assert_eq(reports.length(), 0)
  let first = elems(root, "button")[0]
  // The button has no click handler of the list's: its own handles it, as in JS.
  assert_true(fire(host, first, "click"))
  assert_eq(reports.length(), 0)
  assert_true(fire(host, first, "click"))
  assert_eq(reports.map(report_text), [
    "invalid Item at .items[0]: invariant `count is at most 1` does not hold",
  ])
  // Only the changed component is checked, so the old issue isn't reported again.
  assert_true(fire(host, root.find("div").unwrap(), "click"))
  assert_eq(reports.map(report_text)[1:].to_owned(), [
    "invalid List at ·: invariant `title is not empty` does not hold",
  ])
  // Invalid states are reported, not rolled back.
  assert_eq(app.state().items.at(0).count, 99)
}

///|
test "dev mode reports an invalid root on start, and nothing runs without dev" {
  let bad = DmItem::{ count: 7, }
  let (_, _, _, on) = mount(dm_item, bad)
  assert_eq(on.map(report_text), [
    "invalid Item at ·: invariant `count is at most 1` does not hold",
  ])
  let (host, _, root, off) = mount(dm_item, bad, dev=false)
  click(host, root, "button")
  assert_eq(off.length(), 0)
}

///|
struct DmPicker {
  items : Vec[DmItem]
  picked : Int32
} derive(Debug)

///|
enum DmPickerMsg {
  DmPick(Int32)
} derive(Debug)

///|
test "dev mode reports messages that break their spec" {
  // `args: [t.number().int()]` is DmPick's Int payload, so "bad arg" can't be written, and
  // `emits` has no counterpart: signals are typed keys any handler may notify.
  let picker : Component[DmPicker, DmPickerMsg] = component(
    "Picker",
    view=() => {
      div([], [
        p([on_click(DmPick(1))], [txt("ok")]),
        h("b", [on_click(DmPick(99))], [txt("breaks post")]),
      ])
    },
    update=(s, msg, _) => {
      match msg {
        DmPick(n) => { ..s, picked: n, }
      }
    },
    pre=(prev, _) => prev.items.length() > 0,
    post=(msg, _, next) => {
      match msg {
        DmPick(n) => next.picked == n && n < 10
      }
    },
  )
  let (host, _, root, reports) = mount(picker, {
    items: Vec::of([DmItem::{ count: 0, }]),
    picked: 0,
  })
  click(host, root, "p")
  assert_eq(reports.length(), 0)
  click(host, root, "b")
  assert_eq(reports.map(report_text), [
    "message invalid Picker.DmPick(99): post",
  ])
  let (host, _, root, reports) = mount(picker, { items: Vec::new(), picked: 0, })
  click(host, root, "p")
  assert_eq(reports.map(report_text), ["message invalid Picker.DmPick(1): pre"])
}
