// The app driven end to end: the sequences of stories.js as tests, the demo's test, and the
// generic properties testGenericProperties checked.

///|
/// A scope that answers the tracker's asks: saves kept, waits until fired, now at `clock`.
fn tracker_scope(
  saved~ : Array[@common.SaveFile] = [],
  files~ : Map[String, String] = Map([]),
  timers~ : @common.Timers = @common.Timers::new(),
  clock~ : Double = fixture_now + 90.0 * minute,
) -> @tutuca.Scope {
  let scope = @tutuca.Scope::new()
  @common.handle_in_memory(scope, saved, files~)
  @common.handle_clock_in_memory(scope, () => clock, timers)
  scope
}

///|
/// The first element whose attribute `name` starts with `start`.
fn[R, M] by_attr(
  d : @testing.Driver[R, M],
  name : String,
  start : String,
) -> @memdom.MemNode {
  match
    d.root_node
    .descendants()
    .iter()
    .find_first(n => {
      n.get_attribute(name).map(v => v.has_prefix(start)).unwrap_or(false)
    }) {
    Some(n) => n
    None => abort("no element with \{name} starting \{start}")
  }
}

///|
fn[R, M] no_problems(d : @testing.Driver[R, M]) -> Unit raise {
  assert_eq(d.problems().map(@testing.describe), [])
}

///|
test "the tracker components check clean" {
  for
    issues in [
      tracker_app.check(),
      thing_c.check(),
      tag_c.check(),
      section_c.check(),
      bucket_c.check(),
      prompt_c.check(),
      emoji_picker.check(),
      measurement_wizard.check(),
      event_editor.check(),
      thing_editor.check(),
      tag_editor.check(),
      entry_list.check(),
      panel_c.check(),
    ] {
    assert_eq(issues.map(i => i.to_string()), [])
  }
}

///|
test "the sample app derives its sections, buckets and stats" {
  let app = sample_app()
  // By sort order, then title: each bundle's tags start at 0.
  assert_eq(app.sections.map(s => s.title).to_array(), [
    "Drinks", "Food", "Exercise", "Sleep", "Activities",
  ])
  let coffee = app.find_thing(drink("coffee")).unwrap()
  assert_eq((coffee.total, coffee.last_text), (2, "2h ago"))
  assert_eq(app.find_thing(habit("run")).unwrap().tags_text, "Exercise")
  assert_eq(app.buckets[0].label, "Today")
  assert_true(app.buckets.any(b => b.gap > 0))
  let d = @testing.Driver::new(tracker_app, app)
  no_problems(d)
  assert_true(d.text().contains("Lunchnever"))
}

///|
test "thing tracker demo: logs a thing with a tap" {
  let d = @testing.Driver::new(
    tracker_app,
    demo_app(fixture_now),
    scope=tracker_scope(),
  )
  let before = d.state().events.length()
  assert_true(before > 50)
  d.dispatch(by_attr(d, "aria-label", "Log Coffee"), "click")
  assert_eq(d.state().events.length(), before + 1)
  assert_eq(d.state().events.last().unwrap().thing_id, "thing:hydration/coffee")
  // JS's checkClean: it renders, no problems, no lint errors.
  assert_true(d.root_node.children().length() > 0)
  no_problems(d)
  assert_eq(tracker_app.check().map(i => i.to_string()), [])
}

///|
test "log, undo and log with measurements" {
  let d = @testing.Driver::new(tracker_app, sample_app(), scope=tracker_scope())
  d.send(LogThing(habit("breakfast")))
  let s = d.state()
  assert_true(s.toast.map(t => t.kind is Logged).unwrap_or(false))
  assert_eq(s.events.length(), 10)
  d.send(UndoToast)
  assert_eq(d.state().events.length(), 9)
  assert_eq(d.state().toast, None)
  d.dispatch(by_attr(d, "aria-label", "Log Run,"), "click")
  guard d.state().panel is Some(WizardPanel(w)) else { fail("the wizard") }
  assert_eq(w.prompts[0].base, 5000.0) // Last time's.
  d.send_to(measurement_wizard, wizard_panel, Next)
  d.send_to(measurement_wizard, wizard_panel, Next)
  assert_eq(d.state().events.last().unwrap().measurements.length(), 2)
  assert_eq(d.state().panel, None)
  assert_eq(d.state().toast.map(t => t.text), Some("5km · 28m at 10:30"))
  no_problems(d)
}

///|
test "a toast goes when its timer runs out, and the first log is followed by a tip" {
  let timers = @common.Timers::new()
  let d = @testing.Driver::new(
    tracker_app,
    sample_app(),
    scope=tracker_scope(timers~),
  )
  d.send(LogThing(drink("coffee")))
  assert_eq(timers.waiting(), [4000])
  timers.fire_all()
  d.drain()
  assert_eq(d.state().toast.map(t => t.title), Some("Tip"))
  assert_true(d.state().hint_shown)
  assert_eq(timers.waiting(), [4000, 6000])
  timers.fire_all()
  d.drain()
  assert_eq(d.state().toast, None)
  // A toast replaced before its timer runs out stays.
  d.send(LogThing(drink("coffee")))
  d.send(DismissToast)
  d.send(LogThing(habit("lunch")))
  d.send(DismissToast)
  d.send(LogThing(habit("breakfast")))
  let pending = timers.waiting().length()
  assert_eq(pending, 3)
  timers.fire_all()
  d.drain()
  assert_eq(d.state().toast, None)
  no_problems(d)
}

///|
test "search, collapse and compact" {
  let d = @testing.Driver::new(tracker_app, sample_app(), scope=tracker_scope())
  d.dispatch(by_attr(d, "aria-label", "Search things"), "input", value="coffee")
  assert_eq(d.state().sections.length(), 1)
  assert_eq(d.state().sections[0].member_ids.length(), 1)
  d.send(SetQuery("unicorn"))
  assert_true(d.state().no_matches())
  d.click("button", text="Create “unicorn”")
  guard d.state().panel is Some(ThingPanel(e)) else { fail("the thing editor") }
  assert_eq(e.title, "unicorn")
  d.send(ClosePanel)
  d.send(SetQuery(""))
  d.send(ToggleAllSections)
  assert_false(d.state().any_open())
  d.dispatch(by_attr(d, "aria-label", "Expand all sections"), "click")
  assert_true(d.state().sections.all(s => s.is_open))
  d.send(ToggleCompact)
  assert_eq(d.state().grid_view(), "compact")
  // Compact things render their compact view: no titles under the emoji.
  assert_false(d.text().contains("Lunchnever"))
  // A section's header collapses it through the app; while searching, they stay open.
  d.dispatch(by_attr(d, "aria-expanded", "true"), "click")
  assert_eq(d.state().collapsed.to_array(), [d.state().sections[0].id])
  d.send(SetQuery("coffee"))
  d.dispatch(by_attr(d, "aria-expanded", "true"), "click")
  assert_true(d.state().sections.all(s => s.is_open))
  no_problems(d)
}

///|
test "backdate with a long press" {
  let d = @testing.Driver::new(tracker_app, sample_app(), scope=tracker_scope())
  d.dispatch(by_attr(d, "aria-label", "Log Run,"), "contextmenu")
  guard d.state().panel is Some(EventPanel(e)) else { fail("the event editor") }
  assert_true(e.mode is Create)
  assert_eq(d.state().events.length(), 9)
  d.send_to(event_editor, event_panel, SetWhen("2026-10-16T07:00"))
  d.send_to(event_editor, event_panel, Save)
  assert_eq(d.state().events.last().unwrap().actual_at, utc(2026, 9, 16, h=7))
  assert_eq(d.state().events.length(), 10)
  no_problems(d)
}

///|
test "drill into a chip, edit and delete an entry" {
  let d = @testing.Driver::new(
    tracker_app,
    { ..sample_app(), tab: Insights, },
    scope=tracker_scope(),
  )
  d.dispatch(by_attr(d, "aria-label", "Water,"), "click")
  guard d.state().panel is Some(EntriesPanel(list)) else {
    fail("the entry list")
  }
  assert_eq((list.heading, list.rows.length()), ("💧 Water", 1))
  d.send_to(entry_list, entries_panel, Open(0))
  guard d.state().panel is Some(EventPanel(e)) else { fail("the event editor") }
  assert_true(e.mode is Edit)
  d.send_to(event_editor, event_panel, SetNotes("Big glass"))
  d.send_to(event_editor, event_panel, Save)
  assert_eq(
    d.state().events.iter().find_first(e => e.id == "event-3").map(e => e.notes),
    Some("Big glass"),
  )
  d.send(OpenAllEntries)
  guard d.state().panel is Some(EntriesPanel(list)) else {
    fail("the entry list")
  }
  assert_eq((list.rows.length(), list.subtitle), (9, "9 of 9, newest first"))
  d.send_to(entry_list, entries_panel, Remove(0))
  guard d.state().panel is Some(EntriesPanel(list)) else {
    fail("the entry list")
  }
  assert_eq((d.state().events.length(), list.rows.length()), (8, 8))
  // Escape closes the list; nothing to lose.
  d.dispatch(
    by_attr(d, "role", "dialog"),
    "keydown",
    info=@tutuca.EventInfo::new(key="Escape"),
  )
  assert_eq(d.state().panel, None)
  no_problems(d)
}

///|
test "insights by month, filtered" {
  let app = {
    ..sample_app(),
    tab: Insights,
    granularity: Month,
    group_filter: "group:habits/exercise",
  }.refresh()
  assert_true(
    app.buckets.all(b => {
      b.chips.all(c => c.thing_id == habit("run") || c.thing_id == habit("nap"))
    }),
  )
  let d = @testing.Driver::new(tracker_app, app)
  d.send(ClearGroupFilter)
  assert_eq(d.state().buckets[0].total, 8)
  d.click("button", text="Week")
  assert_eq(d.state().granularity, Week)
  assert_eq(d.state().buckets[0].label, "12 – 18 Oct")
  d.click("button", text="Exercise")
  assert_eq(d.state().group_filter, "group:habits/exercise")
  no_problems(d)
}

///|
test "edit a thing, then delete it and its entries" {
  let d = @testing.Driver::new(
    tracker_app,
    { ..sample_app(), tab: Manage, },
    scope=tracker_scope(),
  )
  d.dispatch(by_attr(d, "aria-label", "Search things…"), "input", value="run")
  d.click("li") // Nothing: the row's button has the handler.
  d.dispatch(d.find_all("li")[0].children()[0], "click")
  guard d.state().panel is Some(ThingPanel(e)) else { fail("the thing editor") }
  assert_eq((e.title, e.mode), ("Run", Edit))
  d.send_to(thing_editor, thing_editor_panel, SetTitle("Jog"))
  for _ in 0..<3 {
    d.send_to(thing_editor, thing_editor_panel, Next)
  }
  assert_true(d.state().things.any(t => t.title == "Jog"))
  d.send(EditThing(habit("run")))
  d.send_to(thing_editor, thing_editor_panel, Remove)
  assert_false(d.state().events.any(e => e.thing_id == habit("run")))
  assert_false(d.state().groups.any(g => g.thing_ids.contains(habit("run"))))
  no_problems(d)
}

///|
test "create a thing in three steps" {
  let d = @testing.Driver::new(tracker_app, sample_app(), scope=tracker_scope())
  d.send(NewThing(""))
  let at = thing_editor_panel
  guard d.state().panel is Some(ThingPanel(e)) else { fail("the thing editor") }
  assert_true(e.cannot_go())
  d.dispatch(by_attr(d, "aria-label", "Name"), "input", value="Swim")
  // The picker tells its editor, not the app.
  d.dispatch(by_attr(d, "aria-label", "Paste an emoji"), "input", value="🏊")
  guard d.state().panel is Some(ThingPanel(e)) else { fail("the thing editor") }
  assert_eq((e.emoji, e.picker_open), ("🏊", false))
  d.send_to(thing_editor, at, Next)
  let distance = d
    .find_all("label")
    .iter()
    .find_first(l => l.text_content() == "📏 Distance")
    .unwrap()
  d.dispatch(distance.children()[0], "change", value="true")
  d.send_to(thing_editor, at, SetUnit("distance|m"))
  guard d.state().panel is Some(ThingPanel(e)) else { fail("the thing editor") }
  assert_eq(e.measurements.to_array(), [{ kind: Distance, unit: "m", }])
  d.send_to(thing_editor, at, Next)
  d.send_to(thing_editor, at, SetDescription("Lengths count"))
  d.send_to(thing_editor, at, Next)
  let swim = d.state().things.last().unwrap()
  assert_eq(
    (swim.id, swim.title, swim.description),
    ("thing-10", "Swim", "Lengths count"),
  )
  assert_eq(d.state().order.last(), Some("thing-10"))
  // It shows under Ungrouped, ready to log.
  assert_eq(d.state().sections.last().map(s => s.id), Some(ungrouped))
  no_problems(d)
}

///|
test "make a tag and share one" {
  let saved = []
  let d = @testing.Driver::new(
    tracker_app,
    { ..sample_app(), tab: Manage, manage_tab: Groups, },
    scope=tracker_scope(saved~),
  )
  d.send(NewTag)
  d.send_to(tag_editor, tag_editor_panel, SetTitle("Morning"))
  d.send_to(tag_editor, tag_editor_panel, ToggleMember(0))
  d.send_to(tag_editor, tag_editor_panel, Save)
  let last = d.state().groups.last().unwrap()
  assert_eq(
    (last.title, last.thing_ids.length(), last.sort_order),
    ("Morning", 1, 4),
  )
  // A tag row's share button: the app knows which tag by where it came from.
  d.dispatch(by_attr(d, "aria-label", "Share Food"), "click")
  assert_eq(d.state().toast.map(t => t.title), Some("Shared"))
  assert_eq(saved.map(f => f.name), [
    "thing-tracker-pack-habits-2026-10-16.json",
  ])
  let pack = envelope_of(saved[0].text)
  assert_eq(pack.groups.map(g => g.title), ["Food"])
  assert_eq(pack.things.length(), 6)
  // A row opens the tag editor on it.
  d.click("button", text="🍎Food6 things")
  guard d.state().panel is Some(TagPanel(e)) else { fail("the tag editor") }
  assert_eq((e.title, e.selected_text()), ("Food", "6 selected"))
  d.send_to(tag_editor, tag_editor_panel, SetQuery("cof"))
  let boxes = d
    .find_all("input")
    .filter(n => n.get_attribute("type") == Some("checkbox"))
  assert_eq(boxes.length(), 1)
  no_problems(d)
}

///|
test "export, then import into a new app" {
  let saved = []
  let d = @testing.Driver::new(
    tracker_app,
    { ..sample_app(), tab: Manage, manage_tab: Data, },
    scope=tracker_scope(saved~),
  )
  d.click("button", text="⤓ Export everything")
  assert_eq(d.state().backup.last_at, fixture_now)
  assert_eq(d.state().toast.map(t => t.title), Some("Backup ready"))
  assert_false(d.state().backup_due())
  assert_eq(saved.map(f => f.name), [
    "thing-tracker-backup-2026-09-26_to_2026-10-16.json",
  ])
  assert_eq(d.state().backup.range_text, "26 Sep 2026 – 16 Oct 2026")
  d.send(SetImportText("{"))
  d.send(PreviewImport)
  assert_eq(d.state().toast.map(t => t.text), Some("That file isn't JSON."))
  d.send(
    SetImportText(
      "{\"format\":\"thing-tracker/backup\",\"version\":1,\"things\":[],\"groups\":[],\"events\":[]}",
    ),
  )
  d.send(SetImportMode(ReplaceMode))
  d.send(PreviewImport)
  assert_true(
    d.state().preview().warnings[0].has_prefix(
      "Replaces everything on this device: 29 things",
    ),
  )
  d.click("button", text="Replace everything")
  assert_eq((d.state().things.length(), d.state().events.length()), (0, 0))
  // The backup restores everything into the empty app.
  d.send(SetImportMode(MergeMode))
  d.send(SetImportText(saved[0].text))
  d.send(PreviewImport)
  assert_eq(d.state().import_title, "Restore backup")
  assert_eq(d.state().preview().lines, [
    "29 new things", "5 new tags", "9 entries restored",
  ])
  d.send(ConfirmImport)
  assert_eq(d.state().events.length(), 9)
  assert_eq(
    d.state().toast.map(t => t.text),
    Some("Added 29 things, 5 tags, 9 entries."),
  )
  assert_eq(d.state().find_thing(drink("coffee")).map(t => t.total), Some(2))
  no_problems(d)
}

///|
test "choose a file to import" {
  let files = Map([("pack.json", find_bundle("mood").unwrap().pack.stringify())])
  let d = @testing.Driver::new(
    tracker_app,
    { ..sample_app(), tab: Manage, manage_tab: Data, },
    scope=tracker_scope(files~),
  )
  let picker = by_attr(d, "type", "file")
  d.dispatch(
    picker,
    "change",
    info=@tutuca.EventInfo::new(files=[{ id: 1, name: "pack.json", }]),
  )
  assert_true(d.state().show_preview)
  assert_eq(d.state().import_title, "Mood")
  d.dispatch(
    picker,
    "change",
    info=@tutuca.EventInfo::new(files=[{ id: 2, name: "gone.json", }]),
  )
  assert_eq(d.state().toast.map(t => t.title), Some("Couldn't read that file"))
  no_problems(d)
}

///|
test "load a bundle into an empty app" {
  let d = @testing.Driver::new(
    tracker_app,
    tracker_app_of(fixture_now),
    scope=tracker_scope(),
  )
  d.click("button", text="Browse bundles")
  assert_eq(d.state().manage_tab, Bundles)
  d.dispatch(by_attr(d, "value", "mood"), "click")
  assert_true(d.state().show_preview)
  assert_eq(d.state().preview().lines, ["10 new things", "1 new tag"])
  d.send(ConfirmImport)
  assert_eq(d.state().things.length(), 10)
  assert_eq(d.state().toast.map(t => t.title), Some("Imported"))
  d.send(SetTab(Track))
  assert_eq(d.state().sections.map(s => s.title).to_array(), ["Mood"])
  // Again: nothing to add, so nothing to confirm.
  d.send(AddBundle("mood"))
  assert_true(d.state().preview().is_noop)
  no_problems(d)
}

///|
test "remind me, later and never" {
  let d = @testing.Driver::new(tracker_app, sample_app())
  assert_true(d.state().backup_due())
  assert_true(d.text().contains("Youhaven'tbackedupyet"))
  d.click("button", text="Later")
  assert_false(d.state().backup_due())
  d.send(SetNow(fixture_now + 8.0 * day))
  assert_true(d.state().backup_due())
  d.send(SetInterval("0"))
  assert_false(d.state().backup_due())
  d.send(SetInterval("5")) // Not a choice.
  assert_eq(d.state().backup.interval_days, 0)
  no_problems(d)
}

///|
test "sync time: an hour and a half later" {
  let d = @testing.Driver::new(tracker_app, sample_app(), scope=tracker_scope())
  d.send(SyncNow)
  assert_eq(
    d.state().find_thing(drink("coffee")).map(t => t.last_text),
    Some("4h ago"),
  )
  no_problems(d)
}

///|
test "reorder sorts Track by use" {
  let d = @testing.Driver::new(tracker_app, sample_app(), scope=tracker_scope())
  d.send(LogThing(habit("lunch")))
  d.send(LogThing(habit("lunch")))
  d.send(LogThing(habit("lunch")))
  // The order is frozen until reorder.
  let food = () => {
    d.state().sections
    .iter()
    .find_first(s => s.id == "group:habits/food")
    .unwrap()
  }
  assert_eq(food().member_ids[0], habit("breakfast"))
  d.send(Reorder)
  assert_eq(food().member_ids[0], habit("lunch"))
  no_problems(d)
}

///|
fn envelope_text(app : TrackerApp) -> String {
  build_backup(app.snapshot(), app.now).stringify()
}

///|
test "the panels ask before discarding" {
  let base = { ..sample_app(), tab: Track, }
  let d = @testing.Driver::new(tracker_app, base, scope=tracker_scope())
  d.send(LogThing(habit("run")))
  d.send_to(measurement_wizard, wizard_panel, RequestClose)
  guard d.state().panel is Some(WizardPanel(w)) else { fail("the wizard") }
  assert_true(w.confirming)
  d.send_to(measurement_wizard, wizard_panel, Key("Escape"))
  guard d.state().panel is Some(WizardPanel(w)) else { fail("the wizard") }
  assert_false(w.confirming)
  d.send_to(measurement_wizard, wizard_panel, RequestClose)
  d.click("button", text="Discard")
  assert_eq(d.state().panel, None)
  assert_eq(d.state().events.length(), 9)
  ignore(envelope_text(d.state()))
  no_problems(d)
}

// --- generic properties ------------------------------------------------------------------------

///|
test "the small components have the generic properties" {
  @testing.check_component(thing_c, count=20)
  @testing.check_component(tag_c, count=20)
  @testing.check_component(section_c, count=20)
  @testing.check_component(bucket_c, count=20)
  @testing.check_component(prompt_c, count=20)
  @testing.check_component(emoji_picker, count=20)
}

///|
test "the panels have the generic properties" {
  @testing.check_component(entry_list, count=20)
  @testing.check_component(event_editor, count=20)
  @testing.check_component(measurement_wizard, count=20, state=(rs, size) => {
    let w : MeasurementWizard = @quickcheck.Arbitrary::arbitrary(size, rs)
    let prompts = if w.prompts.is_empty() {
      Vec::of([make_prompt(Duration.measurement(), "min", 0.0, [])])
    } else {
      w.prompts
    }
    { ..w, prompts, step: pick_index(rs, prompts.length()), }
  })
  @testing.check_component(thing_editor, count=20, state=(rs, size) => {
    let e : ThingEditor = @quickcheck.Arbitrary::arbitrary(size, rs)
    { ..e, step: pick_index(rs, 3), }
  })
  @testing.check_component(tag_editor, count=20)
  @testing.check_component(panel_c, count=20)
}

///|
test "the app has the generic properties on generated apps" {
  @testing.check_component(
    tracker_app,
    count=20,
    state=generate_app,
    scope=tracker_scope(),
  )
}

///|
test "random messages keep the app's contract" {
  @testing.run_messages(
    tracker_app,
    sample_app,
    [
      @testing.root_messages(),
      @testing.item_messages(thing_c, things_items),
      @testing.item_messages(tag_c, groups_items),
      @testing.item_messages(section_c, sections_items),
      @testing.item_messages(bucket_c, buckets_items),
      @testing.child_messages(measurement_wizard, wizard_panel),
      @testing.child_messages(event_editor, event_panel),
      @testing.child_messages(thing_editor, thing_editor_panel),
      @testing.child_messages(tag_editor, tag_editor_panel),
      @testing.child_messages(entry_list, entries_panel),
    ],
    scope=tracker_scope(),
    count=20,
    steps=15,
  )
}

///|
test "random events patch the DOM as a fresh render would" {
  @testing.run_events(
    tracker_app,
    sample_app,
    scope=tracker_scope(),
    count=10,
    steps=15,
  )
  @testing.run_events(
    tracker_app,
    () => { ..sample_app(), tab: Insights, },
    scope=tracker_scope(),
    count=5,
    steps=15,
  )
  @testing.run_events(
    tracker_app,
    () => { ..sample_app(), tab: Manage, },
    scope=tracker_scope(),
    count=5,
    steps=15,
  )
}

///|
test "an emoji search of marks only matches every emoji, as in JS" {
  // Found by the Emoji picker story's stress test: a query that trims to something but
  // folds to no terms (a lone combining accent) made matches index an empty term list.
  let d = @testing.Driver::new(emoji_picker, EmojiPicker::new())
  d.send(SetQuery("\u{301}"))
  assert_eq(d.problems().map(@testing.describe), [])
  assert_true(d.state().is_searching())
  assert_eq(d.state().matches().length(), emoji_palette.length())
  d.send(SetQuery("´ "))
  assert_eq(d.problems().map(@testing.describe), [])
  assert_eq(d.state().matches().length(), emoji_palette.length())
}
