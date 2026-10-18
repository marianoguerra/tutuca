// What the todo components share: colors, nav styles and list helpers.

///|
pub(all) enum Color {
  Grey
  Red
  Orange
  Green
  Blue
  Violet
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS names the colors: "grey", "red", ….
pub impl ToJson for Color with fn to_json(self) {
  Json::string(self.name())
}

///|
pub impl FromJson for Color with fn from_json(json, path) {
  for c in colors {
    if json == Json::string(c.name()) {
      return c
    }
  }
  raise @json.JsonDecodeError((path, "a color"))
}

///|
pub impl Default for Color with fn default() {
  Grey
}

///|
let colors : Array[Color] = [Grey, Red, Orange, Green, Blue, Violet]

///|
pub fn Color::name(self : Color) -> String {
  match self {
    Grey => "grey"
    Red => "red"
    Orange => "orange"
    Green => "green"
    Blue => "blue"
    Violet => "violet"
  }
}

///|
pub fn Color::from_name(name : String) -> Color? {
  colors.iter().find_first(c => c.name() == name)
}

///|
fn Color::bg(self : Color) -> String {
  match self {
    Grey => "bg-neutral"
    Red => "bg-error"
    Orange => "bg-warning"
    Green => "bg-success"
    Blue => "bg-info"
    Violet => "bg-secondary"
  }
}

///|
fn check_class(priority : Int32) -> String {
  match priority {
    1 => "checkbox checkbox-sm checkbox-error rounded-full"
    2 => "checkbox checkbox-sm checkbox-warning rounded-full"
    3 => "checkbox checkbox-sm checkbox-info rounded-full"
    _ => "checkbox checkbox-sm rounded-full"
  }
}

///|
fn tone_class(tone : Tone) -> String {
  match tone {
    Overdue => "text-error"
    DueToday => "text-success"
    Tomorrow => "text-warning"
    Week => "text-secondary"
    Later => "text-base-content/60"
    NoTone => ""
  }
}

///|
let nav : String = "btn btn-sm btn-ghost w-full justify-start font-normal"

///|
let nav_active : String = "\{nav} btn-active"

///|
let icon_btn : String = "btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-70 hover:opacity-100 focus:opacity-100"

///|
/// The words of a text split on spaces and commas.
fn words_of(text : String, commas~ : Bool = false) -> Array[String] {
  let out = []
  let word = StringBuilder()
  for c in text {
    if c is (' ' | '\t' | '\n') || (commas && c == ',') {
      if word.to_string() != "" {
        out.push(word.to_string())
      }
      word.reset()
    } else {
      word.write_char(c)
    }
  }
  if word.to_string() != "" {
    out.push(word.to_string())
  }
  out
}

///|
/// The labels in a text like "@home, work": lowercase, without @, each once.
pub fn labels_of(text : String) -> Vec[String] {
  let out = []
  for w in words_of(text, commas=true) {
    let l = (match w.strip_prefix("@") {
      Some(rest) => rest.to_owned()
      None => w
    }).to_lower()
    if l != "" && !out.contains(l) {
      out.push(l)
    }
  }
  Vec::of(out)
}

///|
/// The index of the next item after i in direction delta that passes keep.
fn[T] neighbor(
  items : Vec[T],
  i : Int32,
  delta : Int32,
  keep : (T) -> Bool,
) -> Int32? {
  let mut j = i + delta
  while j >= 0 && j < items.length() {
    if keep(items[j]) {
      return Some(j)
    }
    j += delta
  }
  None
}

///|
fn trim(s : String) -> String {
  s.trim().to_owned()
}
