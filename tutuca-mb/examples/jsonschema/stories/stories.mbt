///|
using @storybook {story, send, send_to, event, check, css, book, type Book}

///|
using @js {schema_root, schema_tree, type SchemaRoot, type RootMsg}

///|
fn opens(s : SchemaRoot) -> Array[Bool] {
  s.node.all_open()
}

///|
/// Reading back is lossy, but reading what was read back changes nothing.
fn fixed_point(s : SchemaRoot) -> Bool {
  let once = s.node.to_schema()
  @js.canonical(@js.from_schema(once).to_schema()) == @js.canonical(once)
}

///|
let at_object : @tutuca.Lens[SchemaRoot, @js.ObjectSchema] = @js.root_lens.then(
  @js.object_variant,
)

///|
fn object_of(s : SchemaRoot) -> @js.ObjectSchema {
  guard s.node is SObject(o) else { abort("an object") }
  o
}

///|
let nested : Json = {
  "type": "object",
  "properties": {
    "a": {
      "type": "object",
      "properties": {
        "b": { "type": "object", "properties": { "c": { "type": "string" } } },
        "d": { "type": "array", "items": { "type": "integer" } },
      },
    },
    "e": {
      "anyOf": [
        { "type": "string" },
        { "type": "object", "properties": { "f": { "type": "null" } } },
      ],
    },
  },
}

///|
fn wide(n : Int32) -> Json {
  let props : Map[String, Json] = Map([])
  for i in 0..<n {
    props["field\{i}"] = { "type": "string" }
  }
  { "type": "object", "properties": Json::object(props) }
}

///|
fn targets() -> Array[@testing.Target[SchemaRoot, RootMsg]] {
  [
    @testing.root_messages(),
    @testing.child_messages(@js.schema_object(), at_object),
    @testing.item_messages(
      @js.schema_property(),
      at_object.then_items(@js.properties_lens),
    ),
  ]
}

///|
/// One story per kind, in both readings.
fn[N : @vdom.DomNode] leaf(name : String, schema : Json) -> @storybook.Story[N] {
  story(name, schema_root, () => schema_tree(schema), sequences=[
    (
      "read it as its keywords",
      [
        event("click", css(".view-format")),
        check("format view", s => s.view is Format),
        check("reads back to a fixed point", fixed_point),
      ],
    ),
  ])
}

///|
/// The JSON Schema book, for any DOM.
pub fn[N : @vdom.DomNode] schema_book() -> Book[N] {
  book(
    "JSON Schema",
    [
      story(
        "Episode",
        schema_root,
        () => schema_tree(@js.sample),
        sequences=[
          (
            "collapse and expand everything",
            [
              event("click", css(".collapse-all")),
              check("all closed", s => opens(s).iter().all(o => !o)),
              event("click", css(".expand-all")),
              check("all open", s => opens(s).iter().all(o => o)),
            ],
          ),
          (
            "close a node",
            [
              event("click", css(".disclosure")),
              check("the object closed", s => s.node.is_open() == Some(false)),
              send_to(@js.schema_object(), at_object, Toggle),
              check("and open again", s => s.node.is_open() == Some(true)),
            ],
          ),
          (
            "read it as keywords",
            [
              send(SetView(Format)),
              check("format", s => s.view is Format),
              event("click", css(".view-semantic")),
              check("semantic again", s => s.view is Semantic),
            ],
          ),
          (
            "read the schema back",
            [
              check("same schema", s => {
                @js.canonical(s.node.to_schema()) == @js.canonical(@js.sample)
              }),
            ],
          ),
        ],
        targets=targets(),
        generate=(rs, size) => @quickcheck.Arbitrary::arbitrary(size, rs),
        max_steps=12,
      ),
      story(
        "Episode (format)",
        schema_root,
        () => schema_tree(@js.sample, reading=Format),
        targets=targets(),
        max_steps=10,
      ),
      story(
        "Collapsed",
        schema_root,
        () => schema_tree(@js.sample, open=false),
        sequences=[
          (
            "open one node",
            [
              event("click", css(".disclosure")),
              check("the object opened", s => s.node.is_open() == Some(true)),
              check("the array below stays closed", s => {
                object_of(s).properties[8].schema.is_open() == Some(false)
              }),
            ],
          ),
        ],
      ),
      story(
        "Nested",
        schema_root,
        () => schema_tree(nested),
        sequences=[
          (
            "ctrl: close a node and its siblings",
            [
              // What a ctrl click on a's disclosure raises.
              send_to(@js.schema_object(), at_object, OpenSiblings(false)),
              check("a and e closed", s => {
                object_of(s).properties
                .iter()
                .all(p => p.schema.is_open() != Some(true))
              }),
              check("the nodes below did not", s => {
                match object_of(s).properties[0].schema {
                  SObject(a) => a.properties[0].schema.is_open() == Some(true)
                  _ => false
                }
              }),
            ],
          ),
          (
            "ctrl+alt: close a node and everything below",
            [
              // To a's schema, as JS sends it.
              send_to(
                @js.schema_object(),
                at_object
                .then(@js.properties_lens.at(0))
                .then(@js.property_schema_lens)
                .then(@js.object_variant),
                SetOpenDeep(false),
              ),
              check("a and below closed", s => {
                object_of(s).properties[0].schema.all_open().iter().all(o => !o)
              }),
              check("e did not", s => {
                object_of(s).properties[1].schema.is_open() == Some(true)
              }),
            ],
          ),
        ],
        targets=targets(),
        max_steps=12,
      ),
      leaf("String", {
        "type": "string",
        "format": "email",
        "pattern": "^.+@.+$",
        "minLength": 3,
        "maxLength": 254,
      }),
      leaf("Number", {
        "type": "number",
        "minimum": -1.5,
        "maximum": 1.5,
        "multipleOf": 0.5,
      }),
      leaf("Integer", { "type": "integer", "minimum": 0 }),
      leaf("Boolean", {
        "type": "boolean",
        "title": "Explicit",
        "description": "Has explicit content.",
      }),
      leaf("Null", { "type": "null" }),
      leaf("Union", { "type": ["string", "number", "null"] }),
      leaf("Enum", { "enum": ["a", 1, Json::null(), true] }),
      leaf("Const", { "const": { "kind": "fixed" } }),
      leaf("Ref", { "$ref": "#/$defs/person" }),
      leaf("AllOf", { "allOf": [{ "type": "object" }, { "required": ["id"] }] }),
      leaf("AnyOf", { "anyOf": [{ "type": "string" }, { "type": "number" }] }),
      leaf("OneOf", { "oneOf": [{ "const": "a" }, { "const": "b" }] }),
      leaf("Not", { "not": { "type": "string" } }),
      story("True, which allows anything", schema_root, () => schema_tree(true)),
      leaf("False, which allows nothing", false),
      leaf("An empty object, which also allows anything", {}),
      story("An object with no properties", schema_root, () => {
        schema_tree({ "type": "object" })
      }),
      story("An array with no items schema", schema_root, () => {
        schema_tree({ "type": "array" })
      }),
      story("A type inferred from its keywords", schema_root, () => {
        schema_tree({ "properties": { "a": { "type": "string" } } })
      }),
      story(
        "A wide object, paginated",
        schema_root,
        () => schema_tree(wide(120), per_page=10),
        sequences=[
          (
            "page through",
            [
              check("ten shown", s => {
                object_of(s).pager.map(p => p.per_page) == Some(10)
              }),
              event("click", css(".pager .next")),
              check("page 2", s => {
                object_of(s).pager.map(p => p.page) == Some(1)
              }),
              event("click", css(".pager .last")),
              check("the last page", s => {
                object_of(s).pager.map(p => p.page) == Some(11)
              }),
              send_to(
                @js.schema_pager,
                at_object.then(@js.object_pager_lens),
                SetPerPage(25),
              ),
              check("item 111 still shown", s => {
                object_of(s).pager.map(p => p.shows(110)) == Some(true)
              }),
              send_to(
                @js.schema_pager,
                at_object.then(@js.object_pager_lens),
                ShowAll,
              ),
              check("one page", s => {
                object_of(s).pager.map(p => !p.is_many()) == Some(true)
              }),
            ],
          ),
        ],
        targets=[
          @testing.child_messages(
            @js.schema_pager,
            at_object.then(@js.object_pager_lens),
            keep=m => !(m is (First | ToggleSettings)),
          ),
        ],
        max_steps=12,
      ),
      story(
        "A long enum, paginated",
        schema_root,
        () => {
          schema_tree(
            {
              "enum": Json::array(Array::makei(30, i => Json::string("v\{i}"))),
            },
            per_page=8,
          )
        },
        targets=targets(),
        max_steps=10,
      ),
      @storybook.generated_story(
        "Generated tree",
        schema_root,
        (rs, size) => @quickcheck.Arbitrary::arbitrary(size, rs),
        targets=targets(),
        max_steps=10,
      ),
    ],
    specs=[
      @storybook.spec(@jv.json_null),
      @storybook.spec(@jv.json_bool),
      @storybook.spec(@jv.json_number),
      @storybook.spec(@jv.json_string),
      @storybook.spec(@jv.json_selector),
      @storybook.spec(@jv.json_array()),
      @storybook.spec(@jv.json_entry()),
      @storybook.spec(@jv.json_object()),
      @storybook.spec(@jv.json_editor),
      @storybook.spec(@js.schema_root),
      @storybook.spec(@js.schema_object()),
      @storybook.spec(@js.schema_property()),
      @storybook.spec(@js.schema_array()),
      @storybook.spec(@js.schema_string),
      @storybook.spec(@js.schema_number),
      @storybook.spec(@js.schema_integer),
      @storybook.spec(@js.schema_boolean),
      @storybook.spec(@js.schema_null),
      @storybook.spec(@js.schema_union),
      @storybook.spec(@js.schema_enum()),
      @storybook.spec(@js.schema_const),
      @storybook.spec(@js.schema_ref),
      @storybook.spec(@js.all_of()),
      @storybook.spec(@js.any_of()),
      @storybook.spec(@js.one_of()),
      @storybook.spec(@js.schema_not()),
      @storybook.spec(@js.schema_any),
      @storybook.spec(@js.schema_never),
      @storybook.spec(@js.schema_pager),
    ],
  )
}

///|
/// The studio has its own book.
pub fn[N : @vdom.DomNode] studio_book() -> Book[N] {
  book(
    "JSON Schema studio",
    [
      story("Order payload", @js.studio_component, () => @js.studio(), sequences=[
        (
          "load another sample",
          [
            check("in step with the payload", s => !s.is_stale()),
            send(LoadSample("user")),
            check("the user schema", s => s.title == "User" && !s.is_stale()),
          ],
        ),
        (
          "retitle the schema",
          [
            send(SetTitle("Purchase")),
            check("the schema follows", s => {
              s.schema_text().contains("\"title\": \"Purchase\"")
            }),
          ],
        ),
      ]),
    ],
    specs=[
      @storybook.spec(@jv.json_null),
      @storybook.spec(@jv.json_bool),
      @storybook.spec(@jv.json_number),
      @storybook.spec(@jv.json_string),
      @storybook.spec(@jv.json_selector),
      @storybook.spec(@jv.json_array()),
      @storybook.spec(@jv.json_entry()),
      @storybook.spec(@jv.json_object()),
      @storybook.spec(@jv.json_editor),
      @storybook.spec(@js.schema_root),
      @storybook.spec(@js.schema_object()),
      @storybook.spec(@js.schema_property()),
      @storybook.spec(@js.schema_array()),
      @storybook.spec(@js.schema_string),
      @storybook.spec(@js.schema_number),
      @storybook.spec(@js.schema_integer),
      @storybook.spec(@js.schema_boolean),
      @storybook.spec(@js.schema_null),
      @storybook.spec(@js.schema_union),
      @storybook.spec(@js.schema_enum()),
      @storybook.spec(@js.schema_const),
      @storybook.spec(@js.schema_ref),
      @storybook.spec(@js.all_of()),
      @storybook.spec(@js.any_of()),
      @storybook.spec(@js.one_of()),
      @storybook.spec(@js.schema_not()),
      @storybook.spec(@js.schema_any),
      @storybook.spec(@js.schema_never),
      @storybook.spec(@js.schema_pager),
      @storybook.spec(@js.studio_component),
    ],
  )
}
