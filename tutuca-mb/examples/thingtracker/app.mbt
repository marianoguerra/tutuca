// The tracker app, from index.js: tap an emoji to log a thing, see what you did by day, week
// or month, manage things, tags, bundles and backups. The app owns all data; panels and
// children notify it with what to change. Time is state (now, tz) the host keeps current, so
// every view is a function of it.

///|
pub(all) enum ToastKind {
  Info
  Logged
  Failed
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes a toast kind.
pub impl ToJson for ToastKind with fn to_json(self) {
  Json::string(
    match self {
      Info => "info"
      Logged => "logged"
      Failed => "error"
    },
  )
}

///|
pub impl FromJson for ToastKind with fn from_json(json, path) {
  match json {
    String("info") => Info
    String("logged") => Logged
    String("error") => Failed
    _ => raise @json.JsonDecodeError((path, "a toast kind"))
  }
}

///|
/// A toast, gone after a while unless another replaces it first.
pub(all) struct Toast {
  id : Int32
  title : String
  text : String
  event_id : String // The entry it logged, to undo or edit.
  kind : ToastKind
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct BackupInfo {
  last_at : Double // 0 when never.
  interval_days : Int32 // One of intervals; 0 is never.
  dismissed_at : Double
  range_text : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// What an open entry list lists: a thing's entries in a time range, or all ("").
pub(all) struct ListContext {
  thing_id : String
  start : Double
  end : Double
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct TrackerApp {
  now : Double
  tz : Int32
  tab : Tab
  things : Vec[Thing]
  groups : Vec[Tag]
  events : Vec[EventRecord]
  order : Vec[String] // Track's order, frozen until reorder.
  collapsed : Vec[String]
  query : String
  compact : Bool
  sections : Vec[Section] // Derived.
  granularity : Granularity
  group_filter : String
  buckets : Vec[Bucket] // Derived.
  shown_entries : Int32
  list_context : ListContext?
  manage_tab : ManageTab
  manage_query : String
  panel : Panel?
  toast : Toast?
  toast_seq : Int32
  hint_shown : Bool
  next_id : Int32
  backup : BackupInfo
  import_mode : ImportMode
  import_text : String
  import_source : String
  import_title : String
  show_preview : Bool
  overwrite : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// An empty app at `now`; `refresh` works out what it derives.
pub fn TrackerApp::new(now : Double, tz~ : Int32 = 0) -> TrackerApp {
  {
    now,
    tz,
    tab: Track,
    things: Vec::new(),
    groups: Vec::new(),
    events: Vec::new(),
    order: Vec::new(),
    collapsed: Vec::new(),
    query: "",
    compact: false,
    sections: Vec::new(),
    granularity: Day,
    group_filter: "",
    buckets: Vec::new(),
    shown_entries: 200,
    list_context: None,
    manage_tab: Things,
    manage_query: "",
    panel: None,
    toast: None,
    toast_seq: 0,
    hint_shown: false,
    next_id: 1,
    backup: {
      last_at: 0.0,
      interval_days: 7,
      dismissed_at: 0.0,
      range_text: "",
    },
    import_mode: MergeMode,
    import_text: "",
    import_source: "",
    import_title: "",
    show_preview: false,
    overwrite: false,
  }
}

///|
pub(all) enum TrackerMsg {
  SetTab(Tab)
  SyncNow // Asks the host for the time.
  NowIs(AskResult[Double])
  SetNow(Double)
  Reorder // Re-sorts Track by use; the original does it when the app comes back to the front.
  // Track.
  SetQuery(String)
  ToggleCompact
  ToggleSection(String)
  ToggleAllSections // Collapses all when any is open, else expands all.
  LogThing(String)
  CommitLog(String, Array[MeasureValue])
  BackdateThing(String)
  SaveEntry(EntrySaved)
  EditEntry(String)
  DeleteEntry(String)
  ClosePanel
  // Toasts.
  UndoToast
  EditToast
  DismissToast
  ToastDone(Int32) // A toast's timer ran out.
  // Insights.
  SetGranularity(Granularity)
  SetGroupFilter(Int32)
  ClearGroupFilter
  OpenChip(ChipOpened)
  OpenAllEntries
  MoreEntries
  // Things and tags.
  NewThing(String)
  NewThingFromQuery
  EditThing(String)
  SaveThing(Mode, ThingFields)
  DeleteThing(String)
  NewTag
  EditTag(Int32)
  SaveTag(Mode, TagFields)
  DeleteTag(String)
  ShareTag(Int32)
  // Manage.
  SetManageTab(ManageTab)
  SetManageQuery(String)
  BrowseBundles
  // Backups.
  BackupNow
  BackupLater
  SetInterval(String) // The chip's value: a number of days.
  ExportAll
  Saved(AskResult[String]) // The kind of file saved.
  // Imports: a file, pasted text or a bundle, previewed before anything changes.
  SetImportMode(ImportMode)
  SetImportText(String)
  PreviewImport
  ChooseFile(Int32, String) // The picked file's id and name.
  TextRead(AskResult[String])
  AddBundle(String)
  SetOverwrite(Bool)
  CancelImport
  ConfirmImport
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let things_items : Items[TrackerApp, Int32, Thing] = items(
  "things",
  a => a.things,
  (a, things) => { ..a, things, },
)

///|
pub let groups_items : Items[TrackerApp, Int32, Tag] = items(
  "groups",
  a => a.groups,
  (a, groups) => { ..a, groups, },
)

///|
pub let sections_items : Items[TrackerApp, Int32, Section] = items(
  "sections",
  a => a.sections,
  (a, sections) => { ..a, sections, },
)

///|
pub let buckets_items : Items[TrackerApp, Int32, Bucket] = items(
  "buckets",
  a => a.buckets,
  (a, buckets) => { ..a, buckets, },
)

///|
pub let panel_lens : Lens[TrackerApp, Panel] = @tutuca.Lens::partial(
  "panel",
  a => a.panel,
  (a, p) => { ..a, panel: Some(p), },
)

///|
pub fn TrackerApp::find_thing(self : TrackerApp, id : String) -> Thing? {
  self.things.iter().find_first(t => t.id == id)
}

///|
pub fn TrackerApp::snapshot(self : TrackerApp) -> Snapshot {
  {
    things: self.things.to_array(),
    groups: self.groups.to_array(),
    events: self.events.to_array(),
  }
}

///|
pub fn TrackerApp::searching(self : TrackerApp) -> Bool {
  trim(self.query) != ""
}

///|
pub fn TrackerApp::any_open(self : TrackerApp) -> Bool {
  self.sections.any(s => s.is_open)
}

///|
pub fn TrackerApp::has_things(self : TrackerApp) -> Bool {
  self.things.any(t => !t.archived)
}

///|
pub fn TrackerApp::no_matches(self : TrackerApp) -> Bool {
  self.has_things() && self.sections.is_empty()
}

///|
pub fn TrackerApp::grid_view(self : TrackerApp) -> String {
  if self.compact {
    "compact"
  } else {
    "main"
  }
}

///|
pub fn TrackerApp::backup_due(self : TrackerApp) -> Bool {
  let b = self.backup
  if b.interval_days == 0 {
    return false
  }
  let interval = b.interval_days.to_double() * day
  if b.dismissed_at > 0.0 && self.now - b.dismissed_at < interval {
    return false
  }
  b.last_at == 0.0 || self.now - b.last_at >= interval
}

///|
fn TrackerApp::new_id(
  self : TrackerApp,
  prefix : String,
) -> (TrackerApp, String) {
  ({ ..self, next_id: self.next_id + 1, }, "\{prefix}-\{self.next_id}")
}

// --- derived state ---------------------------------------------------------------------------

///|
fn entry_line(
  e : EventRecord,
  tz : Int32,
  mixed : Bool,
  thing : Thing?,
) -> EntryRow {
  let values = e.measurements
    .iter()
    .map(m => {
      match find_measurement(m.measurement_id) {
        Some(measurement) => " · \{format_measurement(measurement, m.value)}"
        None => ""
      }
    })
    .join("")
  {
    id: e.id,
    head: if mixed {
      "\{thing.map(t => t.emoji).unwrap_or("❔")} \{thing.map(t => t.title).unwrap_or("Deleted thing")}"
    } else {
      ""
    },
    line: "\{format_date(e.actual_at, tz)} · \{format_time(e.actual_at, tz)}\{values}",
    notes: e.notes,
    recorded: if (e.recorded_at - e.actual_at).abs() > 60000.0 {
      "recorded \{format_time(e.recorded_at, tz)}"
    } else {
      ""
    },
  }
}

///|
fn TrackerApp::filter_group(self : TrackerApp) -> Tag? {
  self.groups.iter().find_first(g => g.id == self.group_filter)
}

///|
/// The entry list's rows, when an entry list is open; else no list context.
fn TrackerApp::refresh_list(self : TrackerApp) -> TrackerApp {
  guard self.list_context is Some(lc) else { self }
  guard self.panel is Some(EntriesPanel(list)) else {
    { ..self, list_context: None, }
  }
  let group = self.filter_group()
  let mixed = lc.thing_id == ""
  let all = sorted_by(
    self.events
    .iter()
    .filter(e => {
      if mixed {
        group is None || group.unwrap().thing_ids.contains(e.thing_id)
      } else {
        e.thing_id == lc.thing_id &&
        e.actual_at >= lc.start &&
        e.actual_at < lc.end
      }
    })
    .to_array(),
    (a, b) => sign(b.actual_at - a.actual_at),
  )
  let shown = if mixed && all.length() > self.shown_entries {
    all[:self.shown_entries].to_owned()
  } else {
    all
  }
  let rows = shown.map(e => {
    entry_line(e, self.tz, mixed, self.find_thing(e.thing_id))
  })
  let list = {
    ..list,
    rows: Vec::of(rows),
    remaining: all.length() - shown.length(),
    subtitle: if mixed {
      "\{shown.length()} of \{all.length()}, newest first"
    } else {
      list.subtitle
    },
  }
  { ..self, panel: Some(EntriesPanel(list)), }
}

///|
/// Rebuilds what the app derives from its data and time: thing stats, Track's sections,
/// Insights' buckets and an open entry list.
pub fn TrackerApp::refresh(self : TrackerApp) -> TrackerApp {
  let usage = usage_of(self.events.iter())
  let tags_of : Map[String, Array[String]] = Map([])
  for g in self.groups {
    for id in g.thing_ids {
      match tags_of.get(id) {
        Some(titles) => titles.push(g.title)
        None => tags_of[id] = [g.title]
      }
    }
  }
  let things = self.things.map(t => {
    let total = usage.get(t.id).map(u => u.total).unwrap_or(0)
    let last_text = match usage.get(t.id) {
      Some(u) => format_relative(u.last_at, self.now, self.tz)
      None => "never"
    }
    let tags_text = tags_of
      .get(t.id)
      .map(ts => ts.join(" · "))
      .unwrap_or("No tags")
    if t.total == total && t.last_text == last_text && t.tags_text == tags_text {
      t
    } else {
      { ..t, total, last_text, tags_text, }
    }
  })
  let visible = things.filter(t => !t.archived).to_array()
  let searching = self.searching()
  let ordered = if searching {
    filter_things(visible, self.query)
  } else {
    apply_frozen_order(visible, self.order.to_array())
  }
  let sections = build_rows(self.groups.to_array(), ordered).map(row => {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    member_ids: Vec::of(row.member_ids),
    is_open: searching || !self.collapsed.contains(row.id),
    compact: self.compact,
  })
  let events = match self.filter_group() {
    None => self.events.to_array()
    Some(g) =>
      self.events
      .iter()
      .filter(e => g.thing_ids.contains(e.thing_id))
      .to_array()
  }
  let found = bucket_events(events, self.granularity, self.tz)
  let dated = if self.granularity is Day {
    with_gaps(found)
  } else {
    found.map(b => Full(b))
  }
  let thing_of = (id : String) => things.iter().find_first(t => t.id == id)
  let buckets = dated.map(d => {
    match d {
      Gap(gap) =>
        { label: "", start: 0.0, end: 0.0, total: 0, gap, chips: Vec::new(), }
      Full(b) =>
        {
          label: format_bucket_label(
            b.start,
            self.granularity,
            self.now,
            self.tz,
          ),
          start: b.start,
          end: b.end,
          total: b.total,
          gap: 0,
          chips: Vec::of(
            b.chips.map(c => {
              let thing = thing_of(c.thing_id)
              let title = thing.map(t => t.title).unwrap_or("Deleted thing")
              {
                thing_id: c.thing_id,
                emoji: thing.map(t => t.emoji).unwrap_or("❔"),
                aria: "\{title}, \{plural(c.count, "time")}",
                tip: "\{title} · \{c.count}",
                mark: count_mark(c.count),
              }
            }),
          ),
        }
    }
  })
  { ..self, things, sections: Vec::of(sections), buckets: Vec::of(buckets), }.refresh_list()
}

// --- updates ---------------------------------------------------------------------------------

///|
/// Shows a toast, gone after 4 seconds unless another replaces it first.
fn TrackerApp::toast(
  self : TrackerApp,
  ctx : Ctx[TrackerApp, TrackerMsg],
  title : String,
  text : String,
  event_id~ : String = "",
  kind~ : ToastKind = Info,
) -> TrackerApp {
  let seq = self.toast_seq + 1
  ctx.ask(@common.wait, 4000, r => {
    if r is Ok(_) {
      Some(ToastDone(seq))
    } else {
      None
    }
  })
  {
    ..self,
    toast_seq: seq,
    toast: Some({ id: seq, title, text, event_id, kind, }),
  }
}

///|
fn TrackerApp::open_import(
  self : TrackerApp,
  ctx : Ctx[TrackerApp, TrackerMsg],
  title : String,
  text : String,
) -> TrackerApp {
  match parse_envelope(text) {
    Err(error) => self.toast(ctx, "Couldn't read that file", error, kind=Failed)
    Ok(envelope) =>
      {
        ..self,
        import_source: text,
        import_title: if title != "" {
          title
        } else if envelope.format is Backup {
          "Restore backup"
        } else {
          envelope.bundle_title.unwrap_or("Import tags")
        },
        overwrite: false,
        show_preview: true,
      }
  }
}

///|
/// What importing the previewed file would change.
pub fn TrackerApp::plan(self : TrackerApp) -> Plan? {
  match parse_envelope(self.import_source) {
    Ok(envelope) =>
      Some(
        plan_import(
          envelope,
          self.snapshot(),
          mode=self.import_mode,
          overwrite=self.overwrite,
        ),
      )
    Err(_) => None
  }
}

///|
fn TrackerApp::prompts_for(
  self : TrackerApp,
  thing : Thing,
  blank~ : Bool = false,
) -> Array[Prompt] {
  thing.measurements
  .iter()
  .map(r => {
    let m = r.kind.measurement()
    let history = measurement_history(self.events.iter(), thing.id, m.id)
    let base = match history.get(0) {
      Some(v) => v
      None => if blank { 0.0 } else { preferred_unit(m, r.unit).factor }
    }
    make_prompt(m, r.unit, base, history, blank~)
  })
  .to_array()
}

///|
fn TrackerApp::log_event(
  self : TrackerApp,
  ctx : Ctx[TrackerApp, TrackerMsg],
  thing : Thing,
  values : Array[MeasureValue],
) -> TrackerApp {
  let (app, id) = self.new_id("event")
  let event = {
    id,
    thing_id: thing.id,
    recorded_at: self.now,
    actual_at: self.now,
    measurements: Vec::of(values),
    notes: "",
  }
  let at = format_time(self.now, self.tz)
  let text = if values.length() == 0 {
    "Logged at \{at}"
  } else {
    let parts = values.map(v => {
      match find_measurement(v.measurement_id) {
        Some(m) => format_measurement(m, v.value)
        None => ""
      }
    })
    "\{parts.join(" · ")} at \{at}"
  }
  { ..app, events: app.events.push(event), }
  .toast(ctx, "\{thing.emoji} \{thing.title}", text, event_id=id, kind=Logged)
  .refresh()
}

///|
/// The event editor on entry id.
fn TrackerApp::open_entry(self : TrackerApp, id : String) -> TrackerApp {
  guard self.events.iter().find_first(x => x.id == id) is Some(e) else { self }
  let thing = self.find_thing(e.thing_id)
  let ids : Array[String] = []
  let refs = thing.map(t => t.measurements.to_array()).unwrap_or([])
  for r in refs {
    if !ids.contains(r.kind.id()) {
      ids.push(r.kind.id())
    }
  }
  for m in e.measurements {
    if !ids.contains(m.measurement_id) {
      ids.push(m.measurement_id)
    }
  }
  let values = ids.filter_map(mid => {
    find_measurement(mid).map(m => {
      let base = e.measurements
        .iter()
        .find_first(x => x.measurement_id == mid)
        .map(x => x.value)
        .unwrap_or(0.0)
      let unit = refs
        .iter()
        .find_first(r => r.kind == m.kind)
        .map(r => r.unit)
        .unwrap_or("")
      make_prompt(
        m,
        unit,
        base,
        measurement_history(self.events.iter(), e.thing_id, mid),
        blank=true,
      )
    })
  })
  {
    ..self,
    list_context: None,
    panel: Some(
      EventPanel(
        EventEditor::new(
          Edit,
          event_id=e.id,
          thing_id=e.thing_id,
          heading=match thing {
            Some(t) => "\{t.emoji} \{t.title}"
            None => "Entry"
          },
          subtitle="Recorded \{format_relative(e.recorded_at, self.now, self.tz)}",
          recorded_at=e.recorded_at,
          when_=to_datetime_local(e.actual_at, self.tz),
          tz=self.tz,
          notes=e.notes,
          values~,
        ),
      ),
    ),
  }
}

///|
fn TrackerApp::open_tag_editor(self : TrackerApp, tag : Tag?) -> TrackerApp {
  let members = sorted_by(self.things.to_array(), (a, b) => {
    locale_compare(a.title, b.title)
  }).map(t => {
    id: t.id,
    emoji: t.emoji,
    title: t.title,
    checked: tag.map(g => g.thing_ids.contains(t.id)).unwrap_or(false),
  })
  {
    ..self,
    panel: Some(
      TagPanel(
        TagEditor::new(
          if tag is None {
            Create
          } else {
            Edit
          },
          tag_id=tag.map(g => g.id).unwrap_or(""),
          emoji=tag.map(g => g.emoji).unwrap_or(""),
          title=tag.map(g => g.title).unwrap_or(""),
          members~,
        ),
      ),
    ),
  }
}

///|
fn TrackerApp::save_file(
  self : TrackerApp,
  ctx : Ctx[TrackerApp, TrackerMsg],
  name : String,
  data : Json,
  kind : String,
) -> TrackerApp {
  ctx.ask(
    @common.save_file,
    @common.SaveFile::new(name, data.stringify(indent=2), kind~),
    r => Some(Saved(r)),
  )
  self
}

///|
fn TrackerApp::update(
  self : TrackerApp,
  msg : TrackerMsg,
  ctx : Ctx[TrackerApp, TrackerMsg],
) -> TrackerApp {
  match msg {
    SetTab(tab) => { ..self, tab, }
    SyncNow => {
      ctx.ask(@common.now, (), r => Some(NowIs(r)))
      self
    }
    NowIs(Ok(now)) | SetNow(now) =>
      if now >= 0.0 && now.floor() == now && !now.is_inf() {
        { ..self, now, }.refresh()
      } else {
        self
      }
    NowIs(_) => self
    Reorder => {
      let visible = self.things.filter(t => !t.archived).to_array()
      {
        ..self,
        order: Vec::of(rank_things(visible, usage_of(self.events.iter()))),
      }.refresh()
    }
    SetQuery(query) => { ..self, query, }.refresh()
    ToggleCompact => { ..self, compact: !self.compact, }.refresh()
    ToggleSection(id) =>
      if self.searching() {
        self
      } else {
        let collapsed = if self.collapsed.contains(id) {
          self.collapsed.filter(c => c != id)
        } else {
          self.collapsed.push(id)
        }
        { ..self, collapsed, }.refresh()
      }
    ToggleAllSections => {
      let ids = self.sections.map(s => s.id)
      let collapsed = if self.any_open() {
        let mut all = self.collapsed
        for id in ids {
          if !all.contains(id) {
            all = all.push(id)
          }
        }
        all
      } else {
        self.collapsed.filter(id => !ids.contains(id))
      }
      { ..self, collapsed, }.refresh()
    }
    LogThing(id) => {
      guard self.find_thing(id) is Some(thing) else { self }
      let prompts = self.prompts_for(thing)
      if prompts.length() == 0 {
        self.log_event(ctx, thing, [])
      } else {
        {
          ..self,
          panel: Some(
            WizardPanel(
              MeasurementWizard::new(
                thing.id,
                thing.emoji,
                thing.title,
                prompts,
              ),
            ),
          ),
        }
      }
    }
    CommitLog(thing_id, values) => {
      let app = { ..self, panel: None, }
      match self.find_thing(thing_id) {
        Some(thing) => app.log_event(ctx, thing, values)
        None => app
      }
    }
    // Opens the editor on an unsaved entry for now, with last time's values.
    BackdateThing(id) => {
      guard self.find_thing(id) is Some(thing) else { self }
      {
        ..self,
        panel: Some(
          EventPanel(
            EventEditor::new(
              Create,
              thing_id=thing.id,
              heading="\{thing.emoji} \{thing.title}",
              subtitle="Set when this happened.",
              recorded_at=self.now,
              when_=to_datetime_local(self.now, self.tz),
              tz=self.tz,
              values=self.prompts_for(thing, blank=true),
            ),
          ),
        ),
      }
    }
    SaveEntry(entry) => {
      if entry.mode is Create && self.find_thing(entry.thing_id) is None {
        return self
      }
      let notes = if trim(entry.notes) != "" { entry.notes } else { "" }
      let app = match entry.mode {
        Create => {
          let (app, id) = self.new_id("event")
          let event = {
            id,
            thing_id: entry.thing_id,
            recorded_at: entry.recorded_at,
            actual_at: entry.actual_at,
            notes,
            measurements: Vec::of(entry.measurements),
          }
          { ..app, events: app.events.push(event), }
        }
        Edit =>
          {
            ..self,
            events: self.events.map(e => {
              if e.id == entry.id {
                {
                  ..e,
                  actual_at: entry.actual_at,
                  notes,
                  measurements: Vec::of(
                    entry.measurements.filter(m => m.value > 0.0),
                  ),
                }
              } else {
                e
              }
            }),
          }
      }
      { ..app, panel: None, list_context: None, }.refresh()
    }
    EditEntry(id) => self.open_entry(id)
    DeleteEntry(id) => {
      let panel = match self.panel {
        Some(EventPanel(e)) if e.event_id == id => None
        p => p
      }
      { ..self, events: self.events.filter(e => e.id != id), panel, }.refresh()
    }
    ClosePanel => { ..self, panel: None, list_context: None, }
    UndoToast => {
      let id = self.toast.map(t => t.event_id).unwrap_or("")
      let app = { ..self, toast: None, }
      if id == "" {
        app
      } else {
        { ..app, events: app.events.filter(e => e.id != id), }.refresh()
      }
    }
    EditToast => {
      let id = self.toast.map(t => t.event_id).unwrap_or("")
      let app = { ..self, toast: None, }
      if id == "" {
        app
      } else {
        app.open_entry(id)
      }
    }
    DismissToast => { ..self, toast: None, }
    // The first log's toast is followed by a tip.
    ToastDone(id) => {
      guard self.toast is Some(toast) && toast.id == id else { self }
      let app = { ..self, toast: None, }
      if !self.hint_shown && toast.kind is Logged {
        let app = { ..app, hint_shown: true, }.toast(
          ctx, "Tip", "Press and hold a thing to log it at a different time, or a section header to collapse everything.",
        )
        let seq = app.toast_seq
        ctx.ask(@common.wait, 6000, r => {
          if r is Ok(_) {
            Some(ToastDone(seq))
          } else {
            None
          }
        })
        app
      } else {
        app
      }
    }
    SetGranularity(granularity) => { ..self, granularity, }.refresh()
    SetGroupFilter(i) => {
      guard self.groups.get(i) is Some(g) else { self }
      {
        ..self,
        group_filter: if g.id == self.group_filter {
          ""
        } else {
          g.id
        },
      }.refresh()
    }
    ClearGroupFilter => { ..self, group_filter: "", }.refresh()
    OpenChip(c) => {
      let heading = match self.find_thing(c.thing_id) {
        Some(t) => "\{t.emoji} \{t.title}"
        None => "❔ Deleted thing"
      }
      {
        ..self,
        panel: Some(EntriesPanel(EntryList::new(heading~, subtitle=c.label))),
        list_context: Some({ thing_id: c.thing_id, start: c.start, end: c.end, }),
      }.refresh()
    }
    OpenAllEntries =>
      {
        ..self,
        shown_entries: 200,
        panel: Some(EntriesPanel(EntryList::new())),
        list_context: Some({ thing_id: "", start: 0.0, end: 0.0, }),
      }.refresh()
    MoreEntries =>
      { ..self, shown_entries: self.shown_entries + 200, }.refresh()
    NewThing(title) =>
      {
        ..self,
        panel: Some(
          ThingPanel(ThingEditor::new(Create, title~, picker_open=true)),
        ),
      }
    NewThingFromQuery =>
      {
        ..self,
        panel: Some(
          ThingPanel(
            ThingEditor::new(Create, title=trim(self.query), picker_open=true),
          ),
        ),
      }
    EditThing(id) => {
      guard self.find_thing(id) is Some(thing) else { self }
      // The same emoji as a thing sharing one of its tags.
      let peers = self.groups
        .iter()
        .filter(g => g.thing_ids.contains(thing.id))
        .flat_map(g => g.thing_ids.iter())
        .to_array()
      let other = self.things
        .iter()
        .find_first(x => {
          x.id != thing.id && x.emoji == thing.emoji && peers.contains(x.id)
        })
      let clash = match other {
        None => ""
        Some(o) =>
          "\{thing.emoji} is already used by \{o.title} in one of the same groups — still fine, just harder to tell apart at a glance."
      }
      {
        ..self,
        panel: Some(
          ThingPanel(
            ThingEditor::new(
              Edit,
              thing_id=thing.id,
              emoji=thing.emoji,
              title=thing.title,
              description=thing.description,
              measurements=thing.measurements.to_array(),
              clash~,
            ),
          ),
        ),
      }
    }
    SaveThing(mode, fields) => {
      if fields.emoji.length() < 1 ||
        fields.emoji.length() > 16 ||
        fields.title.length() > 120 {
        return self
      }
      let app = match mode {
        Create => {
          let (app, id) = self.new_id("thing")
          let thing = Thing::new(
            id,
            fields.emoji,
            fields.title,
            description=fields.description,
            measurements=Vec::of(fields.measurements),
          )
          { ..app, things: app.things.push(thing), order: app.order.push(id), }
        }
        Edit =>
          {
            ..self,
            things: self.things.map(t => {
              if t.id == fields.id {
                {
                  ..t,
                  emoji: fields.emoji,
                  title: fields.title,
                  description: fields.description,
                  measurements: Vec::of(fields.measurements),
                }
              } else {
                t
              }
            }),
          }
      }
      { ..app, panel: None, }.refresh()
    }
    // Its entries go too, and it leaves every tag.
    DeleteThing(id) =>
      {
        ..self,
        events: self.events.filter(e => e.thing_id != id),
        groups: self.groups.map(g => {
          if g.thing_ids.contains(id) {
            { ..g, thing_ids: g.thing_ids.filter(x => x != id), }
          } else {
            g
          }
        }),
        things: self.things.filter(t => t.id != id),
        panel: None,
      }.refresh()
    NewTag => self.open_tag_editor(None)
    EditTag(i) =>
      match self.groups.get(i) {
        Some(g) => self.open_tag_editor(Some(g))
        None => self
      }
    SaveTag(mode, given) => {
      if given.title.length() > 120 {
        return self
      }
      let thing_ids = Vec::of(
        given.thing_ids.filter(id => self.find_thing(id) is Some(_)),
      )
      let app = match mode {
        Create => {
          let mut top = -1
          for g in self.groups {
            if g.sort_order > top {
              top = g.sort_order
            }
          }
          let (app, id) = self.new_id("tag")
          let tag = Tag::new(
            id,
            given.title,
            emoji=given.emoji,
            sort_order=top + 1,
            thing_ids~,
          )
          { ..app, groups: app.groups.push(tag), }
        }
        Edit =>
          {
            ..self,
            groups: self.groups.map(g => {
              if g.id == given.id {
                { ..g, title: given.title, emoji: given.emoji, thing_ids, }
              } else {
                g
              }
            }),
          }
      }
      { ..app, panel: None, }.refresh()
    }
    DeleteTag(id) =>
      {
        ..self,
        groups: self.groups.filter(g => g.id != id),
        group_filter: if self.group_filter == id {
          ""
        } else {
          self.group_filter
        },
        panel: None,
      }.refresh()
    ShareTag(i) => {
      guard self.groups.get(i) is Some(g) else { self }
      let pack = build_pack([g], self.things.to_array(), self.now)
      let slug = if g.bundle_id != "" { g.bundle_id } else { slugify(g.title) }
      self.save_file(
        ctx,
        "thing-tracker-pack-\{slug}-\{day_key(self.now, self.tz)}.json",
        pack,
        "share",
      )
    }
    SetManageTab(manage_tab) => { ..self, manage_tab, manage_query: "", }
    SetManageQuery(manage_query) => { ..self, manage_query, }
    BrowseBundles =>
      { ..self, tab: Manage, manage_tab: Bundles, manage_query: "", }
    BackupNow => { ..self, tab: Manage, manage_tab: Data, }
    BackupLater =>
      { ..self, backup: { ..self.backup, dismissed_at: self.now, }, }
    SetInterval(value) => {
      let days = @string.parse_int(value) catch { _ => -1 }
      if intervals.iter().any(i => i.0 == days) {
        {
          ..self,
          backup: { ..self.backup, interval_days: days, dismissed_at: 0.0, },
        }
      } else {
        self
      }
    }
    ExportAll => {
      let name = match event_range(self.events.to_array()) {
        None => day_key(self.now, self.tz)
        Some((from, to)) =>
          "\{day_key(from, self.tz)}_to_\{day_key(to, self.tz)}"
      }
      self.save_file(
        ctx,
        "thing-tracker-backup-\{name}.json",
        build_backup(self.snapshot(), self.now),
        "backup",
      )
    }
    Saved(Ok("backup")) => {
      let range_text = match event_range(self.events.to_array()) {
        None => ""
        Some((from, to)) =>
          "\{format_date(from, self.tz, weekday=false, now=0.0)} – \{format_date(to, self.tz, weekday=false, now=0.0)}"
      }
      {
        ..self,
        backup: {
          ..self.backup,
          last_at: self.now,
          dismissed_at: 0.0,
          range_text,
        },
      }.toast(ctx, "Backup ready", "")
    }
    Saved(Ok(_)) => self.toast(ctx, "Shared", "The pack is ready to send.")
    Saved(Err(error)) => self.toast(ctx, "Export failed", error, kind=Failed)
    Saved(NotFound) =>
      self.toast(
        ctx,
        "Export failed",
        "This page can't save files.",
        kind=Failed,
      )
    SetImportMode(import_mode) => { ..self, import_mode, }
    SetImportText(import_text) => { ..self, import_text, }
    PreviewImport => self.open_import(ctx, "", self.import_text)
    ChooseFile(id, name) => {
      ctx.ask(@common.read_text, { id, name, }, r => Some(TextRead(r)))
      self
    }
    TextRead(Ok(text)) => self.open_import(ctx, "", text)
    TextRead(Err(error)) =>
      self.toast(ctx, "Couldn't read that file", error, kind=Failed)
    TextRead(NotFound) => self
    AddBundle(id) =>
      match find_bundle(id) {
        Some(b) =>
          { ..self, import_mode: MergeMode, }.open_import(
            ctx,
            b.title,
            b.pack.stringify(),
          )
        None => self
      }
    SetOverwrite(overwrite) => { ..self, overwrite, }
    CancelImport => { ..self, show_preview: false, import_source: "", }
    ConfirmImport => {
      let plan = self.plan()
      let app = { ..self, show_preview: false, import_source: "", }
      guard plan is Some(plan) && !plan.is_noop else { app }
      let next = apply_plan(plan, self.snapshot())
      let known = next.things.map(t => t.id)
      {
        ..app,
        things: Vec::of(next.things),
        groups: Vec::of(
          next.groups.map(g => {
            ..g,
            thing_ids: g.thing_ids.filter(id => known.contains(id)),
          }),
        ),
        events: Vec::of(next.events.filter(e => known.contains(e.thing_id))),
        import_text: "",
      }
      .toast(ctx, "Imported", imported_text(plan))
      .refresh()
    }
  }
}

///|
/// What the app's children tell it: each signal is the message of the same name, and stops
/// there.
fn[T] listen(
  sig : Signal[T],
  msg : (T) -> TrackerMsg,
) -> @tutuca.Listener[TrackerApp, TrackerMsg] {
  sig.on((a, payload, ctx) => {
    ctx.stop()
    a.update(msg(payload), ctx)
  })
}

///|
fn ids_unique(a : TrackerApp) -> Bool {
  let ids = [
    ..a.things.iter().map(t => t.id),
    ..a.groups.iter().map(g => g.id),
    ..a.events.iter().map(e => e.id),
  ]
  let seen : Map[String, Bool] = Map([])
  for id in ids {
    if seen.contains(id) {
      return false
    }
    seen[id] = true
  }
  true
}

///|
pub let tracker_app : Component[TrackerApp, TrackerMsg] = component(
  "TrackerApp",
  children=() => {
    [
      @tutuca.each_child(thing_c, things_items),
      @tutuca.each_child(tag_c, groups_items),
      @tutuca.each_child(section_c, sections_items),
      @tutuca.each_child(bucket_c, buckets_items),
      @tutuca.child(panel_c, panel_lens),
    ]
  },
  fields=[
    @tutuca.field_info("now", Whole, constraints=[AtLeast(0)], initial=0, checks=[
      "now is never negative",
    ]),
    @tutuca.field_info(
      "tz",
      Whole,
      constraints=[AtLeast(-840), AtMost(840)],
      initial=0,
      checks=["the time zone is -840 to 840"],
    ),
    @tutuca.field_info(
      "tab",
      OneOf(["track", "insights", "manage"]),
      initial="track",
    ),
    @tutuca.field_info("things", ListOf(ComponentOf(["Thing"])), initial=[]),
    @tutuca.field_info("groups", ListOf(ComponentOf(["Tag"])), initial=[]),
    @tutuca.field_info(
      "events",
      ListOf(
        RecordOf([
          ("id", Text),
          ("thing_id", Text),
          ("recorded_at", Number),
          ("actual_at", Number),
          ("measurements", ListOf(Anything)),
          ("notes", Text),
        ]),
      ),
      initial=[],
    ),
    @tutuca.field_info("order", ListOf(Text), initial=[]),
    @tutuca.field_info("collapsed", ListOf(Text), initial=[]),
    @tutuca.field_info("query", Text, initial=""),
    @tutuca.field_info("compact", Boolean, initial=false),
    @tutuca.field_info("sections", ListOf(ComponentOf(["Section"])), initial=[]),
    @tutuca.field_info(
      "granularity",
      OneOf(["day", "week", "month"]),
      initial="day",
    ),
    @tutuca.field_info("group_filter", Text, initial=""),
    @tutuca.field_info("buckets", ListOf(ComponentOf(["Bucket"])), initial=[]),
    @tutuca.field_info(
      "shown_entries",
      Whole,
      constraints=[AtLeast(1)],
      initial=200,
      checks=["at least one entry is shown"],
    ),
    @tutuca.field_info(
      "list_context",
      Optional(
        RecordOf([("thing_id", Text), ("start", Number), ("end", Number)]),
      ),
    ),
    @tutuca.field_info(
      "manage_tab",
      OneOf(["things", "groups", "units", "bundles", "data"]),
      initial="things",
    ),
    @tutuca.field_info("manage_query", Text, initial=""),
    @tutuca.field_info(
      "panel",
      Optional(
        ComponentOf([
          "MeasurementWizard", "EventEditor", "ThingEditor", "TagEditor", "EntryList",
        ]),
      ),
    ),
    @tutuca.field_info(
      "toast",
      Optional(
        RecordOf([
          ("id", Whole),
          ("title", Text),
          ("text", Text),
          ("event_id", Text),
          ("kind", Text),
        ]),
      ),
    ),
    @tutuca.field_info("toast_seq", Whole, constraints=[AtLeast(0)], initial=0),
    @tutuca.field_info("hint_shown", Boolean, initial=false),
    @tutuca.field_info("next_id", Whole, constraints=[AtLeast(1)], initial=1, checks=[
      "ids start at 1",
    ]),
    @tutuca.field_info(
      "backup",
      RecordOf([
        ("last_at", Number),
        ("interval_days", Whole),
        ("dismissed_at", Number),
        ("range_text", Text),
      ]),
      checks=["the backup interval is one of the choices"],
    ),
    @tutuca.field_info(
      "import_mode",
      OneOf(["merge", "replace"]),
      initial="merge",
    ),
    @tutuca.field_info("import_text", Text, initial=""),
    @tutuca.field_info("import_source", Text, initial=""),
    @tutuca.field_info("import_title", Text, initial=""),
    @tutuca.field_info("show_preview", Boolean, initial=false),
    @tutuca.field_info("overwrite", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages(
    [
      "SetTab", "SyncNow", "SetNow", "Reorder", "SetQuery", "ToggleCompact", "ToggleSection",
      "ToggleAllSections", "LogThing", "CommitLog", "BackdateThing", "SaveEntry",
      "EditEntry", "DeleteEntry", "UndoToast", "EditToast", "DismissToast", "SetGranularity",
      "SetGroupFilter", "ClearGroupFilter", "OpenChip", "OpenAllEntries", "NewThing",
      "NewThingFromQuery", "EditThing", "SaveThing", "DeleteThing", "NewTag", "EditTag",
      "SaveTag", "DeleteTag", "ShareTag", "SetManageTab", "SetManageQuery", "BrowseBundles",
      "BackupNow", "BackupLater", "SetInterval", "ExportAll", "SetImportMode", "SetImportText",
      "PreviewImport", "ChooseFile", "AddBundle", "SetOverwrite", "CancelImport",
      "ConfirmImport",
      // What JS writes as plain handlers, which its form lists after the typed ones.
       "NowIs", "ClosePanel", "ToastDone", "MoreEntries", "Saved", "TextRead",
    ],
    replies=[
      @tutuca.reply("NowIs", @common.now),
      @tutuca.reply("ToastDone", @common.wait),
      @tutuca.reply("Saved", @common.save_file),
      @tutuca.reply("TextRead", @common.read_text),
    ],
  ),
  view=TrackerApp::view,
  update=TrackerApp::update,
  provides=[
    things_provided.from(
      @tutuca.field("things", a => a.things, (a, things) => { ..a, things, }),
    ),
  ],
  on=[
    listen(log_thing, id => LogThing(id)),
    listen(backdate_thing, id => BackdateThing(id)),
    listen(edit_thing, id => EditThing(id)),
    listen(toggle_section, id => ToggleSection(id)),
    listen(toggle_all_sections, _ => ToggleAllSections),
    listen(open_chip, c => OpenChip(c)),
    listen(commit_log, v => CommitLog(v.0, v.1)),
    listen(save_entry, e => SaveEntry(e)),
    listen(edit_entry, id => EditEntry(id)),
    listen(delete_entry, id => DeleteEntry(id)),
    listen(close_panel, _ => ClosePanel),
    listen(more_entries, _ => MoreEntries),
    listen(save_thing, v => SaveThing(v.0, v.1)),
    listen(delete_thing, id => DeleteThing(id)),
    listen(save_tag, v => SaveTag(v.0, v.1)),
    listen(delete_tag, id => DeleteTag(id)),
    edit_tag.from(groups_items, (a, _, i, ctx) => {
      ctx.stop()
      a.update(EditTag(i), ctx)
    }),
    share_tag.from(groups_items, (a, _, i, ctx) => {
      ctx.stop()
      a.update(ShareTag(i), ctx)
    }),
  ],
  invariants=[
    (
      "stats match events",
      a => {
        let usage = usage_of(a.events.iter())
        a.things.all(t => {
          t.total == usage.get(t.id).map(u => u.total).unwrap_or(0)
        })
      },
    ),
    (
      "events know their thing",
      a => a.events.all(e => a.find_thing(e.thing_id) is Some(_)),
    ),
    ("ids are unique", ids_unique),
    ("the time zone is -840 to 840", a => a.tz >= -840 && a.tz <= 840),
    ("now is never negative", a => a.now >= 0.0),
    ("at least one entry is shown", a => a.shown_entries >= 1),
    ("ids start at 1", a => a.next_id >= 1),
    (
      "the backup interval is one of the choices",
      a => intervals.iter().any(i => i.0 == a.backup.interval_days),
    ),
  ],
)

///|
/// The open panel of each kind, from the app: where tests and stories send panel messages.
pub let wizard_panel : Lens[TrackerApp, MeasurementWizard] = panel_lens.then(
  wizard_variant,
)

///|
pub let event_panel : Lens[TrackerApp, EventEditor] = panel_lens.then(
  event_variant,
)

///|
pub let thing_editor_panel : Lens[TrackerApp, ThingEditor] = panel_lens.then(
  thing_editor_variant,
)

///|
pub let tag_editor_panel : Lens[TrackerApp, TagEditor] = panel_lens.then(
  tag_editor_variant,
)

///|
pub let entries_panel : Lens[TrackerApp, EntryList] = panel_lens.then(
  entries_variant,
)
