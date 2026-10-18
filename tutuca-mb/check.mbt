// The check pass: what types can't rule out, found on the IR without an instance.

///|
pub(all) struct Issue {
  path : String
  message : String
} derive(Eq, Debug)

///|
pub extend Issue with Eq::{equal, not_equal}

///|
pub extend Issue with Debug::{to_repr}

///|
pub fn Issue::to_string(self : Issue) -> String {
  "\{self.path}: \{self.message}"
}

///|
pub suberror ViewError {
  ViewError(Array[Issue])
}

///|
let dynamic_only : Array[String] = [
  "value", "checked", "is", "dangerouslySetInnerHTML",
]

///|
pub fn check(ir : Ir) -> Array[Issue] {
  let issues = []
  check_at(ir, "view", issues)
  issues
}

///|
fn check_at(ir : Ir, path : String, issues : Array[Issue]) -> Unit {
  match ir {
    IText(_) | IShow => ()
    IElem(e) => {
      let path = if path == "view" {
        "<\{e.tag}>"
      } else {
        "\{path} > <\{e.tag}>"
      }
      let issue = (message : String) => issues.push({ path, message, })
      let seen = []
      for name in e.statics.map(a => a.0) + e.dyns {
        if name == handler_attr {
          issue(
            "`\{name}` is reserved for event routing; use another attribute name",
          )
        } else if seen.contains(name) {
          issue(
            "`\{name}` is set more than once; keep one, joining classes into a single cls(...) or class_(...)",
          )
        } else {
          seen.push(name)
        }
      }
      if e.ns.length() > 1 {
        issue("the namespace is set more than once; keep one ns(...)")
      }
      let events = []
      for ev in e.events {
        if ev is Custom(name) && !known_events.contains(name) {
          issue(
            "`\{name}` is not a DOM event this checker knows; check its spelling, or the handler never runs",
          )
        }
        let name = ev.dom_name()
        if events.contains(name) {
          issue(
            "has two `\{name}` handlers; only one runs, so merge them into one on_event(...)",
          )
        } else {
          events.push(name)
        }
      }
      for c in e.childs {
        check_at(c, path, issues)
      }
    }
    IIf(a, b) => {
      check_at(a, path, issues)
      check_at(b, path, issues)
    }
    IFrag(cs) =>
      for c in cs {
        check_at(c, path, issues)
      }
    IEach(b) => check_at(b, "\{path} > each", issues)
    IScope(b) => check_at(b, "\{path} > scope", issues)
    IPushView(_, b) => check_at(b, "\{path} > push_view", issues)
    IProvided(_, b) => check_at(b, path, issues)
    IRender(r) =>
      match r.view_name {
        Some(name) =>
          if !(r.view_names)().contains(name) {
            let comp = (r.component)()
            issues.push({
              path: "\{path} > \{r.kind}(\{comp})",
              message: "\{comp} has no view `\{name}`; use one of: \{(r.view_names)().join(", ")}",
            })
          }
        None => ()
      }
  }
}

///|
/// DOM events beyond the ones EventName names, for `Custom`.
let known_events : Array[String] = [
  "abort", "animationend", "animationiteration", "animationstart", "auxclick", "beforeinput",
  "blur", "cancel", "canplay", "change", "click", "close", "compositionend", "compositionstart",
  "compositionupdate", "contextmenu", "copy", "cut", "dblclick", "drag", "dragend",
  "dragenter", "dragleave", "dragover", "dragstart", "drop", "ended", "error", "focus",
  "focusin", "focusout", "formdata", "gotpointercapture", "input", "invalid", "keydown",
  "keyup", "load", "loadeddata", "loadedmetadata", "lostpointercapture", "mousedown",
  "mouseenter", "mouseleave", "mousemove", "mouseout", "mouseover", "mouseup", "paste",
  "pause", "play", "playing", "pointercancel", "pointerdown", "pointerenter", "pointerleave",
  "pointermove", "pointerout", "pointerover", "pointerup", "progress", "reset", "resize",
  "scroll", "scrollend", "search", "select", "selectionchange", "slotchange", "submit",
  "timeupdate", "toggle", "touchcancel", "touchend", "touchmove", "touchstart", "transitionend",
  "volumechange", "wheel",
]

///|
/// What `check_set` needs of a component, its types erased.
pub struct Checked {
  name : String
  irs : Array[(String, Ir)]
  provides : Array[String]
  issues : Array[Issue]
}

///|
pub fn[S, M] Component::checked(self : Component[S, M]) -> Checked {
  {
    name: self.name,
    irs: self.irs(),
    provides: self.provided_names(),
    issues: self.check(),
  }
}

///|
/// Checks a set of components together, as JS's `lint(registrations)`: each one's own issues,
/// a provided name read that none of them provides, and a constant `push_view_named` name
/// none of them has a view of.
pub fn check_set(comps : Array[Checked]) -> Array[Issue] {
  let provided : Array[String] = []
  let views : Array[String] = []
  let issues : Array[Issue] = []
  for c in comps {
    provided.append(c.provides)
    for v in c.irs {
      if !views.contains(v.0) {
        views.push(v.0)
      }
    }
    issues.append(c.issues)
  }
  for c in comps {
    for v in c.irs {
      // Each issue's path names the site, as `check`'s do (JS: `Prov.main > provided(nope)`).
      walk_sites(v.1, "", (node, at) => {
        let path = "\{c.name}.\{v.0}\{at}"
        match node {
          IProvided(name, _) | IRender({ provided: Some(name), .. }) =>
            if !provided.contains(name) {
              issues.push({
                path,
                message: "no component here provides `\{name}`",
              })
            }
          IPushView(Some(name), _) =>
            if !views.contains(name) {
              issues.push({
                path,
                message: "no component here has a view `\{name}` to push; views: \{views.join(", ")}",
              })
            }
          _ => ()
        }
      })
    }
  }
  issues
}

///|
/// Calls `f` on every node with its path, spelled as `check_at` spells them, the node's own
/// step included: ` <div> > when_provided(lamp)`.
fn walk_sites(ir : Ir, path : String, f : (Ir, String) -> Unit) -> Unit {
  let step = (s : String) => if path == "" { " \{s}" } else { "\{path} > \{s}" }
  match ir {
    IText(_) | IShow => f(ir, path)
    IElem(e) => {
      let at = step("<\{e.tag}>")
      f(ir, at)
      for c in e.childs {
        walk_sites(c, at, f)
      }
    }
    IIf(a, b) => {
      f(ir, path)
      walk_sites(a, path, f)
      walk_sites(b, path, f)
    }
    IFrag(cs) => {
      f(ir, path)
      for c in cs {
        walk_sites(c, path, f)
      }
    }
    IEach(b) => {
      f(ir, path)
      walk_sites(b, step("each"), f)
    }
    IScope(b) => {
      f(ir, path)
      walk_sites(b, step("scope"), f)
    }
    IPushView(name, b) => {
      let at = step("push_view(\{name.unwrap_or("…")})")
      f(ir, at)
      walk_sites(b, at, f)
    }
    IProvided(name, b) => {
      let at = step("when_provided(\{name})")
      f(ir, at)
      walk_sites(b, at, f)
    }
    IRender(r) => f(ir, step("\{r.kind}(\{(r.component)()})"))
  }
}
