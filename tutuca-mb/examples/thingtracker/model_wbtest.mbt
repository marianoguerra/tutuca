// The cases of test/components/thing-tracker.test.js: time, measurements, search, rows,
// buckets and imports.

///|
test "relative times and bucket labels" {
  let now = fixture_now
  assert_eq(
    [10000.0, 5.0 * 60000.0, 3.0 * hour, day + hour, 3.0 * day, 9.0 * day].map(ago => {
      format_relative(now - ago, now, 0)
    }),
    ["just now", "5m ago", "3h ago", "yesterday", "3d ago", "7 Oct"],
  )
  let in_day = now % day
  assert_eq(
    format_bucket_label(now - 2.0 * hour - in_day, Day, now, 0),
    "Today",
  )
  assert_eq(format_bucket_label(now - day - in_day, Day, now, 0), "Yesterday")
  assert_eq(
    format_bucket_label(start_of_iso_week(now, 0), Week, now, 0),
    "12 – 18 Oct",
  )
  assert_eq(format_bucket_label(now, Month, now, 0), "October 2026")
  assert_eq(iso_week_key(now, 0), "2026-W42")
}

///|
test "time zones shift days, and datetime-local round trips" {
  let late = utc(2026, 9, 16, h=23, mi=30)
  assert_eq(format_bucket_label(late - late % day, Day, late, 0), "Today")
  assert_eq(to_datetime_local(late, 120), "2026-10-17T01:30")
  let zones = [0, 60, -300, 330]
  @testing.check_property("datetime-local round trips", (rs, _) => {
    let ts = (rs.next_double() * 4.0e12).floor()
    let tz = zones[rs.next_uint(limit=4).reinterpret_as_int()]
    let minute_ts = ts - ts % 60000.0
    let back = from_datetime_local(to_datetime_local(minute_ts, tz), tz)
    if back != Some(minute_ts) {
      raise @testing.Broke(
        "\{minute_ts} at \{tz} came back as \{@debug.to_string(back)}",
      )
    }
  })
  assert_eq(from_datetime_local("not a date", 0), None)
  assert_eq(
    from_datetime_local("2026-10-15T07:00", 0),
    Some(utc(2026, 9, 15, h=7)),
  )
  assert_eq(
    from_datetime_local("2026-10-15T07:00:30", 60),
    Some(utc(2026, 9, 15, h=6, s=30)),
  )
}

///|
test "calendar helpers agree with Date" {
  // Wednesday 1 Jan 2025, a leap day and a year end.
  assert_eq(day_key(utc(2025, 0, 1), 0), "2025-01-01")
  assert_eq(day_key(utc(2024, 1, 29, h=12), 0), "2024-02-29")
  assert_eq(iso_week_key(utc(2024, 11, 30), 0), "2025-W01")
  assert_eq(iso_week_key(utc(2027, 0, 1), 0), "2026-W53")
  assert_eq(format_date(utc(2025, 0, 1), 0, now=fixture_now), "Wed 1 Jan 2025")
  assert_eq(start_of_month(fixture_now, 0), utc(2026, 9, 1))
  assert_eq(bucket_end(utc(2026, 11, 1), Month, 0), utc(2027, 0, 1))
  assert_eq(days_ago(fixture_now - 3.0 * day, fixture_now), "3 days ago")
}

///|
test "measurements convert and format" {
  let temp = Temperature.measurement()
  let f = temp.find_unit("f").unwrap()
  assert_true((to_base(212.0, f) - 100.0).abs() < 1.0e-9)
  assert_eq(format_measurement(temp, 37.0, unit="f"), "98.6°F")
  assert_eq(
    [0.0, 90000.0, 4.0 * 60000.0 + 30000.0, 95.0 * 60000.0, 26.0 * hour].map(
      format_duration_ms,
    ),
    ["0m", "1m 30s", "4m 30s", "1h 35m", "1d 2h"],
  )
  @testing.check_property("units round trip", (rs, _) => {
    let m = measurements[rs
      .next_uint(limit=measurements.length().reinterpret_as_uint())
      .reinterpret_as_int()]
    let v = rs.next_double() * 1.0e6
    for u in m.units {
      let back = from_base(to_base(v, u), u)
      if (back - v).abs() >= 1.0e-6 * (if v > 1.0 { v } else { 1.0 }) {
        raise @testing.Broke(
          "\{m.name} in \{u.id}: \{v} came back as \{@debug.to_string(back)}",
        )
      }
    }
  })
}

///|
fn searchable(
  id : String,
  emoji : String,
  title : String,
  description : String,
) -> Thing {
  Thing::new(id, emoji, title, description~)
}

///|
test "search ranks titles over descriptions and needs every term" {
  let things = [
    searchable("a", "☕", "Coffee", ""),
    searchable("b", "🍵", "Tea", "not coffee"),
    searchable("c", "🥤", "Iced coffee", ""),
  ]
  assert_eq(filter_things(things, "coffee").map(t => t.id), ["a", "c", "b"])
  assert_eq(filter_things(things, "iced coffee").map(t => t.id), ["c"])
  assert_eq(filter_things(things, "🍵").map(t => t.id), ["b"])
  // Accents and case don't matter.
  assert_eq(
    filter_things([searchable("d", "☕", "Café", "")], "CAFE").map(t => t.id),
    ["d"],
  )
}

///|
test "rows: tags in order, then the ungrouped" {
  let things = ["a", "b", "c"].map(id => Thing::new(id, "⭐", id))
  let groups = [
    Tag::new("g2", "B", sort_order=1, thing_ids=Vec::of(["b"])),
    Tag::new("g1", "A", sort_order=0, thing_ids=Vec::of(["c", "a", "gone"])),
    Tag::new("g3", "Empty", sort_order=2),
  ]
  assert_eq(build_rows(groups, things).map(r => (r.id, r.member_ids)), [
    ("g1", ["a", "c"]),
    ("g2", ["b"]),
  ])
  assert_eq(build_rows([], things).map(r => r.title), ["Ungrouped"])
}

///|
fn at(thing_id : String, actual_at : Double) -> EventRecord {
  {
    id: "",
    thing_id,
    recorded_at: actual_at,
    actual_at,
    measurements: Vec::new(),
    notes: "",
  }
}

///|
test "buckets count per thing and leave gaps between days" {
  let now = fixture_now
  let events = [
    at("a", now),
    at("a", now - hour),
    at("b", now - 2.0 * hour),
    at("a", now - 4.0 * day),
  ]
  let days = with_gaps(bucket_events(events, Day, 0))
  assert_eq(
    days.map(d => {
      match d {
        Gap(n) => n
        Full(b) => b.total
      }
    }),
    [3, 3, 1],
  )
  guard days[0] is Full(first) else { fail("a bucket first") }
  assert_eq(first.chips.map(c => (c.thing_id, c.count)), [("a", 2), ("b", 1)])
  assert_eq([1, 2, 12, 1000].map(count_mark), ["", "²", "¹²", "×1000"])
}

///|
fn envelope_of(text : String) -> Envelope raise {
  match parse_envelope(text) {
    Ok(e) => e
    Err(e) => fail(e)
  }
}

///|
fn error_of(text : String) -> String {
  match parse_envelope(text) {
    Ok(_) => "no error"
    Err(e) => e
  }
}

///|
test "imports: errors, merges and replaces" {
  assert_eq(error_of("{"), "That file isn't JSON.")
  assert_eq(error_of("[]"), "That file isn't a Thing Tracker file.")
  assert_eq(
    error_of("{\"format\":\"x\"}"),
    "That file isn't a Thing Tracker export.",
  )
  assert_true(
    error_of("{\"format\":\"thing-tracker/backup\",\"version\":3}").contains(
      "format v3",
    ),
  )
  assert_eq(
    error_of(
      "{\"format\":\"thing-tracker/backup\",\"groups\":[],\"things\":[]}",
    ),
    "That file is damaged: expected an array at events.",
  )
  let current = {
    things: [Thing::new("a", "⭐", "A")],
    groups: [Tag::new("g", "G", thing_ids=Vec::of(["a"]))],
    events: [{ ..at("a", 0.0), id: "e1", }],
  }
  let pack_text =
    #|{"format":"thing-tracker/group-pack",
    #| "things":[{"id":"a","title":"A2"},{"id":"b","title":"B"}],
    #| "groups":[{"id":"g","title":"Other","thingIds":["a","b","missing"]}]}
  let pack = envelope_of(pack_text)
  let plan = plan_import(pack, current)
  assert_eq(plan.lines, [
    "1 new thing", "1 already yours", "1 thing added to “G”",
  ])
  assert_true(
    plan.warnings[0].contains("refers to 1 thing the file doesn't include"),
  )
  let next = apply_plan(plan, current)
  assert_eq(next.groups[0].thing_ids.to_array(), ["a", "b"])
  assert_eq(next.things[0].title, "A")
  assert_eq(
    apply_plan(plan_import(pack, current, overwrite=true), current).things[0].title,
    "A2",
  )
  let again = plan_import(pack, next)
  assert_true(again.is_noop)
  let backup_text =
    #|{"format":"thing-tracker/backup","things":[],"groups":[],
    #| "events":[{"id":"e1","thingId":"a"}]}
  let backup = envelope_of(backup_text)
  assert_eq(plan_import(backup, current).lines, ["1 entry already present"])
  assert_true(plan_import(backup, current, mode=ReplaceMode).replace)
}

///|
test "overwriting keeps what the file leaves out" {
  let here = { ..Thing::new("a", "⭐", "A"), color: "#f00", }
  let over = thing_over(
    here,
    @json.parse("{\"id\":\"a\",\"title\":\"A2\",\"emoji\":\"\"}"),
  )
  assert_eq((over.title, over.emoji, over.color), ("A2", "⭐", "#f00"))
}

///|
test "records from files get the fields they need" {
  let t = thing_from(
    @json.parse(
      "{\"id\":7,\"measurements\":[{\"measurementId\":\"distance\"},{\"measurementId\":\"nope\",\"unit\":\"x\"}],\"archived\":1}",
    ),
  )
  assert_eq(t.id, "7")
  assert_eq(t.emoji, "⭐")
  assert_eq(t.measurements.to_array(), [{ kind: Distance, unit: "", }])
  assert_true(t.archived)
  let e = event_from(
    @json.parse(
      "{\"id\":\"e\",\"thingId\":\"t\",\"actualAt\":10.7,\"measurements\":[{\"measurementId\":\"count\",\"value\":-1},{\"measurementId\":\"count\",\"value\":2}]}",
    ),
  )
  assert_eq(
    (e.actual_at, e.recorded_at, e.measurements.length()),
    (10.0, 10.0, 1),
  )
  let g = tag_from(@json.parse("{\"id\":\"g\",\"thingIds\":[1,\"x\"]}"), 4)
  assert_eq((g.sort_order, g.thing_ids.to_array()), (4, ["1", "x"]))
}

///|
test "bundles become packs and back" {
  assert_eq(bundles().length(), 8)
  let habits = find_bundle("habits").unwrap()
  assert_eq((habits.thing_count, habits.group_count), (22, 4))
  let run = habits.things.iter().find_first(t => t.id == habit("run")).unwrap()
  assert_eq(run.measurements.to_array(), [
    { kind: Distance, unit: "km", },
    { kind: Duration, unit: "min", },
  ])
  // A bundle's pack imports as the bundle.
  let pack = envelope_of(habits.pack.stringify())
  assert_eq(pack.bundle_title, Some("Habits"))
  let plan = plan_import(pack, { things: [], groups: [], events: [], })
  assert_eq(plan.lines, ["22 new things", "4 new tags"])
  assert_eq(plan.new_things.map(t => t.id), habits.things.map(t => t.id))
}

///|
test "packs and backups are JSON the app reads back" {
  let app = sample_app()
  let backup = build_backup(app.snapshot(), app.now)
  let envelope = envelope_of(backup.stringify(indent=2))
  assert_eq(envelope.format, Backup)
  assert_eq(envelope.events, app.events.to_array())
  assert_eq(
    envelope.things.map(t => thing_from(t.json).id),
    app.things.map(t => t.id).to_array(),
  )
  let pack = build_pack([app.groups[0]], app.things.to_array(), app.now)
  let shared = envelope_of(pack.stringify())
  assert_eq(shared.groups.map(g => g.id), [app.groups[0].id])
  assert_eq(shared.things.length(), app.groups[0].thing_ids.length())
}

///|
test "slugs, plurals and numbers" {
  assert_eq(slugify("  Morning Routine! "), "morning-routine")
  assert_eq(slugify("¿?"), "untitled")
  assert_eq(slugify("Café au lait"), "cafe-au-lait")
  assert_eq(plural(1, "entry", many="entries"), "1 entry")
  assert_eq(plural(2, "tag"), "2 tags")
  assert_eq(parse_float("12.5kg"), Some(12.5))
  assert_eq(parse_float(".5"), Some(0.5))
  assert_eq(parse_float("abc"), None)
  assert_eq(
    text_in(1609.344, Distance.measurement().find_unit("mi").unwrap()),
    "1",
  )
  assert_eq(common_values([3.0, 1.0, 3.0, 2.0, 1.0]), [1.0, 3.0, 2.0])
}
