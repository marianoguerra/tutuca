///|
test "paths a use names resolve to one key" {
  debug_inspect(
    [
      @api.join_path("components/todo_item/", "../todo_list/todo_list.tcd"),
      @api.join_path("", "a/./b/../c.tcd"),
      @api.join_path("/x/y/", "../../z.tcd"),
      @api.join_path("a/", "../../b.tcd"),
    ],
    content=(
      #|[
      #|  "components/todo_list/todo_list.tcd",
      #|  "a/c.tcd",
      #|  "/z.tcd",
      #|  "../b.tcd",
      #|]
    ),
  )
}

///|
test "load reads the files a use names through the read function" {
  let files : Map[String, String] = Map::from_array([
    ("lib/i.tcd", "interface Item { field id: s32; }"),
    (
      "app/c.tcd", "use \"../lib/i.tcd\".{ Item }; component C: Item { field id: s32; view main = p(); }",
    ),
  ])
  guard @api.load(p => files.get(p), "app/c.tcd") is Some((pkg, diags)) else {
    fail("not loaded")
  }
  debug_inspect(diags.map(d => d.message), content="[]")
  debug_inspect(
    pkg.interfaces.map(i => i.name),
    content=(
      #|["Item"]
    ),
  )
}
