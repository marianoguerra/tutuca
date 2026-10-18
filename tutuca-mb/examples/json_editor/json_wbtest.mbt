///|
fn sample() -> JsonEditor {
  let doc : Json = {
    "name": "tutuca",
    "tags": ["ui", "mb"],
    "stars": 3,
    "public": true,
    "x": null,
  }
  { value: from_json(doc), mode: Viewing, show_text: false, }
}

///|
test "values render read only, and push_view switches the whole tree to edit" {
  let d = @testing.Driver::new(json_editor, sample())
  assert_eq(d.problems().map(@testing.describe), [])
  assert_eq(
    d.text(),
    "ViewEditJSONtext{\"name\":\"tutuca\",\"tags\":[\"ui\",\"mb\"],\"stars\":3,\"public\":true,\"x\":null}",
  )
  assert_eq(d.find_all("input").length(), 1) // Just the "JSON text" checkbox.
  d.click("button", text="Edit")
  // Every key, string and number is an input now; booleans are toggles.
  let inputs = d.find_all("input")
  assert_true(inputs.length() > 5)
  assert_true(d.find("button", text="true") is Some(_))
}

///|
test "editing a string and a number updates the JSON text" {
  let d = @testing.Driver::new(json_editor, {
    ..sample(),
    mode: Editing,
    show_text: true,
  })
  let strings = d
    .find_all("input")
    .filter(n => n.get_attribute("aria-label") == Some("string value"))
  d.dispatch(strings[0], "input", value="tutuca-mb")
  let number = d
    .find_all("input")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("number value"))
  d.dispatch(number.unwrap(), "input", value="42")
  d.click("button", text="true")
  let text = d.state().value.to_json_value().stringify()
  assert_eq(
    text, "{\"name\":\"tutuca-mb\",\"tags\":[\"ui\",\"mb\"],\"stars\":42,\"public\":false,\"x\":null}",
  )
  assert_true(d.find("pre").unwrap().text_content().contains("\"stars\": 42"))
}

///|
test "a new item is chosen in place, then moved and removed" {
  let d = @testing.Driver::new(json_editor, { ..sample(), mode: Editing, })
  d.click("button", text="+ item")
  // The new item asks for its kind; picking one replaces it.
  d.click("button", text="0")
  assert_eq(d.problems().map(@testing.describe), [])
  guard d.state().value is JObject(o) else { fail("expected an object") }
  guard o.entries[1].value is JArray(tags) else {
    fail("expected the tags array")
  }
  assert_true(tags.items[2] is JNumber({ value: 0.0, .. }))
  // The tags' third item is the new number; move it up.
  d.send_to(
    json_array(),
    editor_value
    .then(object_variant)
    .then(object_entries.at(1))
    .then(entry_value)
    .then(array_variant),
    MoveUp(2),
  )
  guard d.state().value is JObject(o) else { fail("expected an object") }
  guard o.entries[1].value is JArray(tags) else {
    fail("expected the tags array")
  }
  assert_true(tags.items[1] is JNumber(_))
  d.send_to(json_object(), editor_value.then(object_variant), RemoveAt(0))
  assert_eq(
    d.state().value.to_json_value().stringify(),
    "{\"tags\":[\"ui\",0,\"mb\"],\"stars\":3,\"public\":true,\"x\":null}",
  )
}

///|
test "the json components check clean and keep their contracts" {
  for
    issues in [json_editor.check(), json_value().check(), json_array().check()] {
    assert_eq(issues.map(i => i.to_string()), [])
  }
  @testing.check_component(json_bool)
  @testing.check_component(json_string)
}

///|
test "random events on the editor patch the DOM as a fresh render would" {
  @testing.run_events(
    json_editor,
    () => { ..sample(), mode: Editing, },
    count=20,
  )
}
