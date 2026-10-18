// Ports of test/core/schema.test.js. Field types are struct fields; what types can't say is an
// invariant, checked in dev mode.

///|
test "view becomes main next to named views" {
  let comp : Component[VsS, NoMsg] = component("C", view=() => txt("main"), views=() => {
    [("other", txt("other"))]
  })
  assert_eq(comp.view_names(), ["main", "other"])
  let (host, app, root, _) = mount(comp, vs_state())
  assert_eq(root.text_content(), "main")
  // A message the default update ignores keeps the state.
  let before = app.state()
  app.send(NoMsg)
  host.drain()
  assert_true(physical_equal(app.state(), before))
  let (_, _, root) = mount_view(comp, vs_state(), "other")
  assert_eq(root.text_content(), "other")
}

///|
struct ScSel {
  items : Vec[String]
  selected : Int32
} derive(Debug)

///|
test "index fields are keys of a sibling collection" {
  // Divergent: there is no index type; that `selected` is a key of `items` is an invariant.
  let sel : Component[ScSel, NoMsg] = component("Sel", view=() => txt("sel"), invariants=[
    (
      "selected is a key of items",
      s => s.selected >= 0 && s.selected < s.items.length(),
    ),
  ])
  let (_, _, _, ok) = mount(sel, { items: Vec::of(["a", "b"]), selected: 0, })
  assert_eq(ok.length(), 0)
  let (_, _, _, bad) = mount(sel, { items: Vec::of(["a", "b"]), selected: 2, })
  assert_eq(bad.map(report_text), [
    "invalid Sel at ·: invariant `selected is a key of items` does not hold",
  ])
}

///|
struct ScRange {
  lo : Int32
  hi : Int32
} derive(Debug)

///|
struct ScHolder {
  r : ScRange
} derive(Debug)

///|
test "broken invariants are reported on the component" {
  // An invariant is a (S) -> Bool that can't raise; JS's throwing one is one returning false.
  let range : Component[ScRange, NoMsg] = component(
    "Range",
    view=() => txt("range"),
    invariants=[("ordered", s => s.lo <= s.hi), ("small", s => s.hi <= 100)],
  )
  let holder : Component[ScHolder, NoMsg] = component("Holder", view=() => {
    render(field("r", s => s.r, (_, r) => { r, }), range)
  })
  let (_, _, _, ok) = mount(holder, { r: { lo: 1, hi: 2, }, })
  assert_eq(ok.length(), 0)
  let (_, _, _, bad) = mount(holder, { r: { lo: 300, hi: 200, }, })
  assert_eq(bad.map(report_text), [
    "invalid Range at .r: invariant `ordered` does not hold; Range at .r: invariant `small` does not hold",
  ])
}
