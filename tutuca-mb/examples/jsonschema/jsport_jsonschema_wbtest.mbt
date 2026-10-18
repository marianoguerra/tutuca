// Ports of test/components/json-schema.test.js and the json-schema tests of
// test/demos/demos.test.js.

///|
test "generated trees read back to a fixed point" {
  @testing.check_property(
    "generated fixed point",
    (rs, size) => {
      let root : SchemaRoot = @quickcheck.Arbitrary::arbitrary(size, rs)
      // A schema is JSON text.
      let once = @json.parse(root.node.to_schema().stringify()) catch {
        e => raise @testing.Broke("not JSON: \{e}")
      }
      let twice = from_schema(once).to_schema()
      if canonical(once) != canonical(twice) {
        raise @testing.Broke("\{canonical(once)}\n  \{canonical(twice)}")
      }
    },
    count=100,
  )
}

///|
fn at(j : Json, key : String) -> Json {
  guard j is Object(m) && m.get(key) is Some(v) else { return Json::null() }
  v
}

///|
fn text_at(j : Json, key : String) -> String? {
  guard at(j, key) is String(s) else { return None }
  Some(s)
}

///|
fn properties(d : @testing.Driver[Studio, StudioMsg]) -> Json {
  guard d.state().schema.node.to_schema() is Object(m) &&
    m.get("properties") is Some(p) else {
    return Json::null()
  }
  p
}

///|
fn property_keys(d : @testing.Driver[Studio, StudioMsg]) -> Array[String] {
  guard properties(d) is Object(m) else { return [] }
  m.keys().to_array()
}

///|
/// What the demo does after each task: an edit inside the editor leaves the studio stale,
/// and the demo infers again.
fn follow(d : @testing.Driver[Studio, StudioMsg]) -> Unit {
  if d.state().is_stale() {
    d.send(Regenerate)
  }
}

///|
test "json studio demo: the schema follows the payload" {
  let scope = @tutuca.Scope::new()
  @common.handle_in_memory(scope, [])
  let d = @testing.Driver::new(studio_component, studio(), scope~)
  assert_eq(property_keys(d)[:3].to_owned(), ["orderId", "createdAt", "status"])
  assert_eq(
    text_at(at(properties(d), "createdAt"), "format"),
    Some("date-time"),
  )
  // Renaming a key in the editor infers the schema again.
  let key = d
    .find_all("input")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("key"))
  d.dispatch(key.unwrap(), "input", value="orderNumber")
  follow(d)
  assert_true(property_keys(d).contains("orderNumber"))
  assert_false(d.state().is_stale())
  let sample = d
    .find_all("select")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("Sample payload"))
  d.dispatch(sample.unwrap(), "change", value="user")
  assert_eq(text_at(at(properties(d), "email"), "format"), Some("email"))
  assert_eq(text_at(d.state().schema.node.to_schema(), "title"), Some("User"))
  d.type_into("textarea", "{ nope")
  d.click("button", text="Use this JSON")
  assert_true(d.state().paste_error.has_prefix("Not JSON"))
  d.type_into("textarea", "{\"n\": 1, \"xs\": [1, 2.5]}")
  d.click("button", text="Use this JSON")
  assert_eq(
    canonical(properties(d)),
    canonical({
      "n": { "type": "integer" },
      "xs": { "type": "array", "items": { "type": "number" } },
    }),
  )
  assert_eq(d.problems().map(@testing.describe), [])
  assert_eq(studio_component.check().map(i => i.to_string()), [])
}

///|
test "inferSchema: types, formats, required keys and merged items" {
  assert_eq(
    canonical(infer_schema({ "a": 1, "b": "x@y.io", "c": null, "d": true })),
    canonical({
      "type": "object",
      "properties": {
        "a": { "type": "integer" },
        "b": { "type": "string", "format": "email" },
        "c": { "type": "null" },
        "d": { "type": "boolean" },
      },
      "required": ["a", "b", "c", "d"],
    }),
  )
  assert_eq(canonical(infer_schema([])), canonical({ "type": "array" }))
  assert_eq(
    canonical(infer_schema(["2026-01-02", "https://a.io/x"])),
    canonical({ "type": "array", "items": { "type": "string" } }),
  )
  // Objects merge: properties from all, required only those in every one.
  assert_eq(
    canonical(infer_schema([{ "id": 1, "tag": "a" }, { "id": 2.5 }])),
    canonical({
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "number" },
          "tag": { "type": "string" },
        },
        "required": ["id"],
      },
    }),
  )
  // Different types: a union, same-typed branches merged.
  assert_eq(
    canonical(at(infer_schema([1, "a", 2.5, null]), "items")),
    canonical({
      "anyOf": [{ "type": "number" }, { "type": "string" }, { "type": "null" }],
    }),
  )
  assert_eq(
    canonical(schema_document({ "type": "null" }, "T")),
    canonical({
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "T",
      "type": "null",
    }),
  )
}

///|
test "JSON Schema lints clean" {
  for
    issues in [
      schema_root.check(),
      schema_node().check(),
      schema_object().check(),
      schema_property().check(),
      schema_array().check(),
      schema_enum().check(),
      schema_not().check(),
      all_of().check(),
      any_of().check(),
      one_of().check(),
      schema_pager.check(),
      schema_string.check(),
      schema_number.check(),
      schema_integer.check(),
      schema_boolean.check(),
      schema_null.check(),
      schema_union.check(),
      schema_const.check(),
      schema_ref.check(),
      schema_any.check(),
      schema_never.check(),
      studio_component.check(),
    ] {
    assert_eq(issues.map(i => i.to_string()), [])
  }
}
