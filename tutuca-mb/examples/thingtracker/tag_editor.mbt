// Creates or edits a tag and the things in it. From panels/tag-editor.js.

///|
/// A thing a tag may collect.
pub(all) struct Member {
  id : String
  emoji : String
  title : String
  checked : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct TagEditor {
  mode : Mode
  tag_id : String
  emoji : String
  title : String
  picker_open : Bool
  picker : EmojiPicker
  query : String
  members : Vec[Member]
  confirming : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn TagEditor::new(
  mode : Mode,
  tag_id~ : String = "",
  emoji~ : String = "",
  title~ : String = "",
  members~ : Array[Member] = [],
) -> TagEditor {
  {
    mode,
    tag_id,
    emoji,
    title,
    picker_open: false,
    picker: EmojiPicker::new(),
    query: "",
    members: Vec::of(members),
    confirming: false,
  }
}

///|
pub(all) enum TagEditorMsg {
  RequestClose
  Key(String) // A key pressed in the panel.
  KeepEditing
  Discard
  TogglePicker
  SetTitle(String)
  SetQuery(String)
  ToggleMember(Int32)
  Save
  Remove
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// What the tag editor saves.
pub(all) struct TagFields {
  id : String
  title : String
  emoji : String
  thing_ids : Array[String]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let save_tag : Signal[(Mode, TagFields)] = Signal::new("saveTag")

///|
pub let delete_tag : Signal[String] = Signal::new("deleteTag")

///|
pub let tag_picker_lens : Lens[TagEditor, EmojiPicker] = field(
  "picker",
  s => s.picker,
  (s, picker) => { ..s, picker, },
)

///|
pub fn TagEditor::selected_text(self : TagEditor) -> String {
  "\{self.members.count(m => m.checked)} selected"
}

///|
pub fn TagEditor::cannot_save(self : TagEditor) -> Bool {
  trim(self.title) == ""
}

///|
/// The members shown with their index: alphabetical, by relevance while searching; ticking
/// never reorders.
fn TagEditor::shown(self : TagEditor) -> Array[(Int32, Member)] {
  let entries = self.members.entries().to_array()
  if trim(self.query) == "" {
    return entries
  }
  let kept = filter_by(entries, self.query, e => {
    emoji: e.1.emoji,
    title: e.1.title,
    description: "",
  }).map(e => e.0)
  entries.filter(e => kept.contains(e.0))
}

///|
fn TagEditor::view() -> View[TagEditor, TagEditorMsg] {
  panel(
    title=s => if s.mode is Edit { "Edit tag" } else { "New tag" },
    description=_ => "Pick which things this tag collects.",
    body=div([cls("flex flex-col gap-3")], [
      div([cls("flex items-center gap-3")], [
        button(
          [
            cls(
              "emoji flex size-11 items-center justify-center rounded-xl border border-base-300 text-2xl",
            ),
            aria("label", "Choose an emoji"),
            on_click(TogglePicker),
          ],
          [show(s => if s.emoji == "" { "＋" } else { s.emoji })],
        ),
        input([
          cls("input h-11 flex-1"),
          attr("placeholder", "Morning routine"),
          aria("label", "Tag name"),
          value(s => s.title),
          on_input(v => SetTitle(v)),
        ]),
      ]),
      when(s => s.picker_open, render(tag_picker_lens, emoji_picker)),
      div([cls("flex items-center justify-between")], [
        label([cls("text-sm font-medium")], [txt("Things")]),
        span([cls("text-xs \{muted}")], [show(s => s.selected_text())]),
      ]),
      input([
        attr("type", "search"),
        cls("input input-sm w-full"),
        attr("placeholder", "Search things…"),
        aria("label", "Search things"),
        value(s => s.query),
        on_input(v => SetQuery(v)),
      ]),
      if_(
        s => s.members.is_empty(),
        p([cls("text-sm \{muted}")], [txt("No things to add yet.")]),
        ul([cls("flex flex-col")], [
          each(
            s => s.shown().iter(),
            li([], [
              label([cls("flex items-center gap-3 py-2 text-sm")], [
                input([
                  attr("type", "checkbox"),
                  cls("checkbox checkbox-sm"),
                  checked(it => it.value.1.checked),
                  on_event(Change, (it, _) => Some(ToggleMember(it.value.0))),
                ]),
                span([cls("emoji")], [show(it => it.value.1.emoji)]),
                show(it => it.value.1.title),
              ]),
            ]),
            key=(e, _) => e.1.id,
          ),
        ]),
      ),
    ]),
    foot=[
      when(
        s => s.mode is Edit,
        button([cls("btn btn-outline h-12 text-error"), on_click(Remove)], [
          txt("Delete"),
        ]),
      ),
      button(
        [
          cls("btn btn-primary h-12 flex-1"),
          bind("disabled", s => Bool(s.cannot_save())),
          on_click(Save),
        ],
        [show(s => if s.mode is Edit { "Save" } else { "Create" })],
      ),
    ],
    confirm=s => {
      confirming: s.confirming,
      title: if s.mode is Edit {
        "Discard changes?"
      } else {
        "Discard this tag?"
      },
      text: "Nothing has been saved yet.",
      keep: "Keep editing",
    },
    close=tag_editor_of_close,
  )
}

///|
fn TagEditor::update(
  self : TagEditor,
  msg : TagEditorMsg,
  ctx : Ctx[TagEditor, TagEditorMsg],
) -> TagEditor {
  match msg {
    RequestClose | Key(_) | KeepEditing | Discard => {
      let m = tag_editor_close(msg)
      { ..self, confirming: closing(self.confirming, true, m, ctx), }
    }
    TogglePicker => { ..self, picker_open: !self.picker_open, }
    SetTitle(title) => { ..self, title, }
    SetQuery(query) => { ..self, query, }
    ToggleMember(i) =>
      if i >= 0 && i < self.members.length() {
        {
          ..self,
          members: self.members.update(i, m => { ..m, checked: !m.checked, }),
        }
      } else {
        self
      }
    Save => {
      if !self.cannot_save() {
        ctx.notify(
          save_tag,
          (
            self.mode,
            {
              id: self.tag_id,
              title: trim(self.title),
              emoji: self.emoji,
              thing_ids: self.members
              .iter()
              .filter(m => m.checked)
              .map(m => m.id)
              .to_array(),
            },
          ),
        )
      }
      self
    }
    Remove => {
      ctx.notify(delete_tag, self.tag_id)
      self
    }
  }
}

///|
pub let tag_editor : Component[TagEditor, TagEditorMsg] = component(
  "TagEditor",
  children=() => [@tutuca.child(emoji_picker, tag_picker_lens)],
  fields=[
    @tutuca.field_info("mode", OneOf(["create", "edit"]), initial="create"),
    @tutuca.field_info("tag_id", Text, initial=""),
    @tutuca.field_info("emoji", Text, initial=""),
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info("picker_open", Boolean, initial=false),
    @tutuca.field_info("picker", ComponentOf(["EmojiPicker"])),
    @tutuca.field_info("query", Text, initial=""),
    @tutuca.field_info(
      "members",
      ListOf(
        RecordOf([
          ("id", Text),
          ("emoji", Text),
          ("title", Text),
          ("checked", Boolean),
        ]),
      ),
      initial=[],
    ),
    @tutuca.field_info("confirming", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages(
    [
      "RequestClose", "Key", "KeepEditing", "Discard", "TogglePicker", "emojiPicked",
      "SetTitle", "SetQuery", "ToggleMember", "Save", "Remove",
    ],
    heard=[@tutuca.heard(emoji_picked)],
  ),
  view=TagEditor::view,
  update=TagEditor::update,
  on=[
    emoji_picked.on((s, glyph, ctx) => {
      ctx.stop()
      { ..s, emoji: glyph, picker_open: false, }
    }),
  ],
)

///|
/// The closing message `msg` is, for `closing`.
fn tag_editor_close(msg : TagEditorMsg) -> CloseMsg {
  match msg {
    Key(k) => Pressed(k)
    KeepEditing => Keep
    Discard => Drop
    _ => AskClose
  }
}

///|
fn tag_editor_of_close(c : CloseMsg) -> TagEditorMsg {
  match c {
    AskClose => RequestClose
    Pressed(k) => Key(k)
    Keep => KeepEditing
    Drop => Discard
  }
}
