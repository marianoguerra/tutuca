///|
test "paths an import names resolve to one key" {
  debug_inspect(
    [
      @api.join_path(
        "components/todo_item/", "../todo_list/todo_list.tutuca.ts",
      ),
      @api.join_path("", "a/./b/../c.tutuca.ts"),
      @api.join_path("/x/y/", "../../z.tutuca.ts"),
      @api.join_path("a/", "../../b.tutuca.ts"),
    ],
    content=(
      #|[
      #|  "components/todo_list/todo_list.tutuca.ts",
      #|  "a/c.tutuca.ts",
      #|  "/z.tutuca.ts",
      #|  "../b.tutuca.ts",
      #|]
    ),
  )
}

///|
test "load reads the modules an import names through the read function" {
  let files : Map[String, String] = Map::from_array([
    ("lib/i.tutuca.ts", "export interface Item { readonly id: number; }"),
    (
      "app/c.tutuca.ts",
      (
        #|import type { Item } from "../lib/i.tutuca";
        #|export type C = { id: number };
        #|export const C = { implements: ["Item"], defaults: { id: 0 } };
      ),
    ),
  ])
  guard @api.load(p => files.get(p), "app/c.tutuca.ts") is Some((pkg, diags, _)) else {
    fail("not loaded")
  }
  debug_inspect(diags.map(d => d.message), content="[]")
  debug_inspect(
    pkg.interfaces.map(i => (i.name, i.declared_here)),
    content=(
      #|[("Item", false)]
    ),
  )
}

///|
test "a module imports another's meta schemas, which its metas meet" {
  let schema =
    #|export type Size = { width: number | null; round: boolean };
    #|export const Size = {
    #|  metaSchema: "urn:example:size",
    #|  defaults: { round: false },
    #|  constraints: { width: { int: true, min: 0, max: 100 } },
    #|};
  let files : Map[String, String] = Map::from_array([
    ("lib/size.tutuca.ts", schema),
    (
      "app/ok.tutuca.ts",
      (
        #|import type { Size } from "../lib/size.tutuca";
        #|export type C = {};
        #|export const C = { meta: { "urn:example:size": { width: 40 } } };
      ),
    ),
    (
      "app/bad.tutuca.ts",
      (
        #|import type { Size } from "../lib/size.tutuca";
        #|export type C = {};
        #|export const C = { meta: { "urn:example:size": { width: 400, wide: true } } };
      ),
    ),
  ])
  guard @api.load(p => files.get(p), "app/ok.tutuca.ts")
    is Some((pkg, diags, _)) else {
    fail("not loaded")
  }
  debug_inspect(diags.map(d => d.code), content="[]")
  debug_inspect(
    pkg.meta_schemas.map(m => (m.name, m.uri, m.fields.map(f => f.name))),
    content=(
      #|[("Size", "urn:example:size", ["width", "round"])]
    ),
  )
  guard @api.load(p => files.get(p), "app/bad.tutuca.ts") is Some((_, diags, _)) else {
    fail("not loaded")
  }
  debug_inspect(
    diags.map(d => d.code),
    content=(
      #|["pure-tutuca.meta.value", "pure-tutuca.meta.key"]
    ),
  )
}

///|
test "a pure-tutuca module implements an interface it imports from another, for its types" {
  let list =
    #|export interface Item { readonly id: number; setDone(done: boolean): Pure; }
    #|export type Holder = { items: Item[] };
    #|export const Holder = { defaults: { items: [] } };
  let item =
    #|import type { Item as ItemInterface } from "../list/list.tutuca";
    #|export type Item = { id: number; done: boolean };
    #|export const Item = {
    #|  implements: ["Item"],
    #|  defaults: { id: 0, done: false },
    #|  on: { setDone: { pure: true, run(next, [done]: [boolean]) { next.done = done; } } },
    #|};
  let files : Map[String, String] = Map::from_array([
    ("list/list.tutuca.ts", list),
    ("item/item.tutuca.ts", item),
    ("item/value.tutuca.ts", item.replace(old="import type", new="import")),
    (
      "item/nope.tutuca.ts",
      item.replace(old="Item as ItemInterface", new="Nope"),
    ),
  ])
  guard @api.load(p => files.get(p), "item/item.tutuca.ts")
    is Some((pkg, diags, _)) else {
    fail("not loaded")
  }
  debug_inspect(diags.map(d => d.code), content="[]")
  debug_inspect(
    (pkg.interfaces.map(i => i.name), pkg.components.map(c => c.implements)),
    content=(
      #|(["Item"], [["Item"]])
    ),
  )
  let messages = ["item/value.tutuca.ts", "item/nope.tutuca.ts"].map(path => {
    match @api.load(p => files.get(p), path) {
      Some((_, diags, _)) => diags.map(d => d.message)
      None => []
    }
  })
  debug_inspect(
    messages,
    content=(
      #|[
      #|  ["a component module is imported for its types: import type { ... } from \"../list/list.tutuca.ts\""],
      #|  ["../list/list.tutuca.ts declares no type Nope"],
      #|]
    ),
  )
}

///|
test "the tutuca section says what each registered component's meta gives, by URI" {
  let src =
    #|export type Card = {};
    #|export const Card = {
    #|  meta: {
    #|    "https://tutuca.dev/meta/canvas": { title: "Card", icon: "🃏", width: 320, transparent: false },
    #|    "urn:example:tags": { tags: ["a", "b"], ratio: 1.5, none: null },
    #|  },
    #|};
    #|export type Plain = {};
    #|export const Plain = {};
    #|export const register = { Card: "Other", Plain: "Plain" };
  let read = (path : String) => {
    if path == "metas.tutuca.ts" {
      Some(src)
    } else {
      None
    }
  }
  guard @api.load(read, "metas.tutuca.ts") is Some((pkg, diags, _)) else {
    fail("not loaded")
  }
  debug_inspect(diags.map(d => d.code), content="[]")
  guard @api.meta(pkg, "metas.tutuca.ts", read) is Object(section) else {
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
  let expected : Json = { "Other": card }
  assert_eq(section.get("meta"), Some(expected))
}
