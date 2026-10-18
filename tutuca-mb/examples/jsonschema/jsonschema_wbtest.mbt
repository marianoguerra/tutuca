///|
test "read_kind follows the order a validator reads a schema in" {
  let cases : Array[(Json, String)] = [
    (true, "any"),
    (false, "never"),
    ({}, "any"),
    ({ "$ref": "#/x", "type": "string" }, "ref"),
    ({ "anyOf": [], "type": "string" }, "anyOf"),
    ({ "not": {}, "enum": [1] }, "not"),
    ({ "enum": [1], "type": "string" }, "enum"),
    ({ "const": 1, "type": "string" }, "const"),
    ({ "type": "integer" }, "integer"),
    ({ "type": ["string", "null"] }, "union"),
    ({ "required": ["a"] }, "object"),
    ({ "items": {} }, "array"),
    ({ "title": "only notes" }, "any"),
  ]
  for c in cases {
    assert_eq(read_kind(c.0), c.1, msg=c.0.stringify())
  }
}

///|
test "a schema reads back as itself when it only uses what the family models" {
  assert_eq(canonical(from_schema(sample).to_schema()), canonical(sample))
}

///|
test "reading a tree back is a fixed point" {
  @testing.check_property(
    "fixed point",
    (rs, _) => {
      let schema = gen_schema(rs, 3)
      let once = from_schema(schema).to_schema()
      let twice = from_schema(once).to_schema()
      if canonical(once) != canonical(twice) {
        raise @testing.Broke("\{canonical(once)}\n  \{canonical(twice)}")
      }
    },
    count=200,
  )
}

///|
fn text_of(root : SchemaRoot) -> String {
  @testing.Driver::new(schema_root, root).text()
}

///|
fn assert_reads(text : String, parts : Array[String]) -> Unit raise {
  for part in parts {
    let part = part.replace_all(old=" ", new="")
    if !text.contains(part) {
      fail("\{part} in \{text}")
    }
  }
}

///|
test "the semantic view reads as a data dictionary" {
  assert_reads(text_of(schema_tree(sample)), [
    "object (10)", "One entry of a podcast feed.", "id * : string uuid", "title * : string ≥ 1 ≤ 200",
    "rating : number ≥ 0 ≤ 5", "notes : string null", "tags : ▾array of ≤ 10",
    "$ref #/$defs/person", "…and nothing",
  ])
}

///|
test "the format view reads as keywords" {
  assert_reads(text_of(schema_tree(sample, reading=Format)), [
    "title : Episode", "id : required", "durationSeconds : optional", "minLength : 1",
    "maxItems : 10", "additionalProperties",
  ])
}

///|
test "a closed node hides what is below it" {
  let text = text_of(schema_tree(sample, open=false))
  assert_true(text.contains("object(10)"))
  assert_false(text.contains("durationSeconds"))
}

///|
let nested : Json = {
  "type": "object",
  "properties": {
    "a": {
      "type": "object",
      "properties": { "b": { "type": "array", "items": { "type": "string" } } },
    },
    "c": { "anyOf": [{ "type": "string" }] },
    "d": { "type": "string" },
  },
}

///|
fn click_disclosure(
  d : @testing.Driver[SchemaRoot, RootMsg],
  index : Int32,
  ctrl~ : Bool = false,
  alt~ : Bool = false,
) -> Unit {
  let buttons = d
    .find_all("button")
    .filter(n => n.get_attribute("class").unwrap_or("").contains("disclosure"))
  d.dispatch(
    buttons[index],
    "click",
    info=@tutuca.EventInfo::new(ctrl_key=ctrl, alt_key=alt),
  )
}

///|
fn props(d : @testing.Driver[SchemaRoot, RootMsg]) -> Array[Schema] {
  guard d.state().node is SObject(o) else { abort("an object") }
  o.properties.map(p => p.schema).to_array()
}

///|
test "a click toggles one node" {
  let d = @testing.Driver::new(schema_root, schema_tree(nested))
  click_disclosure(d, 1) // a
  let ps = props(d)
  assert_eq(ps[0].is_open(), Some(false))
  assert_eq(ps[1].is_open(), Some(true))
  assert_eq(ps[0].children()[0].is_open(), Some(true))
}

///|
test "a ctrl click toggles a node and its siblings" {
  let d = @testing.Driver::new(schema_root, schema_tree(nested))
  click_disclosure(d, 1, ctrl=true) // a
  assert_eq(d.state().node.is_open(), Some(true))
  assert_eq(props(d).map(s => s.is_open()), [Some(false), Some(false), None])
  assert_eq(props(d)[0].children()[0].is_open(), Some(true))
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "a ctrl+alt click toggles a node and everything below it" {
  let d = @testing.Driver::new(schema_root, schema_tree(nested))
  click_disclosure(d, 1, ctrl=true, alt=true) // a
  assert_eq(props(d)[0].all_open(), [false, false])
  assert_eq(props(d)[1].is_open(), Some(true))
}

///|
test "expand all and collapse all reach every node" {
  let d = @testing.Driver::new(schema_root, schema_tree(nested))
  d.click("button", text="collapse all")
  assert_true(d.state().node.all_open().iter().all(o => !o))
  d.click("button", text="expand all")
  assert_true(d.state().node.all_open().iter().all(o => o))
}

///|
test "a property passes SetOpen to its schema" {
  let d = @testing.Driver::new(schema_root, schema_tree(nested))
  let at = root_node
    .then(
      Lens::variant(s => if s is SObject(o) { Some(o) } else { None }, (_, o) => {
        SObject(o)
      }),
    )
    .then(object_properties.at(0))
  d.send_to(schema_property(), at, SetOpen(false))
  assert_eq(props(d)[0].is_open(), Some(false))
}

///|
test "a long list shows one page at a time" {
  let schema : Json = {
    "enum": Json::array(Array::makei(12, i => Json::string("v\{i}"))),
  }
  let d = @testing.Driver::new(schema_root, schema_tree(schema, per_page=5))
  let shown = () => {
    d.root_node
    .descendants()
    .filter(n => n.get_attribute("class").unwrap_or("").contains("text-success"))
    .map(n => n.text_content())
  }
  assert_eq(shown(), ["\"v0\"", "\"v1\"", "\"v2\"", "\"v3\"", "\"v4\""])
  let last = d
    .find_all("button")
    .iter()
    .find_first(n => n.get_attribute("title") == Some("Last page"))
    .unwrap()
  d.dispatch(last, "click")
  assert_eq(shown(), ["\"v10\"", "\"v11\""])
  let range = d
    .find_all("span")
    .iter()
    .find_first(n => n.get_attribute("class") == Some("shrink-0 range"))
    .unwrap()
  assert_eq(range.text_content(), "11–12 of 12")
}

///|
test "a short list has no pager" {
  guard schema_tree({ "enum": [1, 2] }, per_page=5).node is SEnum(e) else {
    fail("an enum")
  }
  assert_true(e.pager is None)
}

///|
test "a schema is inferred from an example" {
  let schema = infer_schema({
    "id": 1,
    "price": 9.5,
    "when": "2026-10-16T10:30:00Z",
    "day": "2026-10-16",
    "email": "ada@example.com",
    "site": "https://ada.example.com",
    "tags": ["a", "b"],
    "items": [{ "n": 1 }, { "n": 1.5, "extra": true }],
    "mixed": [1, "x"],
    "nothing": null,
  })
  assert_eq(
    canonical(schema),
    canonical({
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "price": { "type": "number" },
        "when": { "type": "string", "format": "date-time" },
        "day": { "type": "string", "format": "date" },
        "email": { "type": "string", "format": "email" },
        "site": { "type": "string", "format": "uri" },
        "tags": { "type": "array", "items": { "type": "string" } },
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "n": { "type": "number" },
              "extra": { "type": "boolean" },
            },
            "required": ["n"],
          },
        },
        "mixed": {
          "type": "array",
          "items": { "anyOf": [{ "type": "integer" }, { "type": "string" }] },
        },
        "nothing": { "type": "null" },
      },
      "required": [
        "id", "price", "when", "day", "email", "site", "tags", "items", "mixed",
        "nothing",
      ],
    }),
  )
}

///|
test "the studio keeps the schema in step with the payload" {
  let saved = []
  let scope = @tutuca.Scope::new()
  @common.handle_in_memory(scope, saved)
  let d = @testing.Driver::new(studio_component, studio(), scope~)
  assert_eq(d.problems().map(@testing.describe), [])
  assert_false(d.state().is_stale())
  // Editing a value makes it stale until the schema is updated.
  let strings = d
    .find_all("input")
    .filter(n => n.get_attribute("aria-label") == Some("string value"))
  d.dispatch(strings[0], "input", value="ord_1")
  assert_true(d.state().is_stale())
  d.click("button", text="Update schema")
  assert_false(d.state().is_stale())
  let select = d.find("select").unwrap()
  d.dispatch(select, "change", value="user")
  assert_eq(d.state().title, "User")
  assert_true(d.state().schema_text().contains("\"format\": \"email\""))
  d.type_into("textarea", "{\"a\": [1, 2]}")
  d.click("button", text="Use this JSON")
  assert_true(d.state().schema_text().contains("\"integer\""))
  d.type_into("textarea", "nope")
  d.click("button", text="Use this JSON")
  assert_true(d.state().paste_error.has_prefix("Not JSON"))
  d.click("button", text="Download .schema.json")
  assert_eq(saved[0].name, "payload.schema.json")
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "the schema components have the generic properties" {
  for
    issues in [
      schema_root.check(),
      schema_node().check(),
      studio_component.check(),
    ] {
    assert_eq(issues.map(i => i.to_string()), [])
  }
  @testing.check_component(schema_root, count=30)
  @testing.run_events(schema_root, () => schema_tree(sample), count=15)
}
