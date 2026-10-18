///|
struct Mid {
  leaf : Leaf
  heard : Array[String]
}

///|
struct Top {
  mid : Mid
  heard : Array[String]
}

///|
let mid_leaf : Lens[Mid, Leaf] = field("leaf", m => m.leaf, (m, leaf) => {
  ..m,
  leaf,
})

///|
let top_mid : Lens[Top, Mid] = field("mid", t => t.mid, (t, mid) => {
  ..t,
  mid,
})

///|
test "a message sent to a rendered child notifies through its rendered ancestors, as JS sendAt" {
  let mid : Component[Mid, LeafMsg] = component(
    "Mid",
    view=() => div([], [render(mid_leaf, leaf)]),
    on=[pressed.on((m, name, _) => { ..m, heard: [..m.heard, name], })],
  )
  let top : Component[Top, LeafMsg] = component(
    "Top",
    view=() => render(top_mid, mid),
    on=[pressed.on((t, name, _) => { ..t, heard: [..t.heard, name], })],
  )
  let (host, app, _, reports) = mount(top, {
    mid: { leaf: { name: "x", clicks: 0, }, heard: [], },
    heard: [],
  })
  app.send_to(leaf, top_mid.then(mid_leaf), Press)
  host.drain()
  assert_eq(app.state().mid.leaf.clicks, 1)
  // The middle component, which rendered the leaf, hears it first; it doesn't stop it.
  assert_eq(app.state().mid.heard, ["x"])
  assert_eq(app.state().heard, ["x"])
  assert_eq(reports.length(), 0)
}
