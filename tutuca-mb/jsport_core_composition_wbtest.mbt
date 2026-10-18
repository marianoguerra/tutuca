// Ports of test/core/composition.test.js.

///|
struct CoItem {
  label : String
} derive(Debug)

///|
let co_item : Component[CoItem, NoMsg] = component(
  "Item",
  view=() => h("b", [], [show(s => s.label)]),
  views=() => [("compact", h("i", [], [show(s => s.label)]))],
)

// --- literals in scope and each bodies --------------------------------------------------

///|
struct CoLits {
  items : Vec[Unit]
} derive(Debug)

///|
/// A literal body: text, or nothing for JS null.
fn[X] co_lit(lit : String?) -> ViewAt[X, CoLits, NoMsg] {
  match lit {
    Some(t) => txt(t)
    None => empty()
  }
}

///|
test "literal hello, 42, false and null work in scope and each bodies" {
  // Numbers and booleans are text in MoonBit: txt takes a String.
  for
    case in [
      (Some("hello"), "hello"),
      (Some("42"), "42"),
      (Some("false"), "false"),
      (None, ""),
    ] {
    let (lit, expected) = case
    let in_scope : Component[CoLits, NoMsg] = component("Root", view=() => {
      scope(_ => (), co_lit(lit))
    })
    let in_each : Component[CoLits, NoMsg] = component("Root", view=() => {
      each(s => s.items.iter(), co_lit(lit))
    })
    let state = CoLits::{ items: Vec::of([(), ()]), }
    let (_, _, root, _) = mount(in_scope, state)
    assert_eq(root.text_content(), expected)
    let (_, _, root, _) = mount(in_each, state)
    assert_eq(root.text_content(), expected.repeat(2))
  }
}

// --- view precedence ---------------------------------------------------------------------

///|
struct CoPrecChild {
  n : Int32
} derive(Debug)

///|
struct CoPrec {
  child : CoPrecChild
} derive(Debug)

///|
let co_prec_child : Component[CoPrecChild, NoMsg] = component(
  "Child",
  view=() => txt("default"),
  views=() => {
    [("compact", txt("compact")), ("wide", txt("wide")), ("null", txt("null"))]
  },
)

///|
let co_prec_lens : Lens[CoPrec, CoPrecChild] = field("child", s => s.child, (
  s,
  c,
) => {
  ignore(s)
  { child: c, }
})

///|
/// The root renders the child with `explicit`, inside push_view of each name in `stack`, the
/// first one innermost.
fn co_prec_root(
  explicit : String?,
  stack : Array[String],
) -> Component[CoPrec, NoMsg] {
  let mut tree : View[CoPrec, NoMsg] = render(
    co_prec_lens,
    co_prec_child,
    view?=explicit,
  )
  for name in stack {
    let inner = tree
    tree = push_view(_ => name, inner)
  }
  let view = tree
  component("Root", view=() => view)
}

///|
fn co_precedence(explicit : String?, stack : Array[String]) -> String {
  let (_, _, root, _) = mount(co_prec_root(explicit, stack), {
    child: { n: 0, },
  })
  root.text_content()
}

///|
/// An explicit view the child lacks is refused by the check pass, where JS falls back.
fn co_precedence_issues(explicit : String, stack : Array[String]) -> String {
  co_prec_root(Some(explicit), stack).check().map(i => i.message).join("\n")
}

///|
test "view precedence: [\"compact\",[\"wide\"]]" {
  assert_eq(co_precedence(Some("compact"), ["wide"]), "compact")
}

///|
test "view precedence: [\"missing\",[\"wide\",\"compact\"]]" {
  assert_eq(co_precedence(None, ["wide", "compact"]), "wide")
  assert_eq(
    co_precedence_issues("missing", ["wide", "compact"]),
    "Child has no view `missing`; use one of: main, compact, wide, null",
  )
}

///|
test "view precedence: [null,[\"missing\",\"compact\",\"wide\"]]" {
  assert_eq(co_precedence(None, ["missing", "compact", "wide"]), "compact")
}

///|
test "view precedence: [\"missing\",[\"missing\"]]" {
  assert_eq(co_precedence(None, ["missing"]), "default")
  assert_eq(
    co_precedence_issues("missing", ["missing"]),
    "Child has no view `missing`; use one of: main, compact, wide, null",
  )
}

///|
test "view precedence: [null,[]]" {
  assert_eq(co_precedence(None, []), "default")
}

///|
test "view precedence: [null,[\"null\",\"wide\"]]" {
  assert_eq(co_precedence(None, ["null", "wide"]), "null")
}

///|
test "view precedence: [\"main\",[\"wide\"]]" {
  assert_eq(co_precedence(Some("main"), ["wide"]), "default")
}

///|
test "view precedence: [null,[\"main\",\"wide\"]]" {
  assert_eq(co_precedence(None, ["main", "wide"]), "default")
}

///|
test "view precedence: [\"toString\",[]]" {
  assert_eq(co_precedence(None, ["toString"]), "default")
  assert_eq(
    co_precedence_issues("toString", []),
    "Child has no view `toString`; use one of: main, compact, wide, null",
  )
}

// --- collections: field and seqItem, array and object, four modes ----------------------

///|
struct CoPanel {
  list : Vec[CoItem]
  map : @sorted_map.SortedMap[String, CoItem]
  groups : Vec[Vec[CoItem]]
  mgroups : Vec[@sorted_map.SortedMap[String, CoItem]]
  selected : Int32
} derive(Debug)

///|
fn co_panel() -> CoPanel {
  let a = CoItem::{ label: "A", }
  let b = CoItem::{ label: "B", }
  let map = @sorted_map.SortedMap([("a", a), ("b", b)])
  {
    list: Vec::of([a, b]),
    map,
    groups: Vec::of([Vec::new(), Vec::of([a, b])]),
    mgroups: Vec::of([@sorted_map.new(), map]),
    selected: 1,
  }
}

///|
let co_list : Items[CoPanel, Int32, CoItem] = items("items", s => s.list, (s, v) => {
  ..s,
  list: v,
})

///|
let co_map : Items[CoPanel, String, CoItem] = entries("items", s => s.map, (
  s,
  v,
) => { ..s, map: v, })

///|
/// seqItem("groups", "selected"): the selected group, as a collection.
let co_group : Items[CoPanel, Int32, CoItem] = Lens::partial(
  "groups",
  (s : CoPanel) => s.groups.get(s.selected),
  (s : CoPanel, g) => { ..s, groups: s.groups.set(s.selected, g), },
).then_items(items("selected", g => g, (_, v) => v))

///|
let co_mgroup : Items[CoPanel, String, CoItem] = Lens::partial(
  "groups",
  (s : CoPanel) => s.mgroups.get(s.selected),
  (s : CoPanel, g) => { ..s, mgroups: s.mgroups.set(s.selected, g), },
).then_items(entries("selected", g => g, (_, v) => v))

///|
/// What the panel shows, and the paths of the components it rendered.
fn[K] co_collection(
  items : Items[CoPanel, K, CoItem],
  key_text : (K) -> String,
  mode : String,
) -> (String, Array[String]) {
  let keys = (s : CoPanel) => (items.entries)(s).map(e => e.0)
  let content : View[CoPanel, NoMsg] = match mode {
    "renderEach" => render_each(items, co_item)
    "each" =>
      each(
        keys,
        h("section", [], [show((it : Item[CoPanel, K]) => key_text(it.value))]),
      )
    "renderIt" =>
      each(
        keys,
        h("section", [], [
          render_key(items, (it : Item[CoPanel, K]) => it.value, co_item),
        ]),
      )
    // A custom iteration is ordinary code in the source.
    _ =>
      each(
        s => (items.entries)(s),
        h("section", [], [
          show((it : Item[CoPanel, (K, CoItem)]) => key_text(it.value.0)),
        ]),
      )
  }
  let panel : Component[CoPanel, NoMsg] = component("Panel", view=() => {
    div([], [content])
  })
  let (_, _, root, _) = mount(panel, co_panel())
  (root.text_content(), meta_paths(root))
}

///|
fn[K] co_check_collection(
  items : Items[CoPanel, K, CoItem],
  key_text : (K) -> String,
  keys : Array[String],
  frame : String,
) -> Unit raise {
  let quoted = keys.map(k => {
    if k is ("0" | "1") {
      "[\{k}]"
    } else {
      "[\"\{k}\"]"
    }
  })
  for mode in ["renderEach", "each", "renderIt", "iter"] {
    let (text, paths) = co_collection(items, key_text, mode)
    if mode is ("each" | "iter") {
      assert_eq(text, keys.join(""))
      assert_eq(paths, ["·"])
    } else {
      assert_eq(text, "AB")
      assert_eq(paths, ["·", ..quoted.map(k => frame + k)])
    }
  }
}

///|
test "field array collection: renderEach, each, renderIt, iter" {
  co_check_collection(co_list, i => i.to_string(), ["0", "1"], ".items")
  assert_eq(co_collection(co_list, i => i.to_string(), "renderEach").1, [
    "·", ".items[0]", ".items[1]",
  ])
}

///|
test "field object collection: renderEach, each, renderIt, iter" {
  co_check_collection(co_map, k => k, ["a", "b"], ".items")
  assert_eq(co_collection(co_map, k => k, "renderIt").1, [
    "·", ".items[\"a\"]", ".items[\"b\"]",
  ])
}

///|
test "seqItem array collection: renderEach, each, renderIt, iter" {
  co_check_collection(
    co_group,
    i => i.to_string(),
    ["0", "1"],
    ".groups.selected",
  )
  assert_eq(co_collection(co_group, i => i.to_string(), "renderIt").1, [
    "·", ".groups.selected[0]", ".groups.selected[1]",
  ])
}

///|
test "seqItem object collection: renderEach, each, renderIt, iter" {
  co_check_collection(co_mgroup, k => k, ["a", "b"], ".groups.selected")
}

///|
struct CoTabs {
  tabs : Vec[CoItem]
  selected : Int32
} derive(Debug)

///|
test "render(seqItem) is a frame selecting the item" {
  let tabs_items : Items[CoTabs, Int32, CoItem] = items("tabs", s => s.tabs, (
    s,
    v,
  ) => { ..s, tabs: v, })
  let tabs : Component[CoTabs, NoMsg] = component("Tabs", view=() => {
    div([], [render_key(tabs_items, s => s.selected, co_item)])
  })
  let (_, _, root, _) = mount(tabs, {
    tabs: Vec::of([CoItem::{ label: "a", }, CoItem::{ label: "b", }]),
    selected: 1,
  })
  assert_eq(root.text_content(), "b")
  assert_eq(meta_paths(root), ["·", ".tabs[1]"])
}

// --- loops: key, filter, prepare and enrich are code in each's source --------------------

///|
struct CoLoop {
  items : Vec[CoItem]
  hidden : String
} derive(Debug)

///|
enum CoLoopMsg {
  CoLoopSet(CoLoop)
} derive(Debug)

///|
test "loop key, filter, prepare and enrich are called on the component" {
  let loop_items : Items[CoLoop, Int32, CoItem] = items("items", s => s.items, (
    s,
    v,
  ) => { ..s, items: v, })
  let key_calls : Array[(Int32, String, Int32)] = []
  let comp : Component[CoLoop, CoLoopMsg] = component(
    "Root",
    view=() => {
      each(
        s => {
          // prepare (count) and filter, reading the component's state; the prepared count
          // travels with each item, as JS's prepare result is passed to key and enrich.
          let count = s.items.length()
          s.items
          .iter2()
          .iter()
          .filter(e => e.1.label != s.hidden)
          .map(e => (e.0, e.1.label, count))
        },
        // enrich
        h("p", [bind_str("title", it => "\{it.value.1}/\{it.value.2}")], [
          render_key(loop_items, it => it.value.0, co_item, view="compact"),
        ]),
        key=(v, _) => {
          key_calls.push(v)
          v.1
        },
      )
    },
    update=(_, msg, _) => {
      match msg {
        CoLoopSet(s) => s
      }
    },
  )
  let a = CoItem::{ label: "a", }
  let b = CoItem::{ label: "b", }
  let c = CoItem::{ label: "c", }
  let (host, app, root, _) = mount(comp, {
    items: Vec::of([a, b, c]),
    hidden: "b",
  })
  assert_eq(root.text_content(), "ac")
  assert_eq(key_calls, [(0, "a", 3), (2, "c", 3)])
  let ps = elems(root, "p")
  assert_eq(ps.map(p => p.get_attribute("title").unwrap_or("")), ["a/3", "c/3"])
  // Keys move the DOM nodes instead of patching them in place.
  app.send(CoLoopSet({ items: Vec::of([c, b, a]), hidden: "b", }))
  host.drain()
  assert_true(same_nodes(elems(root, "p"), [ps[1], ps[0]]))
}
