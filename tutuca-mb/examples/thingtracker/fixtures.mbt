// Sample tracker apps for stories, tests and the demo, from fixtures.js.

///|
/// Stories run at a fixed time, in UTC, so labels don't change from run to run: Friday 16 Oct
/// 2026, 10:30.
pub let fixture_now : Double = utc(2026, 9, 16, h=10, mi=30)

///|
/// A thing id of the habits bundle.
pub fn habit(slug : String) -> String {
  "thing:habits/\{slug}"
}

///|
pub fn drink(slug : String) -> String {
  "thing:hydration/\{slug}"
}

///|
pub fn mood(slug : String) -> String {
  "thing:mood/\{slug}"
}

///|
pub fn km(n : Double) -> MeasureValue {
  { measurement_id: "distance", value: n * 1000.0, }
}

///|
pub fn minutes(n : Double) -> MeasureValue {
  { measurement_id: "duration", value: n * minute, }
}

///|
pub fn ml(n : Double) -> MeasureValue {
  { measurement_id: "volume", value: n, }
}

///|
/// An event of a sample app: its thing, how long before now it happened (and was recorded,
/// when that differs), its values and notes.
pub(all) struct EventSpec {
  thing : String
  ago : Double
  recorded_ago : Double?
  measurements : Array[MeasureValue]
  notes : String
}

///|
pub fn ev(
  thing : String,
  ago : Double,
  recorded_ago? : Double,
  measurements~ : Array[MeasureValue] = [],
  notes~ : String = "",
) -> EventSpec {
  { thing, ago, recorded_ago, measurements, notes, }
}

///|
/// An app at `now` with the things and tags of `bundles` (slugs) and `events`, with what it
/// derives already worked out.
pub fn tracker_app_of(
  now : Double,
  tz~ : Int32 = 0,
  bundles~ : Array[String] = [],
  events~ : Array[EventSpec] = [],
) -> TrackerApp {
  let things : Array[Thing] = []
  let groups : Array[Tag] = []
  for slug in bundles {
    guard find_bundle(slug) is Some(b) else { continue }
    for t in b.things {
      match things.search_by(x => x.id == t.id) {
        Some(i) => things[i] = t
        None => things.push(t)
      }
    }
    for g in b.groups {
      match groups.search_by(x => x.id == g.id) {
        Some(i) => groups[i] = g
        None => groups.push(g)
      }
    }
  }
  let made = events.mapi((i, e) => {
    id: "event-\{i + 1}",
    thing_id: e.thing,
    recorded_at: now - e.recorded_ago.unwrap_or(e.ago),
    actual_at: now - e.ago,
    measurements: Vec::of(e.measurements),
    notes: e.notes,
  })
  let visible = things.filter(t => !t.archived)
  {
    ..TrackerApp::new(now, tz~),
    things: Vec::of(things),
    groups: Vec::of(groups),
    events: Vec::of(made),
    order: Vec::of(rank_things(visible, usage_of(made.iter()))),
    next_id: made.length() + 1,
  }.refresh()
}

///|
/// A week of logging, with gaps.
fn week() -> Array[EventSpec] {
  [
    ev(drink("coffee"), 2.0 * hour),
    ev(drink("coffee"), 4.0 * hour),
    ev(drink("water"), 3.0 * hour, measurements=[ml(500.0)]),
    ev(drink("water"), day + hour, measurements=[ml(250.0)]),
    ev(
      habit("run"),
      day + 2.0 * hour,
      measurements=[km(5.0), minutes(28.0)],
      notes="Felt great",
    ),
    ev(habit("run"), 3.0 * day, measurements=[km(8.0), minutes(45.0)]),
    ev(habit("breakfast"), 3.0 * day + hour),
    ev(habit("read"), 6.0 * day, recorded_ago=5.0 * day),
    ev(habit("nap"), 20.0 * day, measurements=[minutes(20.0)]),
  ]
}

///|
/// The week at fixture_now, with habits and hydration.
pub fn sample_app() -> TrackerApp {
  tracker_app_of(fixture_now, bundles=["habits", "hydration"], events=week())
}

///|
/// Three weeks of logging, so insights by day, week and month have something to show.
pub fn three_weeks() -> Array[EventSpec] {
  let events = []
  let moods = ["great", "happy", "calm", "okay", "tired"]
  for d in 0..<21 {
    let at = (hours : Double) => d.to_double() * day + hours * hour
    events.push(ev(drink("coffee"), at(2.0)))
    if d % 2 == 0 {
      events.push(ev(drink("coffee"), at(6.0)))
    }
    events.push(
      ev(drink("water"), at(3.0), measurements=[
        ml((250 + d % 3 * 250).to_double()),
      ]),
    )
    if d % 3 == 0 {
      events.push(
        ev(habit("run"), at(9.0), measurements=[
          km((4 + d % 5).to_double()),
          minutes((25 + d % 5 * 5).to_double()),
        ]),
      )
    }
    if d % 4 == 1 {
      events.push(ev(habit("read"), at(13.0)))
    }
    if d % 7 == 5 {
      events.push(ev(habit("nap"), at(5.0), measurements=[minutes(20.0)]))
    }
    events.push(ev(mood(moods[d % 5]), at(4.0)))
  }
  events.push(
    ev(
      habit("run"),
      day + hour,
      measurements=[km(5.0), minutes(28.0)],
      notes="Felt great",
    ),
  )
  events
}

///|
/// The demo's app: habits, hydration and mood with three weeks of logging.
pub fn demo_app(now : Double, tz~ : Int32 = 0) -> TrackerApp {
  tracker_app_of(
    now,
    tz~,
    bundles=["habits", "hydration", "mood"],
    events=three_weeks(),
  )
}

///|
fn pick_index(rs : @splitmix.RandomState, n : Int32) -> Int32 {
  rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
}

///|
/// A generated app: some bundles and events among their things, at some time.
pub fn generate_app(rs : @splitmix.RandomState, _size : Int32) -> TrackerApp {
  let ids = bundles().map(b => b.id)
  let chosen = ids.filter(_ => pick_index(rs, 3) == 0)
  let chosen = if chosen.length() > 3 { chosen[:3].to_owned() } else { chosen }
  let from = utc(2025, 0, 1)
  let to = utc(2027, 0, 1)
  let now = (from + rs.next_double() * (to - from)).floor()
  let tz = [0, 60, -180, 330][pick_index(rs, 4)]
  let things = bundles()
    .filter(b => chosen.contains(b.id))
    .iter()
    .flat_map(b => b.things.iter())
    .to_array()
  let n = pick_index(rs, 13)
  let events = if things.length() == 0 {
    []
  } else {
    Array::makei(n, _ => {
      ev(
        things[pick_index(rs, things.length())].id,
        (rs.next_double() * 40.0 * day).floor(),
      )
    })
  }
  let app = tracker_app_of(now, tz~, bundles=chosen, events~)
  {
    ..app,
    compact: pick_index(rs, 2) == 0,
    granularity: [Day, Week, Month][pick_index(rs, 3)],
  }.refresh()
}
