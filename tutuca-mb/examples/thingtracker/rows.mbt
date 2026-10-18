// The small components the app lists, from rows.js: a thing, a tag, a section of Track and a
// bucket of Insights.

///|
/// One thing: a button on Track, a row in Manage. The app keeps total, last_text and
/// tags_text from the events and tags.
pub(all) struct Thing {
  id : String
  emoji : String
  title : String
  description : String
  measurements : Vec[MeasureRef]
  color : String
  archived : Bool
  bundle_id : String
  total : Int32
  last_text : String
  tags_text : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn Thing::new(
  id : String,
  emoji : String,
  title : String,
  description~ : String = "",
  measurements~ : Vec[MeasureRef] = Vec::new(),
  color~ : String = "",
  archived~ : Bool = false,
  bundle_id~ : String = "",
) -> Thing {
  {
    id,
    emoji,
    title,
    description,
    measurements,
    color,
    archived,
    bundle_id,
    total: 0,
    last_text: "never",
    tags_text: "No tags",
  }
}

///|
fn Thing::searchable(self : Thing) -> Searchable {
  { emoji: self.emoji, title: self.title, description: self.description, }
}

///|
pub(all) enum ThingMsg {
  Tap
  Hold // A long press on touch, a right click with a mouse.
  Edit
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent by a tapped thing with its id: log it now.
pub let log_thing : Signal[String] = Signal::new("logThing")

///|
/// Sent by a held thing with its id: log it at another time.
pub let backdate_thing : Signal[String] = Signal::new("backdateThing")

///|
pub let edit_thing : Signal[String] = Signal::new("editThing")

///|
fn Thing::aria_label(self : Thing) -> String {
  if self.total == 0 {
    "Log \{self.title}, never logged"
  } else {
    "Log \{self.title}, logged \{self.total} times, last \{self.last_text}"
  }
}

///|
fn Thing::hint(self : Thing) -> String {
  "\{self.title} — tap to log now, hold to pick a time"
}

///|
fn Thing::border_style(self : Thing) -> String {
  if self.color == "" {
    ""
  } else {
    "border-color: \{self.color}"
  }
}

///|
fn thing_button_props(classes : String) -> Array[Prop[Thing, ThingMsg]] {
  [
    cls(classes),
    bind_str("style", t => t.border_style()),
    bind_str("title", t => t.hint()),
    bind_str("aria-label", t => t.aria_label()),
    on_click(Tap),
    on(Custom("contextmenu"), Hold),
  ]
}

///|
pub let thing_c : Component[Thing, ThingMsg] = component(
  "Thing",
  fields=[
    @tutuca.field_info("id", Text, initial=""),
    @tutuca.field_info(
      "emoji",
      Text,
      constraints=[MinLength(1), MaxLength(16)],
      initial="⭐",
      checks=["the emoji is 1 to 16 long"],
    ),
    @tutuca.field_info(
      "title",
      Text,
      constraints=[MaxLength(120)],
      initial="",
      checks=["the title is at most 120 long"],
    ),
    @tutuca.field_info("description", Text, initial=""),
    @tutuca.field_info(
      "measurements",
      ListOf(RecordOf([("measurement_id", Text), ("unit", Text)])),
      initial=[],
    ),
    @tutuca.field_info("color", Text, initial=""),
    @tutuca.field_info("archived", Boolean, initial=false),
    @tutuca.field_info("bundle_id", Text, initial=""),
    @tutuca.field_info("total", Whole, constraints=[AtLeast(0)], initial=0, checks=[
      "the total is never negative",
    ]),
    @tutuca.field_info("last_text", Text, initial="never"),
    @tutuca.field_info("tags_text", Text, initial="No tags"),
  ],
  messages=@tutuca.json_messages(["Tap", "Hold", "Edit"]),
  view=() => {
    button(
      thing_button_props(
        "flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-base-300 bg-base-100 px-1 py-2 select-none transition-transform active:scale-95",
      ),
      [
        span([cls("emoji relative text-3xl leading-none")], [
          show(t => t.emoji),
          when(
            t => t.measurements.length() > 0,
            span([cls("absolute -top-0.5 -right-2 text-[0.5rem] opacity-60")], [
              txt("📏"),
            ]),
          ),
        ]),
        span(
          [
            cls(
              "w-full truncate text-center text-[0.6875rem] leading-tight font-medium",
            ),
          ],
          [show(t => t.title)],
        ),
        span([cls("text-[0.625rem] leading-none tabular-nums \{muted}")], [
          show(t => t.last_text),
        ]),
      ],
    )
  },
  views=() => {
    [
      (
        "compact",
        button(
          thing_button_props(
            "flex aspect-square items-center justify-center rounded-xl border border-base-300 bg-base-100 select-none transition-transform active:scale-95",
          ),
          [span([cls("emoji text-3xl leading-none")], [show(t => t.emoji)])],
        ),
      ),
      (
        "row",
        li([], [
          button(
            [
              cls("flex w-full items-center gap-3 py-2.5 text-left"),
              on_click(Edit),
            ],
            [
              span([cls("emoji text-2xl")], [show(t => t.emoji)]),
              span([cls("min-w-0 flex-1")], [
                span([cls("block truncate text-sm font-medium")], [
                  show(t => t.title),
                ]),
                span([cls("block truncate text-xs \{muted}")], [
                  show(t => t.tags_text),
                ]),
              ]),
            ],
          ),
        ]),
      ),
    ]
  },
  update=(t, msg, ctx) => {
    match msg {
      Tap => ctx.notify(log_thing, t.id)
      Hold => {
        if ctx.event() is Some(e) {
          e.prevent_default()
        }
        ctx.notify(backdate_thing, t.id)
      }
      Edit => ctx.notify(edit_thing, t.id)
    }
    t
  },
  invariants=[
    (
      "the emoji is 1 to 16 long",
      t => t.emoji.length() >= 1 && t.emoji.length() <= 16,
    ),
    ("the title is at most 120 long", t => t.title.length() <= 120),
    ("the total is never negative", t => t.total >= 0),
  ],
)

///|
/// A tag ("group" in the data).
pub(all) struct Tag {
  id : String
  title : String
  emoji : String
  description : String
  sort_order : Int32
  thing_ids : Vec[String]
  bundle_id : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn Tag::new(
  id : String,
  title : String,
  emoji~ : String = "",
  description~ : String = "",
  sort_order~ : Int32 = 0,
  thing_ids~ : Vec[String] = Vec::new(),
  bundle_id~ : String = "",
) -> Tag {
  { id, title, emoji, description, sort_order, thing_ids, bundle_id, }
}

///|
pub(all) enum TagMsg {
  Edit
  Share
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent by a tag's row; the app knows which tag by where it came from.
pub let edit_tag : Signal[Unit] = Signal::new("editTag")

///|
pub let share_tag : Signal[Unit] = Signal::new("shareTag")

///|
pub let tag_c : Component[Tag, TagMsg] = component(
  "Tag",
  fields=[
    @tutuca.field_info("id", Text, initial=""),
    @tutuca.field_info(
      "title",
      Text,
      constraints=[MaxLength(120)],
      initial="",
      checks=["the title is at most 120 long"],
    ),
    @tutuca.field_info("emoji", Text, initial=""),
    @tutuca.field_info("description", Text, initial=""),
    @tutuca.field_info(
      "sort_order",
      Whole,
      constraints=[AtLeast(0), AtMost(1000000)],
      initial=0,
      checks=["the sort order is 0 to 1000000"],
    ),
    @tutuca.field_info("thing_ids", ListOf(Text), initial=[]),
    @tutuca.field_info("bundle_id", Text, initial=""),
  ],
  messages=@tutuca.json_messages(["Edit", "Share"]),
  view=() => {
    span([cls("inline-flex items-center gap-1")], [
      show(g => g.emoji),
      show(g => g.title),
    ])
  },
  views=() => {
    [
      (
        "row",
        li([cls("flex items-center gap-2")], [
          button(
            [
              cls("flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"),
              on_click(Edit),
            ],
            [
              span([cls("emoji text-xl")], [show(g => g.emoji)]),
              span([cls("min-w-0 flex-1 truncate text-sm font-medium")], [
                show(g => g.title),
              ]),
              span([cls("text-xs \{muted}")], [
                show(g => plural(g.thing_ids.length(), "thing")),
              ]),
            ],
          ),
          button(
            [
              cls("btn btn-ghost btn-square btn-sm"),
              bind_str("aria-label", g => "Share \{g.title}"),
              on_click(Share),
            ],
            [txt("⇪")],
          ),
        ]),
      ),
    ]
  },
  update=(g, msg, ctx) => {
    match msg {
      Edit => ctx.notify(edit_tag, ())
      Share => ctx.notify(share_tag, ())
    }
    g
  },
  invariants=[
    ("the title is at most 120 long", g => g.title.length() <= 120),
    (
      "the sort order is 0 to 1000000",
      g => g.sort_order >= 0 && g.sort_order <= 1000000,
    ),
  ],
)

///|
/// A collapsible section of Track; its members are the app's things it names, read from what
/// the app provides, so a section alone shows only its header.
pub(all) struct Section {
  id : String
  title : String
  emoji : String
  member_ids : Vec[String]
  is_open : Bool
  compact : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum SectionMsg {
  Toggle
  ToggleAll
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent by a section's header with its id.
pub let toggle_section : Signal[String] = Signal::new("toggleSection")

///|
/// Sent by a right click or long press on a section's header.
pub let toggle_all_sections : Signal[Unit] = Signal::new("toggleAllSections")

///|
/// The app's things, as it provides them to its sections.
pub let things_provided : @tutuca.Provide[Vec[Thing]] = @tutuca.Provide::new(
  "things",
)

///|
let provided_things : Items[Vec[Thing], Int32, Thing] = items(
  "things",
  v => v,
  replace_things,
)

///|
fn replace_things(_ : Vec[Thing], things : Vec[Thing]) -> Vec[Thing] {
  things
}

///|
/// Where the section's members are among the provided things, in the section's order.
fn Section::member_indices(self : Section, things : Vec[Thing]) -> Array[Int32] {
  self.member_ids
  .iter()
  .filter_map(id => things.find_index(t => t.id == id))
  .to_array()
}

///|
fn Section::grid_class(self : Section) -> String {
  if self.compact {
    "grid grid-cols-6 gap-2 px-4 pt-1 pb-2 min-[480px]:grid-cols-8"
  } else {
    "grid grid-cols-4 gap-2 px-4 pt-1 pb-2 min-[480px]:grid-cols-6"
  }
}

///|
pub let section_c : Component[Section, SectionMsg] = component(
  "Section",
  fields=[
    @tutuca.field_info("id", Text, initial=""),
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info("emoji", Text, initial=""),
    @tutuca.field_info("member_ids", ListOf(Text), initial=[]),
    @tutuca.field_info("is_open", Boolean, initial=true),
    @tutuca.field_info("compact", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages(
    ["Toggle", "logThing", "backdateThing", "ToggleAll"],
    heard=[@tutuca.heard(log_thing), @tutuca.heard(backdate_thing)],
  ),
  view=() => {
    section([cls("py-1")], [
      h2([], [
        button(
          [
            cls(
              "flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-semibold tracking-wide uppercase select-none \{muted}",
            ),
            bind_str("aria-expanded", s => s.is_open.to_string()),
            on_click(Toggle),
            on(Custom("contextmenu"), ToggleAll),
          ],
          [
            span([cls("w-3")], [
              show(s => if s.is_open { "▾" } else { "▸" }),
            ]),
            span([cls("emoji")], [show(s => s.emoji)]),
            span([cls("truncate")], [show(s => s.title)]),
            span([cls("font-normal tabular-nums opacity-60")], [
              show(s => s.member_ids.length().to_string()),
            ]),
          ],
        ),
      ]),
      // The members are the app's things, so a section alone shows only its header.
      when(
        s => s.is_open,
        @tutuca.when_provided(
          things_provided,
          div([class_(w => w.up.grid_class())], [
            @tutuca.each(
              w => w.up.member_indices(w.value).iter(),
              @tutuca.render_provided_key(
                things_provided,
                provided_things,
                it => it.value,
                thing_c,
              ),
              key=(i, _) => i.to_string(),
            ),
          ]),
        ),
      ),
    ])
  },
  update=(s, msg, ctx) => {
    match msg {
      Toggle => ctx.notify(toggle_section, s.id)
      ToggleAll => {
        if ctx.event() is Some(e) {
          e.prevent_default()
        }
        ctx.notify(toggle_all_sections, ())
      }
    }
    s
  },
)

///|
/// A thing's chip in a bucket.
pub(all) struct Chip {
  thing_id : String
  emoji : String
  aria : String
  tip : String
  mark : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// A bucket of Insights, or the quiet days between two (gap > 0).
pub(all) struct Bucket {
  label : String
  start : Double
  end : Double
  total : Int32
  gap : Int32
  chips : Vec[Chip]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum BucketMsg {
  Open(Int32) // The chip's index.
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// What a chip opens: a thing's entries in a bucket.
pub(all) struct ChipOpened {
  thing_id : String
  start : Double
  end : Double
  label : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let open_chip : Signal[ChipOpened] = Signal::new("openChip")

///|
pub let bucket_c : Component[Bucket, BucketMsg] = component(
  "Bucket",
  fields=[
    @tutuca.field_info("label", Text, initial=""),
    @tutuca.field_info("start", Whole, initial=0),
    @tutuca.field_info("end", Whole, initial=0),
    @tutuca.field_info("total", Whole, constraints=[AtLeast(0)], initial=0, checks=[
      "the total is never negative",
    ]),
    @tutuca.field_info("gap", Whole, constraints=[AtLeast(0)], initial=0, checks=[
      "gaps are never negative",
    ]),
    @tutuca.field_info(
      "chips",
      ListOf(
        RecordOf([
          ("thing_id", Text),
          ("emoji", Text),
          ("aria", Text),
          ("tip", Text),
          ("mark", Text),
        ]),
      ),
      initial=[],
    ),
  ],
  messages=@tutuca.json_messages(["Open"]),
  view=() => {
    if_(
      b => b.gap > 0,
      p([cls("px-4 py-2 text-center text-xs opacity-60")], [
        show(b => "· \{plural(b.gap, "quiet day")} ·"),
      ]),
      section([cls("border-b border-base-300/60 px-4 py-3")], [
        h2(
          [
            cls(
              "mb-2 flex items-baseline gap-2 text-xs font-semibold tracking-wide uppercase \{muted}",
            ),
          ],
          [
            span([], [show(b => b.label)]),
            span([cls("font-normal tabular-nums opacity-60")], [
              show(b => b.total.to_string()),
            ]),
          ],
        ),
        div([cls("flex flex-wrap gap-1.5")], [
          each(
            b => b.chips.iter(),
            button(
              [
                cls(
                  "flex items-center gap-0.5 rounded-lg border border-base-300/60 bg-base-100 py-1.5 pr-1.5 pl-2 active:bg-base-200",
                ),
                bind_str("aria-label", it => it.value.aria),
                bind_str("title", it => it.value.tip),
                on_event(Click, (it, _) => Some(Open(it.index))),
              ],
              [
                span([cls("emoji text-xl")], [show(it => it.value.emoji)]),
                span([cls("text-xs \{muted}")], [show(it => it.value.mark)]),
              ],
            ),
          ),
        ]),
      ]),
    )
  },
  update=(b, msg, ctx) => {
    match msg {
      Open(i) =>
        if b.chips.get(i) is Some(chip) {
          ctx.notify(open_chip, {
            thing_id: chip.thing_id,
            start: b.start,
            end: b.end,
            label: b.label,
          })
        }
    }
    b
  },
  invariants=[
    ("the total is never negative", b => b.total >= 0),
    ("gaps are never negative", b => b.gap >= 0),
  ],
)
