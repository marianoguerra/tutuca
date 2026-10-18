// The app's full screen panels, as one child of any kind, rendered by the component of its
// kind.

///|
pub(all) enum Panel {
  WizardPanel(MeasurementWizard)
  EventPanel(EventEditor)
  ThingPanel(ThingEditor)
  TagPanel(TagEditor)
  EntriesPanel(EntryList)
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// The state of the case's component with its name as `$`, as JS's snapshot of a field that
/// holds any panel.
pub impl ToJson for Panel with fn to_json(self) {
  let (name, state) = match self {
    WizardPanel(w) => ("MeasurementWizard", ToJson::to_json(w))
    EventPanel(e) => ("EventEditor", ToJson::to_json(e))
    ThingPanel(e) => ("ThingEditor", ToJson::to_json(e))
    TagPanel(e) => ("TagEditor", ToJson::to_json(e))
    EntriesPanel(e) => ("EntryList", ToJson::to_json(e))
  }
  let out : Map[String, Json] = { "$": Json::string(name) }
  if state is Object(m) {
    for k, v in m {
      out[k] = v
    }
  }
  Json::object(out)
}

///|
pub impl FromJson for Panel with fn from_json(json, path) {
  guard json is Object(m) && m.get("$") is Some(String(name)) else {
    raise @json.JsonDecodeError((path, "a panel"))
  }
  match name {
    "MeasurementWizard" => WizardPanel(@json.from_json(json, path~))
    "EventEditor" => EventPanel(@json.from_json(json, path~))
    "ThingEditor" => ThingPanel(@json.from_json(json, path~))
    "TagEditor" => TagPanel(@json.from_json(json, path~))
    "EntryList" => EntriesPanel(@json.from_json(json, path~))
    _ => raise @json.JsonDecodeError((path, "no panel \{name}"))
  }
}

///|
fn[C] panel_variant(
  _name : String,
  get : (Panel) -> C?,
  make : (C) -> Panel,
) -> Lens[Panel, C] {
  @tutuca.Lens::variant(get, (_, c) => make(c))
}

///|
pub let wizard_variant : Lens[Panel, MeasurementWizard] = panel_variant(
  "wizard",
  p => if p is WizardPanel(w) { Some(w) } else { None },
  w => WizardPanel(w),
)

///|
pub let event_variant : Lens[Panel, EventEditor] = panel_variant(
  "event",
  p => if p is EventPanel(e) { Some(e) } else { None },
  e => EventPanel(e),
)

///|
pub let thing_editor_variant : Lens[Panel, ThingEditor] = panel_variant(
  "thingEditor",
  p => if p is ThingPanel(e) { Some(e) } else { None },
  e => ThingPanel(e),
)

///|
pub let tag_editor_variant : Lens[Panel, TagEditor] = panel_variant(
  "tagEditor",
  p => if p is TagPanel(e) { Some(e) } else { None },
  e => TagPanel(e),
)

///|
pub let entries_variant : Lens[Panel, EntryList] = panel_variant(
  "entries",
  p => if p is EntriesPanel(e) { Some(e) } else { None },
  e => EntriesPanel(e),
)

///|
/// A panel of any kind: it renders the component of its kind.
pub let panel_c : Component[Panel, Unit] = component(
  "Panel",
  // It only shows its case's component, as a JS field holds any panel.
  transparent=true,
  children=() => {
    [
      @tutuca.child(measurement_wizard, wizard_variant),
      @tutuca.child(event_editor, event_variant),
      @tutuca.child(thing_editor, thing_editor_variant),
      @tutuca.child(tag_editor, tag_editor_variant),
      @tutuca.child(entry_list, entries_variant),
    ]
  },
  view=() => {
    frag([
      render(wizard_variant, measurement_wizard),
      render(event_variant, event_editor),
      render(thing_editor_variant, thing_editor),
      render(tag_editor_variant, tag_editor),
      render(entries_variant, entry_list),
    ])
  },
)
