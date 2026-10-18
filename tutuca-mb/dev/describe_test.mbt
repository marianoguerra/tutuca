///|
fn el(
  tag : String,
  attrs : Array[(String, @vdom.AttrValue)],
  childs : Array[@vdom.VNode],
  ns? : String,
  key? : String,
) -> @vdom.VNode {
  let shape = @vdom.Shape::new(tag, ns?, names=attrs.map(a => a.0)) catch {
    _ => abort("bad shape")
  }
  @vdom.VNode::elem(shape, attrs.map(a => a.1), childs, key?)
}

///|
fn header(v : @vdom.VNode) -> String {
  @dev.describe_vnode(v).header_text()
}

///|
test "elements with a short text child render inline" {
  let v = el("span", [("class", Str("x"))], [Text("Hello")])
  assert_eq(header(v), "<span class=\"x\">Hello</span>")
  assert_false(@dev.describe_vnode(v).has_body())
  assert_eq(header(el("br", [], [])), "<br></br>")
}

///|
test "elements with children expand and close" {
  let v = el("p", [("title", Str("t"))], [
    Text("Hello, "),
    el("b", [], [Text("Ada")]),
  ])
  assert_eq(header(v), "<p title=\"t\">…</p>")
  assert_true(@dev.describe_vnode(v).has_body())
  assert_eq(@dev.describe_vnode(v).body_text(), "<ref><ref></p>")
}

///|
test "attribute values" {
  let v = el(
    "input",
    [("disabled", Bool(true)), ("checked", Bool(false)), ("value", Absent)],
    [],
    key="7",
  )
  assert_eq(
    header(v),
    "<input key=\"7\" disabled checked=false value=null></input>",
  )
  let many = el(
    "div",
    [
      ("a", Str("1")),
      ("b", Str("2")),
      ("c", Str("3")),
      ("d", Str("4")),
      ("e", Str("5")),
      ("f", Str("6")),
    ],
    [],
  )
  assert_eq(header(many), "<div a=\"1\" b=\"2\" c=\"3\" d=\"4\" …+2></div>")
  let html = el("div", [("dangerouslySetInnerHTML", Html("<b>x</b>"))], [])
  assert_eq(header(html), "<div dangerouslySetInnerHTML=<ref>></div>")
}

///|
test "namespaces only show when not implied" {
  let circle = el("circle", [("r", Str("1"))], [], ns=@vdom.svg_ns)
  assert_eq(header(el("svg", [], [circle])), "<svg>…</svg>")
  assert_eq(header(circle), "<svg:circle r=\"1\"></svg:circle>")
}

///|
test "text, comments, fragments and vnode arrays" {
  let long = "x".repeat(50)
  assert_eq(header(Text(long)), "\"\{"x".repeat(40)}…\"")
  assert_eq(header(Comment(" note ")), "<!-- note -->")
  let frag = @vdom.VNode::fragment([el("i", [], []), Text("t")], key="k")
  assert_eq(header(frag), "<> key=\"k\" (2)")
  assert_eq(@dev.describe_vnode(frag).body_text(), "<ref><ref></>")
  let out = @dev.describe_vnodes([el("a", [], []), Comment("c")])
  assert_eq(out.header_text(), "[2 vnodes]")
  assert_eq(out.body_text(), "<ref><ref>")
}

///|
test "metadata comments show the component they open" {
  assert_eq(
    header(
      Comment("§{\"t\":\"component\",\"n\":\"Leaf\",\"p\":\".items[1]\"}§"),
    ),
    "⟨Leaf .items[1]⟩",
  )
  assert_eq(header(Comment(@tutuca.meta_close)), "⟨/⟩")
}

///|
test "state as JSON, its first fields inline" {
  let d = @dev.describe_json({
    "a": 1,
    "b": "x",
    "c": [1, 2],
    "d": { "e": true },
  })
  assert_eq(d.header_text(), "{ a=1 b=\"x\" c=[2] … }")
  assert_eq(d.body_text(), "a: 1b: \"x\"c: <ref>d: <ref>")
}
