// The cases of test/vdom/vdom.test.js, on memdom.

///|
let shapes : Map[String, @vdom.Shape] = Map([])

///|
/// Builds raw vnodes the way tutuca's lowering would: every attr is dynamic and shapes are
/// cached by tag, namespace and attr names, so equal templates share a shape.
fn vh(
  tag : String,
  attrs~ : Array[(String, @vdom.AttrValue)] = [],
  childs~ : Array[@vdom.VNode] = [],
  key? : String,
  ns? : String,
) -> @vdom.VNode {
  let names = attrs.map(a => a.0)
  let id = "\{tag}|\{ns.unwrap_or("")}|\{names.join(",")}"
  let shape = match shapes.get(id) {
    Some(s) => s
    None => {
      let s = @vdom.Shape::new(tag, ns?, names~) catch {
        _ => abort("bad shape")
      }
      shapes[id] = s
      s
    }
  }
  @vdom.VNode::elem(shape, attrs.map(a => a.1), childs, key?)
}

///|
fn t(s : String) -> @vdom.VNode {
  Text(s)
}

///|
fn setup() -> (@memdom.MemNode, @memdom.MemNode) {
  let doc = @memdom.document()
  (doc, doc.element("div"))
}

///|
fn draw(
  doc : @memdom.MemNode,
  container : @memdom.MemNode,
  childs : Array[@vdom.VNode],
  prev? : Array[@vdom.VNode],
) -> Array[@vdom.VNode] raise {
  @vdom.render(doc, container, childs, prev?)
  childs
}

///|
test "render mounts, then morphs in place from what the last render returned" {
  let (doc, container) = setup()
  let prev = draw(doc, container, [
    vh("p", attrs=[("class", Str("a"))], childs=[t("one")]),
    t("tail"),
  ])
  assert_eq(prev.length(), 2)
  inspect(container.inner_html(), content="<p class=\"a\">one</p>tail")
  let p = container.first_child().unwrap()
  ignore(
    draw(
      doc,
      container,
      [vh("p", attrs=[("class", Str("b"))], childs=[t("two")]), t("tail")],
      prev~,
    ),
  )
  inspect(container.inner_html(), content="<p class=\"b\">two</p>tail")
  assert_true(physical_equal(container.first_child().unwrap(), p))
}

///|
test "namespaces: svg and math are detected, inherited, and reset by foreignObject" {
  let (doc, container) = setup()
  let tree = (extra : Array[@vdom.VNode]) => {
    [
      vh("div", childs=[
        vh(
          "SVG",
          childs=[
            vh("circle", attrs=[("r", Str("1"))]),
            vh("foreignObject", childs=[vh("span", childs=[t("html")])]),
            ..extra,
          ],
        ),
        vh("math", childs=[vh("mi", childs=[t("x")])]),
        vh("g", ns=@vdom.svg_ns),
      ]),
    ]
  }
  let prev = draw(doc, container, tree([]))
  let ns = (tag : String) => container.find(tag).unwrap().namespace_uri()
  assert_eq(ns("svg"), Some(@vdom.svg_ns))
  assert_eq(ns("circle"), Some(@vdom.svg_ns))
  assert_eq(ns("foreignObject"), Some(@vdom.svg_ns))
  assert_eq(ns("span"), None)
  assert_eq(ns("math"), Some(@vdom.math_ns))
  assert_eq(ns("mi"), Some(@vdom.math_ns))
  assert_eq(ns("g"), Some(@vdom.svg_ns))
  assert_eq(container.find("g").unwrap().get_attribute("namespace"), None)
  // Children mounted while morphing inherit the namespace too.
  ignore(
    draw(
      doc,
      container,
      tree([vh("rect"), vh("foreignObject", childs=[vh("b")])]),
      prev~,
    ),
  )
  assert_eq(ns("rect"), Some(@vdom.svg_ns))
  assert_eq(ns("b"), None)
}

///|
test "an unchanged re-render writes nothing to the DOM" {
  let (doc, container) = setup()
  let tree = () => {
    [
      vh(
        "ul",
        childs=[1, 2, 3].map(i => {
          vh("li", attrs=[("class", Str("r"))], childs=[
            vh("b", childs=[t("\{i}")]),
            t(" x"),
          ])
        }),
      ),
    ]
  }
  let prev = draw(doc, container, tree())
  ignore(doc.take_mutations())
  ignore(draw(doc, container, tree(), prev~))
  assert_eq(doc.take_mutations(), [])
}

///|
test "a changed leaf only writes that leaf" {
  let (doc, container) = setup()
  let tree = (last : String) => {
    [
      vh("ul", childs=[
        vh("li", childs=[t("a")]),
        vh("li", childs=[t("b")]),
        vh("li", childs=[t(last)]),
      ]),
    ]
  }
  let prev = draw(doc, container, tree("c"))
  ignore(doc.take_mutations())
  ignore(draw(doc, container, tree("C"), prev~))
  assert_eq(doc.take_mutations(), [CharacterData("C")])
}

///|
test "a shared vnode is skipped by identity, without looking at the DOM" {
  let (doc, container) = setup()
  let shared = vh("header", childs=[vh("h1", childs=[t("Title")])])
  let prev = draw(doc, container, [shared, vh("p", childs=[t("1")])])
  container
  .find("h1")
  .unwrap()
  .first_child()
  .unwrap()
  .set_data("changed outside")
  ignore(draw(doc, container, [shared, vh("p", childs=[t("2")])], prev~))
  inspect(
    container.find("h1").unwrap().text_content(),
    content="changed outside",
  )
  inspect(container.find("p").unwrap().text_content(), content="2")
}

///|
test "a select reapplies its value when its options change" {
  let (doc, container) = setup()
  let tree = (opts : Array[String]) => {
    [
      vh(
        "select",
        attrs=[("value", Str("b"))],
        childs=opts.map(o => {
          vh("option", attrs=[("value", Str(o))], childs=[t(o)])
        }),
      ),
    ]
  }
  let prev = draw(doc, container, tree(["a"]))
  inspect(container.find("select").unwrap().value(), content="")
  ignore(draw(doc, container, tree(["a", "b"]), prev~))
  inspect(container.find("select").unwrap().value(), content="b")
}

///|
test "same tag with a different shape replaces the element" {
  let (doc, container) = setup()
  let prev = draw(doc, container, [vh("div", attrs=[("class", Str("a"))])])
  let first = container.first_child().unwrap()
  ignore(draw(doc, container, [vh("div", attrs=[("title", Str("t"))])], prev~))
  assert_false(physical_equal(container.first_child().unwrap(), first))
  inspect(container.inner_html(), content="<div title=\"t\"></div>")
}

///|
test "keyed children move instead of being rebuilt" {
  let (doc, container) = setup()
  let row = (k : String) => vh("li", childs=[t(k)], key=k)
  let prev = draw(doc, container, [row("a"), row("b"), row("c")])
  let b = container.children()[1]
  ignore(draw(doc, container, [row("c"), row("b"), row("d")], prev~))
  inspect(container.inner_html(), content="<li>c</li><li>b</li><li>d</li>")
  assert_true(physical_equal(container.children()[1], b))
}

///|
test "fragments morph as groups and empty fragments keep placement" {
  let (doc, container) = setup()
  let tree = (mid : Array[@vdom.VNode]) => {
    [
      t("<"),
      @vdom.VNode::fragment(mid, key="m"),
      @vdom.VNode::fragment([]),
      t(">"),
    ]
  }
  let prev = draw(doc, container, tree([t("1"), t("2")]))
  inspect(container.inner_html(), content="<12>")
  let prev = draw(doc, container, tree([t("2"), t("3"), t("4")]), prev~)
  inspect(container.inner_html(), content="<234>")
  ignore(draw(doc, container, tree([]), prev~))
  inspect(container.inner_html(), content="<>")
}

///|
test "duplicate sibling keys raise" {
  let (doc, container) = setup()
  let prev = draw(doc, container, [vh("i", key="x")])
  try draw(doc, container, [vh("i", key="x"), vh("b", key="x")], prev~) catch {
    _ => ()
  } noraise {
    _ => fail("expected a duplicate key error")
  }
}

///|
test "checked and value are properties, false booleans remove attributes" {
  let (doc, container) = setup()
  let tree = (on : Bool) => {
    [
      vh("input", attrs=[
        ("type", Str("checkbox")),
        ("checked", Bool(on)),
        ("disabled", Bool(on)),
        ("data-x", Bool(on)),
      ]),
    ]
  }
  let prev = draw(doc, container, tree(true))
  let input = container.find("input").unwrap()
  assert_eq(input.get_property("checked"), Some(Bool(true)))
  ignore(draw(doc, container, tree(false), prev~))
  assert_eq(input.get_property("checked"), Some(Bool(false)))
  assert_eq(input.get_attribute("data-x"), Some("false"))
}

///|
test "dangerouslySetInnerHTML sets markup and skips children" {
  let (doc, container) = setup()
  let tree = (html : String) => {
    [vh("div", attrs=[("dangerouslySetInnerHTML", Html(html))])]
  }
  let prev = draw(doc, container, tree("<b>x</b>"))
  inspect(container.inner_html(), content="<div><b>x</b></div>")
  ignore(doc.take_mutations())
  ignore(draw(doc, container, tree("<b>x</b>"), prev~))
  assert_eq(doc.take_mutations(), [])
}

///|
test "value and checked cannot be static" {
  try @vdom.Shape::new("input", static_attrs=[("value", Str("x"))]) catch {
    _ => ()
  } noraise {
    _ => fail("expected a static value to be refused")
  }
}

///|
test "nodes someone else removed or added don't make a morph read out of range" {
  let (doc, container) = setup()
  let prev = draw(doc, container, [
    vh("p", childs=[t("a")]),
    vh("b", childs=[t("b")]),
  ])
  // Something outside the renderer takes both nodes away.
  container.replace_children()
  let prev = draw(
    doc,
    container,
    [vh("p", childs=[t("a2")]), vh("b", childs=[t("b2")])],
    prev~,
  )
  inspect(container.inner_html(), content="<p>a2</p><b>b2</b>")
  // And something adds one of its own: what follows is morphed from the wrong node, as in JS,
  // but nothing breaks.
  container.append_child(doc.create_comment("foreign"))
  ignore(draw(doc, container, [vh("p", childs=[t("a3")])], prev~))
  assert_true(container.inner_html().contains("<p>a3</p>"))
}
