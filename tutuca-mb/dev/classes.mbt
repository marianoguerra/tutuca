// Class names for CSS compilers that need them listed: the constant ones views hold, and the
// computed ones as they show up in the DOM.

///|
/// Collects class names and calls `on_new` with the ones it hadn't seen: feed it the
/// components' constant classes up front, then `scan` the DOM after each render for the
/// computed ones.
pub struct ClassCollector {
  seen : Map[String, Unit]
  on_new : (Array[String]) -> Unit
}

///|
pub fn ClassCollector::new(
  on_new : (Array[String]) -> Unit,
  known~ : Array[String] = [],
) -> ClassCollector {
  let seen = Map([])
  for c in known {
    seen[c] = ()
  }
  { seen, on_new, }
}

///|
/// Adds class names, given as class attribute values; reports the new ones.
pub fn ClassCollector::add(
  self : ClassCollector,
  classes : Array[String],
) -> Unit {
  let fresh = []
  for value in classes {
    for c in value.split(" ") {
      let c = c.to_owned()
      if c != "" && !self.seen.contains(c) {
        self.seen[c] = ()
        fresh.push(c)
      }
    }
  }
  if fresh.length() > 0 {
    (self.on_new)(fresh)
  }
}

///|
/// Adds the class names in the DOM under `root`.
pub fn[N : @vdom.DomNode] ClassCollector::scan(
  self : ClassCollector,
  root : N,
) -> Unit {
  let found = []
  fn walk(n : N) {
    for c in n.child_nodes() {
      if c.get_attribute("class") is Some(v) {
        found.push(v)
      }
      walk(c)
    }
  }

  walk(root)
  self.add(found)
}
