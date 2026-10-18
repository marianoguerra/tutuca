// The schema viewer: one component per kind of schema, read once on the way in, so no view
// branches on it. Every node has two readings: main, the schema read as a data dictionary, and
// format, the schema read as the keywords it is written with. SchemaRoot pushes one onto the
// view stack; nodes without a format view keep main.

///|
using @tutuca {
  div,
  span,
  button,
  header,
  section,
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
  bind,
  bind_str,
  on_click,
  render,
  render_key,
  render_each,
  push_view,
  component,
  type View,
  type Component,
  type Signal,
  type Lens,
  type Once,
}

///|
let line : String = "flex items-baseline min-w-0 py-px"

///|
let body_class : String = "ml-2 pl-3 border-l border-base-300"

///|
let badge_class : String = "badge badge-xs px-1 badge-soft"

///|
let kind_class : String = "text-info kind"

///|
let muted : String = "opacity-60"

///|
let nothing_class : String = "opacity-50 italic py-px"

///|
let disclosure_class : String = "btn btn-xs btn-ghost h-5 min-h-0 gap-0 pl-1 pr-0 font-mono disclosure"

///|
let pager_btn : String = "btn btn-xs btn-ghost h-5 min-h-0 px-1"

///|
let hint : String = "click: this node / ctrl: its siblings / ctrl+alt: everything below"

// --- opening and closing ---------------------------------------------------------------------

///|
/// Raised by a ctrl click below: the nearest container opens or closes all its nodes.
pub let open_siblings : Signal[Bool] = Signal::new("openSiblings")

///|
/// The messages of a node with an open state.
pub(all) enum OpenMsg {
  Toggle
  SetOpen(Bool)
  SetOpenDeep(Bool)
  /// What open_siblings does when it reaches the node, as a message: JS's `openSiblings`.
  OpenSiblings(Bool)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// The update of a node with an open state, through its Schema variant.
fn[S] openable_update(
  wrap : (S) -> Schema,
  unwrap : (Schema) -> S,
  is_open : (S) -> Bool,
) -> (S, OpenMsg, @tutuca.Ctx[S, OpenMsg]) -> S {
  (s, msg, ctx) => {
    match msg {
      Toggle => {
        let open = !is_open(s)
        match ctx.event() {
          Some(e) if e.command_key() && e.info.alt_key =>
            unwrap(wrap(s).open_deep(open))
          Some(e) if e.command_key() => {
            ctx.notify(open_siblings, open)
            s
          }
          _ => unwrap(wrap(s).set_open(open))
        }
      }
      SetOpen(open) => unwrap(wrap(s).set_open(open))
      SetOpenDeep(open) => unwrap(wrap(s).open_deep(open))
      OpenSiblings(open) => unwrap(wrap(s).open_children(open))
    }
  }
}

///|
fn[S, M] siblings_listener(
  wrap : (S) -> Schema,
  unwrap : (Schema) -> S,
) -> @tutuca.Listener[S, M] {
  open_siblings.on((s, open, ctx) => {
    ctx.stop()
    unwrap(wrap(s).open_children(open))
  })
}

// --- view parts ------------------------------------------------------------------------------

///|
fn[S] disclosure(
  caption : (S) -> String,
  is_open : (S) -> Bool,
  caption_class~ : String = "\{muted} caption",
) -> View[S, OpenMsg] {
  button([cls(disclosure_class), attr("title", hint), on_click(Toggle)], [
    span([cls("\{muted} mr-1")], [
      show(s => if is_open(s) { "▾" } else { "▸" }),
    ]),
    span([cls(caption_class)], [show(caption)]),
  ])
}

///|
/// A keyword and its value, in the format view; nothing when the value is "".
fn[S, M] row(label : String, get : (S) -> String) -> View[S, M] {
  when(
    s => get(s) != "",
    div([cls("flex items-baseline gap-1 min-w-0 py-px row")], [
      span([cls("text-secondary label")], [txt(label)]),
      span([cls(muted)], [txt(":")]),
      span(
        [
          cls(
            "overflow-hidden text-ellipsis whitespace-pre inline-block align-bottom max-w-2xl text-success value",
          ),
          bind_str("title", get),
        ],
        [show(get)],
      ),
    ]),
  )
}

///|
fn[S, M] notes_rows(notes : (S) -> Notes) -> Array[View[S, M]] {
  [
    row("title", s => notes(s).title),
    row("description", s => notes(s).description),
  ]
}

///|
fn[S, M] badge(
  extra : String,
  text : (S) -> String,
  shown : (S) -> String,
) -> View[S, M] {
  when(
    s => shown(s) != "",
    span([cls("\{badge_class} \{extra}"), bind_str("title", text)], [show(text)]),
  )
}

///|
fn[S, M] semantic_note(notes : (S) -> Notes) -> View[S, M] {
  when(
    s => notes(s).description != "",
    span(
      [
        cls("ml-1 opacity-50 truncate inline-block align-bottom max-w-xl note"),
        bind_str("title", s => notes(s).description),
      ],
      [show(s => notes(s).description)],
    ),
  )
}

///|
/// A leaf in the format view: its kind, then its keywords below it.
fn[S, M] leaf_format(
  extra : String,
  kind : String,
  notes : (S) -> Notes,
  rows : Array[View[S, M]],
) -> View[S, M] {
  div([cls(extra)], [
    div([cls(kind_class)], [txt(kind)]),
    div([cls(body_class)], [..notes_rows(notes), ..rows]),
  ])
}

///|
fn[S, M] pager_slot(pager : Lens[S, Pager]) -> View[S, M] {
  render(pager, schema_pager)
}

///|
fn[S] paged(pager : (S) -> Pager?) -> (S, Int32, Schema) -> Bool {
  (s, k, _) => {
    match pager(s) {
      Some(p) => p.shows(k)
      None => true
    }
  }
}

// --- the pager -----------------------------------------------------------------------------

///|
pub(all) enum PagerMsg {
  First
  Prev
  Next
  Last
  SetPerPage(Int32)
  ShowAll
  ToggleSettings
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
fn pager_button(
  name : String,
  text : String,
  title : String,
  off : (Pager) -> Bool,
  msg : PagerMsg,
) -> View[Pager, PagerMsg] {
  button(
    [
      cls("\{pager_btn} join-item \{name}"),
      attr("title", title),
      bind("disabled", p => Bool(off(p))),
      on_click(msg),
    ],
    [txt(text)],
  )
}

///|
pub let schema_pager : Component[Pager, PagerMsg] = component(
  "SchemaPager",
  fields=[
    @tutuca.field_info("total", Whole, constraints=[AtLeast(0)], initial=0),
    @tutuca.field_info("per_page", Whole, constraints=[AtLeast(1)], initial=10),
    @tutuca.field_info("page", Whole, constraints=[AtLeast(0)], initial=0),
    @tutuca.field_info("settings", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages([
    "First", "Prev", "Next", "Last", "SetPerPage", "ShowAll", "ToggleSettings",
  ]),
  view=() => {
    when(
      p => p.is_many(),
      div([cls("flex items-baseline gap-1 min-w-0 py-px opacity-70 pager")], [
        span([cls("join shrink-0")], [
          pager_button("first", "«", "First page", p => p.page <= 0, First),
          pager_button("prev", "‹", "Previous page", p => p.page <= 0, Prev),
          pager_button(
            "next",
            "›",
            "Next page",
            p => p.page >= p.last_page(),
            Next,
          ),
          pager_button(
            "last",
            "»",
            "Last page",
            p => p.page >= p.last_page(),
            Last,
          ),
        ]),
        span([cls("shrink-0 range")], [
          show(p => (p.page * p.per_page + 1).to_string()),
          txt("–"),
          show(p => {
            let last = (p.page + 1) * p.per_page
            (if last < p.total { last } else { p.total }).to_string()
          }),
          txt(" of "),
          show(p => p.total.to_string()),
        ]),
        button(
          [
            cls("\{pager_btn} settings-toggle"),
            attr("title", "Items per page"),
            on_click(ToggleSettings),
          ],
          [txt("⚙")],
        ),
        when(
          p => p.settings,
          span(
            [cls("join per-page")],
            [
              ..[10, 25, 50, 100].map(n => {
                button(
                  [cls("\{pager_btn} join-item size"), on_click(SetPerPage(n))],
                  [txt(n.to_string())],
                )
              }),
              button([cls("\{pager_btn} join-item all"), on_click(ShowAll)], [
                txt("all"),
              ]),
            ],
          ),
        ),
      ]),
    )
  },
  update=(p, msg, _) => {
    match msg {
      First => { ..p, page: 0, }
      Prev => { ..p, page: if p.page > 0 { p.page - 1 } else { 0 }, }
      Next =>
        {
          ..p,
          page: if p.page < p.last_page() {
            p.page + 1
          } else {
            p.last_page()
          },
        }
      Last => { ..p, page: p.last_page(), }
      // Keeps the first item of the page in view.
      SetPerPage(n) =>
        if n < 1 {
          p
        } else {
          { ..p, per_page: n, page: p.page * p.per_page / n, }
        }
      ShowAll =>
        { ..p, per_page: if p.total < 1 { 1 } else { p.total }, page: 0, }
      ToggleSettings => { ..p, settings: !p.settings, }
    }
  },
  invariants=[
    ("the page is in range", p => p.page <= p.last_page() && p.per_page >= 1),
  ],
)

// --- the dispatch component ------------------------------------------------------------------

///|
fn[C] variant(
  _name : String,
  get : (Schema) -> C?,
  make : (C) -> Schema,
) -> Lens[Schema, C] {
  Lens::variant(get, (_, c) => make(c))
}

///|
let node_once : Once[Component[Schema, Unit]] = Once::new()

///|
/// A schema of any kind: it renders the component of its kind.
pub fn schema_node() -> Component[Schema, Unit] {
  node_once.get(() => {
    component(
      "SchemaNode",
      // It only shows its case's component, as a JS field holds any schema component.
      transparent=true,
      children=() => {
        [
          @tutuca.child(
            schema_object(),
            variant(
              "object",
              s => if s is SObject(o) { Some(o) } else { None },
              o => SObject(o),
            ),
          ),
          @tutuca.child(
            schema_array(),
            variant("array", s => if s is SArray(a) { Some(a) } else { None }, a => {
              SArray(a)
            }),
          ),
          @tutuca.child(
            schema_string,
            variant(
              "string",
              s => if s is SString(x) { Some(x) } else { None },
              x => SString(x),
            ),
          ),
          @tutuca.child(
            schema_number,
            variant(
              "number",
              s => if s is SNumber(x) { Some(x) } else { None },
              x => SNumber(x),
            ),
          ),
          @tutuca.child(
            schema_integer,
            variant(
              "integer",
              s => if s is SInteger(x) { Some(x) } else { None },
              x => SInteger(x),
            ),
          ),
          @tutuca.child(
            schema_boolean,
            variant(
              "boolean",
              s => if s is SBoolean(x) { Some(x) } else { None },
              x => SBoolean(x),
            ),
          ),
          @tutuca.child(
            schema_null,
            variant("null", s => if s is SNull(x) { Some(x) } else { None }, x => {
              SNull(x)
            }),
          ),
          @tutuca.child(
            schema_union,
            variant("union", s => if s is SUnion(x) { Some(x) } else { None }, x => {
              SUnion(x)
            }),
          ),
          @tutuca.child(
            schema_enum(),
            variant("enum", s => if s is SEnum(x) { Some(x) } else { None }, x => {
              SEnum(x)
            }),
          ),
          @tutuca.child(
            schema_const,
            variant("const", s => if s is SConst(x) { Some(x) } else { None }, x => {
              SConst(x)
            }),
          ),
          @tutuca.child(
            schema_ref,
            variant("ref", s => if s is SRef(x) { Some(x) } else { None }, x => {
              SRef(x)
            }),
          ),
          @tutuca.child(
            all_of(),
            variant("allOf", s => if s is SAllOf(x) { Some(x) } else { None }, x => {
              SAllOf(x)
            }),
          ),
          @tutuca.child(
            any_of(),
            variant("anyOf", s => if s is SAnyOf(x) { Some(x) } else { None }, x => {
              SAnyOf(x)
            }),
          ),
          @tutuca.child(
            one_of(),
            variant("oneOf", s => if s is SOneOf(x) { Some(x) } else { None }, x => {
              SOneOf(x)
            }),
          ),
          @tutuca.child(
            schema_not(),
            variant("not", s => if s is SNot(x) { Some(x) } else { None }, x => {
              SNot(x)
            }),
          ),
          @tutuca.child(
            schema_any,
            variant("any", s => if s is SAny { Some(()) } else { None }, _ => {
              SAny
            }),
          ),
          @tutuca.child(
            schema_never,
            variant("never", s => if s is SNever { Some(()) } else { None }, _ => {
              SNever
            }),
          ),
        ]
      },
      view=() => {
        frag([
          render(
            variant(
              "object",
              s => if s is SObject(o) { Some(o) } else { None },
              o => SObject(o),
            ),
            schema_object(),
          ),
          render(
            variant("array", s => if s is SArray(a) { Some(a) } else { None }, a => {
              SArray(a)
            }),
            schema_array(),
          ),
          render(
            variant(
              "string",
              s => if s is SString(x) { Some(x) } else { None },
              x => SString(x),
            ),
            schema_string,
          ),
          render(
            variant(
              "number",
              s => if s is SNumber(x) { Some(x) } else { None },
              x => SNumber(x),
            ),
            schema_number,
          ),
          render(
            variant(
              "integer",
              s => if s is SInteger(x) { Some(x) } else { None },
              x => SInteger(x),
            ),
            schema_integer,
          ),
          render(
            variant(
              "boolean",
              s => if s is SBoolean(x) { Some(x) } else { None },
              x => SBoolean(x),
            ),
            schema_boolean,
          ),
          render(
            variant("null", s => if s is SNull(x) { Some(x) } else { None }, x => {
              SNull(x)
            }),
            schema_null,
          ),
          render(
            variant("union", s => if s is SUnion(x) { Some(x) } else { None }, x => {
              SUnion(x)
            }),
            schema_union,
          ),
          render(
            variant("enum", s => if s is SEnum(x) { Some(x) } else { None }, x => {
              SEnum(x)
            }),
            schema_enum(),
          ),
          render(
            variant("const", s => if s is SConst(x) { Some(x) } else { None }, x => {
              SConst(x)
            }),
            schema_const,
          ),
          render(
            variant("ref", s => if s is SRef(x) { Some(x) } else { None }, x => {
              SRef(x)
            }),
            schema_ref,
          ),
          render(
            variant("allOf", s => if s is SAllOf(x) { Some(x) } else { None }, x => {
              SAllOf(x)
            }),
            all_of(),
          ),
          render(
            variant("anyOf", s => if s is SAnyOf(x) { Some(x) } else { None }, x => {
              SAnyOf(x)
            }),
            any_of(),
          ),
          render(
            variant("oneOf", s => if s is SOneOf(x) { Some(x) } else { None }, x => {
              SOneOf(x)
            }),
            one_of(),
          ),
          render(
            variant("not", s => if s is SNot(x) { Some(x) } else { None }, x => {
              SNot(x)
            }),
            schema_not(),
          ),
          render(
            variant("any", s => if s is SAny { Some(()) } else { None }, _ => {
              SAny
            }),
            schema_any,
          ),
          render(
            variant("never", s => if s is SNever { Some(()) } else { None }, _ => {
              SNever
            }),
            schema_never,
          ),
        ])
      },
    )
  })
}

// --- objects -------------------------------------------------------------------------------

///|
let object_properties : @tutuca.Items[ObjectSchema, Int32, Property] = @tutuca.items(
  "properties",
  o => o.properties,
  (o, properties) => { ..o, properties, },
)

///|
let object_additional : Lens[ObjectSchema, Schema] = Lens::partial(
  "additional",
  o => o.additional,
  (o, a) => { ..o, additional: Some(a), },
)

///|
let object_pager : Lens[ObjectSchema, Pager] = Lens::partial(
  "pager",
  o => o.pager,
  (o, p) => { ..o, pager: Some(p), },
)

///|
fn object_unwrap(s : Schema) -> ObjectSchema {
  guard s is SObject(o) else { abort("an object") }
  o
}

///|
let object_once : Once[Component[ObjectSchema, OpenMsg]] = Once::new()

///|
/// type: object.
pub fn schema_object() -> Component[ObjectSchema, OpenMsg] {
  object_once.get(() => {
    let caption = (o : ObjectSchema) => "object (\{o.properties.length()})"
    let properties = () => {
      render_each(object_properties, schema_property(), filter=(o, k, _) => {
        match o.pager {
          Some(p) => p.shows(k)
          None => true
        }
      })
    }
    component(
      "SchemaObject",
      children=() => {
        [
          @tutuca.each_child(schema_property(), object_properties),
          @tutuca.child(schema_node(), object_additional),
          @tutuca.child(schema_pager, object_pager),
        ]
      },
      fields=[
        @tutuca.field_info("title", Text, initial=""),
        @tutuca.field_info("description", Text, initial=""),
        @tutuca.field_info(
          "properties",
          ListOf(ComponentOf(["SchemaProperty"])),
          initial=[],
        ),
        @tutuca.field_info(
          "additional",
          Optional(
            ComponentOf([
              "SchemaObject", "SchemaArray", "SchemaString", "SchemaNumber", "SchemaInteger",
              "SchemaBoolean", "SchemaNull", "SchemaUnion", "SchemaEnum", "SchemaConst",
              "SchemaRef", "SchemaAllOf", "SchemaAnyOf", "SchemaOneOf", "SchemaNot",
              "SchemaAny", "SchemaNever",
            ]),
          ),
        ),
        @tutuca.field_info("open", Boolean, initial=true),
        @tutuca.field_info("pager", Optional(ComponentOf(["SchemaPager"]))),
      ],
      messages=@tutuca.json_messages([
        "Toggle", "SetOpen", "SetOpenDeep", "OpenSiblings",
      ]),
      view=() => {
        span([cls("schema-object")], [
          span([cls(line)], [
            disclosure(caption, o => o.open),
            semantic_note(o => o.notes),
          ]),
          when(
            o => o.open,
            span([cls("block \{body_class} body")], [
              pager_slot(object_pager),
              properties(),
              when(
                o => o.additional is Some(_),
                span(
                  [cls("flex items-baseline gap-1 min-w-0 py-px additional")],
                  [
                    span([cls("opacity-50")], [txt("…and")]),
                    render(object_additional, schema_node()),
                  ],
                ),
              ),
            ]),
          ),
        ])
      },
      views=() => {
        [
          (
            "format",
            div([cls("schema-object")], [
              div([cls(line)], [disclosure(caption, o => o.open)]),
              when(
                o => o.open,
                div(
                  [cls("\{body_class} body")],
                  [
                    ..notes_rows((o : ObjectSchema) => o.notes),
                    pager_slot(object_pager),
                    properties(),
                    when(
                      o => o.additional is Some(_),
                      div([cls("mt-2 additional")], [
                        div([cls("text-secondary")], [
                          txt("additionalProperties"),
                        ]),
                        div([cls(body_class)], [
                          render(object_additional, schema_node()),
                        ]),
                      ]),
                    ),
                  ],
                ),
              ),
            ]),
          ),
        ]
      },
      update=openable_update(o => SObject(o), object_unwrap, o => o.open),
      on=[siblings_listener(o => SObject(o), object_unwrap)],
    )
  })
}

///|
pub(all) enum PropertyMsg {
  SetOpen(Bool)
  SetOpenDeep(Bool)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let property_schema : Lens[Property, Schema] = @tutuca.field(
  "schema",
  p => p.schema,
  (p, schema) => { ..p, schema, },
)

///|
let property_once : Once[Component[Property, PropertyMsg]] = Once::new()

///|
/// One named property of an object. It owns no open state: messages go to its schema, and
/// open_siblings passes through it to the object.
pub fn schema_property() -> Component[Property, PropertyMsg] {
  property_once.get(() => {
    let name = span(
      [
        cls("truncate inline-block align-bottom max-w-xs text-secondary name"),
        bind_str("title", (p : Property) => p.name),
      ],
      [show(p => p.name)],
    )
    component(
      "SchemaProperty",
      children=() => [@tutuca.child(schema_node(), property_schema)],
      fields=[
        @tutuca.field_info("name", Text, initial=""),
        @tutuca.field_info("required", Boolean, initial=false),
        @tutuca.field_info(
          "schema",
          ComponentOf([
            "SchemaObject", "SchemaArray", "SchemaString", "SchemaNumber", "SchemaInteger",
            "SchemaBoolean", "SchemaNull", "SchemaUnion", "SchemaEnum", "SchemaConst",
            "SchemaRef", "SchemaAllOf", "SchemaAnyOf", "SchemaOneOf", "SchemaNot",
            "SchemaAny", "SchemaNever",
          ]),
        ),
      ],
      messages=@tutuca.json_messages(
        ["SetOpen", "SetOpenDeep", "openSiblings"],
        heard=[@tutuca.heard(open_siblings)],
      ),
      view=() => {
        span([cls("block schema-property")], [
          span([cls("flex items-baseline gap-1 min-w-0 py-px")], [
            name,
            when(
              p => p.required,
              span([cls("text-error mark"), attr("title", "required")], [
                txt("*"),
              ]),
            ),
            span([cls(muted)], [txt(":")]),
            render(property_schema, schema_node()),
          ]),
        ])
      },
      views=() => {
        [
          (
            "format",
            div([cls("schema-property")], [
              div([cls("flex items-baseline gap-1 min-w-0 py-px")], [
                name,
                span([cls(muted)], [txt(":")]),
                span([cls("\{badge_class} mark")], [
                  show(p => if p.required { "required" } else { "optional" }),
                ]),
              ]),
              div([cls(body_class)], [render(property_schema, schema_node())]),
            ]),
          ),
        ]
      },
      update=(p, msg, _) => {
        match msg {
          SetOpen(open) => { ..p, schema: p.schema.set_open(open), }
          SetOpenDeep(open) => { ..p, schema: p.schema.open_deep(open), }
        }
      },
    )
  })
}

// --- arrays --------------------------------------------------------------------------------

///|
let array_items : Lens[ArraySchema, Schema] = Lens::partial(
  "items",
  a => a.items,
  (a, i) => { ..a, items: Some(i), },
)

///|
fn array_unwrap(s : Schema) -> ArraySchema {
  guard s is SArray(a) else { abort("an array") }
  a
}

///|
let array_once : Once[Component[ArraySchema, OpenMsg]] = Once::new()

///|
/// type: array.
pub fn schema_array() -> Component[ArraySchema, OpenMsg] {
  array_once.get(() => {
    component(
      "SchemaArray",
      children=() => [@tutuca.child(schema_node(), array_items)],
      fields=[
        @tutuca.field_info("title", Text, initial=""),
        @tutuca.field_info("description", Text, initial=""),
        @tutuca.field_info(
          "items",
          Optional(
            ComponentOf([
              "SchemaObject", "SchemaArray", "SchemaString", "SchemaNumber", "SchemaInteger",
              "SchemaBoolean", "SchemaNull", "SchemaUnion", "SchemaEnum", "SchemaConst",
              "SchemaRef", "SchemaAllOf", "SchemaAnyOf", "SchemaOneOf", "SchemaNot",
              "SchemaAny", "SchemaNever",
            ]),
          ),
        ),
        @tutuca.field_info("min_items", Text, initial=""),
        @tutuca.field_info("max_items", Text, initial=""),
        @tutuca.field_info("open", Boolean, initial=true),
      ],
      messages=@tutuca.json_messages([
        "Toggle", "SetOpen", "SetOpenDeep", "OpenSiblings",
      ]),
      view=() => {
        span([cls("schema-array")], [
          span([cls("flex items-baseline gap-1 min-w-0 py-px")], [
            disclosure(
              _ => "array of",
              a => a.open,
              caption_class="text-info caption",
            ),
            badge("c-min", a => "≥ \{a.min_items}", a => a.min_items),
            badge("c-max", a => "≤ \{a.max_items}", a => a.max_items),
          ]),
          when(
            a => a.open,
            span([cls("block \{body_class}")], [
              if_(
                a => a.items is Some(_),
                render(array_items, schema_node()),
                span([cls(nothing_class)], [txt("anything")]),
              ),
            ]),
          ),
        ])
      },
      views=() => {
        [
          (
            "format",
            div([cls("schema-array")], [
              div([cls(line)], [disclosure(_ => "array", a => a.open)]),
              when(
                a => a.open,
                div(
                  [cls("\{body_class} body")],
                  [
                    ..notes_rows((a : ArraySchema) => a.notes),
                    row("minItems", a => a.min_items),
                    row("maxItems", a => a.max_items),
                    when(
                      a => a.items is Some(_),
                      div([cls("mt-2 items")], [
                        div([cls("text-secondary")], [txt("items")]),
                        div([cls(body_class)], [
                          render(array_items, schema_node()),
                        ]),
                      ]),
                    ),
                  ],
                ),
              ),
            ]),
          ),
        ]
      },
      update=openable_update(a => SArray(a), array_unwrap, a => a.open),
      on=[siblings_listener(a => SArray(a), array_unwrap)],
    )
  })
}

// --- scalars -------------------------------------------------------------------------------

///|
pub let schema_string : Component[StringSchema, Unit] = component(
  "SchemaString",
  fields=[
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info("description", Text, initial=""),
    @tutuca.field_info("format", Text, initial=""),
    @tutuca.field_info("pattern", Text, initial=""),
    @tutuca.field_info("min_length", Text, initial=""),
    @tutuca.field_info("max_length", Text, initial=""),
  ],
  view=() => {
    span([cls("inline-flex items-center gap-1 schema-string")], [
      span([cls(kind_class)], [txt("string")]),
      badge("c-format", s => s.format, s => s.format),
      badge("c-pattern", s => s.pattern, s => s.pattern),
      badge("c-min", s => "≥ \{s.min_length}", s => s.min_length),
      badge("c-max", s => "≤ \{s.max_length}", s => s.max_length),
    ])
  },
  views=() => {
    [
      (
        "format",
        leaf_format("schema-string", "string", s => s.notes, [
          row("format", s => s.format),
          row("pattern", s => s.pattern),
          row("minLength", s => s.min_length),
          row("maxLength", s => s.max_length),
        ]),
      ),
    ]
  },
)

///|
/// number and integer are different types, so different components with the same shape.
fn numeric(name : String, kind : String) -> Component[NumericSchema, Unit] {
  component(
    name,
    fields=[
      @tutuca.field_info("title", Text, initial=""),
      @tutuca.field_info("description", Text, initial=""),
      @tutuca.field_info("minimum", Text, initial=""),
      @tutuca.field_info("maximum", Text, initial=""),
      @tutuca.field_info("multiple_of", Text, initial=""),
    ],
    view=() => {
      span([cls("inline-flex items-center gap-1 schema-\{kind}")], [
        span([cls(kind_class)], [txt(kind)]),
        badge("c-min", n => "≥ \{n.minimum}", n => n.minimum),
        badge("c-max", n => "≤ \{n.maximum}", n => n.maximum),
        badge("c-step", n => "× \{n.multiple_of}", n => n.multiple_of),
      ])
    },
    views=() => {
      [
        (
          "format",
          leaf_format("schema-\{kind}", kind, n => n.notes, [
            row("minimum", n => n.minimum),
            row("maximum", n => n.maximum),
            row("multipleOf", n => n.multiple_of),
          ]),
        ),
      ]
    },
  )
}

///|
pub let schema_number : Component[NumericSchema, Unit] = numeric(
  "SchemaNumber", "number",
)

///|
pub let schema_integer : Component[NumericSchema, Unit] = numeric(
  "SchemaInteger", "integer",
)

///|
/// A type with nothing to it but its name.
fn bare(name : String, kind : String) -> Component[Notes, Unit] {
  component(
    name,
    fields=[
      @tutuca.field_info("title", Text, initial=""),
      @tutuca.field_info("description", Text, initial=""),
    ],
    view=() => span([cls("text-info schema-\{kind}")], [txt(kind)]),
    views=() => [("format", leaf_format("schema-\{kind}", kind, n => n, []))],
  )
}

///|
pub let schema_boolean : Component[Notes, Unit] = bare(
  "SchemaBoolean", "boolean",
)

///|
pub let schema_null : Component[Notes, Unit] = bare("SchemaNull", "null")

///|
fn type_names() -> View[UnionSchema, Unit] {
  each(
    u => u.types.iter(),
    span([cls("\{badge_class} text-info type-name")], [show(it => it.value)]),
  )
}

///|
/// type: ["string", "null"]: several types, any of which will do.
pub let schema_union : Component[UnionSchema, Unit] = component(
  "SchemaUnion",
  fields=[
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info("description", Text, initial=""),
    @tutuca.field_info("types", ListOf(Text), initial=[]),
  ],
  view=() => {
    span([cls("inline-flex items-center flex-wrap gap-1 schema-union")], [
      type_names(),
    ])
  },
  views=() => {
    [
      (
        "format",
        div([cls("schema-union")], [
          div([cls("flex items-baseline gap-1 min-w-0 py-px")], [
            span([cls(muted)], [txt("one of")]),
            type_names(),
          ]),
          div([cls(body_class)], notes_rows(u => u.notes)),
        ]),
      ),
    ]
  },
)

// --- values --------------------------------------------------------------------------------

///|
let enum_values : @tutuca.Items[EnumSchema, Int32, @jv.JsonValue] = @tutuca.items(
  "values",
  e => e.values,
  (e, values) => { ..e, values, },
)

///|
let enum_pager : Lens[EnumSchema, Pager] = Lens::partial(
  "pager",
  e => e.pager,
  (e, p) => { ..e, pager: Some(p), },
)

///|
fn enum_unwrap(s : Schema) -> EnumSchema {
  guard s is SEnum(e) else { abort("an enum") }
  e
}

///|
let enum_once : Once[Component[EnumSchema, OpenMsg]] = Once::new()

///|
/// enum: [...]: a closed set of values, shown as JSON.
pub fn schema_enum() -> Component[EnumSchema, OpenMsg] {
  enum_once.get(() => {
    let values = () => {
      each(
        (e : EnumSchema) => {
          (0)
          .until(e.values.length())
          .filter(k => {
            match e.pager {
              Some(p) => p.shows(k)
              None => true
            }
          })
        },
        span([cls("py-px")], [
          render_key(enum_values, it => it.value, @jv.json_value()),
        ]),
      )
    }
    component(
      "SchemaEnum",
      children=() => {
        [
          @tutuca.each_child(@jv.json_value(), enum_values),
          @tutuca.child(schema_pager, enum_pager),
        ]
      },
      fields=[
        @tutuca.field_info("title", Text, initial=""),
        @tutuca.field_info("description", Text, initial=""),
        @tutuca.field_info(
          "values",
          ListOf(
            ComponentOf([
              "JsonNull", "JsonBool", "JsonNumber", "JsonString", "JsonSelector",
              "JsonArray", "JsonObject",
            ]),
          ),
          initial=[],
        ),
        @tutuca.field_info("open", Boolean, initial=true),
        @tutuca.field_info("pager", Optional(ComponentOf(["SchemaPager"]))),
      ],
      messages=@tutuca.json_messages(["Toggle", "SetOpen", "SetOpenDeep"]),
      view=() => {
        span([cls("schema-enum")], [
          span([cls(line)], [
            disclosure(
              _ => "one of",
              e => e.open,
              caption_class="text-info caption",
            ),
          ]),
          when(
            e => e.open,
            span([cls("flex flex-col \{body_class}")], [
              pager_slot(enum_pager),
              values(),
            ]),
          ),
        ])
      },
      views=() => {
        [
          (
            "format",
            div([cls("schema-enum")], [
              div([cls(line)], [
                disclosure(e => "enum (\{e.values.length()})", e => e.open),
              ]),
              when(
                e => e.open,
                div(
                  [cls("flex flex-col \{body_class} body")],
                  [
                    ..notes_rows((e : EnumSchema) => e.notes),
                    pager_slot(enum_pager),
                    values(),
                  ],
                ),
              ),
            ]),
          ),
        ]
      },
      update=openable_update(e => SEnum(e), enum_unwrap, e => e.open),
    )
  })
}

///|
let const_value : Lens[ConstSchema, @jv.JsonValue] = @tutuca.field(
  "value",
  c => c.value,
  (c, value) => { ..c, value, },
)

///|
/// const: x, exactly one value.
pub let schema_const : Component[ConstSchema, Unit] = component(
  "SchemaConst",
  children=() => [@tutuca.child(@jv.json_value(), const_value)],
  fields=[
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info("description", Text, initial=""),
    @tutuca.field_info(
      "value",
      ComponentOf([
        "JsonNull", "JsonBool", "JsonNumber", "JsonString", "JsonSelector", "JsonArray",
        "JsonObject",
      ]),
    ),
  ],
  view=() => {
    span([cls("flex items-baseline gap-1 min-w-0 schema-const")], [
      span([cls(muted)], [txt("=")]),
      render(const_value, @jv.json_value()),
    ])
  },
  views=() => {
    [
      (
        "format",
        div([cls("schema-const")], [
          div([cls("flex items-baseline gap-1 min-w-0 py-px")], [
            span([cls(muted)], [txt("const")]),
            render(const_value, @jv.json_value()),
          ]),
          div([cls(body_class)], notes_rows(c => c.notes)),
        ]),
      ),
    ]
  },
)

///|
/// $ref: a pointer to a schema declared elsewhere.
pub let schema_ref : Component[String, Unit] = component(
  "SchemaRef",
  fields=[@tutuca.field_info("target", Text, initial="")],
  view=() => {
    div([cls("flex items-baseline gap-1 min-w-0 py-px schema-ref")], [
      span([cls(muted)], [txt("$ref")]),
      span(
        [
          cls("truncate inline-block align-bottom max-w-2xl text-warning ref"),
          bind_str("title", t => t),
        ],
        [show(t => t)],
      ),
    ])
  },
)

// --- combinators ---------------------------------------------------------------------------

///|
let combinator_branches : @tutuca.Items[Combinator, Int32, Schema] = @tutuca.items(
  "branches",
  c => c.branches,
  (c, branches) => { ..c, branches, },
)

///|
let combinator_pager : Lens[Combinator, Pager] = Lens::partial(
  "pager",
  c => c.pager,
  (c, p) => { ..c, pager: Some(p), },
)

///|
/// allOf, anyOf and oneOf: branches, read as `label` in main and as `key` in format.
fn combinator(
  name : String,
  key : String,
  label : String,
  wrap : (Combinator) -> Schema,
) -> Component[Combinator, OpenMsg] {
  let unwrap = (s : Schema) => {
    match s {
      SAllOf(c) | SAnyOf(c) | SOneOf(c) => c
      _ => abort("a combinator")
    }
  }
  let branches = () => {
    render_each(combinator_branches, schema_node(), filter=paged(c => c.pager))
  }
  component(
    name,
    children=() => {
      [
        @tutuca.each_child(schema_node(), combinator_branches),
        @tutuca.child(schema_pager, combinator_pager),
      ]
    },
    fields=[
      @tutuca.field_info("title", Text, initial=""),
      @tutuca.field_info("description", Text, initial=""),
      @tutuca.field_info(
        "branches",
        ListOf(
          ComponentOf([
            "SchemaObject", "SchemaArray", "SchemaString", "SchemaNumber", "SchemaInteger",
            "SchemaBoolean", "SchemaNull", "SchemaUnion", "SchemaEnum", "SchemaConst",
            "SchemaRef", "SchemaAllOf", "SchemaAnyOf", "SchemaOneOf", "SchemaNot",
            "SchemaAny", "SchemaNever",
          ]),
        ),
        initial=[],
      ),
      @tutuca.field_info("open", Boolean, initial=true),
      @tutuca.field_info("pager", Optional(ComponentOf(["SchemaPager"]))),
    ],
    messages=@tutuca.json_messages([
      "Toggle", "SetOpen", "SetOpenDeep", "OpenSiblings",
    ]),
    view=() => {
      span([cls("schema-\{key.to_lower()}")], [
        span([cls(line)], [
          disclosure(_ => label, c => c.open, caption_class="text-info caption"),
        ]),
        when(
          c => c.open,
          span([cls("block \{body_class}")], [
            pager_slot(combinator_pager),
            branches(),
          ]),
        ),
      ])
    },
    views=() => {
      [
        (
          "format",
          div([cls("schema-\{key.to_lower()}")], [
            div([cls(line)], [
              disclosure(c => "\{key} (\{c.branches.length()})", c => c.open),
            ]),
            when(
              c => c.open,
              div(
                [cls("\{body_class} body")],
                [
                  ..notes_rows((c : Combinator) => c.notes),
                  pager_slot(combinator_pager),
                  branches(),
                ],
              ),
            ),
          ]),
        ),
      ]
    },
    update=openable_update(wrap, unwrap, c => c.open),
    on=[siblings_listener(wrap, unwrap)],
  )
}

///|
let all_of_once : Once[Component[Combinator, OpenMsg]] = Once::new()

///|
pub fn all_of() -> Component[Combinator, OpenMsg] {
  all_of_once.get(() => {
    combinator("SchemaAllOf", "allOf", "all of", c => SAllOf(c))
  })
}

///|
let any_of_once : Once[Component[Combinator, OpenMsg]] = Once::new()

///|
pub fn any_of() -> Component[Combinator, OpenMsg] {
  any_of_once.get(() => {
    combinator("SchemaAnyOf", "anyOf", "any of", c => SAnyOf(c))
  })
}

///|
let one_of_once : Once[Component[Combinator, OpenMsg]] = Once::new()

///|
pub fn one_of() -> Component[Combinator, OpenMsg] {
  one_of_once.get(() => {
    combinator("SchemaOneOf", "oneOf", "exactly one of", c => SOneOf(c))
  })
}

///|
pub(all) enum NotMsg {
  SetOpenDeep(Bool)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let not_schema : Lens[NotSchema, Schema] = @tutuca.field(
  "schema",
  n => n.schema,
  (n, schema) => { ..n, schema, },
)

///|
fn not_unwrap(s : Schema) -> NotSchema {
  guard s is SNot(n) else { abort("a not") }
  n
}

///|
let not_once : Once[Component[NotSchema, NotMsg]] = Once::new()

///|
/// not: the one branch must not hold.
pub fn schema_not() -> Component[NotSchema, NotMsg] {
  not_once.get(() => {
    component(
      "SchemaNot",
      children=() => [@tutuca.child(schema_node(), not_schema)],
      fields=[
        @tutuca.field_info("title", Text, initial=""),
        @tutuca.field_info("description", Text, initial=""),
        @tutuca.field_info(
          "schema",
          ComponentOf([
            "SchemaObject", "SchemaArray", "SchemaString", "SchemaNumber", "SchemaInteger",
            "SchemaBoolean", "SchemaNull", "SchemaUnion", "SchemaEnum", "SchemaConst",
            "SchemaRef", "SchemaAllOf", "SchemaAnyOf", "SchemaOneOf", "SchemaNot",
            "SchemaAny", "SchemaNever",
          ]),
        ),
      ],
      messages=@tutuca.json_messages(["SetOpenDeep", "openSiblings"], heard=[
        @tutuca.heard(open_siblings),
      ]),
      view=() => {
        span([cls("flex items-baseline gap-1 min-w-0 schema-not")], [
          span([cls(muted)], [txt("not")]),
          render(not_schema, schema_node()),
        ])
      },
      views=() => {
        [
          (
            "format",
            div([cls("schema-not")], [
              div([cls(muted)], [txt("not")]),
              div(
                [cls(body_class)],
                [
                  ..notes_rows((n : NotSchema) => n.notes),
                  render(not_schema, schema_node()),
                ],
              ),
            ]),
          ),
        ]
      },
      update=(n, msg, _) => {
        match msg {
          SetOpenDeep(open) => not_unwrap(SNot(n).open_deep(open))
        }
      },
      on=[siblings_listener(n => SNot(n), not_unwrap)],
    )
  })
}

///|
/// true, or {}: anything is valid.
pub let schema_any : Component[Unit, Unit] = component("SchemaAny", view=() => {
  div([cls("\{nothing_class} schema-any")], [txt("anything")])
})

///|
/// false: nothing is valid.
pub let schema_never : Component[Unit, Unit] = component("SchemaNever", view=() => {
  div([cls("\{nothing_class} schema-never")], [txt("nothing")])
})

// --- the root ------------------------------------------------------------------------------

///|
pub(all) enum Reading {
  Semantic
  Format
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS names the views: "main" (the semantic reading) and "format".
pub impl ToJson for Reading with fn to_json(self) {
  Json::string(if self is Format { "format" } else { "main" })
}

///|
pub impl FromJson for Reading with fn from_json(json, path) {
  match json {
    String("main") => Semantic
    String("format") => Format
    _ => raise @json.JsonDecodeError((path, "a view: \"main\" or \"format\""))
  }
}

///|
/// The entry point of a schema tree: a toolbar and one node.
pub(all) struct SchemaRoot {
  node : Schema
  view : Reading // JS's view: "main" or "format".
} derive(Eq, Debug, ToJson)

///|
pub(all) enum RootMsg {
  SetView(Reading)
  SetOpenDeep(Bool)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// A whole schema under its root.
pub fn schema_tree(
  j : Json,
  reading~ : Reading = Semantic,
  open~ : Bool = true,
  per_page~ : Int32 = default_per_page,
) -> SchemaRoot {
  { node: from_schema(j, open~, per_page~), view: reading, }
}

///|
let root_node : Lens[SchemaRoot, Schema] = @tutuca.field("node", r => r.node, (
  r,
  node,
) => { ..r, node, })

///|
fn reading_button(
  reading : Reading,
  label : String,
) -> View[SchemaRoot, RootMsg] {
  button(
    [
      class_(r => {
        if r.view == reading {
          "btn btn-xs btn-ghost join-item btn-active view-\{label}"
        } else {
          "btn btn-xs btn-ghost join-item view-\{label}"
        }
      }),
      bind_str("aria-pressed", r => (r.view == reading).to_string()),
      on_click(SetView(reading)),
    ],
    [txt(label)],
  )
}

///|
pub let schema_root : Component[SchemaRoot, RootMsg] = component(
  "SchemaRoot",
  children=() => [@tutuca.child(schema_node(), root_node)],
  fields=[
    @tutuca.field_info(
      "node",
      ComponentOf([
        "SchemaObject", "SchemaArray", "SchemaString", "SchemaNumber", "SchemaInteger",
        "SchemaBoolean", "SchemaNull", "SchemaUnion", "SchemaEnum", "SchemaConst",
        "SchemaRef", "SchemaAllOf", "SchemaAnyOf", "SchemaOneOf", "SchemaNot", "SchemaAny",
        "SchemaNever",
      ]),
    ),
    @tutuca.field_info("view", OneOf(["main", "format"]), initial="main"),
  ],
  messages=@tutuca.json_messages(["SetView", "SetOpenDeep", "openSiblings"], heard=[
    @tutuca.heard(open_siblings),
  ]),
  view=() => {
    section(
      [
        cls(
          "font-mono text-xs leading-5 bg-base-100 text-base-content p-3 rounded schema-root",
        ),
      ],
      [
        header(
          [cls("flex gap-1 items-center pb-2 mb-2 border-b border-base-300")],
          [
            span(
              [
                cls("join mr-2"),
                attr("role", "group"),
                aria("label", "Reading"),
              ],
              [
                reading_button(Semantic, "semantic"),
                reading_button(Format, "format"),
              ],
            ),
            button(
              [
                cls("btn btn-xs btn-ghost expand-all"),
                on_click(SetOpenDeep(true)),
              ],
              [txt("expand all")],
            ),
            button(
              [
                cls("btn btn-xs btn-ghost collapse-all"),
                on_click(SetOpenDeep(false)),
              ],
              [txt("collapse all")],
            ),
          ],
        ),
        push_view(
          r => if r.view is Format { "format" } else { "main" },
          div([cls("schema-tree")], [render(root_node, schema_node())]),
        ),
      ],
    )
  },
  update=(r, msg, _) => {
    match msg {
      SetView(reading) => { ..r, view: reading, }
      SetOpenDeep(open) => { ..r, node: r.node.open_deep(open), }
    }
  },
  on=[
    open_siblings.on((r, open, ctx) => {
      ctx.stop()
      { ..r, node: r.node.set_open(open), }
    }),
  ],
  post=(msg, _, next) => {
    match msg {
      SetOpenDeep(open) => next.node.all_open().iter().all(o => o == open)
      SetView(reading) => next.view == reading
    }
  },
)

///|
/// The object a schema is, for addressing it from outside (stories, tests).
pub let object_variant : Lens[Schema, ObjectSchema] = variant(
  "object",
  s => if s is SObject(o) { Some(o) } else { None },
  o => SObject(o),
)

///|
/// The root's node.
pub let root_lens : Lens[SchemaRoot, Schema] = root_node

///|
/// The pager of an object.
pub let object_pager_lens : Lens[ObjectSchema, Pager] = object_pager

///|
/// The properties of an object.
pub let properties_lens : @tutuca.Items[ObjectSchema, Int32, Property] = object_properties

///|
pub let property_schema_lens : Lens[Property, Schema] = property_schema
