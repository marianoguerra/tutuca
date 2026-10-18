// The domain logic of thing-tracker (src/domain, src/transfer), from model.js: pure functions
// over things, groups (tags), events and measurements.

///|
pub let pack_format : String = "thing-tracker/group-pack"

///|
pub let backup_format : String = "thing-tracker/backup"

///|
/// The id of Track's section of the things no tag claims.
pub let ungrouped : String = "__ungrouped__"

///|
/// A measurement a thing records, in its preferred unit.
pub(all) struct MeasureRef {
  kind : MeasureKind
  unit : String
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// A recorded value, in its measurement's base unit. Records from files may name
/// measurements this app doesn't know; they are kept and shown without a value.
pub(all) struct MeasureValue {
  measurement_id : String
  value : Double
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// A logged event: something happened at `actual_at`, recorded at `recorded_at`.
pub(all) struct EventRecord {
  id : String
  thing_id : String
  recorded_at : Double
  actual_at : Double
  measurements : Vec[MeasureValue]
  notes : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

// --- search ----------------------------------------------------------------------------------

///|
/// Lower case without diacritics: JS's toLowerCase, NFD and \p{Diacritic} removal, for the
/// Latin letters and the marks the app's texts use.

///|
pub fn normalize(s : String) -> String {
  trim(fold(s))
}

///|
/// The words of a query, normalized.
pub fn terms(q : String) -> Array[String] {
  normalize(q)
  .split(" ")
  .flat_map(w => w.split("\t"))
  .flat_map(w => w.split("\n"))
  .map(w => w.to_owned())
  .filter(w => w != "")
  .to_array()
}

///|
/// What search reads of a thing.
pub(all) struct Searchable {
  emoji : String
  title : String
  description : String
}

///|
/// All terms must match; an exact emoji query wins outright.
pub fn score_thing(thing : Searchable, raw_query : String) -> Int32 {
  if thing.emoji == trim(raw_query) {
    return 100
  }
  let title = normalize(thing.title)
  let description = normalize(thing.description)
  let mut score = 0
  for part in terms(raw_query) {
    if title == part {
      score += 40
    } else if title.has_prefix(part) {
      score += 25
    } else if title.contains(part) {
      score += 12
    } else if description.contains(part) {
      score += 4
    } else {
      return 0
    }
  }
  score
}

///|
/// The items that match the query, best first.
pub fn[T] filter_by(
  items : Array[T],
  query : String,
  fields : (T) -> Searchable,
) -> Array[T] {
  let scored = items
    .mapi((i, x) => (i, x, score_thing(fields(x), query)))
    .filter(r => r.2 > 0)
  scored.sort_by((a, b) => {
    let c = b.2.compare(a.2)
    if c != 0 {
      c
    } else {
      a.0.compare(b.0)
    }
  })
  scored.map(r => r.1)
}

///|
pub fn filter_things(things : Array[Thing], query : String) -> Array[Thing] {
  filter_by(things, query, Thing::searchable)
}

///|
/// Every term in the joined, normalized fields.
pub fn matches_query(fields : Array[String], query : String) -> Bool {
  let hay = normalize(fields.filter(f => f != "").join(" "))
  terms(query).iter().all(t => hay.contains(t))
}

// --- usage and order --------------------------------------------------------------------------

///|
pub(all) struct Usage {
  total : Int32
  last_at : Double
} derive(Eq, Debug)

///|
/// The usage of each thing id, from its events.
pub fn usage_of(events : Iter[EventRecord]) -> Map[String, Usage] {
  let usage = Map([])
  for e in events {
    let u = usage.get(e.thing_id).unwrap_or({ total: 0, last_at: 0.0, })
    usage[e.thing_id] = {
      total: u.total + 1,
      last_at: if e.actual_at > u.last_at {
        e.actual_at
      } else {
        u.last_at
      },
    }
  }
  usage
}

///|
/// Most used first, then most recent, then by title.
pub fn rank_things(
  things : Array[Thing],
  usage : Map[String, Usage],
) -> Array[String] {
  let none = { total: 0, last_at: 0.0, }
  sorted_by(things, (a, b) => {
    let ua = usage.get(a.id).unwrap_or(none)
    let ub = usage.get(b.id).unwrap_or(none)
    let by_total = ub.total.compare(ua.total)
    if by_total != 0 {
      return by_total
    }
    let by_last = sign(ub.last_at - ua.last_at)
    if by_last != 0 {
      return by_last
    }
    let by_title = locale_compare(a.title, b.title)
    if by_title != 0 {
      return by_title
    }
    a.id.lexical_compare(b.id)
  }).map(t => t.id)
}

///|
/// Things in the frozen order; the ones it doesn't know go last, by title.
pub fn apply_frozen_order(
  things : Array[Thing],
  order : Array[String],
) -> Array[Thing] {
  let at : Map[String, Int32] = Map([])
  for i, id in order {
    if !at.contains(id) {
      at[id] = i
    }
  }
  let known = sorted_by(things.filter(t => at.contains(t.id)), (a, b) => {
    at[a.id].compare(at[b.id])
  })
  let rest = sorted_by(things.filter(t => !at.contains(t.id)), (a, b) => {
    locale_compare(a.title, b.title)
  })
  [..known, ..rest]
}

///|
fn compare_groups(a : Tag, b : Tag) -> Int32 {
  let c = a.sort_order.compare(b.sort_order)
  if c != 0 {
    c
  } else {
    locale_compare(a.title, b.title)
  }
}

///|
pub fn sort_groups(groups : Array[Tag]) -> Array[Tag] {
  sorted_by(groups, compare_groups)
}

///|
/// A section of Track: a tag with visible members, or the ungrouped things.
pub(all) struct Row {
  id : String
  title : String
  emoji : String
  member_ids : Array[String]
} derive(Eq, Debug)

///|
/// Track's sections: each group with visible members, then the things no group claims.
/// `ordered` are the visible things in display order.
pub fn build_rows(groups : Array[Tag], ordered : Array[Thing]) -> Array[Row] {
  let position : Map[String, Int32] = Map([])
  for i, t in ordered {
    position[t.id] = i
  }
  let rows = []
  let claimed : Map[String, Bool] = Map([])
  for g in sort_groups(groups) {
    let members = g.thing_ids
      .iter()
      .filter(id => position.contains(id))
      .to_array()
    for id in members {
      claimed[id] = true
    }
    if members.length() == 0 {
      continue
    }
    let members = sorted_by(members, (a, b) => position[a].compare(position[b]))
    rows.push({ id: g.id, title: g.title, emoji: g.emoji, member_ids: members, })
  }
  let rest = ordered.filter(t => !claimed.contains(t.id)).map(t => t.id)
  if rest.length() > 0 {
    rows.push({
      id: ungrouped,
      title: "Ungrouped",
      emoji: "",
      member_ids: rest,
    })
  }
  rows
}

// --- insights --------------------------------------------------------------------------------

///|
/// How often a thing happened in a bucket.
pub(all) struct ChipCount {
  thing_id : String
  count : Int32
  last_at : Double
} derive(Eq, Debug)

///|
pub(all) struct BucketData {
  key : String
  start : Double
  end : Double
  total : Int32
  chips : Array[ChipCount] // Most counted first.
} derive(Eq, Debug)

///|
/// Buckets newest first, each with its things as chips, most counted first.
pub fn bucket_events(
  events : Array[EventRecord],
  granularity : Granularity,
  tz : Int32,
) -> Array[BucketData] {
  let keys : Array[String] = []
  let starts : Map[String, Double] = Map([])
  let totals : Map[String, Int32] = Map([])
  let chips : Map[String, Array[ChipCount]] = Map([])
  for e in events {
    let key = bucket_key(e.actual_at, granularity, tz)
    if !starts.contains(key) {
      keys.push(key)
      starts[key] = bucket_start(e.actual_at, granularity, tz)
      totals[key] = 0
      chips[key] = []
    }
    let cs = chips[key]
    match cs.search_by(c => c.thing_id == e.thing_id) {
      Some(i) => {
        let c = cs[i]
        cs[i] = {
          ..c,
          count: c.count + 1,
          last_at: if e.actual_at > c.last_at {
            e.actual_at
          } else {
            c.last_at
          },
        }
      }
      None => cs.push({ thing_id: e.thing_id, count: 1, last_at: e.actual_at, })
    }
    totals[key] = totals[key] + 1
  }
  let buckets = keys.map(key => {
    let start = starts[key]
    {
      key,
      start,
      end: bucket_end(start, granularity, tz),
      total: totals[key],
      chips: sorted_by(chips[key], (x, y) => {
        let c = y.count.compare(x.count)
        if c != 0 {
          return c
        }
        let l = sign(y.last_at - x.last_at)
        if l != 0 {
          return l
        }
        x.thing_id.lexical_compare(y.thing_id)
      }),
    }
  })
  sorted_by(buckets, (a, b) => sign(b.start - a.start))
}

///|
/// A day bucket, or the quiet days between two.
pub(all) enum Dated {
  Full(BucketData)
  Gap(Int32)
} derive(Eq, Debug)

///|
/// Day buckets with the gaps between days that aren't adjacent.
pub fn with_gaps(buckets : Array[BucketData]) -> Array[Dated] {
  let out = []
  for i, b in buckets {
    if i > 0 {
      let prev = buckets[i - 1]
      let days = js_round(
          (prev.start + 12.0 * hour - (b.start + 12.0 * hour)) / day,
        ).to_int() -
        1
      if days > 0 {
        out.push(Gap(days))
      }
    }
    out.push(Full(b))
  }
  out
}

///|
let superscript : Array[String] = [
  "⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹",
]

///|
/// The count beside a chip: nothing for one, superscript digits, ×N past 999.
pub fn count_mark(n : Int32) -> String {
  if n <= 1 {
    ""
  } else if n > 999 {
    "×\{n}"
  } else {
    n
    .to_string()
    .iter()
    .map(d => superscript[d.to_int() - '0'.to_int()])
    .join("")
  }
}

///|
/// Past values of a thing's measurement, newest first, all positive.
pub fn measurement_history(
  events : Iter[EventRecord],
  thing_id : String,
  measurement_id : String,
) -> Array[Double] {
  let mine = sorted_by(events.filter(e => e.thing_id == thing_id).to_array(), (
    a,
    b,
  ) => sign(b.actual_at - a.actual_at))
  mine
  .iter()
  .flat_map(e => e.measurements.iter())
  .filter(m => m.measurement_id == measurement_id && m.value > 0.0)
  .map(m => m.value)
  .to_array()
}

// --- bundles ---------------------------------------------------------------------------------

///|
pub(all) struct MeasureDef {
  slug : String
  unit : String
}

///|
pub(all) struct ThingDef {
  slug : String
  emoji : String
  title : String
  measures : Array[MeasureDef]
}

///|
pub(all) struct GroupDef {
  slug : String
  title : String
  emoji : String
  things : Array[ThingDef]
}

///|
pub(all) struct BundleDef {
  slug : String
  title : String
  emoji : String
  description : String
  version : Int32
  groups : Array[GroupDef]
}

///|
/// A bundle as the app lists it, with the pack it loads.
pub(all) struct Bundle {
  id : String
  title : String
  description : String
  emoji : String
  version : Int32
  thing_count : Int32
  group_count : Int32
  things : Array[Thing]
  groups : Array[Tag]
  pack : Json // As a shared file has it.
}

///|
/// A bundle, as the pack it loads.
pub fn bundle_of(def : BundleDef) -> Bundle {
  let things = []
  let thing_json = []
  let groups = def.groups.mapi((sort_order, g) => {
    let ids = g.things.map(t => {
      let id = "thing:\{def.slug}/\{t.slug}"
      let refs = t.measures.filter_map(m => {
        MeasureKind::from_id(m.slug).map(kind => {
          ({ kind, unit: m.unit, } : MeasureRef)
        })
      })
      things.push(
        Thing::new(
          id,
          t.emoji,
          t.title,
          measurements=Vec::of(refs),
          bundle_id=def.slug,
        ),
      )
      thing_json.push(
        Json::object({
          "id": Json(id),
          "emoji": Json(t.emoji),
          "title": Json(t.title),
          "description": Json(""),
          "measurements": Json::array(
            t.measures.map(m => {
              Json::object({
                "measurementId": Json(m.slug),
                "unit": Json(m.unit),
              })
            }),
          ),
          "bundleId": Json(def.slug),
        }),
      )
      id
    })
    Tag::new(
      "group:\{def.slug}/\{g.slug}",
      g.title,
      emoji=g.emoji,
      sort_order~,
      thing_ids=Vec::of(ids),
      bundle_id=def.slug,
    )
  })
  let pack = Json::object({
    "format": Json(pack_format),
    "version": Json::number(1.0),
    "bundle": Json::object({
      "id": Json(def.slug),
      "title": Json(def.title),
      "description": Json(def.description),
      "emoji": Json(def.emoji),
      "version": Json(def.version),
    }),
    "groups": Json::array(groups.map(plain_tag)),
    "things": Json::array(thing_json),
  })
  {
    id: def.slug,
    title: def.title,
    description: def.description,
    emoji: def.emoji,
    version: def.version,
    thing_count: things.length(),
    group_count: groups.length(),
    things,
    groups,
    pack,
  }
}

///|
let bundles_once : @tutuca.Once[Array[Bundle]] = @tutuca.Once::new()

///|
/// The bundles that ship with the app.
pub fn bundles() -> Array[Bundle] {
  bundles_once.get(() => bundle_defs.map(bundle_of))
}

///|
pub fn find_bundle(id : String) -> Bundle? {
  bundles().iter().find_first(b => b.id == id)
}

// --- export ----------------------------------------------------------------------------------

///|
/// The pack sharing groups: their things, and only those.
pub fn build_pack(
  groups : Array[Tag],
  things : Array[Thing],
  now : Double,
) -> Json {
  let ids = groups.iter().flat_map(g => g.thing_ids.iter()).to_array()
  let included = things.filter(t => ids.contains(t.id))
  let known = included.map(t => t.id)
  let narrowed = groups.map(g => {
    ..g,
    thing_ids: g.thing_ids.filter(id => known.contains(id)),
  })
  Json::object({
    "format": Json(pack_format),
    "version": Json::number(1.0),
    "exportedAt": Json(now),
    "groups": Json::array(narrowed.map(plain_tag)),
    "things": Json::array(included.map(plain_thing)),
  })
}

///|
/// The app's data: what backups hold and imports change.
pub(all) struct Snapshot {
  things : Array[Thing]
  groups : Array[Tag]
  events : Array[EventRecord]
} derive(Eq, Debug)

///|
/// The earliest and latest event, if any.
pub fn event_range(events : Array[EventRecord]) -> (Double, Double)? {
  guard events.length() > 0 else { None }
  let mut from = events[0].actual_at
  let mut to = events[0].actual_at
  for e in events {
    if e.actual_at < from {
      from = e.actual_at
    }
    if e.actual_at > to {
      to = e.actual_at
    }
  }
  Some((from, to))
}

///|
pub fn build_backup(data : Snapshot, now : Double) -> Json {
  let range = event_range(data.events)
  Json::object({
    "format": Json(backup_format),
    "version": Json::number(1.0),
    "exportedAt": Json(now),
    "counts": Json::object({
      "things": Json(data.things.length()),
      "groups": Json(data.groups.length()),
      "events": Json(data.events.length()),
      "attachments": Json::number(0.0),
    }),
    "things": Json::array(data.things.map(plain_thing)),
    "groups": Json::array(data.groups.map(plain_tag)),
    "events": Json::array(data.events.map(plain_event)),
    "range": Json::object({
      "from": range.map(r => Json(r.0)).unwrap_or(Json::null()),
      "to": range.map(r => Json(r.1)).unwrap_or(Json::null()),
    }),
  })
}

// --- import ----------------------------------------------------------------------------------

///|
pub(all) enum Format {
  Pack
  Backup
} derive(Eq, Debug)

///|
/// A thing from a file: what it says, laid over a here thing when they share an id.
pub(all) struct IncomingThing {
  id : String
  updated_at : Double
  json : Json
}

///|
/// A Thing Tracker file.
pub(all) struct Envelope {
  format : Format
  version : Double
  bundle_title : String?
  things : Array[IncomingThing]
  groups : Array[Tag]
  events : Array[EventRecord]
}

///|
/// The envelope in text, or the app's message for what's wrong with it.
pub fn parse_envelope(text : String) -> Result[Envelope, String] {
  let data = @json.parse(text) catch {
    _ => return Err("That file isn't JSON.")
  }
  guard data is Object(obj) else {
    Err("That file isn't a Thing Tracker file.")
  }
  let format = match obj.get("format") {
    Some(String(f)) if f == pack_format => Pack
    Some(String(f)) if f == backup_format => Backup
    _ => return Err("That file isn't a Thing Tracker export.")
  }
  let version = match obj.get("version") {
    Some(Number(v, ..)) => v
    _ => 1.0
  }
  if version > 1.0 {
    return Err(
      "That file was made by a newer version of Thing Tracker (format v\{version}). Update the app and try again.",
    )
  }
  let required = match format {
    Pack => ["groups", "things"]
    Backup => ["groups", "things", "events"]
  }
  for key in required {
    guard obj.get(key) is Some(Array(_)) else {
      return Err("That file is damaged: expected an array at \{key}.")
    }
  }
  let array_at = (key : String) => {
    match obj.get(key) {
      Some(Array(xs)) => xs
      _ => []
    }
  }
  let bundle_title = match obj.get("bundle") {
    Some(Object(b)) =>
      match b.get("title") {
        Some(String(t)) => Some(t)
        _ => None
      }
    _ => None
  }
  Ok({
    format,
    version,
    bundle_title,
    things: array_at("things").map(j => {
      id: string_at(j, "id"),
      updated_at: number_at(j, "updatedAt"),
      json: j,
    }),
    groups: array_at("groups").mapi((i, j) => tag_from(j, i)),
    events: array_at("events").map(event_from),
  })
}

///|
pub(all) enum ImportMode {
  MergeMode
  ReplaceMode
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes an import mode.
pub impl ToJson for ImportMode with fn to_json(self) {
  Json::string(
    match self {
      MergeMode => "merge"
      ReplaceMode => "replace"
    },
  )
}

///|
pub impl FromJson for ImportMode with fn from_json(json, path) {
  match json {
    String("merge") => MergeMode
    String("replace") => ReplaceMode
    _ => raise @json.JsonDecodeError((path, "an import mode"))
  }
}

///|
/// Things an import adds to a tag the device already has.
pub(all) struct TagMerge {
  id : String
  title : String
  added : Array[String]
} derive(Eq, Debug)

///|
/// What importing a file changes: the lists to apply, summary lines and warnings, as the
/// import preview shows them.
pub(all) struct Plan {
  new_things : Array[Thing]
  updated_things : Array[Thing]
  unchanged : Int32
  new_groups : Array[Tag]
  merges : Array[TagMerge]
  new_events : Array[EventRecord]
  skipped : Int32
  replace : Bool
  is_noop : Bool
  lines : Array[String]
  warnings : Array[String]
  can_overwrite : Bool
} derive(Eq, Debug)

///|
pub fn plan_import(
  envelope : Envelope,
  current : Snapshot,
  mode~ : ImportMode = MergeMode,
  overwrite~ : Bool = false,
) -> Plan {
  let replace = mode is ReplaceMode && envelope.format is Backup
  let base = if replace {
    { things: [], groups: [], events: [], }
  } else {
    current
  }
  let things : Map[String, Thing] = Map([])
  for t in base.things {
    things[t.id] = t
  }
  let event_ids = base.events.map(e => e.id)
  let new_things = []
  let updated_things = []
  let mut unchanged = 0
  for t in envelope.things {
    match things.get(t.id) {
      None => new_things.push(thing_from(t.json))
      Some(here) =>
        if overwrite || (envelope.format is Backup && t.updated_at > 0.0) { // Local things have no updatedAt.
          updated_things.push(thing_over(here, t.json))
        } else {
          unchanged += 1
        }
    }
  }
  let known = (id : String) => {
    things.contains(id) || new_things.iter().any(t => t.id == id)
  }
  let warnings = []
  let new_groups = []
  let merges = []
  let mut sort_order = -1
  for g in base.groups {
    if g.sort_order > sort_order {
      sort_order = g.sort_order
    }
  }
  for g in envelope.groups {
    let missing = g.thing_ids.filter(id => !known(id)).length()
    if missing > 0 {
      warnings.push(
        "“\{g.title}” refers to \{plural(missing, "thing")} the file doesn't include; they'll be skipped.",
      )
    }
    let members = g.thing_ids.filter(id => known(id))
    match base.groups.iter().find_first(l => l.id == g.id) {
      None => {
        sort_order += 1
        new_groups.push({ ..g, thing_ids: members, sort_order, })
      }
      Some(here) => {
        let added = members
          .iter()
          .filter(id => !here.thing_ids.contains(id))
          .to_array()
        if added.length() > 0 {
          merges.push({ id: g.id, title: here.title, added, })
        }
      }
    }
  }
  let new_events = []
  let mut skipped = 0
  for e in envelope.events {
    if event_ids.contains(e.id) {
      skipped += 1
    } else {
      new_events.push(e)
    }
  }
  if replace {
    warnings.insert(
      0,
      "Replaces everything on this device: \{plural(current.things.length(), "thing")}, \{plural(current.groups.length(), "tag")} and \{plural(current.events.length(), "entry", many="entries")} will be deleted.",
    )
  }
  let lines = []
  let line = (n : Int32, text : String) => if n > 0 { lines.push(text) }
  line(new_things.length(), plural(new_things.length(), "new thing"))
  line(
    updated_things.length(),
    "\{plural(updated_things.length(), "thing")} updated",
  )
  line(unchanged, "\{unchanged} already yours")
  line(new_groups.length(), plural(new_groups.length(), "new tag"))
  for m in merges {
    lines.push("\{plural(m.added.length(), "thing")} added to “\{m.title}”")
  }
  line(
    new_events.length(),
    "\{plural(new_events.length(), "entry", many="entries")} restored",
  )
  line(skipped, "\{plural(skipped, "entry", many="entries")} already present")
  let is_noop = !replace &&
    new_things.length() +
    updated_things.length() +
    new_groups.length() +
    merges.length() +
    new_events.length() ==
    0
  if lines.length() == 0 {
    lines.push("Nothing to change — you already have all of this.")
  }
  {
    new_things,
    updated_things,
    unchanged,
    new_groups,
    merges,
    new_events,
    skipped,
    replace,
    is_noop,
    lines,
    warnings,
    can_overwrite: unchanged > 0 && envelope.format is Pack,
  }
}

///|
/// current with plan applied.
pub fn apply_plan(plan : Plan, current : Snapshot) -> Snapshot {
  let base = if plan.replace {
    { things: [], groups: [], events: [], }
  } else {
    current
  }
  let things = base.things.map(t => {
    plan.updated_things.iter().find_first(u => u.id == t.id).unwrap_or(t)
  })
  let groups = base.groups.map(g => {
    match plan.merges.iter().find_first(m => m.id == g.id) {
      Some(m) => { ..g, thing_ids: g.thing_ids.concat(Vec::of(m.added)), }
      None => g
    }
  })
  {
    things: [..things, ..plan.new_things],
    groups: [..groups, ..plan.new_groups],
    events: [..base.events, ..plan.new_events],
  }
}

///|
pub fn imported_text(plan : Plan) -> String {
  let parts = []
  if plan.new_things.length() > 0 {
    parts.push(plural(plan.new_things.length(), "thing"))
  }
  if plan.new_groups.length() > 0 {
    parts.push(plural(plan.new_groups.length(), "tag"))
  }
  if plan.new_events.length() > 0 {
    parts.push(plural(plan.new_events.length(), "entry", many="entries"))
  }
  if parts.length() == 0 {
    "Everything was already here."
  } else {
    "Added \{parts.join(", ")}."
  }
}

///|
/// A file name part: lower case letters and digits joined by dashes.
pub fn slugify(s : String) -> String {
  let sb = StringBuilder()
  let mut dash = false
  for c in normalize(s) {
    if c is ('a'..<='z' | '0'..<='9') {
      if dash && sb.to_string() != "" {
        sb.write_char('-')
      }
      dash = false
      sb.write_char(c)
    } else {
      dash = true
    }
  }
  let slug = prefix(sb.to_string(), 40)
  if slug == "" {
    "untitled"
  } else {
    slug
  }
}
