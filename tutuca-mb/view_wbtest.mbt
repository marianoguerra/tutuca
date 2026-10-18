///|
struct Card {
  title : String
  tags : Array[String]
  done : Bool
}

///|
enum CardMsg {
  Rename(String)
  Remove(Int32)
  Toggle
} derive(Debug)

///|
fn card_view() -> View[Card, CardMsg] {
  div([cls("card")], [
    h1([], [txt("Title: "), show(s => s.title)]),
    p([cls("static")], [txt("never "), txt("changes")]),
    input([value(s => s.title), on_input(v => Rename(v))]),
    when(s => s.done, span([], [txt("done")])),
    ul([], [
      each(s => s.tags.iter(), li([on_click(Toggle)], [show(it => it.value)]), key=(
        t,
        _,
      ) => t),
    ]),
    each(
      s => s.tags.iter(),
      button([on_event(Click, (it, _) => Some(Remove(it.index)))], [
        show(it => "x \{it.up.title}"),
      ]),
    ),
  ])
}

///|
let card : Component[Card, CardMsg] = component("Card", view=card_view, update=(
  s,
  msg,
  _,
) => {
  match msg {
    Rename(title) => { ..s, title, }
    Remove(i) => {
      let tags = s.tags.copy()
      ignore(tags.remove(i))
      { ..s, tags, }
    }
    Toggle => { ..s, done: !s.done, }
  }
})

///|
test "a view renders through its plan" {
  let (_, _, root, _) = mount(card, {
    title: "T",
    tags: ["a", "b"],
    done: true,
  })
  inspect(
    root.inner_html(),
    content=(
      #|<!--§{"t":"component","n":"Card","p":"·"}§--><div class="card"><h1>Title: T</h1><p class="static">never changes</p><input data-h="·#1"></input><span>done</span><ul><li data-h="·#2[a]">a</li><li data-h="·#2[b]">b</li></ul><button type="button" data-h="·#3[0]">x T</button><button type="button" data-h="·#3[1]">x T</button></div><!--§/§-->
    ),
  )
}

///|
test "constant subtrees are prebuilt once and shared" {
  let plan = card_view().compile()
  guard plan is PElem(e) else { fail("expected an element") }
  guard e.childs[1] is PConst(_) else {
    fail("expected the <p> to be constant")
  }
  guard e.childs[0] is PElem(_) else { fail("expected the <h1> to be dynamic") }
}

///|
test "handlers send what the view read" {
  let (host, app, root, _) = mount(card, {
    title: "T",
    tags: ["a", "b"],
    done: false,
  })
  click(host, root, "button", text="x T")
  assert_eq(app.state().tags, ["b"])
  let input = root.find("input").unwrap()
  input.props["value"] = Str("new")
  ignore(host.handle_event(input, "input"))
  host.drain()
  inspect(app.state().title, content="new")
  inspect(root.find("h1").unwrap().text_content(), content="Title: new")
}

///|
test "the IR lists event and class names" {
  let ir = card_view().ir()
  assert_eq(ir.event_names(), ["input", "click"])
  assert_eq(ir.class_names(), ["card", "static"])
}

///|
test "check names what to write instead" {
  let bad : View[Card, CardMsg] = div([cls("a"), cls("b")], [
    input([attr("value", "x"), on_click(Toggle), on_click(Toggle)]),
  ])
  let issues = check(bad.ir()).map(i => i.to_string())
  inspect(
    issues.join("\n"),
    content=(
      #|<div>: `class` is set more than once; keep one, joining classes into a single cls(...) or class_(...)
      #|<div> > <input>: has two `click` handlers; only one runs, so merge them into one on_event(...)
    ),
  )
  try bad.compile() catch {
    ViewError(issues) => inspect(issues.length(), content="2")
  } noraise {
    _ => fail("expected the view to be refused")
  }
}

///|
test "scope computes a value for its body" {
  let scoped : Component[Card, CardMsg] = component("Scoped", view=() => {
    scope(
      s => s.tags.length(),
      p([], [show(w => "\{w.up.title} has \{w.value}")]),
    )
  })
  let (_, _, root, _) = mount(scoped, { title: "T", tags: ["a"], done: false, })
  inspect(
    root.inner_html(),
    content=(
      #|<!--§{"t":"component","n":"Scoped","p":"·"}§--><p>T has 1</p><!--§/§-->
    ),
  )
}

///|
test "check flags an event name it doesn't know" {
  let v : View[Card, CardMsg] = button(
    [on(Custom("clik"), Toggle), on(Custom("contextmenu"), Toggle)],
    [],
  )
  assert_eq(check(v.ir()).map(i => i.to_string()), [
    "<button>: `clik` is not a DOM event this checker knows; check its spelling, or the handler never runs",
  ])
}
