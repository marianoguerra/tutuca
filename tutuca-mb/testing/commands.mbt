// Random message and event sequences, run on a Driver, with failing sequences shrunk.

///|
/// Where random messages go: makes a step for the current state, or None when it has no
/// component to send to (an empty collection). Messages also go as JSON, for the storybook's
/// send form: `sample` makes one, `decode` reads one (with the item key for collections).
pub struct Target[R, M] {
  name : String
  step : (R, @splitmix.RandomState, Int32) -> Step[R, M]?
  sample : (@splitmix.RandomState, Int32) -> String
  decode : (R, String, String) -> Step[R, M] raise
  keys : (R) -> Array[String] // The item keys it can send to now; [] for a single target.
  messages : Array[String] // The message variants' names its component declares, if any.
  /// A step made from the running app instead of its state, when given (`any_instance`).
  app_step : ((@tutuca.App[R, M], @splitmix.RandomState, Int32) -> Step[R, M]?)?
}

///|
/// A message ready to send to a running app.
pub struct Step[R, M] {
  label : String
  send_app : (@tutuca.App[R, M]) -> Unit
}

///|
fn[M : FromJson] decode_json(text : String) -> M raise {
  @json.from_json(@json.parse(text))
}

///|
/// Random messages to the root; `keep` drops the ones the UI can't send.
pub fn[R, M : @quickcheck.Arbitrary + Debug + ToJson + FromJson] root_messages(
  keep~ : (M) -> Bool = _ => true,
) -> Target[R, M] {
  let make = (msg : M) => {
    label: "· \{@debug.to_string(msg)}",
    send_app: (a : @tutuca.App[R, M]) => a.send(msg),
  }
  {
    name: "root",
    step: (_, rs, size) => {
      let msg : M = gen(rs, size)
      guard keep(msg) else { None }
      Some(make(msg))
    },
    sample: (rs, size) => {
      let msg : M = gen(rs, size)
      ToJson::to_json(msg).stringify()
    },
    decode: (_, text, _) => make(decode_json(text)),
    keys: _ => [],
    messages: [],
    app_step: None,
  }
}

///|
/// Random messages to the child `lens` reaches.
pub fn[R, M, C, CM : @quickcheck.Arbitrary + Debug + ToJson + FromJson] child_messages(
  comp : @tutuca.Component[C, CM],
  lens : @tutuca.Lens[R, C],
  keep~ : (CM) -> Bool = _ => true,
) -> Target[R, M] {
  let make = (msg : CM) => {
    label: ".\{lens.name} \{@debug.to_string(msg)}",
    send_app: (a : @tutuca.App[R, M]) => a.send_to(comp, lens, msg),
  }
  {
    name: "\{comp.name} at \{lens.name}",
    step: (state, rs, size) => {
      guard (lens.get)(state) is Some(_) else { None }
      let msg : CM = gen(rs, size)
      guard keep(msg) else { None }
      Some(make(msg))
    },
    sample: (rs, size) => {
      let msg : CM = gen(rs, size)
      ToJson::to_json(msg).stringify()
    },
    decode: (_, text, _) => make(decode_json(text)),
    keys: _ => [],
    messages: comp.message_names(),
    app_step: None,
  }
}

///|
/// Random messages to whichever of the places `at` finds in the state now: JS's messages to
/// any instance of a component, for components a fixed lens or collection doesn't reach (one
/// in every node of a tree). Each place is a lens through the fields the views render, so a
/// message reaches the component rendered there, with its rendered ancestors.
pub fn[R, M, C, CM : @quickcheck.Arbitrary + Debug + ToJson + FromJson] lens_messages(
  comp : @tutuca.Component[C, CM],
  at : (R) -> Array[@tutuca.Lens[R, C]],
  keep~ : (CM) -> Bool = _ => true,
) -> Target[R, M] {
  let make = (lens : @tutuca.Lens[R, C], msg : CM) => {
    label: "\{lens.name} \{@debug.to_string(msg)}",
    send_app: (a : @tutuca.App[R, M]) => a.send_to(comp, lens, msg),
  }
  {
    name: "\{comp.name} anywhere",
    step: (state, rs, size) => {
      let places = at(state)
      guard places.length() > 0 else { None }
      let lens = places[rs
        .next_uint(limit=places.length().reinterpret_as_uint())
        .reinterpret_as_int()]
      let msg : CM = gen(rs, size)
      guard keep(msg) else { None }
      Some(make(lens, msg))
    },
    sample: (rs, size) => {
      let msg : CM = gen(rs, size)
      ToJson::to_json(msg).stringify()
    },
    decode: (state, text, key) => {
      let places = at(state)
      let lens = match places.iter().find_first(l => l.name == key) {
        Some(l) => l
        None =>
          if places.length() > 0 {
            places[0]
          } else {
            raise Failure("no \{comp.name} to send to")
          }
      }
      make(lens, decode_json(text))
    },
    keys: state => at(state).map(l => l.name),
    messages: comp.message_names(),
    app_step: None,
  }
}

///|
fn key_text(slot : @tutuca.SlotKey) -> String {
  match slot {
    Index(i) => i.to_string()
    Name(s) => s
    Pair(a, b) => "\{key_text(a)}.\{key_text(b)}"
  }
}

///|
/// Random messages to a random item of `items`.
pub fn[R, M, K, C, CM : @quickcheck.Arbitrary + Debug + ToJson + FromJson] item_messages(
  comp : @tutuca.Component[C, CM],
  items : @tutuca.Items[R, K, C],
  keep~ : (CM) -> Bool = _ => true,
) -> Target[R, M] {
  let make = (key : K, msg : CM) => {
    let lens = items.at(key)
    {
      label: ".\{items.name}\{lens.slot.map(s => s.to_string()).unwrap_or("")} \{@debug.to_string(msg)}",
      send_app: (a : @tutuca.App[R, M]) => a.send_to(comp, lens, msg),
    }
  }
  {
    name: "\{comp.name} in \{items.name}",
    step: (state, rs, size) => {
      let keys = (items.entries)(state).map(e => e.0).to_array()
      guard keys.length() > 0 else { None }
      let key = keys[rs
        .next_uint(limit=keys.length().reinterpret_as_uint())
        .reinterpret_as_int()]
      let msg : CM = gen(rs, size)
      guard keep(msg) else { None }
      Some(make(key, msg))
    },
    sample: (rs, size) => {
      let msg : CM = gen(rs, size)
      ToJson::to_json(msg).stringify()
    },
    decode: (state, text, key) => {
      let found = (items.entries)(state).find_first(e => {
        key_text((items.slot_of)(e.0)) == key
      })
      match found {
        Some((k, _)) => make(k, decode_json(text))
        None => raise Broke("\{items.name} has no item \{key}")
      }
    },
    keys: state => {
      (items.entries)(state).map(e => key_text((items.slot_of)(e.0))).to_array()
    },
    messages: comp.message_names(),
    app_step: None,
  }
}

///|
/// A message sequence that broke, shrunk: the state it started from, its steps, and what
/// broke.
pub struct Failure[R, M] {
  start : R
  steps : Array[Step[R, M]]
  problem : String
}

///|
pub fn[R, M] Failure::describe(self : Failure[R, M]) -> String {
  "after\n    \{self.steps.map(s => s.label).join("\n    ")}\n  \{self.problem}"
}

///|
/// Runs `steps` from `start`; the first problem, as text, or None.
fn[R, M] replay(
  comp : @tutuca.Component[R, M],
  start : R,
  steps : ArrayView[Step[R, M]],
  scope : @tutuca.Scope,
  after_each : ((R, R, String) -> Unit raise)?,
) -> (String, Int32)? {
  let d = Driver::new(comp, start, scope~)
  if d.problems().length() > 0 {
    return Some(
      ("the start state: " + d.problems().map(describe).join("; "), 0),
    )
  }
  for i, step in steps {
    let prev = d.state()
    let before = d.reports.length()
    (step.send_app)(d.app)
    d.drain()
    let problems = d.problems_since(before)
    if problems.length() > 0 {
      return Some((problems.map(describe).join("\n  "), i + 1))
    }
    if after_each is Some(f) {
      f(prev, d.state(), step.label) catch {
        e => return Some((e.to_string(), i + 1))
      }
    }
  }
  None
}

///|
/// The shortest sequence found by dropping chunks of `steps` that still breaks.
fn[R, M] shrink_steps(
  comp : @tutuca.Component[R, M],
  start : R,
  steps : Array[Step[R, M]],
  scope : @tutuca.Scope,
  after_each : ((R, R, String) -> Unit raise)?,
) -> (Array[Step[R, M]], String) {
  let mut best = steps
  let mut problem = match replay(comp, start, best[:], scope, after_each) {
    Some((p, n)) => {
      best = best[:n].to_owned()
      p
    }
    None => return (steps, "it passed when replayed")
  }
  let mut chunk = best.length() / 2
  while chunk >= 1 {
    let mut i = 0
    while i < best.length() {
      let end = if i + chunk > best.length() {
        best.length()
      } else {
        i + chunk
      }
      let candidate = [..best[:i], ..best[end:]]
      match replay(comp, start, candidate[:], scope, after_each) {
        Some((p, n)) => {
          best = candidate[:n].to_owned()
          problem = p
        }
        None => i += chunk
      }
    }
    chunk = chunk / 2
  }
  (best, problem)
}

///|
/// Searches for a sequence of up to `steps` random messages to `targets` that breaks the
/// component (a failed task, invalid state, a broken contract, or `after_each` raising), one
/// sequence per run from `start`, and returns it shrunk.
pub fn[R, M] find_failure(
  comp : @tutuca.Component[R, M],
  start : (@splitmix.RandomState, Int32) -> R,
  targets : Array[Target[R, M]],
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
  count~ : Int32 = 50,
  steps~ : Int32 = 20,
  seed~ : UInt64 = 42,
  size~ : Int32 = 10,
  after_each? : (R, R, String) -> Unit raise?,
) -> Failure[R, M]? {
  let after_each : ((R, R, String) -> Unit raise)? = match after_each {
    Some(f) => Some(fn(prev, next, label) raise { f(prev, next, label) })
    None => None
  }
  guard targets.length() > 0 else { return None }
  let rs = @splitmix.RandomState(seed~)
  for _ in 0..<count {
    let run_rs = rs.split()
    let first = start(run_rs, size)
    let d = Driver::new(comp, first, scope~)
    if d.problems().length() > 0 {
      return Some({
        start: first,
        steps: [],
        problem: "the start state: " + d.problems().map(describe).join("; "),
      })
    }
    let done = []
    for _ in 0..<steps {
      let target = targets[run_rs
        .next_uint(limit=targets.length().reinterpret_as_uint())
        .reinterpret_as_int()]
      let made = match target.app_step {
        Some(f) => f(d.app, run_rs, size)
        None => (target.step)(d.state(), run_rs, size)
      }
      guard made is Some(step) else { continue }
      done.push(step)
      let prev = d.state()
      let before = d.reports.length()
      (step.send_app)(d.app)
      d.drain()
      let broke = d.problems_since(before).length() > 0 ||
        (match after_each {
          Some(f) =>
            try f(prev, d.state(), step.label) catch {
              _ => true
            } noraise {
              _ => false
            }
          None => false
        })
      if broke {
        let (shrunk, problem) = shrink_steps(
          comp, first, done, scope, after_each,
        )
        return Some({ start: first, steps: shrunk, problem, })
      }
    }
  }
  None
}

///|
/// Sends up to `steps` random messages to `targets`, one sequence per run, starting from
/// `state`; raises on the first sequence that breaks the component, shrunk. `after_each(prev,
/// next, label)` adds assertions.
pub fn[R, M] run_messages(
  comp : @tutuca.Component[R, M],
  state : () -> R,
  targets : Array[Target[R, M]],
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
  count~ : Int32 = 50,
  steps~ : Int32 = 20,
  seed~ : UInt64 = 42,
  after_each? : (R, R, String) -> Unit raise?,
) -> Unit raise PropertyFailed {
  let failure = match after_each {
    Some(f) =>
      find_failure(
        comp,
        (_, _) => state(),
        targets,
        scope~,
        count~,
        steps~,
        seed~,
        after_each=(prev, next, label) => f(prev, next, label),
      )
    None =>
      find_failure(
        comp,
        (_, _) => state(),
        targets,
        scope~,
        count~,
        steps~,
        seed~,
      )
  }
  match failure {
    Some(failure) =>
      raise PropertyFailed(
        "\{comp.name} messages failed (seed \{seed}):\n  " + failure.describe(),
      )
    None => ()
  }
}

///|
/// Dispatches up to `steps` random events (with random field values) on elements that have
/// handlers, and after each checks there was no problem and the patched DOM equals a fresh
/// render of the same state.
pub fn[R, M] run_events(
  comp : @tutuca.Component[R, M],
  state : () -> R,
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
  count~ : Int32 = 50,
  steps~ : Int32 = 20,
  seed~ : UInt64 = 42,
) -> Unit raise PropertyFailed {
  check_property(
    "\{comp.name} events",
    (rs, size) => {
      let d = Driver::new(comp, state(), scope~)
      let done = []
      // Fields typed into hold the typed text until the state overrides it, as in a browser.
      let typed : Array[String] = []
      for _ in 0..<steps {
        let sites = d.host.handler_sites()
        let elements = d.root_node
          .descendants()
          .filter(n => n.get_attribute(@tutuca.handler_attr) is Some(_))
        guard elements.length() > 0 else { break }
        let el = elements[rs
          .next_uint(limit=elements.length().reinterpret_as_uint())
          .reinterpret_as_int()]
        let id = el.get_attribute(@tutuca.handler_attr).unwrap()
        guard sites.iter().find_first(s => s.0 == id) is Some((_, events)) &&
          events.length() > 0 else {
          continue
        }
        let event = events[rs
          .next_uint(limit=events.length().reinterpret_as_uint())
          .reinterpret_as_int()]
        let value = if rs.next_uint(limit=2) == 0 {
          printable(rs, size)
        } else {
          (rs.next_uint(limit=2) == 0).to_string()
        }
        done.push(
          "\{event} on <\{el.tag_name().to_lower()} \{id}> value \{@debug.to_string(value)}",
        )
        let before = d.reports.length()
        if !typed.contains(id) {
          typed.push(id)
        }
        d.dispatch(el, event, value~)
        let problems = d.problems_since(before)
        if problems.length() > 0 {
          raise Broke(
            "after\n    \{done.join("\n    ")}\n  " +
            problems.map(describe).join("\n  "),
          )
        }
        let fresh = Driver::new(comp, d.state(), scope~)
        let skip_live = (n : @memdom.MemNode) => {
          n
          .get_attribute(@tutuca.handler_attr)
          .map(id => typed.contains(id))
          .unwrap_or(false)
        }
        let inside = (root : @memdom.MemNode) => {
          root.children().map(c => c.signature(skip_live~)).join("")
        }
        let (patched, rendered) = (inside(d.root_node), inside(fresh.root_node))
        if patched != rendered {
          raise Broke(
            "after\n    \{done.join("\n    ")}\n  the patched DOM differs from a fresh render:\n" +
            first_difference(patched, rendered),
          )
        }
      }
    },
    count~,
    seed~,
  )
}

///|
/// A short random text a user could type: letters, digits, spaces and a few marks.
fn printable(rs : @splitmix.RandomState, size : Int32) -> String {
  let chars = "abcdefghijklmnopqrstuvwxyz ABC0123456789@#-,"
  let n = rs
    .next_uint(limit=(size + 1).reinterpret_as_uint())
    .reinterpret_as_int()
  let sb = StringBuilder()
  for _ in 0..<n {
    let i = rs
      .next_uint(limit=chars.length().reinterpret_as_uint())
      .reinterpret_as_int()
    sb.write_char(chars.get_char(i).unwrap())
  }
  sb.to_string()
}

///|
/// Where two texts first differ, with some context, one line each.
fn first_difference(a : String, b : String) -> String {
  let ca = a.iter().to_array()
  let cb = b.iter().to_array()
  let mut i = 0
  while i < ca.length() && i < cb.length() && ca[i] == cb[i] {
    i += 1
  }
  let start = if i > 120 { i - 120 } else { 0 }
  let around = (cs : Array[Char]) => {
    let end = if i + 120 < cs.length() { i + 120 } else { cs.length() }
    String::from_array(cs[start:end])
  }
  "    patched: …\{around(ca)}…\n    fresh:   …\{around(cb)}…"
}

///|
/// Random messages to any component instance in the state, each one of its declared messages
/// (`json_messages`) with generated args, from a random item for a signal it hears from a
/// collection: JS's stress tests, which send any message of any instance.
pub fn[R, M] any_instance() -> Target[R, M] {
  {
    name: "any instance",
    step: (_, _, _) => None,
    sample: (_, _) => "",
    decode: (_, _, _) => raise Failure("any_instance sends by name"),
    keys: _ => [],
    messages: [],
    app_step: Some((app, rs, _) => {
      let nodes = app.instances().filter(n => n.messages.length() > 0)
      guard nodes.length() > 0 else { return None }
      let pick = (n : Int32) => {
        rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
      }
      let node = nodes[pick(nodes.length())]
      let name = node.messages[pick(node.messages.length())]
      let args = (node.sample_args)(name, rs.next_uint64())
      let keys = (node.keys_of)(name)
      let key = if keys.is_empty() { "" } else { keys[pick(keys.length())] }
      let home = node.home.to_string()
      let shown = args.map(a => a.stringify()).join(", ")
      let from = if key == "" { "" } else { " from \{key}" }
      Some({
        label: "\{node.name} at \{home}.\{name}(\{shown})\{from}",
        send_app: a => a.send_json(home, name, args, key) catch { _ => () },
      })
    }),
  }
}
