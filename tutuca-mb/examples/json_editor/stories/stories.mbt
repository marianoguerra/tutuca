///|
using @storybook {
  story,
  generated_story,
  send_to,
  event,
  check,
  css,
  book,
  type Book,
  type Step,
}

///|
using @json {
  json_null,
  json_bool,
  json_number,
  json_string,
  json_array,
  json_entry,
  json_object,
  json_editor,
  type JsonValue,
  type JsonEditor,
  type JsonArray,
  type JsonObject,
  type JsonEntry,
}

///|
fn sample() -> JsonValue {
  @json.from_json(
    obj([
      ("name", str("tutuca")),
      ("version", num(1.5)),
      ("private", Json::boolean(true)),
      ("keywords", Json::array([str("ui"), str("immutable")])),
      ("repository", Json::null()),
      ("scripts", obj([("test", str("node --test"))])),
    ]),
  )
}

///|
fn edit(value : JsonValue) -> JsonEditor {
  { value, mode: Editing, show_text: false, }
}

// Json built by its constructors: a Json literal here would reach for core's @json, which
// this package's @json (the components) shadows.

///|
fn num(n : Double) -> Json {
  Json::number(n)
}

///|
fn str(s : String) -> Json {
  Json::string(s)
}

///|
fn obj(fields : Array[(String, Json)]) -> Json {
  Json::object(Map::from_array(fields))
}

///|
fn json_is(expected : Json) -> (JsonEditor) -> Bool {
  e => e.value.to_json_value() == expected
}

// Lenses from the editor root, for messages to the components inside it.

///|
let at_value : @tutuca.Lens[JsonEditor, JsonValue] = @tutuca.field(
  "value",
  e => e.value,
  (e, value) => { ..e, value, },
)

///|
fn[C] variant(
  _name : String,
  get : (JsonValue) -> C?,
  make : (C) -> JsonValue,
) -> @tutuca.Lens[JsonValue, C] {
  @tutuca.Lens::variant(get, (_, c) => make(c))
}

///|
let as_bool : @tutuca.Lens[JsonValue, @json.JsonBool] = variant(
  "bool",
  v => if v is JBool(b) { Some(b) } else { None },
  b => JBool(b),
)

///|
let as_number : @tutuca.Lens[JsonValue, @json.JsonNumber] = variant(
  "number",
  v => if v is JNumber(n) { Some(n) } else { None },
  n => JNumber(n),
)

///|
let as_array : @tutuca.Lens[JsonValue, JsonArray] = variant(
  "array",
  v => if v is JArray(a) { Some(a) } else { None },
  a => JArray(a),
)

///|
let as_object : @tutuca.Lens[JsonValue, JsonObject] = variant(
  "object",
  v => if v is JObject(o) { Some(o) } else { None },
  o => JObject(o),
)

///|
let array_items : @tutuca.Items[JsonArray, Int32, JsonValue] = @tutuca.items(
  "items",
  a => a.items,
  (_, items) => { items, },
)

///|
let object_entries : @tutuca.Items[JsonObject, Int32, JsonEntry] = @tutuca.items(
  "entries",
  o => o.entries,
  (_, entries) => { entries, },
)

///|
fn item(i : Int32) -> @tutuca.Lens[JsonEditor, JsonValue] {
  at_value.then(as_array).then(array_items.at(i))
}

// Every value of a kind in the document, in document order: random messages go to any of
// them, as JS's go to any instance of the component.

///|
fn nodes(
  v : JsonValue,
  path : Array[Int32],
  out : Array[(Array[Int32], JsonValue)],
) -> Unit {
  out.push((path, v))
  match v {
    JArray(a) =>
      for i, x in a.items.to_array() {
        nodes(x, [..path, i], out)
      }
    JObject(o) =>
      for i, e in o.entries.to_array() {
        nodes(e.value, [..path, i], out)
      }
    _ => ()
  }
}

///|
fn replace_at(
  v : JsonValue,
  segs : ArrayView[Int32],
  f : (JsonValue) -> JsonValue,
) -> JsonValue {
  match segs {
    [] => f(v)
    [i, .. rest] =>
      match v {
        JArray(a) =>
          JArray({ items: a.items.update(i, x => replace_at(x, rest, f)), })
        JObject(o) =>
          JObject({
            entries: o.entries.update(i, e => {
              ..e,
              value: replace_at(e.value, rest, f),
            }),
          })
        _ => v
      }
  }
}

///|
/// The values `pick` keeps, with their paths.
fn[C] found(
  e : JsonEditor,
  pick : (JsonValue) -> C?,
) -> Array[(Array[Int32], C)] {
  let out = []
  nodes(e.value, [], out)
  out.filter_map(p => pick(p.1).map(c => (p.0, c)))
}

///|
fn[C : Eq] every(
  name : String,
  pick : (JsonValue) -> C?,
  wrap : (C) -> JsonValue,
) -> @tutuca.Items[JsonEditor, Int32, C] {
  @tutuca.items(name, e => @tutuca.Vec::of(found(e, pick).map(p => p.1)), (
    e,
    values,
  ) => {
    // Only the value a message changed differs from the document.
    let mut value = e.value
    for i, p in found(e, pick) {
      match values.get(i) {
        Some(c) if c != p.1 => value = replace_at(value, p.0, _ => wrap(c))
        _ => ()
      }
    }
    { ..e, value, }
  })
}

///|
fn entries_of(v : JsonValue) -> Array[JsonEntry]? {
  if v is JObject(o) {
    Some(o.entries.to_array())
  } else {
    None
  }
}

///|
/// Every entry of every object, in document order.
let every_entry : @tutuca.Items[JsonEditor, Int32, JsonEntry] = @tutuca.items(
  "entries",
  e => {
    @tutuca.Vec::of(
      found(e, entries_of)
      .map(p => p.1)
      .fold(init=[], (acc, es) => [..acc, ..es]),
    )
  },
  (e, values) => {
    let mut value = e.value
    let mut n = 0
    for p in found(e, entries_of) {
      for i, entry in p.1 {
        match values.get(n) {
          Some(next) if next != entry =>
            value = replace_at(value, p.0, v => {
              match v {
                JObject(o) => JObject({ entries: o.entries.set(i, next), })
                _ => v
              }
            })
          _ => ()
        }
        n += 1
      }
    }
    { ..e, value, }
  },
)

///|
/// Every value still to be picked, as the lens through the fields its selector is rendered
/// at, so a random `SetTo` reaches it and its JsonValue answers, as in JS.
fn choices(
  v : JsonValue,
  at : @tutuca.Lens[JsonEditor, JsonValue],
) -> Array[@tutuca.Lens[JsonEditor, Unit]] {
  match v {
    Choose => [at.then(as_choose)]
    JArray(a) =>
      a.items
      .to_array()
      .mapi((i, x) => choices(x, at.then(as_array).then(array_items.at(i))))
      .flatten()
    JObject(o) =>
      o.entries
      .to_array()
      .mapi((i, e) => {
        choices(
          e.value,
          at.then(as_object).then(object_entries.at(i)).then(entry_value),
        )
      })
      .flatten()
    _ => []
  }
}

///|
/// Random messages to every value component of the document: JS's valueMessages. The
/// selector's `SetTo` goes through `choices`, lenses along the rendered fields, so the
/// JsonValue that rendered the selector answers it.
fn value_messages() -> Array[@testing.Target[JsonEditor, @json.JsonEditorMsg]] {
  [
    @testing.lens_messages(@json.json_selector, e => choices(e.value, at_value)),
    @testing.item_messages(
      json_bool,
      every("bools", v => if v is JBool(b) { Some(b) } else { None }, b => {
        JBool(b)
      }),
    ),
    @testing.item_messages(
      json_number,
      every("numbers", v => if v is JNumber(n) { Some(n) } else { None }, n => {
        JNumber(n)
      }),
    ),
    @testing.item_messages(
      json_string,
      every("strings", v => if v is JString(s) { Some(s) } else { None }, s => {
        JString(s)
      }),
    ),
    @testing.item_messages(
      json_array(),
      every("arrays", v => if v is JArray(a) { Some(a) } else { None }, a => {
        JArray(a)
      }),
    ),
    @testing.item_messages(
      json_object(),
      every("objects", v => if v is JObject(o) { Some(o) } else { None }, o => {
        JObject(o)
      }),
    ),
    @testing.item_messages(json_entry(), every_entry),
  ]
}

///|
/// A generated value whose numbers read as their text, as JS's arbitrary JsonNumber.
fn tidy(v : JsonValue) -> JsonValue {
  match v {
    JNumber(n) => {
      let value = if n.value.is_nan() || n.value.is_inf() {
        0.0
      } else {
        n.value
      }
      JNumber({ value, text: value.to_string(), })
    }
    JArray(a) => JArray({ items: a.items.map(tidy), })
    JObject(o) =>
      JObject({ entries: o.entries.map(e => { ..e, value: tidy(e.value), }), })
    _ => v
  }
}

///|
let as_choose : @tutuca.Lens[JsonValue, Unit] = variant(
  "choose",
  v => if v is Choose { Some(()) } else { None },
  _ => Choose,
)

///|
let entry_value : @tutuca.Lens[JsonEntry, JsonValue] = @tutuca.field(
  "value",
  e => e.value,
  (e, value) => { ..e, value, },
)

///|
/// JS's `send("setTo", [kind], { at })`: the selector rendered at `at` picks `kind`, and the
/// JsonValue that rendered it answers its `chosen`, as the message reaches it through the
/// components rendered around it.
fn set_to(
  at : @tutuca.Lens[JsonEditor, JsonValue],
  kind : @json.Kind,
) -> Step[JsonEditor, @json.JsonEditorMsg] {
  send_to(@json.json_selector, at.then(as_choose), SetTo(kind))
}

///|
fn pick(kind : String) -> Step[JsonEditor, @json.JsonEditorMsg] {
  event("click", css("[title=\"\{kind}\"]"))
}

///|
/// The JSON book, for any DOM.
pub fn[N : @vdom.DomNode] json_book() -> Book[N] {
  let root = [@testing.root_messages()]
  book(
    "JSON",
    [
      story("Null", json_null, () => ()),
      story("Bool", json_bool, () => { value: true, }),
      story(
        "Bool (edit)",
        json_editor,
        () => edit(JBool({ value: false, })),
        sequences=[
          (
            "toggle",
            [
              event("click", css("[aria-label=\"boolean value\"]")),
              check("true", json_is(Json::boolean(true))),
              send_to(json_bool, at_value.then(as_bool), Toggle),
              check("false again", json_is(Json::boolean(false))),
            ],
          ),
        ],
        targets=root,
        max_steps=8,
      ),
      story("Number", json_number, () => { value: 42.0, text: "42", }),
      story(
        "Number (edit)",
        json_editor,
        () => edit(JNumber({ value: 42.0, text: "42", })),
        sequences=[
          (
            "type a number, then text that isn't one",
            [
              event("input", css("[aria-label=\"number value\"]"), value="3.14"),
              check("3.14", json_is(num(3.14))),
              event(
                "input",
                css("[aria-label=\"number value\"]"),
                value="3.14x",
              ),
              check("keeps the last number", json_is(num(3.14))),
            ],
          ),
        ],
        targets=root,
        max_steps=8,
      ),
      story("String", json_string, () => { value: "hello", }),
      story(
        "String (edit)",
        json_editor,
        () => edit(JString({ value: "hello", })),
        sequences=[
          (
            "type",
            [
              event(
                "input",
                css("[aria-label=\"string value\"]"),
                value="tutuca",
              ),
              check("tutuca", json_is(str("tutuca"))),
            ],
          ),
        ],
        targets=root,
        max_steps=8,
      ),
      story("Selector (edit)", json_editor, () => edit(Choose), sequences=[
        (
          "pick a string",
          [pick("string"), check("an empty string", json_is(str("")))],
        ),
      ]),
      story("Array", json_array(), () => {
        match
          @json.from_json(
            Json::array([
              num(1),
              str("two"),
              Json::boolean(false),
              Json::null(),
              Json::array([num(3)]),
            ]),
          ) {
          JArray(a) => a
          _ => { items: @tutuca.Vec::new(), }
        }
      }),
      story(
        "Empty array (edit)",
        json_editor,
        () => edit(JArray({ items: @tutuca.Vec::new(), })),
        sequences=[
          (
            "build [true, 5]",
            [
              send_to(json_array(), at_value.then(as_array), Add),
              set_to(item(0), Boolean),
              send_to(json_bool, item(0).then(as_bool), Toggle),
              send_to(json_array(), at_value.then(as_array), Add),
              set_to(item(1), Number),
              send_to(json_number, item(1).then(as_number), SetText("5")),
              check(
                "[true, 5]",
                json_is(Json::array([Json::boolean(true), num(5)])),
              ),
              send_to(json_array(), at_value.then(as_array), MoveUp(1)),
              check(
                "[5, true]",
                json_is(Json::array([num(5), Json::boolean(true)])),
              ),
              send_to(json_array(), at_value.then(as_array), RemoveAt(0)),
              check("[true]", json_is(Json::array([Json::boolean(true)]))),
            ],
          ),
        ],
        targets=value_messages(),
        max_steps=15,
      ),
      story("Object", json_object(), () => {
        match sample() {
          JObject(o) => o
          _ => { entries: @tutuca.Vec::new(), }
        }
      }),
      story(
        "Object (edit)",
        json_editor,
        () => edit(@json.from_json(obj([("a", num(1))]))),
        sequences=[
          (
            "add and rename an entry",
            [
              event("click", css("button[class*='cursor-pointer self-start']")),
              send_to(
                json_entry(),
                at_value.then(as_object).then(object_entries.at(1)),
                SetKey("b"),
              ),
              set_to(
                at_value
                .then(as_object)
                .then(object_entries.at(1))
                .then(entry_value),
                Text,
              ),
              check(
                "{ a: 1, b: '' }",
                json_is(obj([("a", num(1)), ("b", str(""))])),
              ),
            ],
          ),
        ],
        targets=value_messages(),
        max_steps=15,
      ),
      story(
        "Document",
        json_editor,
        () => { value: sample(), mode: Viewing, show_text: true, },
        sequences=[
          (
            "switch to edit",
            [
              event("click", css("button:nth-of-type(2)")),
              check("edit mode", e => e.mode is Editing),
              event("input", css("[aria-label=\"key\"]"), value="title"),
              check("renamed", e => {
                e.value.to_json_value() is Object(m) && m.contains("title")
              }),
            ],
          ),
        ],
        targets=root,
        max_steps=10,
      ),
      generated_story(
        "Generated document",
        json_editor,
        (rs, size) => {
          let e : JsonEditor = @quickcheck.Arbitrary::arbitrary(size, rs)
          { ..e, value: tidy(e.value), }
        },
        targets=value_messages(),
        max_steps=10,
      ),
    ],
    specs=[
      @storybook.spec(@json.json_null),
      @storybook.spec(@json.json_bool),
      @storybook.spec(@json.json_number),
      @storybook.spec(@json.json_string),
      @storybook.spec(@json.json_selector),
      @storybook.spec(@json.json_array()),
      @storybook.spec(@json.json_entry()),
      @storybook.spec(@json.json_object()),
      @storybook.spec(@json.json_editor),
    ],
  )
}
