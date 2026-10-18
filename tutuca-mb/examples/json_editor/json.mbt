///|
using @tutuca {
  div,
  span,
  button,
  input,
  label,
  pre,
  txt,
  show,
  when,
  if_,
  each,
  frag,
  cls,
  class_,
  attr,
  aria,
  value,
  checked,
  on_click,
  on_input,
  on_check,
  on_event,
  render,
  render_key,
  push_view,
  component,
  field,
  field_info,
  items,
  type View,
  type ViewAt,
  type Component,
  type Signal,
  type Lens,
  type Vec,
  type Once,
}

// Shared looks, so an edit view reads like its main view.

///|
let mono : String = "font-mono text-sm leading-6"

///|
let punct : String = "\{mono} opacity-50"

///|
let inline_input : String = "min-w-[1ch] [field-sizing:content] bg-transparent p-0 outline-none border-0 border-b border-dashed border-transparent hover:border-base-content/30 focus:border-primary"

///|
let action : String = "cursor-pointer rounded px-1 font-mono text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 focus:opacity-100"

///|
let add_class : String = "cursor-pointer self-start rounded px-1 font-mono text-xs opacity-50 hover:opacity-100"

///|
let block : String = "ml-1 flex flex-col border-l border-base-content/15 pl-4"

///|
/// An object entry's key.
let key_class : String = "\{mono} text-secondary"

///|
fn text_class(kind : Kind) -> String {
  match kind {
    Null => "\{mono} text-warning"
    Boolean => "\{mono} text-accent"
    Number => "\{mono} text-info"
    Text => "\{mono} text-success"
    List | Record => mono
  }
}

// --- values -----------------------------------------------------------------------------

///|
/// A JSON value: each kind is its own component, and `Choose` is one still to be picked.
pub(all) enum JsonValue {
  JNull
  JBool(JsonBool)
  JNumber(JsonNumber)
  JString(JsonString)
  JArray(JsonArray)
  JObject(JsonObject)
  Choose
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// The state of the case's component, with its name as `$`, as JS's snapshot of a field that
/// holds any JSON component: `{"$": "JsonBool", "value": true}`.
fn tagged(name : String, state : Json) -> Json {
  let out : Map[String, Json] = { "$": Json::string(name) }
  if state is Object(m) {
    for k, v in m {
      out[k] = v
    }
  }
  Json::object(out)
}

///|
pub impl ToJson for JsonValue with fn to_json(self) {
  match self {
    JNull => tagged("JsonNull", Json::null())
    JBool(b) => tagged("JsonBool", ToJson::to_json(b))
    JNumber(n) => tagged("JsonNumber", ToJson::to_json(n))
    JString(t) => tagged("JsonString", ToJson::to_json(t))
    JArray(a) => tagged("JsonArray", ToJson::to_json(a))
    JObject(o) => tagged("JsonObject", ToJson::to_json(o))
    Choose => tagged("JsonSelector", Json::null())
  }
}

///|
pub impl FromJson for JsonValue with fn from_json(json, path) {
  guard json is Object(m) && m.get("$") is Some(String(name)) else {
    raise @json.JsonDecodeError((path, "a JSON component's state"))
  }
  let rest : Map[String, Json] = Map([])
  for k, v in m {
    if k != "$" {
      rest[k] = v
    }
  }
  let state = Json::object(rest)
  match name {
    "JsonNull" => JNull
    "JsonBool" => JBool(@json.from_json(state, path~))
    "JsonNumber" => JNumber(@json.from_json(state, path~))
    "JsonString" => JString(@json.from_json(state, path~))
    "JsonArray" => JArray(@json.from_json(state, path~))
    "JsonObject" => JObject(@json.from_json(state, path~))
    "JsonSelector" => Choose
    _ => raise @json.JsonDecodeError((path, "no JSON component \{name}"))
  }
}

///|
pub(all) struct JsonBool {
  value : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// `text` is what the user typed; `value` follows it whenever it reads as a number.
pub(all) struct JsonNumber {
  value : Double
  text : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct JsonString {
  value : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct JsonArray {
  items : Vec[JsonValue]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct JsonEntry {
  key : String
  value : JsonValue
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct JsonObject {
  entries : Vec[JsonEntry]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// The kinds a new value can be.
pub(all) enum Kind {
  Null
  Boolean
  Number
  Text
  List
  Record
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS names the kinds: "null", "bool", "number", "string", "array", "object".
pub impl ToJson for Kind with fn to_json(self) {
  Json::string(self.name())
}

///|
pub impl FromJson for Kind with fn from_json(json, path) {
  for k in [Null, Boolean, Number, Text, List, Record] {
    if json == Json::string(k.name()) {
      return k
    }
  }
  raise @json.JsonDecodeError((path, "a kind"))
}

///|
let kinds : Array[(Kind, String)] = [
  (Null, "null"),
  (Boolean, "false"),
  (Number, "0"),
  (Text, "\"\""),
  (List, "[]"),
  (Record, "{}"),
]

///|
/// The kind's name, as JS's selector titles its buttons.
fn Kind::name(self : Kind) -> String {
  match self {
    Null => "null"
    Boolean => "bool"
    Number => "number"
    Text => "string"
    List => "array"
    Record => "object"
  }
}

///|
fn Kind::empty(self : Kind) -> JsonValue {
  match self {
    Null => JNull
    Boolean => JBool({ value: false, })
    Number => JNumber({ value: 0.0, text: "0", })
    Text => JString({ value: "", })
    List => JArray({ items: Vec::new(), })
    Record => JObject({ entries: Vec::new(), })
  }
}

///|
/// The JSON a value stands for; a value still to be chosen is null. Later entries win, as in
/// JSON.parse.
pub fn JsonValue::to_json_value(self : JsonValue) -> Json {
  match self {
    JNull | Choose => Json::null()
    JBool(b) => Json::boolean(b.value)
    JNumber(n) => Json::number(n.value)
    JString(s) => Json::string(s.value)
    JArray(a) => Json::array(a.items.map(v => v.to_json_value()).to_array())
    JObject(o) => {
      let m = Map([])
      for e in o.entries.iter() {
        m[e.key] = e.value.to_json_value()
      }
      Json::object(m)
    }
  }
}

///|
/// The components for a JSON value.
pub fn from_json(v : Json) -> JsonValue {
  match v {
    Null => JNull
    True => JBool({ value: true, })
    False => JBool({ value: false, })
    Number(n, ..) => JNumber({ value: n, text: n.to_string(), })
    String(s) => JString({ value: s, })
    Array(items) => JArray({ items: Vec::of(items.map(from_json)), })
    Object(fields) =>
      JObject({
        entries: Vec::from_iter(
          fields.iter().map(f => { key: f.0, value: from_json(f.1), }),
        ),
      })
  }
}

// --- leaf components ----------------------------------------------------------------------

///|
pub let json_null : Component[Unit, Unit] = component("JsonNull", view=() => {
  span([cls(text_class(Null))], [txt("null")])
})

///|
pub(all) enum JsonBoolMsg {
  Toggle
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let json_bool : Component[JsonBool, JsonBoolMsg] = component(
  "JsonBool",
  fields=[field_info("value", Boolean, initial=false)],
  messages=@tutuca.json_messages(["Toggle"]),
  view=() => span([cls(text_class(Boolean))], [show(s => s.value.to_string())]),
  views=() => {
    [
      (
        "edit",
        button(
          [
            cls(
              "\{text_class(Boolean)} cursor-pointer underline decoration-dashed decoration-transparent hover:decoration-current",
            ),
            attr("title", "Toggle"),
            aria("label", "boolean value"),
            on_click(Toggle),
          ],
          [show(s => s.value.to_string())],
        ),
      ),
    ]
  },
  update=(s, _, _) => { value: !s.value, },
  post=(_, prev, next) => next.value == !prev.value,
)

///|
pub(all) enum JsonNumberMsg {
  SetText(String)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
fn parse_number(text : String) -> Double? {
  let t = text.trim().to_owned()
  if t == "" {
    return None
  }
  try @string.parse_double(t) catch {
    _ => None
  } noraise {
    n => if n.is_nan() || n.is_inf() { None } else { Some(n) }
  }
}

///|
pub let json_number : Component[JsonNumber, JsonNumberMsg] = component(
  "JsonNumber",
  fields=[
    field_info("value", Number, initial=0),
    field_info("text", Text, initial="0"),
  ],
  messages=@tutuca.json_messages(["SetText"]),
  view=() => span([cls(text_class(Number))], [show(s => s.value.to_string())]),
  views=() => {
    [
      (
        "edit",
        input([
          class_(s => {
            if parse_number(s.text) is Some(_) {
              "\{text_class(Number)} \{inline_input}"
            } else {
              "\{text_class(Number)} \{inline_input} text-error"
            }
          }),
          attr("inputmode", "decimal"),
          aria("label", "number value"),
          @tutuca.bind_str("title", s => s.value.to_string()),
          value(s => s.text),
          on_input(v => SetText(v)),
        ]),
      ),
    ]
  },
  update=(s, msg, _) => {
    match msg {
      SetText(text) =>
        match parse_number(text) {
          Some(value) => { value, text, }
          None => { ..s, text, }
        }
    }
  },
  invariants=[
    (
      "the value follows the text",
      s => {
        match parse_number(s.text) {
          Some(n) => n == s.value
          None => true
        }
      },
    ),
  ],
  post=(msg, _, next) => {
    match msg {
      SetText(text) => next.text == text
    }
  },
)

///|
pub(all) enum JsonStringMsg {
  SetValue(String)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let json_string : Component[JsonString, JsonStringMsg] = component(
  "JsonString",
  fields=[field_info("value", Text, initial="")],
  messages=@tutuca.json_messages(["SetValue"]),
  view=() => {
    span([cls(text_class(Text))], [txt("\""), show(s => s.value), txt("\"")])
  },
  views=() => {
    [
      (
        "edit",
        span([cls(text_class(Text))], [
          txt("\""),
          input([
            cls(inline_input),
            aria("label", "string value"),
            value(s => s.value),
            on_input(v => SetValue(v)),
          ]),
          txt("\""),
        ]),
      ),
    ]
  },
  update=(_, msg, _) => {
    match msg {
      SetValue(value) => { value, }
    }
  },
)

///|
/// Sent by a value still to be chosen, with the kind picked.
pub let chosen : Signal[Kind] = Signal::new("chosen")

///|
pub(all) enum ChooseMsg {
  SetTo(Kind)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let json_selector : Component[Unit, ChooseMsg] = component(
  "JsonSelector",
  messages=@tutuca.json_messages(["SetTo"]),
  view=() => span([cls("\{mono} italic opacity-40")], [txt("…")]),
  views=() => {
    [
      (
        "edit",
        span(
          [
            cls("inline-flex flex-wrap items-center gap-1"),
            attr("role", "group"),
            aria("label", "Pick a type"),
          ],
          kinds.map(k => {
            button(
              [
                cls(
                  "\{text_class(k.0)} cursor-pointer rounded border border-dashed border-base-content/20 px-1 hover:border-current",
                ),
                attr("title", k.0.name()),
                on_click(SetTo(k.0)),
              ],
              [txt(k.1)],
            )
          }),
        ),
      ),
    ]
  },
  // Replaced by its parent, which holds the value it is.
  update=(s, msg, ctx) => {
    match msg {
      SetTo(kind) => {
        ctx.notify(chosen, kind)
        s
      }
    }
  },
)

// --- the value component --------------------------------------------------------------------

///|
fn[C] variant(
  _name : String,
  get : (JsonValue) -> C?,
  make : (C) -> JsonValue,
) -> Lens[JsonValue, C] {
  Lens::variant(get, (_, c) => make(c))
}

///|
let null_variant : Lens[JsonValue, Unit] = variant(
  "null",
  v => if v is JNull { Some(()) } else { None },
  _ => JNull,
)

///|
let bool_variant : Lens[JsonValue, JsonBool] = variant(
  "bool",
  v => if v is JBool(b) { Some(b) } else { None },
  b => JBool(b),
)

///|
let number_variant : Lens[JsonValue, JsonNumber] = variant(
  "number",
  v => if v is JNumber(n) { Some(n) } else { None },
  n => JNumber(n),
)

///|
let string_variant : Lens[JsonValue, JsonString] = variant(
  "string",
  v => if v is JString(s) { Some(s) } else { None },
  s => JString(s),
)

///|
let array_variant : Lens[JsonValue, JsonArray] = variant(
  "array",
  v => if v is JArray(a) { Some(a) } else { None },
  a => JArray(a),
)

///|
let object_variant : Lens[JsonValue, JsonObject] = variant(
  "object",
  v => if v is JObject(o) { Some(o) } else { None },
  o => JObject(o),
)

///|
let choose_variant : Lens[JsonValue, Unit] = variant(
  "choose",
  v => if v is Choose { Some(()) } else { None },
  _ => Choose,
)

///|
let json_value_once : Once[Component[JsonValue, Unit]] = Once::new()

///|
/// A JSON value of any kind: it renders the component of its kind, and replaces a value
/// still to be chosen with the kind picked.
pub fn json_value() -> Component[JsonValue, Unit] {
  json_value_once.get(() => {
    component(
      "JsonValue",
      // It only shows its case's component, as a JS field holds any JSON component.
      transparent=true,
      children=() => {
        [
          @tutuca.child(json_null, null_variant),
          @tutuca.child(json_bool, bool_variant),
          @tutuca.child(json_number, number_variant),
          @tutuca.child(json_string, string_variant),
          @tutuca.child(json_array(), array_variant),
          @tutuca.child(json_object(), object_variant),
          @tutuca.child(json_selector, choose_variant),
        ]
      },
      view=() => {
        frag([
          render(null_variant, json_null),
          render(bool_variant, json_bool),
          render(number_variant, json_number),
          render(string_variant, json_string),
          render(array_variant, json_array()),
          render(object_variant, json_object()),
          render(choose_variant, json_selector),
        ])
      },
      on=[
        chosen.on((v, kind, ctx) => {
          ctx.stop()
          if v is Choose {
            kind.empty()
          } else {
            v
          }
        }),
      ],
    )
  })
}

// --- collections ----------------------------------------------------------------------------

///|
pub(all) enum CollectionMsg {
  Add
  RemoveAt(Int32)
  MoveUp(Int32)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// An item row: the item, a comma unless it is last, and in the edit view its buttons.
fn[S] collection_view(
  open : String,
  close : String,
  length : (S) -> Int32,
  item : ViewAt[@tutuca.Item[S, Int32], S, CollectionMsg],
  add_label : String?,
) -> View[S, CollectionMsg] {
  let add = match add_label {
    Some(l) => button([cls(add_class), on_click(Add)], [txt(l)])
    None => frag([])
  }
  if_(
    s => length(s) == 0,
    div([cls("inline-flex items-baseline gap-1")], [
      span([cls(punct)], [txt(open + close)]),
      add,
    ]),
    div([cls("inline-flex flex-col")], [
      span([cls(punct)], [txt(open)]),
      div([cls(block)], [each(s => (0).until(length(s)), item), add]),
      span([cls(punct)], [txt(close)]),
    ]),
  )
}

///|
fn[S] row(
  render_item : ViewAt[@tutuca.Item[S, Int32], S, CollectionMsg],
  length : (S) -> Int32,
  editing : Bool,
) -> ViewAt[@tutuca.Item[S, Int32], S, CollectionMsg] {
  div([cls("group flex items-baseline gap-1")], [
    render_item,
    span([cls(punct)], [
      show(it => if it.value == length(it.up) - 1 { "" } else { "," }),
    ]),
    if editing {
      frag([
        button(
          [
            cls(action),
            attr("title", "Move up"),
            on_event(Click, (it, _) => Some(MoveUp(it.value))),
          ],
          [txt("↑")],
        ),
        button(
          [
            cls("\{action} text-error"),
            attr("title", "Remove"),
            on_event(Click, (it, _) => Some(RemoveAt(it.value))),
          ],
          [txt("×")],
        ),
      ])
    } else {
      frag([])
    },
  ])
}

///|
fn[T] move_up(items : Vec[T], key : Int32) -> Vec[T] {
  if key > 0 {
    items.swap(key - 1, key)
  } else {
    items
  }
}

///|
let array_items : @tutuca.Items[JsonArray, Int32, JsonValue] = items(
  "items",
  a => a.items,
  (_, v) => { items: v, },
)

///|
let json_array_once : Once[Component[JsonArray, CollectionMsg]] = Once::new()

///|
pub fn json_array() -> Component[JsonArray, CollectionMsg] {
  json_array_once.get(() => {
    let length = (a : JsonArray) => a.items.length()
    let item = render_key(
      array_items,
      (it : @tutuca.Item[JsonArray, Int32]) => it.value,
      json_value(),
    )
    component(
      "JsonArray",
      children=() => [@tutuca.each_child(json_value(), array_items)],
      fields=[
        field_info("items", ListOf(ComponentOf(["JsonValue"])), initial=[]),
      ],
      messages=@tutuca.json_messages(["Add", "RemoveAt", "MoveUp"]),
      view=() => {
        collection_view("[", "]", length, row(item, length, false), None)
      },
      views=() => {
        [
          (
            "edit",
            collection_view(
              "[",
              "]",
              length,
              row(item, length, true),
              Some("+ item"),
            ),
          ),
        ]
      },
      update=(a, msg, _) => {
        match msg {
          Add => { items: a.items.push(Choose), }
          RemoveAt(i) => { items: a.items.remove(i), }
          MoveUp(i) => { items: move_up(a.items, i), }
        }
      },
      post=(msg, prev, next) => {
        match msg {
          Add => next.items.length() == prev.items.length() + 1
          RemoveAt(i) =>
            i < 0 ||
            i >= prev.items.length() ||
            next.items.length() == prev.items.length() - 1
          MoveUp(_) => true
        }
      },
    )
  })
}

///|
pub(all) enum JsonEntryMsg {
  SetKey(String)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let entry_value : Lens[JsonEntry, JsonValue] = field("value", e => e.value, (
  e,
  value,
) => { ..e, value, })

///|
let json_entry_once : Once[Component[JsonEntry, JsonEntryMsg]] = Once::new()

///|
pub fn json_entry() -> Component[JsonEntry, JsonEntryMsg] {
  json_entry_once.get(() => {
    component(
      "JsonEntry",
      children=() => [@tutuca.child(json_value(), entry_value)],
      fields=[
        field_info("key", Text, initial=""),
        field_info("value", ComponentOf(["JsonValue"])),
      ],
      messages=@tutuca.json_messages(["SetKey"]),
      view=() => {
        span([cls("inline-flex items-baseline gap-1")], [
          span([cls(key_class)], [txt("\""), show(e => e.key), txt("\"")]),
          span([cls(punct)], [txt(":")]),
          render(entry_value, json_value()),
        ])
      },
      views=() => {
        [
          (
            "edit",
            span([cls("inline-flex items-baseline gap-1")], [
              span([cls(key_class)], [
                txt("\""),
                input([
                  cls(inline_input),
                  aria("label", "key"),
                  value(e => e.key),
                  on_input(v => SetKey(v)),
                ]),
                txt("\""),
              ]),
              span([cls(punct)], [txt(":")]),
              render(entry_value, json_value()),
            ]),
          ),
        ]
      },
      update=(e, msg, _) => {
        match msg {
          SetKey(key) => { ..e, key, }
        }
      },
    )
  })
}

///|
let object_entries : @tutuca.Items[JsonObject, Int32, JsonEntry] = items(
  "entries",
  o => o.entries,
  (_, v) => { entries: v, },
)

///|
let json_object_once : Once[Component[JsonObject, CollectionMsg]] = Once::new()

///|
pub fn json_object() -> Component[JsonObject, CollectionMsg] {
  json_object_once.get(() => {
    let length = (o : JsonObject) => o.entries.length()
    let item = render_key(
      object_entries,
      (it : @tutuca.Item[JsonObject, Int32]) => it.value,
      json_entry(),
    )
    component(
      "JsonObject",
      children=() => [@tutuca.each_child(json_entry(), object_entries)],
      fields=[
        field_info("entries", ListOf(ComponentOf(["JsonEntry"])), initial=[]),
      ],
      messages=@tutuca.json_messages(["Add", "RemoveAt", "MoveUp"]),
      view=() => {
        collection_view("{", "}", length, row(item, length, false), None)
      },
      views=() => {
        [
          (
            "edit",
            collection_view(
              "{",
              "}",
              length,
              row(item, length, true),
              Some("+ entry"),
            ),
          ),
        ]
      },
      update=(o, msg, _) => {
        match msg {
          Add =>
            {
              entries: o.entries.push({
                key: "key\{o.entries.length() + 1}",
                value: Choose,
              }),
            }
          RemoveAt(i) => { entries: o.entries.remove(i), }
          MoveUp(i) => { entries: move_up(o.entries, i), }
        }
      },
    )
  })
}

// --- the editor -------------------------------------------------------------------------------

///|
pub(all) enum Mode {
  Viewing
  Editing
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS names the modes: "view", "edit".
pub impl ToJson for Mode with fn to_json(self) {
  Json::string(if self is Editing { "edit" } else { "view" })
}

///|
pub impl FromJson for Mode with fn from_json(json, path) {
  match json {
    String("view") => Viewing
    String("edit") => Editing
    _ => raise @json.JsonDecodeError((path, "a mode: \"view\" or \"edit\""))
  }
}

///|
/// A JSON document, shown read only or edited in place, with its JSON text.
pub(all) struct JsonEditor {
  value : JsonValue
  mode : Mode
  show_text : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum JsonEditorMsg {
  SetMode(Mode)
  SetShowText(Bool)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let editor_value : Lens[JsonEditor, JsonValue] = field("value", e => e.value, (
  e,
  value,
) => { ..e, value, })

///|
fn mode_class(active : Bool) -> String {
  if active {
    "btn btn-xs btn-primary join-item"
  } else {
    "btn btn-xs join-item"
  }
}

///|
pub let json_editor : Component[JsonEditor, JsonEditorMsg] = component(
  "JsonEditor",
  children=() => [@tutuca.child(json_value(), editor_value)],
  fields=[
    field_info("value", ComponentOf(["JsonValue"])),
    field_info("mode", OneOf(["view", "edit"]), initial="view"),
    field_info("show_text", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages(["SetMode", "SetShowText"]),
  view=() => {
    div([cls("flex flex-col gap-3")], [
      div([cls("flex flex-wrap items-center gap-2")], [
        div([cls("join"), attr("role", "group"), aria("label", "Mode")], [
          button(
            [
              class_(e => mode_class(e.mode is Viewing)),
              on_click(SetMode(Viewing)),
            ],
            [txt("View")],
          ),
          button(
            [
              class_(e => mode_class(e.mode is Editing)),
              on_click(SetMode(Editing)),
            ],
            [txt("Edit")],
          ),
        ]),
        label([cls("flex items-center gap-1 text-xs")], [
          input([
            attr("type", "checkbox"),
            cls("checkbox checkbox-xs"),
            checked(e => e.show_text),
            on_check(c => SetShowText(c)),
          ]),
          txt("JSON text"),
        ]),
      ]),
      div([cls("overflow-auto")], [
        push_view(
          e => if e.mode is Editing { "edit" } else { "main" },
          render(editor_value, json_value()),
        ),
      ]),
      when(
        e => e.show_text,
        pre([cls("rounded bg-base-200 p-3 font-mono text-xs")], [
          show(e => e.value.to_json_value().stringify(indent=2)),
        ]),
      ),
    ])
  },
  update=(e, msg, _) => {
    match msg {
      SetMode(mode) => { ..e, mode, }
      SetShowText(show_text) => { ..e, show_text, }
    }
  },
)
