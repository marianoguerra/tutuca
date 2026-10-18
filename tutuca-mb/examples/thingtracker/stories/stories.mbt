// The thing tracker stories, from components/thing-tracker/stories.js: the pieces, the panels
// alone and the app.

///|
using @storybook {
  story,
  send,
  send_to,
  event,
  check,
  find,
  css,
  book,
  type Book,
  type Step,
}

///|
using @tt {
  fixture_now,
  habit,
  drink,
  sample_app,
  tracker_app,
  tracker_app_of,
  type TrackerApp,
  type TrackerMsg,
}

///|
/// The asks the tracker makes: saves and reads in memory, waits that never end (toasts stay
/// up), and the time an hour and a half after the stories' now.
fn asks(s : @tutuca.Scope) -> Unit {
  @common.handle_in_memory(s, [])
  @common.handle_clock_in_memory(
    s,
    () => fixture_now + 90.0 * @tt.minute,
    @common.Timers::new(),
  )
}

///|
/// The app messages the UI sends, for stress tests.
fn app_targets() -> Array[@testing.Target[TrackerApp, TrackerMsg]] {
  [
    @testing.root_messages(keep=m => {
      m
      is (SetTab(_)
      | SetQuery(_)
      | ToggleCompact
      | ToggleSection(_)
      | ToggleAllSections
      | Reorder
      | SetNow(_)
      | SetGranularity(_)
      | SetGroupFilter(_)
      | ClearGroupFilter
      | SetManageTab(_)
      | SetManageQuery(_)
      | UndoToast
      | DismissToast
      | BackupLater
      | SetInterval(_)
      | DeleteThing(_)
      | DeleteTag(_))
    }),
    @testing.item_messages(@tt.thing_c, @tt.things_items),
    @testing.item_messages(@tt.section_c, @tt.sections_items, keep=m => {
      m is Toggle
    }),
    @testing.item_messages(@tt.bucket_c, @tt.buckets_items),
    @testing.child_messages(@tt.measurement_wizard, @tt.wizard_panel, keep=m => {
      m is (Next | Back)
    }),
    @testing.child_messages(@tt.event_editor, @tt.event_panel, keep=m => {
      m is (Save | SetWhen(_))
    }),
    @testing.child_messages(@tt.entry_list, @tt.entries_panel, keep=m => {
      m is Remove(_)
    }),
  ]
}

///|
fn thing_of(id : String) -> @tt.Thing {
  sample_app().find_thing(id).unwrap()
}

///|
fn in_panel(app : TrackerApp, f : (@tt.Panel) -> Bool) -> Bool {
  app.panel.map(f).unwrap_or(false)
}

///|
fn last_event(s : TrackerApp) -> @tt.EventRecord {
  s.events.last().unwrap()
}

///|
fn minutes(n : Double) -> Double {
  n * @tt.minute
}

///|
/// The aria label of the sample's run.

///|
fn[N : @vdom.DomNode] pieces() -> Array[@storybook.Story[N]] {
  [
    story("Thing/Never logged", @tt.thing_c, () => thing_of(habit("breakfast"))),
    story("Thing/Logged often", @tt.thing_c, () => thing_of(drink("coffee"))),
    story("Thing/With measurements", @tt.thing_c, () => thing_of(habit("run"))),
    story("Section/Header", @tt.section_c, () => sample_app().sections[0], sequences=[
      (
        "toggle notifies the app",
        [send(Toggle), check("still open: the app decides", s => s.is_open)],
      ),
    ]),
    story("Bucket/Today", @tt.bucket_c, () => sample_app().buckets[0]),
    story("Bucket/Quiet days", @tt.bucket_c, () => {
      sample_app().buckets.iter().find_first(b => b.gap > 0).unwrap()
    }),
    story(
      "Prompt/Duration",
      @tt.prompt_c,
      () => {
        kind: Duration,
        unit_id: "min",
        base: minutes(30.0),
        text: "30",
        history: @tutuca.Vec::of([minutes(30.0), minutes(45.0), minutes(30.0)]),
      },
      sequences=[
        (
          "type, adjust and change unit",
          [
            event("input", css("input"), value="20"),
            check("20 minutes", s => {
              s.base == minutes(20.0) && s.formatted() == "20m"
            }),
            event("click", css("[aria-label=\"Add 10 minutes\"]")),
            check("30 minutes", s => s.formatted() == "30m"),
            send(SetUnit("h")),
            check("in hours", s => s.text == "0.5"),
            event("click", css("button[value=\"2700000\"]")),
            check("a usual value", s => s.base == minutes(45.0)),
            send(Adjust("-60")),
            check("never below zero", s => s.base == 0.0),
          ],
        ),
      ],
      targets=[@testing.root_messages()],
      max_steps=12,
    ),
    story(
      "Prompt/Temperature (field view)",
      @tt.prompt_c,
      () => {
        kind: Temperature,
        unit_id: "c",
        base: 37.2,
        text: "37.2",
        history: @tutuca.Vec::new(),
      },
      sequences=[
        (
          "to Fahrenheit",
          [
            send(SetUnit("f")),
            check("98.96°F", s => s.text == "99" && s.formatted() == "99°F"),
          ],
        ),
      ],
    ),
    story(
      "Emoji picker",
      @tt.emoji_picker,
      () => @tt.EmojiPicker::new(value="☕"),
      sequences=[
        (
          "browse, search and pick",
          [
            event("click", css("[title=\"Mood\"]")),
            check("mood emoji", s => {
              s.matches().iter().all(e => e.category is Mood)
            }),
            event("input", css("[aria-label=\"Search emoji\"]"), value="coff"),
            check("coffee first", s => s.matches()[0].glyph == "☕"),
            event("click", css("button[value=\"☕\"]")),
            check("in recents", s => s.recent.get(0) == Some("☕")),
            event("input", css("[aria-label=\"Search emoji\"]"), value="zzzqqq"),
            check("nothing matches", s => s.matches().is_empty()),
            event("input", css("[aria-label=\"Paste an emoji\"]"), value="🦆"),
            check("pasted", s => s.value == "🦆"),
          ],
        ),
      ],
      targets=[@testing.root_messages()],
      max_steps=10,
    ),
  ]
}

///|
// Panels alone; what they'd tell the app goes nowhere at the root.
fn[N : @vdom.DomNode] panels() -> Array[@storybook.Story[N]] {
  [
    story(
      "Panel/Measurement wizard",
      @tt.measurement_wizard,
      () => {
        @tt.MeasurementWizard::new(habit("run"), "🏃", "Run", [
          {
            kind: Distance,
            unit_id: "km",
            base: 5000.0,
            text: "5",
            history: @tutuca.Vec::of([5000.0, 8000.0, 5000.0]),
          },
          {
            kind: Duration,
            unit_id: "min",
            base: 0.0,
            text: "",
            history: @tutuca.Vec::new(),
          },
        ])
      },
      sequences=[
        (
          "step through and ask before discarding",
          [
            check("1 of 2", s => {
              s.step_text() == "1 of 2" && s.primary_label() == "Next"
            }),
            send(Next),
            check("can't log nothing", s => s.cannot_go()),
            send_to(@tt.prompt_c, @tt.prompts_items.at(1), SetText("28")),
            check("logs 28m", s => s.primary_label() == "Log 28m"),
            send(Back),
            check("back to distance", s => s.step == 0),
            send(RequestClose),
            check("asks first", s => s.confirming),
            send(KeepEditing),
            check("kept", s => !s.confirming),
          ],
        ),
      ],
      targets=[
        @testing.root_messages(),
        @testing.item_messages(@tt.prompt_c, @tt.prompts_items),
      ],
      max_steps=12,
    ),
    story(
      "Panel/Event editor",
      @tt.event_editor,
      () => {
        @tt.EventEditor::new(
          Edit,
          event_id="event-5",
          heading="🏃 Run",
          subtitle="Recorded yesterday",
          when_="2026-10-15T08:30",
          notes="Felt great",
          values=[
            {
              kind: Distance,
              unit_id: "km",
              base: 5000.0,
              text: "5",
              history: @tutuca.Vec::new(),
            },
          ],
        )
      },
      sequences=[
        (
          "an invalid time can't be saved",
          [
            event(
              "input",
              css("[aria-label=\"When did it happen?\"]"),
              value="",
            ),
            check("invalid", s => s.is_invalid()),
            event(
              "input",
              css("[aria-label=\"When did it happen?\"]"),
              value="2026-10-15T07:00",
            ),
            check("valid again", s => {
              s.actual_at() == Some(@tt.utc(2026, 9, 15, h=7))
            }),
          ],
        ),
      ],
      targets=[
        @testing.root_messages(),
        @testing.item_messages(@tt.prompt_c, @tt.values_items),
      ],
    ),
    story(
      "Panel/Thing editor",
      @tt.thing_editor,
      () => @tt.ThingEditor::new(Create, picker_open=true),
      sequences=[
        (
          "create a thing in three steps",
          [
            check("needs a name", s => s.cannot_go()),
            event("input", css("[aria-label=\"Name\"]"), value="Swim"),
            send_to(@tt.emoji_picker, @tt.thing_picker_lens, Pick("🏊")),
            check("picked, picker closed", s => {
              s.emoji == "🏊" && !s.picker_open
            }),
            send(Next),
            // The choices are by name: Count, then Distance.
            event("change", css("input[value=\"distance\"]"), value="true"),
            check("distance ticked", s => {
              s.measurements
              .get(0)
              .map(r => r.kind is Distance)
              .unwrap_or(false)
            }),
            send(SetUnit("distance|m")),
            check("distance in metres", s => s.measurements[0].unit == "m"),
            send(Next),
            send(SetDescription("Lengths count")),
            check("ready to create", s => s.primary_label() == "Create"),
          ],
        ),
      ],
      targets=[
        @testing.root_messages(),
        @testing.child_messages(@tt.emoji_picker, @tt.thing_picker_lens),
      ],
      max_steps=12,
    ),
    story(
      "Panel/Tag editor",
      @tt.tag_editor,
      () => {
        let app = sample_app()
        let tag = app.groups[0]
        @tt.TagEditor::new(
          Edit,
          tag_id=tag.id,
          title=tag.title,
          emoji=tag.emoji,
          members=app.things
            .iter()
            .map(t => {
              (
                {
                  id: t.id,
                  emoji: t.emoji,
                  title: t.title,
                  checked: tag.thing_ids.contains(t.id),
                } : @tt.Member)
            })
            .to_array(),
        )
      },
      sequences=[
        (
          "search and tick",
          [
            event("input", css("[aria-label=\"Search things\"]"), value="cof"),
            send(
              ToggleMember(
                sample_app().things
                .find_index(t => t.id == drink("coffee"))
                .unwrap(),
              ),
            ),
            check("7 selected", s => s.selected_text() == "7 selected"),
          ],
        ),
      ],
      targets=[@testing.root_messages()],
    ),
    story(
      "Panel/Entry list",
      @tt.entry_list,
      () => {
        ..@tt.EntryList::new(subtitle="2 of 9, newest first"),
        remaining: 7,
        rows: @tutuca.Vec::of([
          {
            id: "event-1",
            head: "☕ Coffee",
            line: "Fri 16 Oct · 08:30",
            notes: "",
            recorded: "",
          },
          {
            id: "event-8",
            head: "📖 Read",
            line: "Sat 10 Oct · 10:30",
            notes: "Finished it",
            recorded: "recorded 10:30",
          },
        ]),
      },
      sequences=[
        (
          "close without asking",
          [send(RequestClose), check("nothing to confirm", s => !s.confirming)],
        ),
      ],
      targets=[@testing.root_messages()],
    ),
  ]
}

///|
fn[N : @vdom.DomNode] app_story(
  name : String,
  make : () -> TrackerApp,
  sequences~ : Array[(String, Array[Step[TrackerApp, TrackerMsg]])] = [],
  max_steps~ : Int32 = 20,
) -> @storybook.Story[N] {
  story(
    name,
    tracker_app,
    make,
    sequences~,
    targets=app_targets(),
    asks~,
    max_steps~,
  )
}

///|
fn[N : @vdom.DomNode] apps() -> Array[@storybook.Story[N]] {
  [
    app_story("App/Empty", () => tracker_app_of(fixture_now), sequences=[
      (
        "load a bundle",
        [
          event("click", css("button.btn-primary")),
          check("on bundles", s => s.manage_tab is Bundles),
          event("click", css("button[value=\"mood\"]")),
          check("previewed", s => {
            s.show_preview &&
            s.preview().lines.join(",") == "10 new things,1 new tag"
          }),
          send(ConfirmImport),
          check("ten moods", s => {
            s.things.length() == 10 &&
            s.toast.map(t => t.title) == Some("Imported")
          }),
          send(SetTab(Track)),
          check("one section", s => {
            s.sections.length() == 1 && s.sections[0].title == "Mood"
          }),
        ],
      ),
    ]),
    app_story(
      "App/Track",
      sample_app,
      sequences=[
        (
          "log, undo and log with measurements",
          [
            send(LogThing(habit("breakfast"))),
            check("logged with a toast", s => {
              s.toast.map(t => t.kind is Logged).unwrap_or(false) &&
              s.events.length() == 10
            }),
            send(UndoToast),
            check("undone", s => s.events.length() == 9 && s.toast is None),
            event("click", css("[aria-label^=\"Log Run,\"]")),
            check("asks for distance, last time's", s => {
              in_panel(s, p => {
                p is WizardPanel(w) && w.prompts[0].base == 5000.0
              })
            }),
            send_to(@tt.measurement_wizard, @tt.wizard_panel, Next),
            send_to(@tt.measurement_wizard, @tt.wizard_panel, Next),
            check("logged 5km and 28m", s => {
              last_event(s).measurements.length() == 2 && s.panel is None
            }),
            check("toast says so", s => {
              s.toast.map(t => t.text) == Some("5km · 28m at 10:30")
            }),
          ],
        ),
        (
          "search, collapse and compact",
          [
            event(
              "input",
              css("[aria-label=\"Search things\"]"),
              value="coffee",
            ),
            check("one thing found", s => {
              s.sections.length() == 1 && s.sections[0].member_ids.length() == 1
            }),
            send(SetQuery("unicorn")),
            check("nothing matches", s => s.no_matches()),
            event("click", css("main .btn-primary")),
            check("create it", s => {
              in_panel(s, p => p is ThingPanel(e) && e.title == "unicorn")
            }),
            send(ClosePanel),
            send(SetQuery("")),
            send(ToggleAllSections),
            check("all collapsed", s => !s.any_open()),
            event("click", css("[aria-label=\"Expand all sections\"]")),
            check("all open", s => s.sections.all(x => x.is_open)),
            send(ToggleCompact),
            check("compact", s => s.grid_view() == "compact"),
          ],
        ),
        (
          "backdate with a long press",
          [
            event("contextmenu", css("[aria-label^=\"Log Run,\"]")),
            check("an unsaved entry", s => {
              in_panel(s, p => p is EventPanel(e) && e.mode is Create) &&
              s.events.length() == 9
            }),
            send_to(
              @tt.event_editor,
              @tt.event_panel,
              SetWhen("2026-10-16T07:00"),
            ),
            send_to(@tt.event_editor, @tt.event_panel, Save),
            check("logged at 7", s => {
              last_event(s).actual_at == @tt.utc(2026, 9, 16, h=7)
            }),
          ],
        ),
      ],
      max_steps=15,
    ),
    app_story("App/Insights by day", () => { ..sample_app(), tab: Insights, }, sequences=[
      (
        "drill into a chip, edit and delete an entry",
        [
          check("today, yesterday and a gap", s => {
            s.buckets[0].label == "Today" && s.buckets.any(b => b.gap > 0)
          }),
          event("click", css("[aria-label^=\"Water,\"]")),
          check("water today", s => {
            in_panel(s, p => {
              p is EntriesPanel(l) &&
              l.heading == "💧 Water" &&
              l.rows.length() == 1
            })
          }),
          send_to(@tt.entry_list, @tt.entries_panel, Open(0)),
          check("editing it", s => {
            in_panel(s, p => p is EventPanel(e) && e.mode is Edit)
          }),
          send_to(@tt.event_editor, @tt.event_panel, SetNotes("Big glass")),
          send_to(@tt.event_editor, @tt.event_panel, Save),
          check("saved", s => {
            s.events.iter().find_first(e => e.id == "event-3").map(e => e.notes) ==
            Some("Big glass")
          }),
          send(OpenAllEntries),
          check("all, newest first", s => {
            in_panel(s, p => {
              p is EntriesPanel(l) &&
              l.rows.length() == 9 &&
              l.subtitle == "9 of 9, newest first"
            })
          }),
          send_to(@tt.entry_list, @tt.entries_panel, Remove(0)),
          check("one less", s => {
            s.events.length() == 8 &&
            in_panel(s, p => p is EntriesPanel(l) && l.rows.length() == 8)
          }),
        ],
      ),
    ]),
    app_story("App/Insights by week", () => {
      { ..sample_app(), tab: Insights, granularity: Week, }.refresh()
    }),
    app_story(
      "App/Insights by month, filtered",
      () => {
        {
          ..sample_app(),
          tab: Insights,
          granularity: Month,
          group_filter: "group:habits/exercise",
        }.refresh()
      },
      sequences=[
        (
          "clear the filter",
          [
            check("only runs", s => {
              s.buckets.all(b => {
                b.chips.all(c => {
                  c.thing_id == habit("run") || c.thing_id == habit("nap")
                })
              })
            }),
            send(ClearGroupFilter),
            check("everything", s => s.buckets[0].total == 8),
          ],
        ),
      ],
    ),
    app_story("App/Manage things", () => { ..sample_app(), tab: Manage, }, sequences=[
      (
        "edit a thing",
        [
          event("input", css("[aria-label=\"Search things…\"]"), value="run"),
          event("click", css("li button")),
          check("editing Run", s => {
            in_panel(s, p => {
              p is ThingPanel(e) && e.title == "Run" && e.mode is Edit
            })
          }),
          send_to(@tt.thing_editor, @tt.thing_editor_panel, SetTitle("Jog")),
          send_to(@tt.thing_editor, @tt.thing_editor_panel, Next),
          send_to(@tt.thing_editor, @tt.thing_editor_panel, Next),
          send_to(@tt.thing_editor, @tt.thing_editor_panel, Next),
          check("renamed", s => s.things.any(t => t.title == "Jog")),
        ],
      ),
      (
        "delete a thing and its entries",
        [
          send(EditThing(habit("run"))),
          send_to(@tt.thing_editor, @tt.thing_editor_panel, Remove),
          check("gone with its entries", s => {
            !s.events.any(e => e.thing_id == habit("run"))
          }),
          check("and from its tag", s => {
            !s.groups.any(g => g.thing_ids.contains(habit("run")))
          }),
        ],
      ),
    ]),
    app_story(
      "App/Manage tags",
      () => { ..sample_app(), tab: Manage, manage_tab: Groups, },
      sequences=[
        (
          "make a tag",
          [
            send(NewTag),
            send_to(@tt.tag_editor, @tt.tag_editor_panel, SetTitle("Morning")),
            send_to(@tt.tag_editor, @tt.tag_editor_panel, ToggleMember(0)),
            send_to(@tt.tag_editor, @tt.tag_editor_panel, Save),
            check("last tag", s => {
              s.groups.last().map(g => (g.title, g.thing_ids.length())) ==
              Some(("Morning", 1))
            }),
          ],
        ),
        (
          "share a tag",
          [
            event("click", find("button", attr=("aria-label", "Share Food"))),
            check("shared", s => s.toast.map(t => t.title) == Some("Shared")),
          ],
        ),
      ],
    ),
    app_story("App/Manage units", () => {
      ..sample_app(),
      tab: Manage,
      manage_tab: Units,
    }),
    app_story("App/Manage bundles", () => {
      ..sample_app(),
      tab: Manage,
      manage_tab: Bundles,
    }),
    app_story(
      "App/Manage data",
      () => { ..sample_app(), tab: Manage, manage_tab: Data, },
      sequences=[
        (
          "export, then import into a new app",
          [
            send(ExportAll),
            check("backed up", s => {
              s.backup.last_at == fixture_now &&
              s.toast.map(t => t.title) == Some("Backup ready")
            }),
            check("no reminder", s => !s.backup_due()),
            send(SetImportText("{")),
            send(PreviewImport),
            check("not JSON", s => {
              s.toast.map(t => t.text) == Some("That file isn't JSON.")
            }),
            send(
              SetImportText(
                "{\"format\":\"thing-tracker/backup\",\"version\":1,\"things\":[],\"groups\":[],\"events\":[]}",
              ),
            ),
            send(SetImportMode(ReplaceMode)),
            send(PreviewImport),
            check("warns", s => {
              s.preview().warnings
              .get(0)
              .map(w => {
                w.has_prefix("Replaces everything on this device: 29 things")
              })
              .unwrap_or(false)
            }),
            send(ConfirmImport),
            check("empty", s => s.things.is_empty() && s.events.is_empty()),
          ],
        ),
        (
          "remind me",
          [send(SetInterval("0")), check("never due", s => !s.backup_due())],
        ),
      ],
    ),
    app_story("App/Sync time", sample_app, sequences=[
      (
        "an hour and a half later",
        [
          send(SyncNow),
          check("coffee 4h ago", s => {
            s.find_thing(drink("coffee")).map(t => t.last_text) ==
            Some("4h ago")
          }),
        ],
      ),
    ]),
    @storybook.generated_story(
      "App/Generated",
      tracker_app,
      @tt.generate_app,
      targets=app_targets(),
      asks~,
      max_steps=15,
    ),
    app_story("App/DOM events", sample_app, max_steps=15),
  ]
}

///|
/// The thing tracker book, for any DOM: memdom in tests, the browser's in the storybook page.
pub fn[N : @vdom.DomNode] thing_tracker_book() -> Book[N] {
  book("Thing tracker", [..pieces(), ..panels(), ..apps()], specs=[
    @storybook.spec(@tt.tracker_app),
    @storybook.spec(@tt.thing_c),
    @storybook.spec(@tt.tag_c),
    @storybook.spec(@tt.section_c),
    @storybook.spec(@tt.bucket_c),
    @storybook.spec(@tt.prompt_c),
    @storybook.spec(@tt.emoji_picker),
    @storybook.spec(@tt.measurement_wizard),
    @storybook.spec(@tt.event_editor),
    @storybook.spec(@tt.thing_editor),
    @storybook.spec(@tt.tag_editor),
    @storybook.spec(@tt.entry_list),
  ])
}
