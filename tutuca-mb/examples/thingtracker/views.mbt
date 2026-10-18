// TrackerApp's views, from views.js and index.js: Track, Insights, Manage, Data, the import
// dialog, the tab bar and the toast.

///|
fn search_box(placeholder : String) -> View[TrackerApp, TrackerMsg] {
  input([
    attr("type", "search"),
    cls("input input-sm mb-3 w-full"),
    attr("placeholder", placeholder),
    aria("label", placeholder),
    value(s => s.manage_query),
    on_input(v => SetManageQuery(v)),
  ])
}

///|
fn TrackerApp::compact_class(self : TrackerApp) -> String {
  if self.compact {
    "\{icon_toggle} border-transparent bg-primary text-primary-content"
  } else {
    "\{icon_toggle} border-base-300 \{muted}"
  }
}

///|
fn TrackerApp::collapse_label(self : TrackerApp) -> String {
  if self.any_open() {
    "Collapse all sections"
  } else {
    "Expand all sections"
  }
}

///|
fn track_view() -> View[TrackerApp, TrackerMsg] {
  when(
    s => s.tab is Track,
    div([], [
      if_(
        s => s.has_things(),
        div([], [
          div([cls("\{sticky} flex items-center gap-2")], [
            div([cls("relative flex-1")], [
              span(
                [
                  cls(
                    "absolute top-1/2 left-2.5 -translate-y-1/2 text-sm \{muted}",
                  ),
                ],
                [txt("⌕")],
              ),
              input([
                attr("type", "search"),
                cls("input input-sm w-full pl-8"),
                attr("placeholder", "Search things…"),
                aria("label", "Search things"),
                value(s => s.query),
                on_input(v => SetQuery(v)),
              ]),
            ]),
            button(
              [
                cls("\{icon_toggle} border-base-300 \{muted}"),
                bind_str("aria-label", s => s.collapse_label()),
                bind_str("title", s => s.collapse_label()),
                on_click(ToggleAllSections),
              ],
              [show(s => if s.any_open() { "⇡" } else { "⇣" })],
            ),
            button(
              [
                class_(s => s.compact_class()),
                bind_str("aria-label", s => {
                  if s.compact {
                    "Show labels"
                  } else {
                    "Hide labels"
                  }
                }),
                bind_str("title", s => {
                  if s.compact {
                    "Show labels"
                  } else {
                    "Hide labels"
                  }
                }),
                bind_str("aria-pressed", s => s.compact.to_string()),
                on_click(ToggleCompact),
              ],
              [txt("▦")],
            ),
          ]),
          when(
            s => s.backup_due(),
            div([cls(banner)], [
              p([cls("font-medium")], [
                show(s => {
                  if s.backup.last_at == 0.0 {
                    "You haven't backed up yet"
                  } else {
                    "Time for a backup"
                  }
                }),
              ]),
              p([cls("mt-0.5 \{muted}")], [
                show(s => {
                  if s.backup.last_at == 0.0 {
                    "Everything you've logged lives only in this browser. One file keeps it safe."
                  } else {
                    "Your last backup was \{days_ago(s.backup.last_at, s.now)}."
                  }
                }),
              ]),
              div([cls("mt-1 flex gap-3")], [
                button([cls(link), on_click(BackupNow)], [txt("Back up now")]),
                button([cls(link), on_click(BackupLater)], [txt("Later")]),
              ]),
            ]),
          ),
          if_(
            s => s.no_matches(),
            div([cls("space-y-3 px-4 py-10 text-center")], [
              p([cls("text-sm \{muted}")], [
                show(s => "Nothing matches “\{trim(s.query)}”."),
              ]),
              button(
                [cls("btn btn-primary btn-sm"), on_click(NewThingFromQuery)],
                [show(s => "Create “\{trim(s.query)}”")],
              ),
            ]),
            div([cls("pb-4")], [
              push_view(
                s => s.grid_view(),
                render_each(sections_items, section_c, key=(_, s) => s.id),
              ),
            ]),
          ),
        ]),
        div([cls("flex flex-col items-center gap-6 px-6 py-16 text-center")], [
          div([cls("text-5xl")], [txt("⚡")]),
          div([cls("space-y-1.5")], [
            h1([cls("text-lg font-semibold")], [txt("Nothing to track yet")]),
            p([cls("max-w-xs text-sm \{muted}")], [
              txt(
                "Start from a ready-made bundle, or add your own thing. Either way, one tap logs it.",
              ),
            ]),
          ]),
          div([cls("flex w-full max-w-xs flex-col gap-2")], [
            button([cls("btn btn-primary"), on_click(BrowseBundles)], [
              txt("Browse bundles"),
            ]),
            button([cls("btn btn-outline"), on_click(NewThing(""))], [
              txt("Create a thing"),
            ]),
          ]),
        ]),
      ),
    ]),
  )
}

///|
/// The tags with things the app has, in order, with their index: Insights' filter chips.
fn TrackerApp::used_groups(self : TrackerApp) -> Array[(Int32, Tag)] {
  let used = self.groups
    .entries()
    .filter(e => e.1.thing_ids.iter().any(id => self.find_thing(id) is Some(_)))
    .to_array()
  sorted_by(used, (a, b) => compare_groups(a.1, b.1))
}

///|
let granularities : Array[Granularity] = [Day, Week, Month]

///|
fn insights_view() -> View[TrackerApp, TrackerMsg] {
  when(
    s => s.tab is Insights,
    div([], [
      div([cls("\{sticky} space-y-2")], [
        div([cls("flex items-center gap-2")], [
          div(
            [
              cls("\{seg_class} flex-1"),
              attr("role", "group"),
              aria("label", "Granularity"),
            ],
            [
              each(
                s => granularities.iter().map(g => (g, g == s.granularity)),
                button(
                  [
                    class_(it => {
                      if it.value.1 {
                        "flex-1 rounded-md px-3 py-1.5 bg-base-100 shadow-sm"
                      } else {
                        "flex-1 rounded-md px-3 py-1.5 \{muted}"
                      }
                    }),
                    bind_str("value", it => it.value.0.name()),
                    on_event(Click, (it, _) => Some(SetGranularity(it.value.0))),
                  ],
                  [
                    show(it => {
                      let n = it.value.0.name()
                      n.view(end_offset=1).to_upper().to_owned() +
                      n.view(start_offset=1).to_owned()
                    }),
                  ],
                ),
              ),
            ],
          ),
          button(
            [
              cls("size-9 rounded-md border border-base-300 \{muted}"),
              aria("label", "All entries"),
              attr("title", "All entries"),
              on_click(OpenAllEntries),
            ],
            [txt("☰")],
          ),
        ]),
        when(
          s => s.used_groups().length() > 0,
          div([cls("-mx-1 flex gap-1.5 overflow-x-auto px-1")], [
            button(
              [
                class_(s => pick(s.group_filter == "")),
                on_click(ClearGroupFilter),
              ],
              [txt("All")],
            ),
            each(
              s => {
                s
                .used_groups()
                .map(e => (e.0, e.1, e.1.id == s.group_filter))
                .iter()
              },
              button(
                [
                  class_(it => pick(it.value.2)),
                  on_event(Click, (it, _) => Some(SetGroupFilter(it.value.0))),
                ],
                [show(it => it.value.1.title)],
              ),
              key=(e, _) => e.1.id,
            ),
          ]),
        ),
      ]),
      if_(
        s => s.buckets.is_empty(),
        div([cls("flex flex-col items-center gap-3 px-6 py-16 text-center")], [
          div([cls("text-4xl")], [txt("🗓️")]),
          p([cls("text-sm \{muted}")], [
            txt(
              "Nothing logged yet. Entries show up here grouped by day, week or month.",
            ),
          ]),
        ]),
        div([], [render_each(buckets_items, bucket_c)]),
      ),
    ]),
  )
}

///|
/// Manage's things, with their index: by relevance while searching, else by title.
fn TrackerApp::manage_things(self : TrackerApp) -> Array[(Int32, Thing)] {
  let entries = self.things.entries().to_array()
  if trim(self.manage_query) != "" {
    filter_by(entries, self.manage_query, e => e.1.searchable())
  } else {
    sorted_by(entries, (a, b) => locale_compare(a.1.title, b.1.title))
  }
}

///|
/// Manage's tags that match the search, in order, with their index.
fn TrackerApp::manage_groups(self : TrackerApp) -> Array[(Int32, Tag)] {
  let kept = self.groups
    .entries()
    .filter(e => {
      matches_query([e.1.title, e.1.description, e.1.emoji], self.manage_query)
    })
    .to_array()
  sorted_by(kept, (a, b) => compare_groups(a.1, b.1))
}

///|
priv struct UnitRow {
  emoji : String
  name : String
  usage : String
  units : String
}

///|
fn TrackerApp::unit_rows(self : TrackerApp) -> Array[UnitRow] {
  let kept = measurements.filter(m => {
    matches_query(
      [
        m.name,
        m.emoji,
        ..m.units.iter().flat_map(u => [u.label, u.symbol].iter()),
      ],
      self.manage_query,
    )
  })
  sorted_by(kept, (a, b) => locale_compare(a.name, b.name)).map(m => {
    let n = self.things.count(t => t.measurements.any(r => r.kind == m.kind))
    {
      emoji: m.emoji,
      name: m.name,
      usage: if n == 0 {
        "unused"
      } else {
        plural(n, "thing")
      },
      units: m.units.map(symbol_of).join(" · "),
    }
  })
}

///|
priv struct BundleCard {
  id : String
  emoji : String
  title : String
  description : String
  counts : String
  added : Bool
}

///|
fn TrackerApp::bundle_cards(self : TrackerApp) -> Array[BundleCard] {
  bundles()
  .filter(b => {
    matches_query([b.title, b.description, b.emoji], self.manage_query)
  })
  .map(b => {
    id: b.id,
    emoji: b.emoji,
    title: b.title,
    description: b.description,
    counts: "\{b.thing_count} things · \{plural(b.group_count, "tag")}",
    added: self.things.any(t => t.bundle_id == b.id),
  })
}

///|
fn manage_view() -> View[TrackerApp, TrackerMsg] {
  when(
    s => s.tab is Manage,
    div([], [
      div([cls(sticky)], [
        div([cls(seg_class), attr("role", "tablist")], [
          each(
            s => manage_tabs.iter().map(t => (t.0, t.1, t.0 == s.manage_tab)),
            button(
              [
                class_(it => seg(it.value.2)),
                attr("role", "tab"),
                bind_str("value", it => manage_tab_id(it.value.0)),
                on_event(Click, (it, _) => Some(SetManageTab(it.value.0))),
              ],
              [show(it => it.value.1)],
            ),
          ),
        ]),
      ]),
      when(
        s => s.manage_tab is Things,
        div([cls("p-4")], [
          button([cls("btn btn-primary mb-3 w-full"), on_click(NewThing(""))], [
            txt("＋ New thing"),
          ]),
          if_(
            s => s.things.is_empty(),
            p([cls("text-sm \{muted}")], [
              txt("No things yet. Add one, or load a bundle."),
            ]),
            div([], [
              search_box("Search things…"),
              ul([cls("divide-y divide-base-300/60")], [
                each(
                  s => s.manage_things().iter(),
                  render_key(
                    things_items,
                    it => it.value.0,
                    thing_c,
                    view="row",
                  ),
                  key=(e, _) => e.1.id,
                ),
              ]),
            ]),
          ),
        ]),
      ),
      when(
        s => s.manage_tab is Groups,
        div([cls("p-4")], [
          button([cls("btn btn-primary mb-3 w-full"), on_click(NewTag)], [
            txt("＋ New tag"),
          ]),
          search_box("Search tags…"),
          p([cls("mb-3 text-xs \{muted}")], [
            txt(
              "Tags are yours alone — they organise your things and are what you share. Someone importing your tags can file the same things however they like.",
            ),
          ]),
          if_(
            s => s.groups.is_empty(),
            p([cls("text-sm \{muted}")], [
              txt(
                "No tags yet. Things without tags still show up under “Ungrouped”.",
              ),
            ]),
            ul([cls("divide-y divide-base-300/60")], [
              each(
                s => s.manage_groups().iter(),
                render_key(groups_items, it => it.value.0, tag_c, view="row"),
                key=(e, _) => e.1.id,
              ),
            ]),
          ),
        ]),
      ),
      when(
        s => s.manage_tab is Units,
        div([cls("p-4")], [
          p([cls("mb-3 text-xs \{muted}")], [
            txt(
              "Quantities a thing can record. Metric and imperial units sit inside the same measurement, so values are stored once and everyone reads them in whichever unit they think in.",
            ),
          ]),
          search_box("Search measurements…"),
          ul([cls("divide-y divide-base-300/60")], [
            each(
              s => s.unit_rows().iter(),
              li([cls("py-2.5")], [
                div([cls("flex items-center gap-3")], [
                  span([cls("emoji text-xl")], [show(it => it.value.emoji)]),
                  span([cls("flex-1 text-sm font-medium")], [
                    show(it => it.value.name),
                  ]),
                  span([cls("text-xs \{muted}")], [show(it => it.value.usage)]),
                ]),
                div([cls("pl-8 text-xs \{muted}")], [show(it => it.value.units)]),
              ]),
            ),
          ]),
        ]),
      ),
      when(
        s => s.manage_tab is Bundles,
        div([cls("p-4")], [
          p([cls("mb-3 text-xs \{muted}")], [
            txt(
              "Ready-made sets of things to track. Everyone who loads a bundle gets the same identifiers, so data recorded against it can be compared later.",
            ),
          ]),
          search_box("Search bundles…"),
          div([cls("flex flex-col gap-2")], [
            each(
              s => s.bundle_cards().iter(),
              div(
                [
                  cls(
                    "flex items-start gap-3 rounded-xl border border-base-300/60 bg-base-100 p-3",
                  ),
                ],
                [
                  span([cls("emoji text-2xl")], [show(it => it.value.emoji)]),
                  div([cls("min-w-0 flex-1")], [
                    h3(
                      [
                        cls(
                          "flex items-baseline gap-2 truncate text-sm font-medium",
                        ),
                      ],
                      [
                        show(it => it.value.title),
                        when(
                          it => it.value.added,
                          span([cls("text-[0.6875rem] \{muted}")], [
                            txt("added"),
                          ]),
                        ),
                      ],
                    ),
                    p([cls("text-xs \{muted}")], [
                      show(it => it.value.description),
                    ]),
                    p([cls("text-[0.6875rem] opacity-50")], [
                      show(it => it.value.counts),
                    ]),
                  ]),
                  button(
                    [
                      class_(it => {
                        if it.value.added {
                          "btn btn-outline btn-sm"
                        } else {
                          "btn btn-primary btn-sm"
                        }
                      }),
                      bind_str("value", it => it.value.id),
                      on_event(Click, (it, _) => Some(AddBundle(it.value.id))),
                    ],
                    [
                      show(it => if it.value.added { "Re-check" } else { "Add" }),
                    ],
                  ),
                ],
              ),
              key=(b, _) => b.id,
            ),
          ]),
        ]),
      ),
      when(s => s.manage_tab is Data, data_view()),
    ]),
  )
}

///|
fn data_view() -> View[TrackerApp, TrackerMsg] {
  let heading = (text : String) => h2([cls("text-sm font-medium")], [txt(text)])
  let hr = () => div([cls("h-px w-full bg-base-300")], [])
  div([cls("space-y-5 p-4")], [
    section([cls("space-y-1")], [
      heading("On this device"),
      p([cls("text-sm")], [
        show(s => {
          "\{s.things.length()} things · \{s.groups.length()} tags · \{s.events.length()} entries"
        }),
      ]),
      p([cls("text-xs \{muted}")], [
        txt(
          "Everything lives in this browser. No account, no server — which also means a backup is the only copy that survives clearing site data.",
        ),
      ]),
    ]),
    hr(),
    section([cls("space-y-2")], [
      heading("Backup"),
      p([cls("text-xs \{muted}")], [
        txt(
          "A single JSON file with every thing, tag and entry — for safekeeping or for analysing elsewhere.",
        ),
      ]),
      button([cls("btn btn-primary w-full"), on_click(ExportAll)], [
        txt("⤓ Export everything"),
      ]),
      p([cls("text-xs \{muted}")], [
        show(s => {
          let b = s.backup
          if b.last_at == 0.0 {
            "No backup made yet."
          } else {
            let covering = if b.range_text == "" {
              ""
            } else {
              ", covering \{b.range_text}"
            }
            "Last backup \{days_ago(b.last_at, s.now)}\{covering}."
          }
        }),
      ]),
      div([cls("flex flex-wrap items-center gap-1.5")], [
        span([cls("text-xs \{muted}")], [txt("Remind me every")]),
        each(
          s => {
            intervals.iter().map(i => (i.0, i.1, i.0 == s.backup.interval_days))
          },
          button(
            [
              class_(it => pick(it.value.2)),
              bind_str("value", it => it.value.0.to_string()),
              on_event(Click, (it, _) => {
                Some(SetInterval(it.value.0.to_string()))
              }),
            ],
            [show(it => it.value.1)],
          ),
        ),
      ]),
    ]),
    hr(),
    section([cls("space-y-2")], [
      heading("Restore or import"),
      p([cls("text-xs \{muted}")], [
        txt(
          "Open a backup or a shared tag pack. You'll see exactly what changes before anything is written.",
        ),
      ]),
      div([cls("flex gap-2")], [
        each(
          s => {
            [(MergeMode, "Merge"), (ReplaceMode, "Replace")]
            .iter()
            .map(m => (m.0, m.1, m.0 == s.import_mode))
          },
          button(
            [
              class_(it => {
                if it.value.2 {
                  "flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-content"
                } else {
                  "flex-1 rounded-md border border-base-300 px-3 py-1.5 text-sm font-medium"
                }
              }),
              bind_str("value", it => it.value.1.to_lower()),
              on_event(Click, (it, _) => Some(SetImportMode(it.value.0))),
            ],
            [show(it => it.value.1)],
          ),
        ),
      ]),
      p([cls("text-xs \{muted}")], [
        show(s => {
          if s.import_mode is MergeMode {
            "Keeps what's here and adds what's missing. Entries are never duplicated."
          } else {
            "Deletes everything on this device first. Only applies to full backups."
          }
        }),
      ]),
      label([cls("btn btn-outline w-full")], [
        txt("⤒ Choose a file"),
        input([
          attr("type", "file"),
          attr("accept", "application/json,.json"),
          cls("hidden"),
          on_event(Change, (_, e) => {
            e.files().get(0).map(f => ChooseFile(f.id, f.name))
          }),
        ]),
      ]),
      textarea([
        cls("textarea w-full font-mono text-xs"),
        attr("rows", "3"),
        attr("placeholder", "…or paste a backup or tag pack"),
        aria("label", "Paste a file"),
        value(s => s.import_text),
        on_input(v => SetImportText(v)),
      ]),
      button([cls("btn btn-outline btn-sm w-full"), on_click(PreviewImport)], [
        txt("Preview import"),
      ]),
    ]),
  ])
}

///|
/// What the import preview shows.
pub(all) struct Preview {
  lines : Array[String]
  warnings : Array[String]
  description : String
  is_noop : Bool
  can_overwrite : Bool
  replace : Bool
}

///|
pub fn TrackerApp::preview(self : TrackerApp) -> Preview {
  match self.plan() {
    None =>
      {
        lines: [],
        warnings: [],
        description: "",
        is_noop: true,
        can_overwrite: false,
        replace: false,
      }
    Some(plan) =>
      {
        lines: plan.lines,
        warnings: plan.warnings,
        description: if plan.is_noop {
          "You already have every thing in this file."
        } else {
          "Here's what will change on this device."
        },
        is_noop: plan.is_noop,
        can_overwrite: plan.can_overwrite,
        replace: plan.replace,
      }
  }
}

///|
fn import_dialog() -> View[TrackerApp, TrackerMsg] {
  scope(
    s => s.preview(),
    div(
      [
        cls(
          "absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4",
        ),
      ],
      [
        div(
          [
            cls(
              "grid w-full max-w-md gap-4 rounded-lg border border-base-300 bg-base-100 p-6 shadow-lg",
            ),
            attr("role", "dialog"),
            aria("label", "Import preview"),
          ],
          [
            div([cls("flex flex-col gap-2")], [
              h2([cls("text-lg leading-none font-semibold")], [
                show(w => w.up.import_title),
              ]),
              p([cls("text-sm \{muted}")], [show(w => w.value.description)]),
            ]),
            ul([cls("space-y-1 text-sm")], [
              each(
                w => w.value.lines.iter(),
                li([], [txt("· "), show(it => it.value)]),
              ),
            ]),
            ul([cls("space-y-1 text-xs \{muted}")], [
              each(
                w => w.value.warnings.iter(),
                li([], [txt("⚠ "), show(it => it.value)]),
              ),
            ]),
            when(
              w => w.value.can_overwrite,
              label([cls("flex items-start gap-2 text-sm")], [
                input([
                  attr("type", "checkbox"),
                  cls("checkbox checkbox-sm"),
                  checked(w => w.up.overwrite),
                  on_check(b => SetOverwrite(b)),
                ]),
                span([], [
                  txt("Update details of things I already have"),
                  span([cls("block text-xs \{muted}")], [
                    txt(
                      "Names, emoji and what gets recorded — so ticking this is how an updated bundle adds a measurement to a thing you already have. Off by default: your own edits win. Ids never change either way, so entries you've already recorded stay attached.",
                    ),
                  ]),
                ]),
              ]),
            ),
            div(
              [cls("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end")],
              [
                button(
                  [cls("btn btn-outline btn-sm"), on_click(CancelImport)],
                  [txt("Cancel")],
                ),
                button(
                  [
                    class_(w => {
                      if w.value.replace {
                        "btn btn-error btn-sm"
                      } else {
                        "btn btn-primary btn-sm"
                      }
                    }),
                    bind("disabled", w => Bool(w.value.is_noop)),
                    on_click(ConfirmImport),
                  ],
                  [
                    show(w => {
                      if w.value.replace {
                        "Replace everything"
                      } else {
                        "Import"
                      }
                    }),
                  ],
                ),
              ],
            ),
          ],
        ),
      ],
    ),
  )
}

///|
fn toast_view() -> View[TrackerApp, TrackerMsg] {
  let can_edit = (s : TrackerApp) => {
    s.toast.map(t => t.kind is Logged).unwrap_or(false)
  }
  when(
    s => s.toast is Some(_),
    div(
      [
        cls("absolute inset-x-0 bottom-20 z-30 flex justify-center px-4"),
        attr("role", "status"),
      ],
      [
        div(
          [
            class_(s => {
              if s.toast.map(t => t.kind is Failed).unwrap_or(false) {
                "flex items-start gap-3 rounded-lg border border-error/40 bg-base-100 p-3 text-sm shadow-lg"
              } else {
                "flex items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-sm shadow-lg"
              }
            }),
          ],
          [
            div([cls("min-w-0 flex-1")], [
              div([cls("font-medium")], [
                show(s => s.toast.map(t => t.title).unwrap_or("")),
              ]),
              div([cls("text-xs \{muted}")], [
                show(s => s.toast.map(t => t.text).unwrap_or("")),
                when(
                  can_edit,
                  button([cls("ml-1 \{link}"), on_click(EditToast)], [
                    txt("Edit"),
                  ]),
                ),
              ]),
            ]),
            when(
              can_edit,
              button([cls("btn btn-xs"), on_click(UndoToast)], [txt("Undo")]),
            ),
            button(
              [
                cls("btn btn-ghost btn-xs"),
                aria("label", "Dismiss"),
                on_click(DismissToast),
              ],
              [txt("✕")],
            ),
          ],
        ),
      ],
    ),
  )
}

///|
fn TrackerApp::view() -> View[TrackerApp, TrackerMsg] {
  div(
    [
      cls(
        "relative mx-auto flex min-h-[40rem] w-full max-w-2xl flex-col overflow-hidden bg-base-100 text-base-content",
      ),
    ],
    [
      main_([cls("min-h-0 flex-1 overflow-y-auto pb-20")], [
        track_view(),
        insights_view(),
        manage_view(),
      ]),
      nav(
        [
          cls(
            "absolute inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100/85 backdrop-blur-lg",
          ),
        ],
        [
          ul([cls("mx-auto flex h-16 max-w-2xl")], [
            each(
              s => tabs.iter().map(t => (t.0, t.1, t.2, t.0 == s.tab)),
              li([cls("flex-1")], [
                button(
                  [
                    class_(it => {
                      let on = if it.value.3 { "" } else { muted }
                      "flex h-full w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium \{on}"
                    }),
                    bind_str("aria-current", it => {
                      if it.value.3 {
                        "page"
                      } else {
                        "false"
                      }
                    }),
                    bind_str("value", it => tab_id(it.value.0)),
                    on_event(Click, (it, _) => Some(SetTab(it.value.0))),
                  ],
                  [
                    span([cls("text-lg leading-none")], [show(it => it.value.1)]),
                    show(it => it.value.2),
                  ],
                ),
              ]),
            ),
          ]),
        ],
      ),
      toast_view(),
      when(s => s.show_preview, import_dialog()),
      render(panel_lens, panel_c),
    ],
  )
}
