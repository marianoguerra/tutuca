///|
using @storybook {story, send, send_to, event, check, css, book, type Book}

///|
using @dev {type Inspected, type DevNode, type DevSection, type SpecInfo}

///|
/// The document the dev tools inspect, as JS's `fromJson([[1, true], "two"])`.
let doc : Json = [[1, true], "two"]

///|
/// The path of the second item of a collection, as JS's `items → 1`.
let path : @tutuca.DispatchPath = @tutuca.DispatchPath::root().push({
  name: "items",
  item: Some(Index(1)),
  lens_id: 0,
  provider: None,
})

///|
let json_specs_cache : Ref[Array[SpecInfo]?] = Ref(None)

///|
/// The JSON editor's components, as JS's `Object.values(jsonComponents)`: what the app's scope
/// knows.
fn json_specs() -> Array[SpecInfo] {
  match json_specs_cache.val {
    Some(specs) => specs
    None => {
      let specs = [
        SpecInfo::of(@jv.json_null),
        SpecInfo::of(@jv.json_bool),
        SpecInfo::of(@jv.json_number),
        SpecInfo::of(@jv.json_string),
        SpecInfo::of(@jv.json_selector),
        SpecInfo::of(@jv.json_array()),
        SpecInfo::of(@jv.json_entry()),
        SpecInfo::of(@jv.json_object()),
        SpecInfo::of(@jv.json_editor),
      ]
      json_specs_cache.val = Some(specs)
      specs
    }
  }
}

///|
fn spec_named(name : String) -> SpecInfo {
  json_specs().iter().find_first(s => s.name == name).unwrap()
}

///|
/// What the JSON editor's checks find: nothing.
fn json_issues() -> Array[@dev.LintRecord] {
  @dev.lint_records(
    [
      @jv.json_null.check(),
      @jv.json_bool.check(),
      @jv.json_number.check(),
      @jv.json_string.check(),
      @jv.json_selector.check(),
      @jv.json_array().check(),
      @jv.json_entry().check(),
      @jv.json_object().check(),
      @jv.json_editor.check(),
    ].flatten(),
  )
}

///|
/// A JSON editor value as the instance of the component that shows it, as JS's dev tools see
/// the JSON editor's component instances.
fn instance(v : @jv.JsonValue) -> Inspected {
  let of = (name : String, fields : Array[(String, Inspected)]) => {
    Inspected::instance(spec_named(name), fields, scope=json_specs())
  }
  match v {
    JNull => of("JsonNull", [])
    JBool(b) =>
      of("JsonBool", [("value", Inspected::json(Json::boolean(b.value)))])
    JNumber(n) =>
      of("JsonNumber", [
        ("value", Inspected::json(Json::number(n.value))),
        ("text", Inspected::json(Json::string(n.text))),
      ])
    JString(s) =>
      of("JsonString", [("value", Inspected::json(Json::string(s.value)))])
    JArray(a) =>
      of("JsonArray", [
        ("items", Inspected::list(a.items.to_array().map(instance))),
      ])
    JObject(o) =>
      of("JsonObject", [
        (
          "entries",
          Inspected::list(
            o.entries
            .to_array()
            .map(e => {
              of("JsonEntry", [
                ("key", Inspected::json(Json::string(e.key))),
                ("value", instance(e.value)),
              ])
            }),
          ),
        ),
      ])
    Choose => of("JsonSelector", [])
  }
}

///|
/// The message JS's fixture task carries: toggle, to items → 1.
fn toggle_task() -> Inspected {
  Inspected::message(Send, "toggle", [], path)
}

///|
fn opened(n : DevNode) -> Bool {
  n.is_open && n.rows.length() > 0
}

///|
/// The dev book, for any DOM.
pub fn[N : @vdom.DomNode] dev_book() -> Book[N] {
  book(
    "Dev",
    [
      story(
        "Node/Component instance",
        @dev.dev_node,
        () => DevNode::of("root", instance(@jv.from_json(doc))),
        targets=[@testing.root_messages()],
        max_steps=8,
        sequences=[
          (
            "open the instance, then an item",
            [
              send(Toggle),
              check("shows the fields and spec", n => {
                opened(n) && n.rows.length() == 3
              }),
              send_to(@dev.dev_node, DevNode::row(0), Toggle),
              check("the items array opens", n => opened(n.rows.at(0))),
              send_to(
                @dev.dev_node,
                DevNode::row(0).then(DevNode::row(0)),
                Toggle,
              ),
              check("an item opens", n => opened(n.rows.at(0).rows.at(0))),
              send(Toggle),
              check("closing keeps the rows", n => {
                !n.is_open && n.rows.length() == 3
              }),
            ],
          ),
        ],
      ),
      story(
        "Node/Component spec",
        @dev.dev_node,
        () => DevNode::of("", Inspected::spec(SpecInfo::of(@todo.todo_task))),
        sequences=[
          (
            "open the spec and a view",
            [
              send(Toggle),
              check("fields, views and sections", n => n.rows.length() > 5),
              check("a view reads as code", n => {
                n.rows.any(r => {
                  r.label == "view main" && r.tokens[0].text == "h"
                })
              }),
              check("and in words", n => {
                n.rows.any(r => {
                  r.label == "view main" && r.title == "<div> element"
                })
              }),
              check("so do field types", n => {
                n.rows.any(r => {
                  r.label == "next_sub_id" &&
                  r.title == "whole number" &&
                  r.detail == "at least 1, default 1"
                })
              }),
            ],
          ),
        ],
      ),
      story(
        "Node/Path",
        @dev.dev_node,
        () => DevNode::of("path", Inspected::path(path)),
        sequences=[
          ("words", [check("items → 1", n => n.detail == "items → 1")]),
        ],
      ),
      story(
        "Node/Task",
        @dev.dev_node,
        () => DevNode::of("task", toggle_task()),
        sequences=[
          (
            "words",
            [check("a message", n => n.title == "message “toggle”")],
          ),
        ],
      ),
      story("Node/Primitives", @dev.dev_section, () => {
        DevSection::new("Primitives", nodes=[
          DevNode::of("string", Inspected::json("hello")),
          DevNode::of("number", Inspected::json(42)),
          DevNode::of("bool", Inspected::json(true)),
          DevNode::of("null", Inspected::json(Json::null())),
          DevNode::of("array", Inspected::json([1, 2, 3])),
          DevNode::of("set", Inspected::set(["a", "b"])),
        ])
      }),
      story("Lint/Clean", @dev.dev_lint, () => { issues: [], }),
      story("Lint/Issues", @dev.dev_lint, () => { issues: json_issues(), }),
      story(
        "Panel/JSON app",
        @dev.dev_panel,
        () => {
          @dev.DevPanel::new().updated(
            state=instance(@jv.from_json(doc)),
            tasks=[("", toggle_task())],
            specs=json_specs(),
            issues=json_issues(),
          )
        },
        sequences=[
          (
            "switch to code and back",
            [
              check("readable", p => p.view is Main),
              event("click", css("button:nth-of-type(2)")),
              check("code", p => p.view is Code),
              send(SetView(Main)),
            ],
          ),
        ],
      ),
    ],
    specs=[
      @storybook.spec(@dev.dev_node),
      @storybook.spec(@dev.dev_section),
      @storybook.spec(@dev.dev_lint),
      @storybook.spec(@dev.dev_panel),
    ],
  )
}
