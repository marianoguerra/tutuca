// Ports of test/components/json.test.js.

///|
test "JSON lints clean" {
  for
    issues in [
      json_editor.check(),
      json_value().check(),
      json_array().check(),
      json_object().check(),
      json_entry().check(),
      json_bool.check(),
      json_number.check(),
      json_string.check(),
      json_null.check(),
      json_selector.check(),
    ] {
    assert_eq(issues.map(i => i.to_string()), [])
  }
}

///|
test "JSON components have the generic properties" {
  @testing.check_component(json_bool, count=25)
  @testing.check_component(json_number, count=25)
  @testing.check_component(json_string, count=25)
  @testing.check_component(json_null, count=25)
  @testing.check_component(json_selector, count=25)
  @testing.check_component(json_value(), count=25)
  @testing.check_component(json_array(), count=25)
  @testing.check_component(json_object(), count=25)
  @testing.check_component(json_entry(), count=25)
  @testing.check_component(json_editor, count=25)
}

///|
/// A random JSON value, `depth` levels deep at most, whose numbers survive printing.
fn gen_json(rs : @splitmix.RandomState, depth : Int32) -> Json {
  let pick = rs
    .next_uint(limit=if depth > 0 { 6 } else { 4 })
    .reinterpret_as_int()
  match pick {
    0 => Json::null()
    1 => Json::boolean(rs.next_uint(limit=2) == 1)
    2 =>
      Json::number(
        (rs.next_uint(limit=2001).reinterpret_as_int() - 1000).to_double() /
        (if rs.next_uint(limit=2) == 0 { 1.0 } else { 8.0 }),
      )
    3 => {
      let n = rs.next_uint(limit=5).reinterpret_as_int()
      let sb = StringBuilder()
      for _ in 0..<n {
        sb.write_char(
          ['a', 'é', '"', ' ', '\\', '7'][rs
          .next_uint(limit=6)
          .reinterpret_as_int()],
        )
      }
      Json::string(sb.to_string())
    }
    4 => {
      let n = rs.next_uint(limit=4).reinterpret_as_int()
      Json::array(Array::makei(n, _ => gen_json(rs, depth - 1)))
    }
    _ => {
      let n = rs.next_uint(limit=4).reinterpret_as_int()
      let m : Map[String, Json] = Map([])
      for i in 0..<n {
        m["k\{rs.next_uint(limit=6)}\{i}"] = gen_json(rs, depth - 1)
      }
      Json::object(m)
    }
  }
}

///|
test "fromJson and toJson round trip" {
  @testing.check_property(
    "round trip",
    (rs, _) => {
      let v = gen_json(rs, 3)
      let back = from_json(v).to_json_value()
      if back.stringify() != v.stringify() {
        raise @testing.Broke("\{v.stringify()}\n  \{back.stringify()}")
      }
    },
    count=100,
  )
}

///|
test "the main view reads as JSON" {
  let doc : Json = { "a": [1, "x", true, null], "b": {} }
  let d = @testing.Driver::new(json_value(), from_json(doc))
  assert_eq(d.problems().map(@testing.describe), [])
  assert_eq(d.text(), doc.stringify())
}

///|
test "the edit view shows the same text, with inputs in place of values" {
  let d = @testing.Driver::new(json_editor, {
    value: from_json({ "a": "x", "n": 2 }),
    mode: Editing,
    show_text: false,
  })
  let inputs = d
    .find_all("input")
    .filter(i => i.get_attribute("type") != Some("checkbox"))
    .map(i => (i.get_attribute("aria-label").unwrap_or(""), i.value()))
  assert_eq(inputs, [
    ("key", "a"),
    ("string value", "x"),
    ("key", "n"),
    ("number value", "2"),
  ])
}
