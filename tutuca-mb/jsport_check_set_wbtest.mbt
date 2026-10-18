///|
let lamp : Provide[Leaf] = Provide::new("lamp")

///|
test "lint reports a provided name no registration provides" {
  let reader : Component[Leaf, LeafMsg] = component("Reader", view=() => {
    div([], [
      when_provided(lamp, span([], [show(w => w.value.name)])),
      render_provided(lamp, leaf),
    ])
  })
  let issues = check_set([reader.checked(), leaf.checked()]).map(i => {
    i.to_string()
  })
  // One issue per reading site, with its path, as JS reports `provided(nope)` where it is read.
  assert_eq(issues, [
    "Reader.main <div> > when_provided(lamp): no component here provides `lamp`",
    "Reader.main <div> > render_provided(Leaf): no component here provides `lamp`",
  ])
  // With a provider in the set, nothing to report.
  let lit : Component[Panel, LeafMsg] = component(
    "Lit",
    view=() => div([], []),
    provides=[lamp.at(leaves, p => p.selected)],
  )
  assert_eq(check_set([reader.checked(), leaf.checked(), lit.checked()]), [])
}

///|
test "lint reports a pushed view name no registration declares" {
  let pusher : Component[Panel, LeafMsg] = component("Pusher", view=() => {
    push_view_named("compact", div([], [render_each(leaves, leaf)]))
  })
  let issues = check_set([pusher.checked(), leaf.checked()]).map(i => {
    i.to_string()
  })
  // The views are listed once each, though Pusher and Leaf both have a `main`.
  assert_eq(issues, [
    "Pusher.main push_view(compact): no component here has a view `compact` to push; views: main",
  ])
  let small : Component[Leaf, LeafMsg] = component(
    "Small",
    view=() => span([], []),
    views=() => [("compact", span([], [txt("·")]))],
  )
  assert_eq(check_set([pusher.checked(), small.checked()]), [])
}
