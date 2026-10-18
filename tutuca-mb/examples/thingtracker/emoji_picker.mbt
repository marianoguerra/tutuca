// Picks an emoji by category or search, with the recently used first. From emoji-picker.js.

///|
pub(all) enum Category {
  Common
  FoodDrink
  Health
  Activity
  Rest
  Mood
  Focus
  Home
  NaturePets
  Places
  Social
  Money
  Symbols
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes an emoji category.
pub impl ToJson for Category with fn to_json(self) {
  Json::string(
    match self {
      Common => "Common"
      FoodDrink => "Food & drink"
      Health => "Health"
      Activity => "Activity"
      Rest => "Rest"
      Mood => "Mood"
      Focus => "Focus"
      Home => "Home"
      NaturePets => "Nature & pets"
      Places => "Places"
      Social => "Social"
      Money => "Money"
      Symbols => "Symbols"
    },
  )
}

///|
pub impl FromJson for Category with fn from_json(json, path) {
  match json {
    String("Common") => Common
    String("Food & drink") => FoodDrink
    String("Health") => Health
    String("Activity") => Activity
    String("Rest") => Rest
    String("Mood") => Mood
    String("Focus") => Focus
    String("Home") => Home
    String("Nature & pets") => NaturePets
    String("Places") => Places
    String("Social") => Social
    String("Money") => Money
    String("Symbols") => Symbols
    _ => raise @json.JsonDecodeError((path, "an emoji category"))
  }
}

///|
pub impl Default for Category with fn default() {
  Common
}

///|
/// The picker's categories, Common (the whole palette) first.
pub let categories : Array[Category] = [
  Common,
  FoodDrink,
  Health,
  Activity,
  Rest,
  Mood,
  Focus,
  Home,
  NaturePets,
  Places,
  Social,
  Money,
  Symbols,
]

///|
pub fn Category::name(self : Category) -> String {
  match self {
    Common => "Common"
    FoodDrink => "Food & drink"
    Health => "Health"
    Activity => "Activity"
    Rest => "Rest"
    Mood => "Mood"
    Focus => "Focus"
    Home => "Home"
    NaturePets => "Nature & pets"
    Places => "Places"
    Social => "Social"
    Money => "Money"
    Symbols => "Symbols"
  }
}

///|
/// An emoji of the palette.
pub(all) struct Emoji {
  glyph : String
  name : String
  category : Category
  keywords : Array[String]
}

///|
fn emoji(
  glyph : String,
  name : String,
  category : Category,
  keywords : Array[String],
) -> Emoji {
  { glyph, name, category, keywords, }
}

///|
/// The icon of a category chip: its first emoji, a star for Common.
fn Category::icon(self : Category) -> String {
  match self {
    Common => "⭐"
    c =>
      emoji_palette
      .iter()
      .find_first(e => e.category == c)
      .map(e => e.glyph)
      .unwrap_or("")
  }
}

///|
let max_results : Int32 = 300

///|
pub(all) struct EmojiPicker {
  query : String
  category : Category
  value : String
  recent : Vec[String]
  paste : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn EmojiPicker::new(value~ : String = "") -> EmojiPicker {
  { query: "", category: Common, value, recent: Vec::new(), paste: "", }
}

///|
pub impl Default for EmojiPicker with fn default() {
  EmojiPicker::new()
}

///|
pub(all) enum PickerMsg {
  SetQuery(String)
  SetCategory(Category)
  Pick(String)
  Pasted(String)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent with the emoji picked or pasted.
pub let emoji_picked : Signal[String] = Signal::new("emojiPicked")

///|
pub fn EmojiPicker::is_searching(self : EmojiPicker) -> Bool {
  trim(self.query) != ""
}

///|
/// The emoji of the category, or the ones that match the search, best first.
pub fn EmojiPicker::matches(self : EmojiPicker) -> Array[Emoji] {
  if !self.is_searching() {
    return match self.category {
      Common => emoji_palette
      c => emoji_palette.filter(e => e.category == c)
    }
  }
  let qs = terms(self.query)
  // A query of marks only has no terms: everything matches, unscored, as in JS.
  let first = qs.get(0)
  let found = emoji_palette.filter(e => {
    let hay = normalize([e.name, e.category.name(), ..e.keywords].join(" "))
    qs.iter().all(q => hay.contains(q))
  })
  let scored = found.map(e => {
    let name = normalize(e.name)
    let score = match first {
      Some(first) if name == first => 40
      Some(first) if name.has_prefix(first) => 30
      Some(first) if name.contains(first) => 20
      _ => 10
    }
    (e, score + 5)
  })
  sorted_by(scored, (a, b) => {
    let c = b.1.compare(a.1)
    if c != 0 {
      c
    } else {
      locale_compare(a.0.name, b.0.name)
    }
  }).map(r => r.0)
}

///|
priv struct Cell {
  glyph : String
  name : String
  cls : String
}

///|
fn EmojiPicker::cell(self : EmojiPicker, glyph : String, name : String) -> Cell {
  {
    glyph,
    name,
    cls: if glyph == self.value {
      "emoji aspect-square rounded-md text-xl bg-primary/15 ring-2 ring-primary"
    } else {
      "emoji aspect-square rounded-md text-xl hover:bg-base-200"
    },
  }
}

///|
/// What the picker shows: worked out once a render.
priv struct PickerBinds {
  results : Array[Cell]
  is_empty : Bool
  is_capped : Bool
  cap_text : String
}

///|
fn EmojiPicker::binds(self : EmojiPicker) -> PickerBinds {
  let matches = self.matches()
  let shown = if matches.length() > max_results {
    matches[:max_results].to_owned()
  } else {
    matches
  }
  {
    results: shown.map(e => self.cell(e.glyph, e.name)),
    is_empty: matches.length() == 0,
    is_capped: matches.length() > max_results,
    cap_text: "Showing \{max_results} of \{matches.length()}. Keep typing to narrow it down.",
  }
}

///|
fn cell_button() -> ViewAt[
  Item[@tutuca.With[EmojiPicker, PickerBinds], Cell],
  EmojiPicker,
  PickerMsg,
] {
  button(
    [
      class_(it => it.value.cls),
      bind_str("title", it => it.value.name),
      bind_str("value", it => it.value.glyph),
      on_event(Click, (it, _) => Some(Pick(it.value.glyph))),
    ],
    [show(it => it.value.glyph)],
  )
}

///|
fn EmojiPicker::view() -> View[EmojiPicker, PickerMsg] {
  scope(
    s => s.binds(),
    div([cls("flex min-h-0 max-h-[45vh] flex-col gap-3")], [
      input([
        attr("type", "search"),
        cls("input input-sm w-full"),
        attr("placeholder", "Search emoji…"),
        aria("label", "Search emoji"),
        value(w => w.up.query),
        on_input(v => SetQuery(v)),
      ]),
      when(
        w => !w.up.is_searching(),
        div([cls("flex flex-wrap justify-center gap-1")], [
          each(
            w => categories.iter().map(c => (c, w.up.category == c)),
            button(
              [
                class_(it => {
                  if it.value.1 {
                    "emoji size-9 rounded-lg text-lg bg-primary/20 ring-2 ring-primary"
                  } else {
                    "emoji size-9 rounded-lg text-lg hover:bg-base-200"
                  }
                }),
                bind_str("title", it => it.value.0.name()),
                bind_str("aria-label", it => it.value.0.name()),
                bind_str("value", it => it.value.0.name()),
                on_event(Click, (it, _) => Some(SetCategory(it.value.0))),
              ],
              [show(it => it.value.0.icon())],
            ),
          ),
        ]),
      ),
      when(
        w => !w.up.is_searching() && w.up.recent.length() > 0,
        div([], [
          h3([cls("mb-1 text-xs \{muted}")], [txt("Recent")]),
          div([cls("grid grid-cols-8 gap-1")], [
            each(
              w => w.up.recent.iter().map(g => w.up.cell(g, g)),
              cell_button(),
            ),
          ]),
        ]),
      ),
      div([cls("min-h-0 flex-1 overflow-y-auto")], [
        if_(
          w => w.value.is_empty,
          p([cls("py-4 text-center text-sm \{muted}")], [
            show(w => {
              "Nothing matches “\{trim(w.up.query)}”. Paste any emoji below instead."
            }),
          ]),
          div([cls("grid grid-cols-8 gap-1")], [
            each(w => w.value.results.iter(), cell_button()),
          ]),
        ),
        when(
          w => w.value.is_capped,
          p([cls("py-2 text-center text-xs \{muted}")], [
            show(w => w.value.cap_text),
          ]),
        ),
      ]),
      label([cls("flex items-center gap-2 text-sm")], [
        txt("Or paste any emoji"),
        input([
          cls("input input-sm w-20 text-center text-lg"),
          attr("maxlength", "16"),
          attr("placeholder", "🦆"),
          aria("label", "Paste an emoji"),
          value(w => w.up.paste),
          on_input(v => Pasted(v)),
        ]),
      ]),
    ]),
  )
}

///|
fn EmojiPicker::update(
  self : EmojiPicker,
  msg : PickerMsg,
  ctx : Ctx[EmojiPicker, PickerMsg],
) -> EmojiPicker {
  match msg {
    SetQuery(query) => { ..self, query, }
    SetCategory(category) => { ..self, category, }
    Pick(glyph) => {
      if glyph == "" {
        return self
      }
      let others = self.recent.filter(c => c != glyph).to_array()
      let recent = [glyph, ..others]
      let recent = if recent.length() > 16 {
        recent[:16].to_owned()
      } else {
        recent
      }
      ctx.notify(emoji_picked, glyph)
      { ..self, value: glyph, recent: Vec::of(recent), }
    }
    Pasted(text) => {
      let glyph = trim(text)
      if glyph == "" || glyph.length() > 16 {
        return { ..self, paste: text, }
      }
      ctx.notify(emoji_picked, glyph)
      { ..self, paste: text, value: glyph, }
    }
  }
}

///|
pub let emoji_picker : Component[EmojiPicker, PickerMsg] = component(
  "EmojiPicker",
  fields=[
    @tutuca.field_info("query", Text, initial=""),
    @tutuca.field_info(
      "category",
      OneOf([
        "Common", "Food & drink", "Health", "Activity", "Rest", "Mood", "Focus",
        "Home", "Nature & pets", "Places", "Social", "Money", "Symbols",
      ]),
      initial="Common",
    ),
    @tutuca.field_info("value", Text, initial=""),
    @tutuca.field_info(
      "recent",
      ListOf(Text),
      constraints=[MaxLength(16)],
      initial=[],
      checks=["at most 16 recent emoji"],
    ),
    @tutuca.field_info("paste", Text, initial=""),
  ],
  messages=@tutuca.json_messages(["SetQuery", "SetCategory", "Pick", "Pasted"]),
  view=EmojiPicker::view,
  update=EmojiPicker::update,
  invariants=[("at most 16 recent emoji", s => s.recent.length() <= 16)],
)
