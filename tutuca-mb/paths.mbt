// Paths: where a component was rendered (DispatchPath, the rendered ancestry) and how to reach
// its state (Route, which follows ownership). They differ for provided components, as in
// docs/paths.md.

///|
/// One component render step: the lens it went through and the item it selected.
pub(all) struct Frame {
  name : String
  item : SlotKey?
  lens_id : Int32
  provider : String? // The Provide it was reached through, if any.
} derive(Eq, Debug)

///|
pub extend Frame with Eq::{equal, not_equal}

///|
pub extend Frame with Debug::{to_repr}

///|
pub fn Frame::to_string(self : Frame) -> String {
  let base = match self.provider {
    Some(p) => "<\{p}>.\{self.name}"
    None => ".\{self.name}"
  }
  match self.item {
    Some(k) => base + k.to_string()
    None => base
  }
}

///|
/// The component frames from the root to a component, as rendered.
pub struct DispatchPath {
  frames : Array[Frame]
} derive(Eq, Debug)

///|
pub extend DispatchPath with Eq::{equal, not_equal}

///|
pub extend DispatchPath with Debug::{to_repr}

///|
pub fn DispatchPath::root() -> DispatchPath {
  { frames: [], }
}

///|
pub fn DispatchPath::push(self : DispatchPath, frame : Frame) -> DispatchPath {
  { frames: [..self.frames, frame], }
}

///|
pub fn DispatchPath::is_root(self : DispatchPath) -> Bool {
  self.frames.is_empty()
}

///|
pub fn DispatchPath::depth(self : DispatchPath) -> Int32 {
  self.frames.length()
}

///|
/// The frame right below `receiver` on this path: which child a message came through, from the
/// receiver's point of view. None when the receiver itself, or an ancestor, sent it.
pub fn DispatchPath::frame_below(
  self : DispatchPath,
  receiver : DispatchPath,
) -> Frame? {
  self.frames.get(receiver.frames.length())
}

///|
/// Paths print as .key and [item], with · for the root.
pub fn DispatchPath::to_string(self : DispatchPath) -> String {
  if self.frames.is_empty() {
    "·"
  } else {
    self.frames.map(f => f.to_string()).join("")
  }
}

///|
pub suberror RouteError {
  RouteError(String)
}

///|
/// How to read and replace a component's state in the current root. Reads happen when a task
/// runs, so a route always sees the committed state.
pub struct Route[S] {
  path : DispatchPath
  /// Where the state lives: the path from the root through the state's fields, which is
  /// `path` but for a component rendered from what an ancestor provides.
  home : DispatchPath
  get : () -> S?
  set : (S) -> Unit raise RouteError
}

///|
pub fn[S] Route::new(
  path : DispatchPath,
  get : () -> S?,
  set : (S) -> Unit raise RouteError,
) -> Route[S] {
  { path, home: path, get, set, }
}

///|
/// The route of the state `lens` reaches from here. `path` is where it was rendered, which is
/// this route's path plus the lens's frame unless the caller says otherwise.
pub fn[S, C] Route::focus(
  self : Route[S],
  lens : Lens[S, C],
  path? : DispatchPath,
) -> Route[C] {
  // A variant lens adds no frame: its case's component sits where this one does.
  let step = (at : DispatchPath) => {
    if lens.name == "" && lens.slot is None {
      at
    } else {
      at.push({
        name: lens.name,
        item: lens.slot,
        lens_id: lens.id,
        provider: None,
      })
    }
  }
  let home = step(self.home)
  let path = path.unwrap_or_else(() => step(self.path))
  {
    path,
    home,
    get: () => (self.get)().bind(s => (lens.get)(s)),
    set: c => {
      match (self.get)() {
        Some(s) => (self.set)((lens.set)(s, c))
        None =>
          raise RouteError(
            "nothing at \{self.path.to_string()} to write \{lens.name} into",
          )
      }
    },
  }
}

///|
pub fn[S] Route::read(self : Route[S]) -> S raise RouteError {
  match (self.get)() {
    Some(s) => s
    None => raise RouteError("nothing at \{self.path.to_string()}")
  }
}
