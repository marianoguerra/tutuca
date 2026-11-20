// Where a message goes and how it gets there, as tutuca's src/tree: a path
// of frames into the state, tasks in a queue, one transaction each; a
// notification going up from the component that sent it, hop by hop, until
// one stops it.

///|
/// A frame of a dispatch path: the keys to a value, the item of it when it is
/// one of a sequence, and whether a component is rendered there.
priv struct PFrame {
  keys : Array[Json]
  item : Json
  node : Bool
  /// When its keys start from a value a component above provides: how many
  /// frames up that component is, and the keys from it to the value.
  provider : (Int32, Array[Json])?
}

///|
fn PFrame::access_keys(self : PFrame) -> Array[Json] {
  if self.item is Null {
    self.keys
  } else {
    [..self.keys, self.item]
  }
}

///|
fn same_frame(a : PFrame, b : PFrame) -> Bool {
  a.keys == b.keys && a.item == b.item
}

///|
/// The path up to its last component: what a handler runs at.
fn to_node_path(path : Array[PFrame]) -> Array[PFrame] {
  let mut end = path.length()
  while end > 0 && !path[end - 1].node {
    end -= 1
  }
  path[:end].to_owned()
}

///|
fn to_key_path(path : Array[PFrame]) -> Array[Json] {
  // The keys to each frame's start; a provided frame starts at its provider.
  let prefixes : Array[Array[Json]] = [[]]
  for f in path {
    let at = prefixes.length() - 1
    let start = match f.provider {
      Some((up, keys)) if at - up >= 0 => [..prefixes[at - up], ..keys]
      _ => prefixes[at]
    }
    prefixes.push([..start, ..f.access_keys()])
  }
  prefixes[prefixes.length() - 1]
}

///|
/// The key of the item of receiver's that a path goes through: what a
/// handler reads as sourceKey.
fn source_key_in(path : Array[PFrame], receiver : Array[PFrame]) -> Json {
  let mut i = receiver.length()
  if i >= path.length() {
    return Json::null()
  }
  for j in 0..<i {
    if !same_frame(path[j], receiver[j]) {
      return Json::null()
    }
  }
  while i < path.length() - 1 && !path[i].node {
    i += 1
  }
  path[i].item
}

///|
fn step_in(v : Val, key : Json) -> Val {
  match (kind(v), key) {
    (Obj, String(k)) => get(v, k)
    (List, Number(n, ..)) => {
      let i = n.to_int()
      if i >= 0 && i < v_len(v) {
        v_at(v, i)
      } else {
        undefined()
      }
    }
    (Obj, Number(n, ..)) => get(v, text_of(v_num(n)))
    _ => undefined()
  }
}

///|
fn get_in(root : Val, keys : Array[Json]) -> Val {
  let mut v = root
  for k in keys {
    v = step_in(v, k)
  }
  v
}

///|
extern "wasm" fn v_put_at(l : Val, i : Int32, x : Val) = "values" "v_put_at"

///|
/// The root with the value at keys replaced: the root itself, changed, or
/// the value when there are no keys.
fn set_in(root : Val, keys : Array[Json], v : Val) -> Val {
  guard keys.last() is Some(last) else { return v }
  let parent = get_in(root, keys[:keys.length() - 1].to_owned())
  match (kind(parent), last) {
    (Obj, String(k)) => obj_put(parent, k, v)
    (List, Number(n, ..)) => v_put_at(parent, n.to_int(), v)
    _ => ()
  }
  root
}

///|
priv enum TaskKind {
  /// A message for the component at its path.
  Message
  /// A notification from a component: the hops left to go, and whether one
  /// handled it.
  Notify(from~ : Array[PFrame], hops~ : Array[Array[PFrame]]?, handled~ : Bool)
  /// A message for what a path, as data, selects under the component that
  /// sent it: found in the state its sender left.
  Select(Json)
  /// A question a component asks: its request's number.
  Ask(Int32)
  /// The answer to one: the ask's name, how it went (ok, error, unhandled),
  /// the request.
  Answer(ask~ : String, outcome~ : String, request~ : Int32)
}

///|
priv struct Task {
  name : String
  args : Val
  to : Array[PFrame]
  kind : TaskKind
  /// The component that sent it; None for the page.
  from : Array[PFrame]?
  /// Whether it is an event's, so its handler reads what is being dragged.
  event : Bool
}

///|
/// What a handler did besides changing its draft, and where it ran.
priv struct Ctx {
  /// The handling component's scope, to make components from.
  scope : Scope
  path : Array[PFrame]
  /// Who sent the message being handled; None for the page.
  from : Array[PFrame]?
  tasks : Array[Task]
  unhandled : Array[String]
  logs : Array[Json]
  mut stop_next : Bool
}

///|
/// The paths a notification from a component goes through: each component
/// above it, the root last.
fn hops_of(from : Array[PFrame]) -> Array[Array[PFrame]] {
  let hops = []
  let mut p = to_node_path(from)
  while p.length() > 0 {
    p = to_node_path(p[:p.length() - 1].to_owned())
    hops.push(p)
  }
  hops
}

///|
/// One task: its handler runs on a draft of its component, and what it
/// leaves is in the root when it finishes.
fn World::deliver(self : World, task : Task) -> Unit {
  guard self.root is Some(before) else { return }
  // A notification finds where it goes when its turn comes.
  if task.kind is Ask(request) {
    return self.ask(task, request)
  }
  let (to, hops, any_handled, through) = match task.kind {
    Notify(from~, hops~, handled~) => {
      let all = match hops {
        Some(h) => h
        None => hops_of(from)
      }
      guard all.get(0) is Some(first) else { return }
      (first, all[1:].to_owned(), handled, from)
    }
    _ => (task.to, [], false, task.from.unwrap_or(task.to))
  }
  let path = to_node_path(to)
  let keys = to_key_path(path)
  let instance = get_in(before, keys)
  let record : Map[String, Json] = {
    "type": "transition",
    "name": Json::string(task.name),
    "args": to_json(task.args),
    // Where it was handled: the keys from the root.
    "at": Json::array(keys),
  }
  guard self.scope.spec_of(instance) is Some(spec) else {
    record["outcome"] = "orphaned"
    record["issues"] = Json::array([])
    self.reports.push(Json::object(record))
    return
  }
  let ctx : Ctx = {
    scope: scope_of(instance),
    path,
    from: task.from,
    tasks: [],
    unhandled: [],
    logs: [],
    stop_next: false,
  }
  // An answer's handler is its ask's, for how it went; a message's its own.
  let (handler, entry, ctx_name, request) = match task.kind {
    Answer(ask~, outcome~, request~) => {
      let h : Handler? = if spec.answers
        .get(ask)
        .unwrap_or([])
        .contains(outcome) {
        Some({
          name: task.name,
          args: None,
          pure: false,
          swap: false,
          pre: false,
          post: false,
        })
      } else {
        None
      }
      (
        h,
        "\{spec.at}.answers.\{ask}.\{outcome}",
        "Ctx_\{spec.name}_\{ask}Answer",
        v_num(request.to_double()),
      )
    }
    _ =>
      (
        spec.on.get(task.name),
        "\{spec.at}.on.\{task.name}.run",
        "Ctx_\{spec.name}_\{task.name}",
        null_(),
      )
  }
  let draft_root = v_copy(before)
  let draft = get_in(draft_root, keys)
  let mut ran : Result[Val, String] = Ok(draft)
  match handler {
    Some(h) => {
      let params = [draft, task.args]
      if !h.pure {
        let fields = obj_new()
        obj_put(fields, "sourceKey", from_json(source_key_in(through, path)))
        obj_put(
          fields,
          "drag",
          match (task.event, self.drag) {
            (true, Some(drag)) => {
              let d = obj_new()
              obj_put(d, "type", drag.type_)
              obj_put(d, "value", drag.value)
              obj_put(d, "key", from_json(source_key_in(drag.path, path)))
              d
            }
            _ => null_()
          },
        )
        obj_put(fields, "request", request)
        params.push(v_handle(ctx_name, fields))
      }
      self.ctxs.push(ctx)
      ran = try {
        let result = call_entry(entry, instance, params)
        Ok(self.scope.result_of(h, result, draft))
      } catch {
        Fault(message, ..) => Err(message)
      }
      ignore(self.ctxs.pop())
    }
    None => ()
  }
  guard ran is Ok(next) else {
    if ran is Err(message) {
      record["error"] = Json::string(message)
    }
    record["outcome"] = "failed"
    record["issues"] = Json::array([])
    self.reports.push(Json::object(record))
    return
  }
  // Where a notification goes next, and whether anyone heard it.
  let mut next_hop : Task? = None
  match task.kind {
    Message | Select(_) | Ask(_) | Answer(..) =>
      if handler is None {
        ctx.unhandled.push(task.name)
      }
    Notify(from~, ..) => {
      let handled = any_handled || handler is Some(_)
      if !ctx.stop_next {
        if path.length() == 0 {
          if !handled {
            ctx.unhandled.push(task.name)
          }
        } else {
          next_hop = Some({
            name: task.name,
            args: task.args,
            to: [],
            kind: Notify(from~, hops=Some(hops), handled~),
            from: Some(from),
            event: false,
          })
        }
      }
    }
  }
  let after = v_freeze(v_share(before, set_in(draft_root, keys, next)))
  self.root = Some(after)
  let issues = []
  self.scope.collect_invalid(after, Some(before), true, false, issues)
  match handler {
    Some(h) =>
      for
        reason in self.scope.message_issues(
          spec,
          h,
          instance,
          get_in(after, keys),
          task.args,
        ) {
        issues.push(message_issue(reason))
      }
    None => ()
  }
  record["outcome"] = if handler is Some(_) {
    "handled"
  } else if ctx.unhandled.contains(task.name) {
    "unhandled"
  } else {
    "passed"
  }
  record["issues"] = Json::array(issues)
  if ctx.logs.length() > 0 {
    record["logs"] = Json::array(ctx.logs)
  }
  self.reports.push(Json::object(record))
  for child in ctx.tasks {
    // What a path selects is found in the state its sender left.
    match child.kind {
      Select(selector) => {
        let to = [..path, ..self.scope.fix_path(selector, get_in(after, keys))]
        self.queue.push({ ..child, to, kind: Message, })
      }
      _ => self.queue.push(child)
    }
  }
  match next_hop {
    Some(hop) => self.queue.insert(0, hop)
    None => ()
  }
}

///|
/// Runs the tasks queued, then shows what changed and checks what settled.
fn World::run(self : World) -> Unit {
  let before = self.root
  while self.queue.length() > 0 {
    let task = self.queue.remove(0)
    self.deliver(task)
  }
  let changed = match (before, self.root) {
    (Some(a), Some(b)) => !v_same(a, b)
    _ => false
  }
  if changed {
    let problem = self.render()
    if problem != "" {
      self.reports.push({
        "type": "renderFailed",
        "error": Json::string(problem),
        "issues": Json::array([]),
      })
    }
  }
  self.settle()
}

///|
/// A message to the component at a path, run now with what it starts.
fn World::send(
  self : World,
  name : String,
  args : Val,
  to : Array[PFrame],
  event~ : Bool = false,
) -> Unit {
  self.queue.insert(0, { name, args, to, kind: Message, from: None, event, })
  self.run()
}

///|
/// The path the comments around a node say: the frames from the root down,
/// each a component's where a component starts under it.
fn path_of_markers(markers : Array[Json]) -> Array[PFrame] {
  let frames : Array[PFrame] = []
  // The components above that provide values: where each is, and what.
  let providers : Array[(Int32, Map[String, Json])] = []
  for i in 0..<markers.length() {
    guard markers[markers.length() - 1 - i] is Object(m) else { continue }
    if m.get("t") is Some(String("frame")) {
      let keys = match m.get("k") {
        Some(Array(ks)) => ks
        _ => []
      }
      let mut provider = None
      if m.get("p") is Some(Object(p)) && p.get("v") is Some(String(name)) {
        for j in 0..<providers.length() {
          let (at, provides) = providers[providers.length() - 1 - j]
          if provides.get(name) is Some(Array(ks)) {
            provider = Some((frames.length() - at, ks))
            break
          }
        }
      }
      frames.push({
        keys,
        item: m.get("i").unwrap_or(Json::null()),
        node: false,
        provider,
      })
    } else {
      if frames.length() > 0 {
        let last = frames[frames.length() - 1]
        frames[frames.length() - 1] = { ..last, node: true, }
      }
      if m.get("p") is Some(Object(provides)) {
        providers.push((frames.length(), provides))
      }
    }
  }
  frames
}

///|
extern "wasm" fn event_property(name : String) -> Val = "tutuca" "event_property"

///|
extern "wasm" fn event_prevent() = "tutuca" "event_prevent"

///|
extern "wasm" fn event_stop() = "tutuca" "event_stop"

///|
/// An event of the page: { type, key, held: [names], markers, eids: [{ eid,
/// level, value }] }, what the page found walking up from its target. The
/// first binding that takes it sends its message to the component the
/// element is in.
fn World::event(self : World, e : Map[String, Json]) -> Unit {
  let text = (key : String) => {
    match e.get(key) {
      Some(String(s)) => Some(s)
      _ => None
    }
  }
  guard text("type") is Some(type_) else { return }
  let held : Array[String] = match e.get("held") {
    Some(Array(xs)) =>
      xs.filter_map(x => {
        match x {
          String(s) => Some(s)
          _ => None
        }
      })
    _ => []
  }
  match
    self.binding_for(e, b => {
      b.type_ == type_ &&
      (b.key is None || text("key") == b.key) &&
      b.held.iter().all(h => held.contains(h))
    }) {
    Some((b, to, found)) => {
      guard b.action is Send(name, arg_views) else { return }
      if b.prevent {
        event_prevent()
      }
      if b.stop {
        event_stop()
      }
      let path = to_node_path(to)
      let source_key = source_key_in(to, path)
      let args = arg_views.map(a => {
        match a {
          Constant(v) => v
          EventArg("targetValue", _) =>
            from_json(found.get("value").unwrap_or(Json::null()))
          EventArg("eventKey", _) =>
            from_json(e.get("key").unwrap_or(Json::null()))
          EventArg("eventProperty", Some(p)) => event_property(p)
          EventArg("sourceKey", _) => from_json(source_key)
          EventArg("dragKey", _) =>
            match self.drag {
              Some(drag) => from_json(source_key_in(drag.path, path))
              None => null_()
            }
          _ => null_()
        }
      })
      self.send(name, list_of(args), to, event=true)
    }
    None => ()
  }
}

///|
let drop_events : Array[String] = ["dragenter", "dragover", "dragleave", "drop"]

///|
/// The binding that takes an event, the path of the component its element
/// is in, and what the page found of that element. The elements of the
/// component the target is in are looked at; for what is dragged over or
/// dropped, those of each component around it too, the nearest first.
fn World::binding_for(
  self : World,
  e : Map[String, Json],
  takes : (Binding) -> Bool,
) -> (Binding, Array[PFrame], Map[String, Json])? {
  ignore(self)
  let markers = match e.get("markers") {
    Some(Array(ms)) => ms
    _ => []
  }
  // Where in the markers each component around the target starts.
  let components : Array[Int32] = match e.get("components") {
    Some(Array(xs)) =>
      xs.filter_map(x => {
        match x {
          Number(n, ..) => Some(n.to_int())
          _ => None
        }
      })
    _ => []
  }
  guard e.get("eids") is Some(Array(eids)) else { return None }
  let bubbles = e.get("type") is Some(String(t)) && drop_events.contains(t)
  let levels = if bubbles {
    components.length()
  } else {
    components.length().min(1)
  }
  for level in 0..<levels {
    let start = if level == 0 { 0 } else { components[level - 1] + 1 }
    let to = path_of_markers(markers[start:].to_owned())
    for found in eids {
      guard found is Object(f) else { continue }
      guard f.get("level") is Some(Number(l, ..)) && l.to_int() == level else {
        continue
      }
      guard f.get("eid") is Some(Number(eid, ..)) else { continue }
      guard views.bound.get(eid.to_int()) is Some(elem) else { continue }
      for b in elem.bindings {
        if takes(b) {
          return Some((b, to, f))
        }
      }
    }
  }
  None
}

///|
/// What is being dragged: where in the state it is, the type its element
/// says, and its value.
priv struct Drag {
  path : Array[PFrame]
  type_ : Val
  value : Val
}

///|
/// Answers an ask now when what handles it does, or leaves it for later. 0:
/// nobody handles it; 1: answered, the value in ask_value; 2: failed, the
/// error's text in ask_value; 3: the page answers later, with tw_answer.
extern "wasm" fn host_ask(name : String, args : Val, request : Int32) -> Int32 = "tutuca" "ask"

///|
extern "wasm" fn ask_value() -> Val = "tutuca" "ask_value"

///|
/// A component's question: answered by its scope's ask handler, a function
/// of a module, or by the page. The answer is a task for the asker.
fn World::ask(self : World, task : Task, request : Int32) -> Unit {
  let answer = (outcome : String, args : Array[Val]) => {
    let made : Task = {
      name: "\{task.name}.\{outcome}",
      args: list_of(args),
      to: task.to,
      kind: Answer(ask=task.name, outcome~, request~),
      from: None,
      event: false,
    }
    made
  }
  self.reports.push({
    "type": "transition",
    "name": Json::string(task.name),
    "args": to_json(task.args),
    "outcome": "asked",
    "issues": Json::array([]),
  })
  // Its scope's handler, a function of a module, when there is one.
  let asker = match self.root {
    Some(root) => get_in(root, to_key_path(to_node_path(task.to)))
    None => undefined()
  }
  if scope_of(asker).lookup_ask(task.name) is Some(path) {
    let ctx = v_handle("AskCtx", obj_new())
    // What the handler's ctx names and makes, it does from the asker's scope.
    making.push(scope_of(asker))
    let result : Result[Val, Fault] = Ok(
      call_entry(path, undefined(), [..items(task.args), ctx]),
    ) catch {
      e => Err(e)
    }
    ignore(making.pop())
    let now = match result {
      Ok(v) => answer("ok", [v])
      Err(Fault(message, ..)) => answer("error", [v_str(message)])
    }
    self.queue.insert(0, now)
    return
  }
  match host_ask(task.name, task.args, request) {
    1 => self.queue.insert(0, answer("ok", [ask_value()]))
    2 => self.queue.insert(0, answer("error", [ask_value()]))
    3 => self.asked[request] = task
    _ => self.queue.insert(0, answer("unhandled", []))
  }
}

///|
/// The page's answer to an ask it left for later: how it went, and the value
/// (or the error's text).
fn World::answer(self : World, request : Int32, ok : Bool, value : Val) -> Unit {
  guard self.asked.get(request) is Some(task) else { return }
  self.asked.remove(request)
  let outcome = if ok { "ok" } else { "error" }
  self.queue.push({
    name: "\{task.name}.\{outcome}",
    args: list_of([value]),
    to: task.to,
    kind: Answer(ask=task.name, outcome~, request~),
    from: None,
    event: false,
  })
  self.run()
}
