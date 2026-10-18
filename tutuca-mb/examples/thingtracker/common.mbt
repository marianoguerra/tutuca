// What the tracker's components share: its look (after shadcn's zinc theme in daisyUI terms),
// small helpers, and the app's intervals and tabs. From common.js.

///|
let muted : String = "text-base-content/60"

///|
let sticky : String = "sticky top-0 z-20 border-b border-base-300 bg-base-100/85 px-4 py-2.5 backdrop-blur-lg"

///|
let pill : String = "rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0"

///|
let seg_class : String = "flex rounded-lg bg-base-200 p-0.5 text-sm font-medium"

///|
let icon_toggle : String = "flex size-9 shrink-0 items-center justify-center rounded-md border"

///|
let banner : String = "mx-4 mt-3 rounded-lg border border-base-300 bg-base-200/40 p-3 text-xs"

///|
let link : String = "underline underline-offset-2 cursor-pointer"

///|
/// A filter chip, on or off.
fn pick(on : Bool) -> String {
  if on {
    "\{pill} border-transparent bg-primary text-primary-content"
  } else {
    "\{pill} border-base-300 \{muted}"
  }
}

///|
/// A segment of a segmented control, on or off.
fn seg(on : Bool) -> String {
  if on {
    "flex-1 rounded-md px-1.5 py-1.5 text-xs sm:text-sm bg-base-100 shadow-sm"
  } else {
    "flex-1 rounded-md px-1.5 py-1.5 text-xs sm:text-sm \{muted}"
  }
}

///|
/// The backup reminder intervals, in days (0 is never), with their chip text.
pub let intervals : Array[(Int32, String)] = [
  (1, "day"),
  (3, "3d"),
  (7, "week"),
  (14, "14d"),
  (30, "month"),
  (90, "90d"),
  (0, "never"),
]

///|
pub(all) enum Tab {
  Track
  Insights
  Manage
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes a tab.
pub impl ToJson for Tab with fn to_json(self) {
  Json::string(
    match self {
      Track => "track"
      Insights => "insights"
      Manage => "manage"
    },
  )
}

///|
pub impl FromJson for Tab with fn from_json(json, path) {
  match json {
    String("track") => Track
    String("insights") => Insights
    String("manage") => Manage
    _ => raise @json.JsonDecodeError((path, "a tab"))
  }
}

///|
let tabs : Array[(Tab, String, String)] = [
  (Track, "⚡", "Track"),
  (Insights, "🗓", "Insights"),
  (Manage, "⚙", "Manage"),
]

///|
pub(all) enum ManageTab {
  Things
  Groups
  Units
  Bundles
  Data
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes a manage tab.
pub impl ToJson for ManageTab with fn to_json(self) {
  Json::string(
    match self {
      Things => "things"
      Groups => "groups"
      Units => "units"
      Bundles => "bundles"
      Data => "data"
    },
  )
}

///|
pub impl FromJson for ManageTab with fn from_json(json, path) {
  match json {
    String("things") => Things
    String("groups") => Groups
    String("units") => Units
    String("bundles") => Bundles
    String("data") => Data
    _ => raise @json.JsonDecodeError((path, "a manage tab"))
  }
}

///|
let manage_tabs : Array[(ManageTab, String)] = [
  (Things, "Things"),
  (Groups, "Tags"),
  (Units, "Units"),
  (Bundles, "Bundles"),
  (Data, "Data"),
]

///|
/// A tab's id, its button's value, as JS's.
fn tab_id(t : Tab) -> String {
  match t {
    Track => "track"
    Insights => "insights"
    Manage => "manage"
  }
}

///|
fn manage_tab_id(t : ManageTab) -> String {
  match t {
    Things => "things"
    Groups => "groups"
    Units => "units"
    Bundles => "bundles"
    Data => "data"
  }
}

///|
/// Whether an editor creates something or edits what exists.
pub(all) enum Mode {
  Create
  Edit
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes a mode.
pub impl ToJson for Mode with fn to_json(self) {
  Json::string(
    match self {
      Create => "create"
      Edit => "edit"
    },
  )
}

///|
pub impl FromJson for Mode with fn from_json(json, path) {
  match json {
    String("create") => Create
    String("edit") => Edit
    _ => raise @json.JsonDecodeError((path, "a mode"))
  }
}

///|
fn trim(s : String) -> String {
  s.trim().to_owned()
}

///|
/// "1 thing", "2 things"; `many` for irregular plurals.
pub fn plural(n : Int32, one : String, many? : String) -> String {
  let many = many.unwrap_or("\{one}s")
  "\{n} \{if n == 1 { one } else { many }}"
}

///|
/// The first `n` UTF-16 units of s, as JS's slice(0, n).
fn prefix(s : String, n : Int32) -> String {
  if s.length() <= n {
    s
  } else {
    s.view(end_offset=n).to_owned()
  }
}

///|
/// JS's Math.round: halves go up.
fn js_round(x : Double) -> Double {
  (x + 0.5).floor()
}

///|
/// What JS's Number.parseFloat makes of a string: the longest number it starts with.
fn parse_float(text : String) -> Double? {
  let cs = trim(text).to_array()
  let mut i = 0
  if i < cs.length() && cs[i] is ('+' | '-') {
    i += 1
  }
  let digits_start = i
  while i < cs.length() && cs[i] is ('0'..<='9') {
    i += 1
  }
  let mut digits = i - digits_start
  if i < cs.length() && cs[i] == '.' {
    let dot = i
    i += 1
    let frac_start = i
    while i < cs.length() && cs[i] is ('0'..<='9') {
      i += 1
    }
    digits += i - frac_start
    if i - frac_start == 0 && digits == 0 {
      i = dot
    }
  }
  if digits == 0 {
    return None
  }
  if i < cs.length() && cs[i] is ('e' | 'E') {
    let mut j = i + 1
    if j < cs.length() && cs[j] is ('+' | '-') {
      j += 1
    }
    let exp_start = j
    while j < cs.length() && cs[j] is ('0'..<='9') {
      j += 1
    }
    if j > exp_start {
      i = j
    }
  }
  let mut text = String::from_array(cs[:i])
  if text.has_suffix(".") {
    text = text + "0"
  }
  if text.has_prefix(".") || text.has_prefix("-.") || text.has_prefix("+.") {
    text = text.replace(old=".", new="0.")
  }
  try @string.parse_double(text) catch {
    _ => None
  } noraise {
    v => Some(v)
  }
}

///|
/// xs sorted by cmp, keeping the order of ties, as JS's sort does.
fn[T] sorted_by(xs : Array[T], cmp : (T, T) -> Int32) -> Array[T] {
  let indexed = xs.mapi((i, x) => (i, x))
  indexed.sort_by((a, b) => {
    let c = cmp(a.1, b.1)
    if c != 0 {
      c
    } else {
      a.0.compare(b.0)
    }
  })
  indexed.map(e => e.1)
}

///|
fn sign(x : Double) -> Int32 {
  if x < 0.0 {
    -1
  } else if x > 0.0 {
    1
  } else {
    0
  }
}
