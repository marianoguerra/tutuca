// A studio for JSON Schemas: an example payload in a JSON editor and the schema inferred from
// it, kept in step.

///|
pub(all) struct Sample {
  id : String
  label : String
  title : String
  value : Json
}

///|
/// Example payloads to start from.
pub let samples : Array[Sample] = [
  {
    id: "user",
    label: "User profile",
    title: "User",
    value: {
      "id": 4211,
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "website": "https://ada.example.com",
      "verified": true,
      "rating": 4.8,
      "joined": "2024-03-01",
      "address": {
        "street": "12 Analytical Row",
        "city": "London",
        "postcode": "N1 9GU",
      },
      "tags": ["math", "engines"],
    },
  },
  {
    id: "order",
    label: "Shop order",
    title: "Order",
    value: {
      "orderId": "ord_9f2c",
      "createdAt": "2026-10-16T10:30:00Z",
      "status": "paid",
      "customer": { "id": 4211, "email": "ada@example.com" },
      "items": [
        { "sku": "MUG-01", "name": "Mug", "quantity": 2, "price": 9.5 },
        {
          "sku": "TEA-12",
          "name": "Earl grey",
          "quantity": 1,
          "price": 6,
          "giftWrap": true,
        },
      ],
      "coupon": Json::null(),
      "total": 25,
    },
  },
  {
    id: "webhook",
    label: "Webhook event",
    title: "PushEvent",
    value: {
      "event": "push",
      "deliveredAt": "2026-10-16T10:31:12+02:00",
      "repository": {
        "name": "tutuca",
        "url": "https://git.example.com/tutuca",
        "private": false,
      },
      "commits": [
        {
          "id": "a1b2c3",
          "message": "Add demos",
          "author": "ada@example.com",
          "added": ["demos/boot.js"],
        },
        {
          "id": "d4e5f6",
          "message": "Fix typo",
          "author": "grace@example.com",
          "removed": [],
        },
      ],
    },
  },
]

///|
fn schema_for(json : Json, title : String) -> Json {
  schema_document(infer_schema(json), title)
}

///|
pub(all) struct Studio {
  sample : String
  title : String
  editor : @jv.JsonEditor
  schema : SchemaRoot
  source : String // The payload the schema was inferred from, as JSON text.
  paste_text : String
  paste_error : String
} derive(Eq, Debug, ToJson)

///|
pub fn Studio::json(self : Studio) -> Json {
  self.editor.value.to_json_value()
}

///|
pub fn Studio::is_stale(self : Studio) -> Bool {
  self.json().stringify() != self.source
}

///|
pub fn Studio::schema_text(self : Studio) -> String {
  schema_for(self.json(), self.title).stringify(indent=2)
}

///|
/// Infers the schema again from the editor's payload, keeping how it is read.
fn Studio::infer(self : Studio) -> Studio {
  let json = self.json()
  {
    ..self,
    schema: schema_tree(schema_for(json, self.title), reading=self.schema.view),
    source: json.stringify(),
  }
}

///|
/// A studio on sample `id`.
pub fn studio(id~ : String = "order") -> Studio {
  let s = samples.iter().find_first(s => s.id == id).unwrap_or(samples[1])
  {
    sample: s.id,
    title: s.title,
    editor: { value: @jv.from_json(s.value), mode: Editing, show_text: false, },
    schema: schema_tree(schema_for(s.value, s.title)),
    source: s.value.stringify(),
    paste_text: "",
    paste_error: "",
  }
}

///|
pub(all) enum StudioMsg {
  Regenerate
  LoadSample(String)
  SetTitle(String)
  SetPasteText(String)
  PasteJson
  DownloadSchema
  Saved(@tutuca.AskResult[String])
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let studio_editor : Lens[Studio, @jv.JsonEditor] = @tutuca.field(
  "editor",
  s => s.editor,
  (s, editor) => { ..s, editor, },
)

///|
let studio_schema : Lens[Studio, SchemaRoot] = @tutuca.field(
  "schema",
  s => s.schema,
  (s, schema) => { ..s, schema, },
)

///|
fn card(childs : Array[View[Studio, StudioMsg]]) -> View[Studio, StudioMsg] {
  div(
    [
      cls(
        "card flex min-w-0 flex-1 flex-col gap-3 border border-base-300 bg-base-100 p-4 shadow-sm",
      ),
    ],
    childs,
  )
}

///|
fn card_title(text : String) -> View[Studio, StudioMsg] {
  @tutuca.h2(
    [cls("text-sm font-semibold uppercase tracking-wider opacity-60")],
    [txt(text)],
  )
}

///|
fn slug(text : String) -> String {
  let sb = StringBuilder()
  let mut dash = false
  for c in text.to_lower() {
    if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
      sb.write_char(c)
      dash = false
    } else if !dash {
      sb.write_char('-')
      dash = true
    }
  }
  sb.to_string()
}

///|
pub let studio_component : Component[Studio, StudioMsg] = component(
  "Studio",
  children=() => {
    [
      @tutuca.child(@jv.json_editor, studio_editor),
      @tutuca.child(schema_root, studio_schema),
    ]
  },
  fields=[
    @tutuca.field_info("sample", Text, initial=""),
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info("editor", ComponentOf(["JsonEditor"])),
    @tutuca.field_info("schema", ComponentOf(["SchemaRoot"])),
    @tutuca.field_info("source", Text, initial=""),
    @tutuca.field_info("paste_text", Text, initial=""),
    @tutuca.field_info("paste_error", Text, initial=""),
  ],
  messages=@tutuca.json_messages(
    [
      "Regenerate", "LoadSample", "SetTitle", "SetPasteText", "PasteJson", "DownloadSchema",
      "Saved",
    ],
    replies=[@tutuca.reply("Saved", @common.save_file)],
  ),
  view=() => {
    div([cls("flex flex-col gap-4 xl:flex-row xl:items-start")], [
      card([
        div([cls("flex flex-wrap items-center justify-between gap-2")], [
          card_title("Example payload"),
          @tutuca.select(
            [
              cls("select select-sm select-bordered"),
              aria("label", "Sample payload"),
              @tutuca.value(s => s.sample),
              @tutuca.on_change(v => LoadSample(v)),
            ],
            samples.map(s => {
              @tutuca.option([attr("value", s.id)], [txt(s.label)])
            }),
          ),
        ]),
        @tutuca.p([cls("text-sm opacity-70")], [
          txt(
            "Edit values, add or remove fields and array items: the schema follows.",
          ),
        ]),
        render(studio_editor, @jv.json_editor),
        @tutuca.h(
          "details",
          [cls("collapse collapse-arrow border border-base-300")],
          [
            @tutuca.h("summary", [cls("collapse-title text-sm font-medium")], [
              txt("Paste your own JSON"),
            ]),
            div([cls("collapse-content flex flex-col gap-2")], [
              @tutuca.textarea([
                cls("textarea textarea-bordered h-40 w-full font-mono text-xs"),
                aria("label", "JSON to paste"),
                attr("placeholder", "{ \"id\": 1, \"name\": \"…\" }"),
                @tutuca.value(s => s.paste_text),
                @tutuca.on_input(v => SetPasteText(v)),
              ]),
              when(
                s => s.paste_error != "",
                @tutuca.p([cls("text-sm text-error")], [
                  show(s => s.paste_error),
                ]),
              ),
              button(
                [cls("btn btn-sm btn-primary self-start"), on_click(PasteJson)],
                [txt("Use this JSON")],
              ),
            ]),
          ],
        ),
      ]),
      card([
        div([cls("flex flex-wrap items-center justify-between gap-2")], [
          card_title("Schema"),
          button([cls("btn btn-sm btn-primary"), on_click(DownloadSchema)], [
            txt("Download .schema.json"),
          ]),
        ]),
        @tutuca.label([cls("flex items-center gap-2 text-sm")], [
          span([cls("opacity-70")], [txt("Title")]),
          @tutuca.input([
            cls("input input-sm input-bordered flex-1"),
            aria("label", "Schema title"),
            @tutuca.value(s => s.title),
            @tutuca.on_input(v => SetTitle(v)),
          ]),
        ]),
        when(
          s => s.is_stale(),
          button(
            [cls("btn btn-sm btn-warning self-start"), on_click(Regenerate)],
            [txt("Update schema")],
          ),
        ),
        render(studio_schema, schema_root),
        @tutuca.h(
          "details",
          [cls("collapse collapse-arrow border border-base-300")],
          [
            @tutuca.h("summary", [cls("collapse-title text-sm font-medium")], [
              txt("Schema as JSON"),
            ]),
            @tutuca.pre(
              [cls("collapse-content overflow-x-auto font-mono text-xs")],
              [show(s => s.schema_text())],
            ),
          ],
        ),
      ]),
    ])
  },
  update=(s, msg, ctx) => {
    match msg {
      Regenerate => s.infer()
      LoadSample(id) =>
        match samples.iter().find_first(x => x.id == id) {
          Some(sample) =>
            {
              ..s,
              sample: id,
              title: sample.title,
              editor: {
                value: @jv.from_json(sample.value),
                mode: Editing,
                show_text: false,
              },
            }.infer()
          None => s
        }
      SetTitle(title) => { ..s, title, }.infer()
      SetPasteText(paste_text) => { ..s, paste_text, paste_error: "", }
      PasteJson => {
        let value = @json.parse(s.paste_text) catch {
          e => return { ..s, paste_error: "Not JSON: \{e}", }
        }
        {
          ..s,
          editor: {
            value: @jv.from_json(value),
            mode: Editing,
            show_text: false,
          },
          paste_text: "",
          title: "",
        }.infer()
      }
      DownloadSchema => {
        let name = slug(if s.title == "" { "payload" } else { s.title })
        ctx.ask(
          @common.save_file,
          @common.SaveFile::new(
            "\{name}.schema.json",
            "\{s.schema_text()}\n",
            mime="application/schema+json",
          ),
          r => Some(Saved(r)),
        )
        s
      }
      Saved(_) => s
    }
  },
  post=(msg, _, next) => {
    match msg {
      Regenerate => !next.is_stale()
      _ => true
    }
  },
)
