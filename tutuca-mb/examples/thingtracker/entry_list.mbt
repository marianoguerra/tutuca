// The entries of a thing in a bucket, or all of them, to open one in the event editor. From
// panels/entry-list.js.

///|
pub(all) struct EntryRow {
  id : String
  head : String // The thing, when the list mixes things.
  line : String
  notes : String
  recorded : String // When it was recorded, if long after it happened.
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct EntryList {
  heading : String
  subtitle : String
  rows : Vec[EntryRow]
  remaining : Int32
  confirming : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn EntryList::new(
  heading~ : String = "All entries",
  subtitle~ : String = "",
) -> EntryList {
  { heading, subtitle, rows: Vec::new(), remaining: 0, confirming: false, }
}

///|
pub(all) enum EntryListMsg {
  RequestClose
  Key(String) // A key pressed in the panel.
  KeepEditing
  Discard
  Open(Int32)
  Remove(Int32)
  More
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let edit_entry : Signal[String] = Signal::new("editEntry")

///|
/// Sent with an entry's id, from the entry list and the event editor.
pub let delete_entry : Signal[String] = Signal::new("deleteEntry")

///|
pub let more_entries : Signal[Unit] = Signal::new("moreEntries")

///|
fn EntryList::view() -> View[EntryList, EntryListMsg] {
  panel(
    title=s => s.heading,
    description=s => s.subtitle,
    body=div([], [
      ul([cls("divide-y divide-base-300/60")], [
        when(
          s => s.rows.is_empty(),
          li([cls("py-4 text-sm \{muted}")], [txt("No entries.")]),
        ),
        each(
          s => s.rows.iter(),
          li([cls("flex items-center gap-2 py-2.5")], [
            button(
              [
                cls("min-w-0 flex-1 text-left"),
                on_event(Click, (it, _) => Some(Open(it.index))),
              ],
              [
                when(
                  it => it.value.head != "",
                  div([cls("text-sm font-medium")], [show(it => it.value.head)]),
                ),
                div([cls("text-sm tabular-nums")], [show(it => it.value.line)]),
                when(
                  it => it.value.notes != "",
                  div([cls("truncate text-xs \{muted}")], [
                    show(it => it.value.notes),
                  ]),
                ),
                when(
                  it => it.value.recorded != "",
                  div([cls("text-[0.6875rem] opacity-50")], [
                    show(it => it.value.recorded),
                  ]),
                ),
              ],
            ),
            span([cls("opacity-40")], [txt("›")]),
            button(
              [
                cls("btn btn-ghost btn-square btn-sm"),
                aria("label", "Delete entry"),
                on_event(Click, (it, _) => Some(Remove(it.index))),
              ],
              [txt("🗑")],
            ),
          ]),
          key=(row, _) => row.id,
        ),
      ]),
      when(
        s => s.remaining > 0,
        button([cls("btn btn-outline mt-3 w-full"), on_click(More)], [
          show(s => {
            let n = if s.remaining < 200 { s.remaining } else { 200 }
            "Show \{n} more (\{s.remaining} left)"
          }),
        ]),
      ),
    ]),
    foot=[
      button([cls("btn btn-outline h-12 flex-1"), on_click(RequestClose)], [
        txt("Close"),
      ]),
    ],
    confirm=s => { confirming: s.confirming, title: "", text: "", keep: "", },
    close=list_of_close,
  )
}

///|
fn EntryList::update(
  self : EntryList,
  msg : EntryListMsg,
  ctx : Ctx[EntryList, EntryListMsg],
) -> EntryList {
  match msg {
    RequestClose | Key(_) | KeepEditing | Discard => {
      let m = list_close(msg)
      let confirming = closing(self.confirming, false, m, ctx)
      { ..self, confirming, }
    }
    Open(i) => {
      if self.rows.get(i) is Some(row) {
        ctx.notify(edit_entry, row.id)
      }
      self
    }
    Remove(i) => {
      if self.rows.get(i) is Some(row) {
        ctx.notify(delete_entry, row.id)
      }
      self
    }
    More => {
      ctx.notify(more_entries, ())
      self
    }
  }
}

///|
pub let entry_list : Component[EntryList, EntryListMsg] = component(
  "EntryList",
  fields=[
    @tutuca.field_info("heading", Text, initial="All entries"),
    @tutuca.field_info("subtitle", Text, initial=""),
    @tutuca.field_info(
      "rows",
      ListOf(
        RecordOf([
          ("id", Text),
          ("head", Text),
          ("line", Text),
          ("notes", Text),
          ("recorded", Text),
        ]),
      ),
      initial=[],
    ),
    @tutuca.field_info(
      "remaining",
      Whole,
      constraints=[AtLeast(0)],
      initial=0,
      checks=["remaining is never negative"],
    ),
    @tutuca.field_info("confirming", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages([
    "RequestClose", "Key", "KeepEditing", "Discard", "Open", "Remove", "More",
  ]),
  view=EntryList::view,
  update=EntryList::update,
  invariants=[("remaining is never negative", s => s.remaining >= 0)],
)

///|
/// The closing message `msg` is, for `closing`.
fn list_close(msg : EntryListMsg) -> CloseMsg {
  match msg {
    Key(k) => Pressed(k)
    KeepEditing => Keep
    Discard => Drop
    _ => AskClose
  }
}

///|
fn list_of_close(c : CloseMsg) -> EntryListMsg {
  match c {
    AskClose => RequestClose
    Pressed(k) => Key(k)
    Keep => KeepEditing
    Drop => Discard
  }
}
