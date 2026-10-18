// Ports of test/core/view-semantics.test.js.

///|
struct VsS {
  name : String
  loud : Bool
  value : String
  show : Bool
} derive(Debug)

///|
fn vs_state() -> VsS {
  { name: "world", loud: false, value: "", show: true, }
}

///|
enum VsMsg {
  VsSet(VsS)
} derive(Debug)

///|
fn vs_comp(view : View[VsS, VsMsg]) -> Component[VsS, VsMsg] {
  component(
    "Root",
    view=() => view,
    views=() => [("compact", txt("compact"))],
    update=(_, msg, _) => {
      match msg {
        VsSet(s) => s
      }
    },
  )
}

///|
fn vs_lit(lit : String?) -> View[VsS, VsMsg] {
  match lit {
    Some(t) => txt(t)
    None => empty()
  }
}

///|
test "literal hello, 42, false, null and undefined work in every expression body" {
  // Numbers and booleans are text here (txt takes a String); null and undefined are empty().
  for
    case in [
      (Some("hello"), "hello"),
      (Some("42"), "42"),
      (Some("false"), "false"),
      (None, ""),
    ] {
    let (lit, expected) = case
    let bodies = [
      vs_lit(lit),
      if_(_ => true, vs_lit(lit), txt("wrong")),
      if_(_ => false, txt("wrong"), vs_lit(lit)),
      // The root has a compact view, but push_view only affects components below.
      push_view(_ => "compact", vs_lit(lit)),
    ]
    for body in bodies {
      let (_, _, root, _) = mount(vs_comp(body), vs_state())
      assert_eq(root.text_content(), expected)
    }
  }
}

///|
test "literal condition uses JS truthiness and only evaluates the selected branch" {
  // A condition is a Bool, so there is no truthiness to get wrong.
  for value in [false, true] {
    let calls = Ref(0)
    let selected : View[VsS, VsMsg] = show(_ => {
      calls.val += 1
      "selected"
    })
    let rejected : View[VsS, VsMsg] = show(_ => {
      abort("unselected branch evaluated")
    })
    let view = if_(
      _ => value,
      if value {
        selected
      } else {
        rejected
      },
      if value {
        rejected
      } else {
        selected
      },
    )
    let (_, _, root, _) = mount(vs_comp(view), vs_state())
    assert_eq(root.text_content(), "selected")
    assert_eq(calls.val, 1)
  }
}

///|
test "attributes and children read fields, and $if selects values" {
  let greeting = vs_comp(
    p(
      [
        class_(s => if s.loud { "loud" } else { "quiet" }),
        bind_str("title", s => s.name),
      ],
      [txt("Hello, "), show(s => s.name), txt("!")],
    ),
  )
  let (_, _, root, _) = mount(greeting, {
    ..vs_state(),
    name: "Ada",
    loud: true,
  })
  let el = root.find("p").unwrap()
  assert_eq(el.text_content(), "Hello, Ada!")
  assert_eq(el.get_attribute("title"), Some("Ada"))
  assert_eq(el.get_attribute("class"), Some("loud"))
}

///|
test "re-rendering patches the existing DOM" {
  let comp = vs_comp(span([], [show(s => s.value)]))
  let (host, app, root, _) = mount(comp, { ..vs_state(), value: "a", })
  let el = root.find("span").unwrap()
  app.send(VsSet({ ..vs_state(), value: "b", }))
  host.drain()
  assert_true(physical_equal(root.find("span").unwrap(), el))
  assert_eq(el.text_content(), "b")
}

///|
test "components are wrapped in meta comments" {
  // The opening comment also names the component and its path.
  let comp : Component[VsS, VsMsg] = component("C", view=() => {
    h("b", [], [txt("x")])
  })
  let (_, _, root, _) = mount(comp, vs_state())
  let comments = root
    .children()
    .filter(n => n.kind() is CommentNode)
    .map(n => n.data())
  assert_eq(comments, [
    "§{\"t\":\"component\",\"n\":\"C\",\"p\":\"·\"}§", "§/§",
  ])
}

///|
test "view names don't resolve to inherited properties" {
  let comp : Component[VsS, VsMsg] = component("C", view=() => txt("main"))
  assert_eq(comp.view_names(), ["main"])
  let (_, _, root) = mount_view(comp, vs_state(), "toString")
  assert_eq(root.text_content(), "main")
}

///|
test "arrays of children splice into their parent, nested ones too" {
  let comp = vs_comp(
    p([], [
      frag([
        h("b", [], [txt("x")]),
        frag([if_(s => s.show, h("i", [], [txt("y")]), txt("")), txt("z")]),
      ]),
    ]),
  )
  let (_, _, root, _) = mount(comp, vs_state())
  assert_eq(root.find("p").unwrap().inner_html(), "<b>x</b><i>y</i>z")
}
