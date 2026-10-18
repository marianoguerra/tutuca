// Ports of test/core/shape.test.js: how lowering splits an element into a Shape, and how the
// morph uses it.

///|
struct ShS {
  t : String
  k : Int32
  on : Bool
  src : String
} derive(Debug)

///|
fn sh_state() -> ShS {
  { t: "T", k: 3, on: true, src: "a.mp4", }
}

///|
enum ShMsg {
  ShSet(ShS)
} derive(Debug)

///|
fn sh_comp(view : View[ShS, ShMsg]) -> Component[ShS, ShMsg] {
  component("Comp", view=() => view, update=(_, msg, _) => {
    match msg {
      ShSet(s) => s
    }
  })
}

///|
fn sh_plan(view : View[ShS, ShMsg]) -> ElemPlan[ShS, ShS, ShMsg] raise {
  match view.compile() {
    PElem(e) => e
    _ => fail("expected a dynamic element")
  }
}

///|
fn sh_shape(view : View[ShS, ShMsg]) -> @vdom.Shape raise {
  match view.compile() {
    PElem(e) => e.shape
    PConst(Elem(e)) => e.shape
    _ => fail("expected an element")
  }
}

///|
test "a DomNode splits its attrs into a shape once: static, dynamic, key and namespace" {
  let view : View[ShS, ShMsg] = h(
    "input",
    [
      cls("c"),
      bind_str("title", s => s.t),
      attr("value", "v"),
      key(s => s.k.to_string()),
      on_input(v => ShSet({ ..sh_state(), t: v, })),
    ],
    [txt("label")],
  )
  let plan = sh_plan(view)
  assert_eq(plan.shape.tag, "input")
  assert_eq(plan.shape.static_attrs, [("class", Str("c"))])
  // value is applied last, so never static; data-h names the bound handlers.
  assert_eq(plan.shape.names, ["title", "value", handler_attr])
  let comp = sh_comp(view)
  let (host, app, _, _) = mount(comp, sh_state())
  // The rendered vnode carries the component's lowered shape itself, not a copy.
  let lowered = match comp.compiled_views().plans.get("main") {
    Some(PElem(e)) => e.shape
    _ => fail("expected main to lower to a dynamic element")
  }
  assert_eq(lowered.static_attrs, plan.shape.static_attrs)
  assert_eq(lowered.names, plan.shape.names)
  let vnode = find_velem(host.vnodes(), "input")
  assert_true(physical_equal(vnode.shape, lowered))
  assert_eq(vnode.values, [Str("T"), Str("v"), Str("·#1")])
  assert_eq(vnode.key, Some("3"))
  assert_eq(vnode.attrs(), [
    ("class", Str("c")),
    ("title", Str("T")),
    ("value", Str("v")),
    (handler_attr, Str("·#1")),
  ])
  app.send(ShSet({ ..sh_state(), t: "U", }))
  host.drain()
  assert_true(physical_equal(find_velem(host.vnodes(), "input").shape, lowered))
}

///|
test "value, checked, is and dangerouslySetInnerHTML stay dynamic even when constant" {
  let shape = sh_shape(
    p(
      [
        attr("value", "1"),
        attr("checked", "true"),
        attr("is", "x-p"),
        attr("dangerouslySetInnerHTML", ""),
      ],
      [],
    ),
  )
  assert_eq(shape.static_attrs, [])
  assert_eq(shape.names, ["value", "checked", "is", "dangerouslySetInnerHTML"])
  try @vdom.Shape::new("p", static_attrs=[("value", Str("1"))]) catch {
    ShapeError(msg) => assert_eq(msg, "value must be a dynamic attr")
  } noraise {
    _ => fail("expected a static value to be refused")
  }
}

///|
test "namespace must be a constant, and svg and math are detected once in the shape" {
  // ns(...) takes a String, so a namespace is always a constant.
  assert_eq(sh_shape(h("g", [ns(@vdom.svg_ns)], [])).ns, Some(@vdom.svg_ns))
  let svg = sh_shape(h("SVG", [], []))
  assert_eq(svg.tag, "svg")
  assert_eq(svg.ns, Some(@vdom.svg_ns))
  assert_eq(sh_shape(h("math", [], [])).ns, Some(@vdom.math_ns))
  assert_eq(sh_shape(div([], [])).ns, None)
}

///|
test "re-rendering a changed dynamic attr writes only that attr" {
  let (host, app, root, _) = mount(
    sh_comp(p([cls("fixed"), bind_str("title", s => s.t)], [txt("x")])),
    { ..sh_state(), t: "a", },
  )
  let el = root.find("p").unwrap()
  assert_eq(el.get_attribute("class"), Some("fixed"))
  ignore(host.doc.take_mutations())
  app.send(ShSet({ ..sh_state(), t: "b", }))
  host.drain()
  assert_eq(host.doc.take_mutations(), [Attribute("title")])
  assert_true(physical_equal(root.find("p").unwrap(), el))
  assert_eq(el.get_attribute("title"), Some("b"))
}

///|
test "different templates with the same tag replace the element; the same one morphs" {
  let (host, app, root, _) = mount(
    sh_comp(
      if_(
        s => s.on,
        div([cls("a"), bind_str("title", s => s.t)], []),
        div([cls("b")], []),
      ),
    ),
    { ..sh_state(), t: "1", },
  )
  let a = root.find("div").unwrap()
  app.send(ShSet({ ..sh_state(), t: "2", }))
  host.drain()
  assert_true(physical_equal(root.find("div").unwrap(), a))
  assert_eq(a.get_attribute("title"), Some("2"))
  app.send(ShSet({ ..sh_state(), on: false, t: "2", }))
  host.drain()
  let b = root.find("div").unwrap()
  assert_false(physical_equal(b, a))
  assert_eq(b.get_attribute("class"), Some("b"))
  assert_eq(b.get_attribute("title"), None)
}

///|
test "a changed key remounts the element" {
  let (host, app, root, _) = mount(
    sh_comp(h("video", [key(s => s.src), bind_str("src", s => s.src)], [])),
    sh_state(),
  )
  let first = root.find("video").unwrap()
  assert_eq(first.get_attribute("key"), None)
  app.send(ShSet({ ..sh_state(), t: "other", }))
  host.drain()
  assert_true(physical_equal(root.find("video").unwrap(), first))
  app.send(ShSet({ ..sh_state(), src: "b.mp4", }))
  host.drain()
  assert_false(physical_equal(root.find("video").unwrap(), first))
}

///|
test "a constant select value is applied after its options are created" {
  let (_, _, root, _) = mount(
    sh_comp(
      select([attr("value", "b")], [
        option([attr("value", "a")], [txt("A")]),
        option([attr("value", "b")], [txt("B")]),
      ]),
    ),
    sh_state(),
  )
  assert_eq(root.find("select").unwrap().value(), "b")
}
