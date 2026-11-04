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

///|
test "the tutuca section says what each registered component's meta gives, by URI" {
  let src =
    #|package tutuca:metas@0.1.0;
    #|component Card {
    #|    meta "https://tutuca.dev/meta/canvas" = { title: "Card", icon: "🃏", width: 320, transparent: false };
    #|    meta "urn:example:tags" = { tags: ["a", "b"], ratio: 1.5, none: null };
    #|    view main = p();
    #|}
    #|component Plain { view main = p(); }
    #|register Card, Plain;
    #|register Card as Other;
  let (f, parse_diags) = @syntax.parse("metas.tcd", src)
  inspect(parse_diags.length(), content="0")
  let (pkg, diags) = @check.check(f, Map([]))
  inspect(diags.map(d => d.code), content="[]")
  let read = (path : String) => {
    if path == "metas.tcd" {
      Some(src)
    } else {
      None
    }
  }
  guard @api.meta(pkg, "metas.tcd", read, []) is Object(section) else {
    fail("not an object")
  }
  let card : Json = {
    "https://tutuca.dev/meta/canvas": {
      "title": "Card",
      "icon": "🃏",
      "width": 320,
      "transparent": false,
    },
    "urn:example:tags": { "tags": ["a", "b"], "ratio": 1.5, "none": null },
  }
  let expected : Json = { "Card": card, "Other": card }
  assert_eq(section.get("meta"), Some(expected))
}
