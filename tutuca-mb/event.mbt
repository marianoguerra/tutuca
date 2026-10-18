///|
/// The events a view can handle. `Custom` covers the rest by DOM name.
pub(all) enum EventName {
  Click
  DblClick
  Input
  Change
  Submit
  KeyDown
  KeyUp
  Focus
  Blur
  PointerDown
  PointerMove
  PointerUp
  DragStart
  DragOver
  Drop
  Custom(String)
} derive(Eq)

///|
pub extend EventName with Eq::{equal, not_equal}

///|
pub fn EventName::dom_name(self : EventName) -> String {
  match self {
    Click => "click"
    DblClick => "dblclick"
    Input => "input"
    Change => "change"
    Submit => "submit"
    KeyDown => "keydown"
    KeyUp => "keyup"
    Focus => "focus"
    Blur => "blur"
    PointerDown => "pointerdown"
    PointerMove => "pointermove"
    PointerUp => "pointerup"
    DragStart => "dragstart"
    DragOver => "dragover"
    Drop => "drop"
    Custom(name) => name
  }
}

///|
/// A file the user picked (an `<input type="file">`'s): its name, and an id the backend
/// resolves to the file when an ask reads it.
pub(all) struct FileRef {
  id : Int32
  name : String
} derive(Eq, Debug, ToJson, FromJson)

///|
/// What the backend reads off a DOM event for the host: the key, the pointer (in client
/// coordinates and, over an SVG, in its viewBox), the button and modifiers, and the event's
/// preventDefault and setPointerCapture (on the SVG it is over).
pub(all) struct EventInfo {
  key : String
  client_x : Double
  client_y : Double
  point : (Double, Double)?
  button : Int32
  ctrl_key : Bool
  meta_key : Bool
  shift_key : Bool
  alt_key : Bool
  files : Array[FileRef] // The files of a file input, on its change.
  prevent : () -> Unit
  capture : () -> Unit
}

///|
pub fn EventInfo::new(
  key~ : String = "",
  client_x~ : Double = 0.0,
  client_y~ : Double = 0.0,
  point? : (Double, Double),
  button~ : Int32 = 0,
  ctrl_key~ : Bool = false,
  meta_key~ : Bool = false,
  shift_key~ : Bool = false,
  alt_key~ : Bool = false,
  files~ : Array[FileRef] = [],
  prevent~ : () -> Unit = () => (),
  capture~ : () -> Unit = () => (),
) -> EventInfo {
  {
    key,
    client_x,
    client_y,
    point,
    button,
    ctrl_key,
    meta_key,
    shift_key,
    alt_key,
    files,
    prevent,
    capture,
  }
}

///|
/// A DOM event as a handler sees it. `target_value` and `target_checked` are read from the
/// element with the handler, not the innermost target, as JS `targetValue()` does.
pub struct Event {
  name : String
  target_value : String
  target_checked : Bool
  is_checkbox : Bool
  info : EventInfo
  mut default_prevented : Bool
}

///|
pub fn Event::new(
  name : String,
  target_value~ : String = "",
  target_checked~ : Bool = false,
  is_checkbox~ : Bool = false,
  info~ : EventInfo = EventInfo::new(),
) -> Event {
  {
    name,
    target_value,
    target_checked,
    is_checkbox,
    info,
    default_prevented: false,
  }
}

///|
pub fn Event::key(self : Event) -> String {
  self.info.key
}

///|
/// The pointer in the viewBox of the SVG the event is over, or None outside one.
pub fn Event::point(self : Event) -> (Double, Double)? {
  self.info.point
}

///|
/// The files of a file input, on its change.
pub fn Event::files(self : Event) -> Array[FileRef] {
  self.info.files
}

///|
pub fn Event::button(self : Event) -> Int32 {
  self.info.button
}

///|
/// Ctrl, or Cmd on a Mac.
pub fn Event::command_key(self : Event) -> Bool {
  self.info.ctrl_key || self.info.meta_key
}

///|
pub fn Event::shift_key(self : Event) -> Bool {
  self.info.shift_key
}

///|
/// Keeps the pointer's moves and release going to the SVG it is over, even outside it.
pub fn Event::capture_pointer(self : Event) -> Unit {
  (self.info.capture)()
}

///|
pub fn Event::prevent_default(self : Event) -> Unit {
  if !self.default_prevented {
    self.default_prevented = true
    (self.info.prevent)()
  }
}

///|
/// Sends what `f` makes of the files picked, on a file input's change.
pub fn[X, M] on_files(f : (Array[FileRef]) -> M) -> Prop[X, M] {
  On(Change, (_, e) => Some(f(e.files())))
}

///|
/// `checked` for a checkbox, the value otherwise: JS `targetValue()`.
pub fn Event::value(self : Event) -> String {
  if self.is_checkbox {
    self.target_checked.to_string()
  } else {
    self.target_value
  }
}
