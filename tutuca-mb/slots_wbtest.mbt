///|
struct Toggle {
  on : Bool
}

///|
enum ToggleMsg {
  Flip
} derive(Debug)

///|
test "a when turning on or off keeps the nodes of the siblings after it" {
  let comp : Component[Toggle, ToggleMsg] = component(
    "Toggle",
    view=() => {
      div([], [
        when(s => s.on, span([], [txt("shown")])),
        input([cls("field")]),
        button([on_click(Flip)], [txt("flip")]),
      ])
    },
    update=(s, _, _) => { on: !s.on, },
  )
  let (host, _, dom, _) = mount(comp, { on: false, })
  let field = dom.descendants().filter(n => n.tag_name() == "INPUT")[0]
  click(host, dom, "button", text="flip")
  assert_true(dom.text_content().contains("shown"))
  let now = dom.descendants().filter(n => n.tag_name() == "INPUT")[0]
  assert_true(physical_equal(field, now))
  click(host, dom, "button", text="flip")
  let now = dom.descendants().filter(n => n.tag_name() == "INPUT")[0]
  assert_true(physical_equal(field, now))
}
