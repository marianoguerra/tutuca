///|
let sample : String =
  #|package tutuca:todos@0.1.0;
  #|
  #|/// What the list needs of an item.
  #|interface TodoItem {
  #|    field id: s32 where id >= 0;
  #|    field done: bool;
  #|    message set_done(done: bool) changes done ensures next.done == done;
  #|}
  #|
  #|component TodoList {
  #|    field items: list<TodoItem> where len(items) <= 500;
  #|    field next_id: s32 = 0 where 0 <= next_id < 1000;
  #|    message move_item(from: option<index<items>>, to: index<items>) changes items;
  #|    message remove_me() source_key: index<items> changes items emits nothing;
  #|    invariant ids: all(items, it.id < next_id);
  #|    loop items { key: s32 }
  #|    view main = ul(class: "list", "on_keydown+enter": send(add_todo), render_each(loop: items, field(items)));
  #|}
  #|register TodoList;
  #|

///|
test "parse a file with every kind of item" {
  let (f, diags) = @syntax.parse("todos.tcd", sample)
  debug_inspect(diags.map(d => @diag.render(d)), content="[]")
  debug_inspect(
    f.package_decl.map(p => p.0),
    content="Some(\"tutuca:todos@0.1.0\")",
  )
  inspect(f.items.length(), content="3")
  guard f.items[1] is Component(d) else { fail("not a component") }
  inspect(d.members.length(), content="7")
  guard d.members[1] is Field(next_id) &&
    next_id.where_ is Some(Bin(And, _, _, ..)) else {
    fail("a chained comparison is a conjunction")
  }
  guard d.members[6] is View(v) && v.body is Call(_, attrs, childs, ..) else {
    fail("not a view")
  }
  debug_inspect(
    attrs.map(a => a.key.text),
    content="[\"class\", \"on_keydown+enter\"]",
  )
  inspect(childs.length(), content="1")
}

///|
test "attributes after children and syntax errors are reported, and parsing goes on" {
  let (f, diags) = @syntax.parse(
    "bad.tcd", "component C { field x: s32 = ; view main = p(\"a\", class: \"b\"); field y: bool; }",
  )
  debug_inspect(
    diags.map(d => d.code),
    content="[\"tcd.syntax.expected\", \"tcd.view.attr_after_child\"]",
  )
  guard f.items[0] is Component(d) else { fail("not a component") }
  inspect(d.members.length(), content="2")
}

///|
test "el's tag comes before its attributes" {
  let (f, diags) = @syntax.parse(
    "el.tcd", "component C { view main = el(\"my-widget\", class: \"x\", \"b\"); }",
  )
  debug_inspect(diags.map(d => d.code), content="[]")
  guard f.items[0] is Component(d) &&
    d.members[0] is View(v) &&
    v.body is Call(_, attrs, childs, ..) else {
    fail("not a view")
  }
  debug_inspect(attrs.map(a => a.key.text), content="[\"class\"]")
  inspect(childs.length(), content="2")
}
