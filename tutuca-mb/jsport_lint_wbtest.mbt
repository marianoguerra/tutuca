// Port of test/lint/lint.test.js. Most JS lint rules are compile errors in MoonBit (see
// docs/parity/paths-vdom-lint-pbt.md); these are the ones `Component::check` keeps.

///|
struct LtItem {
  label : String
}

///|
enum LtMsg {
  SetQuery(String)
  Pick(Int32)
} derive(Debug)

///|
struct LtPage {
  items : Vec[LtItem]
  selected : Int32
  query : String
}

///|
let lt_list : Provide[Vec[LtItem]] = Provide::new("list")

///|
fn lt_item() -> Component[LtItem, LtMsg] {
  component("Item", view=() => show(s => s.label), views=() => {
    [("row", li([], [show(s => s.label)]))]
  })
}

///|
test "a component using every helper correctly is clean" {
  let item = lt_item()
  let page_items : Items[LtPage, Int32, LtItem] = items("items", p => p.items, (
    p,
    items,
  ) => { ..p, items, })
  let list_items : Items[Vec[LtItem], Int32, LtItem] = items(
    "list",
    v => v,
    lt_keep_new,
  )
  let page : Component[LtPage, LtMsg] = component(
    "Page",
    view=() => {
      div([class_(p => if p.query != "" { "a" } else { "b" })], [
        input([on_input(v => SetQuery(v))]),
        each(
          p => p.items.iter().map(i => i.label),
          button([on_event(Click, (it, _) => Some(Pick(it.index)))], [
            show(it => it.value),
          ]),
        ),
        each(
          p => p.items.iter(),
          render_key(page_items, it => it.index, item, view="row"),
        ),
        render_each(page_items, item, view="row"),
        render_key(page_items, p => p.selected, item),
        scope(p => p.items.length(), show(w => w.value.to_string())),
        push_view(
          _ => "row",
          when_provided(
            lt_list,
            each(
              w => w.value.iter(),
              render_provided_key(lt_list, list_items, it => it.index, item),
            ),
          ),
        ),
      ])
    },
    update=(s, msg, _) => {
      match msg {
        SetQuery(query) => { ..s, query, }
        Pick(selected) => { ..s, selected, }
      }
    },
    provides=[
      lt_list.from(field("items", p => p.items, (p, items) => { ..p, items, })),
    ],
  )
  assert_eq(page.check(), [])
  assert_eq(item.check(), [])
  // And it renders and handles events without a problem.
  let (host, app, dom, reports) = jp_mount(page, {
    items: Vec::of([{ label: "a", }, { label: "b", }]),
    selected: 1,
    query: "",
  })
  jp_click(host, jp_elems(dom, "button")[0])
  assert_eq(app.state().selected, 0)
  assert_eq(jp_failures(reports), [])
}

///|
fn lt_keep_new(_ : Vec[LtItem], v : Vec[LtItem]) -> Vec[LtItem] {
  v
}

///|
test "lint reports an event type that is not lower-case" {
  let camel : Component[LtItem, LtMsg] = component("Camel", view=() => {
    button([on_event(Custom("Click"), (_, _) => Some(Pick(0)))], [])
  })
  assert_eq(camel.check().map(i => i.to_string()), [
    "Camel.main <button>: `Click` is not a DOM event this checker knows; check its spelling, or the handler never runs",
  ])
}

///|
struct LtViews {
  child : LtItem
}

///|
test "lint reports view names no registration declares" {
  let views : Component[LtViews, LtMsg] = component("Views", view=() => {
    div([], [
      render(
        field("child", s => s.child, (_, child) => { child, }),
        lt_item(),
        view="missing",
      ),
    ])
  })
  assert_eq(views.check().map(i => i.to_string()), [
    "Views.main <div> > render(Item): Item has no view `missing`; use one of: main, row",
  ])
}

///|
test "lint reports a view rooted at render" {
  let root : Component[LtViews, LtMsg] = component("Root", view=() => {
    render(field("child", s => s.child, (_, child) => { child, }), lt_item())
  })
  assert_eq(root.check(), [])
}
