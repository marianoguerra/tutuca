// The host: renders the root component, routes DOM events to handlers and runs the task queue.

///|
/// What the host tells `on_report`.
pub enum Report {
  Rendered
  TaskHandled(Task)
  TaskFailed(Task, String)
  StateInvalid(Array[Issue]) // Dev mode: invariants that don't hold once the queue is empty.
  MessageInvalid(Task, Array[String]) // Dev mode: "pre" or "post" broke.
  RenderFailed(String)
}

///|
let next_host_id : Ref[Int32] = Ref(0)

///|
/// The attribute a host puts on its root node, so hosts nested in another's DOM keep their
/// events to themselves.
pub let host_attr : String = "data-tutuca-host"

///|
priv struct Snapshot {
  restore : () -> Unit
  unchanged : () -> Bool
}

///|
priv struct RootHandle {
  render : (RenderEnv) -> Array[@vdom.VNode]
  snapshot : () -> Snapshot
  instances : () -> Array[Node] // The instances its state holds, parents first.
}

///|
pub struct Host[N] {
  id : Int32
  doc : N
  root_node : N
  scope : Scope
  dev : Bool
  meta : Bool
  priv tasks : Array[Task]
  priv mut handlers : Map[String, Bound]
  priv mut nodes : Map[String, Node]
  priv mut vdom : Array[@vdom.VNode]?
  priv mut root : RootHandle?
  priv schedule : ((() -> Unit) -> Unit)?
  priv now : () -> Double
  priv mut listen : (String) -> Unit
  priv listened : Array[String]
  priv mut handling : Bool
  priv mut rendering : Bool
  priv mut tick_pending : Bool
  priv mut last_settled : Bool
  priv mut gen : Int32
  priv mut start_id : Int32
  priv mut on_report : (Report) -> Unit
  priv stops : Array[() -> Unit] // What stop also undoes: the root's listeners.
}

///|
/// A host rendering into `root_node`. `schedule` runs the task queue later (a zero timeout);
/// without it the queue runs when `drain` is called. `listen` adds the root listener for a DOM
/// event name the first time a rendered component handles it. `dev` checks contracts and
/// invariants. `meta` wraps each component's render in metadata comments, as JS always does:
/// events stop at the component they happen in, and `component_at` tells tools which component
/// a DOM node belongs to. Without them, an event goes to the component of the first handler.
pub fn[N] Host::new(
  doc : N,
  root_node : N,
  dev~ : Bool = false,
  meta~ : Bool = true,
  scope~ : Scope = Scope::new(),
  schedule? : (() -> Unit) -> Unit,
  now~ : () -> Double = () => 0.0,
  listen~ : (String) -> Unit = _ => (),
) -> Host[N] {
  next_host_id.val += 1
  {
    id: next_host_id.val,
    doc,
    root_node,
    scope,
    dev,
    meta,
    tasks: [],
    handlers: Map([]),
    nodes: Map([]),
    vdom: None,
    root: None,
    schedule,
    now,
    listen,
    listened: [],
    handling: false,
    rendering: false,
    tick_pending: false,
    last_settled: true,
    gen: 0,
    start_id: 0,
    on_report: _ => (),
    stops: [],
  }
}

///|
/// Sets how the host adds the root listener for a DOM event name; events already listened
/// for are listened for again through `f`.
pub fn[N] Host::set_listen(self : Host[N], f : (String) -> Unit) -> Unit {
  self.listen = f
  for name in self.listened {
    f(name)
  }
}

///|
/// Sets what the host calls with each `Report`.
pub fn[N] Host::set_on_report(self : Host[N], f : (Report) -> Unit) -> Unit {
  self.on_report = f
}

///|
/// A running root component: its state, and a way to send it messages from outside.
pub struct App[R, M] {
  priv cell : Ref[R]
  priv comp : Component[R, M]
  priv route : Route[R]
  priv node : Node
  priv push : (Task) -> Unit
  priv node_at : (String) -> Node?
}

///|
pub fn[R, M] App::state(self : App[R, M]) -> R {
  self.cell.val
}

///|
/// Queues `msg` to the root component, as if it came from outside the app.
pub fn[R, M] App::send(self : App[R, M], msg : M) -> Unit {
  (self.push)(send_task(self.comp, self.route, self.node, msg, None))
}

///|
/// Queues `msg` to the child of the root that `at` reaches.
pub fn[R, M, C, CM] App::send_to(
  self : App[R, M],
  comp : Component[C, CM],
  at : Lens[R, C],
  msg : CM,
) -> Unit {
  let route = self.route.focus(at)
  (self.push)(
    send_task(
      comp,
      route,
      rendered_node(self.node_at, comp, route, self.node),
      msg,
      None,
    ),
  )
}

///|
/// The component instances in the app's state, parents first (see `Host::instances`).
pub fn[R, M] App::instances(self : App[R, M]) -> Array[Node] {
  self.comp.instances_at(self.route, self.node)
}

///|
/// Queues the message `name` with JSON args to the instance whose state lives at `home` (from
/// the item `key` for a signal it hears from a collection), as the storybook's form sends.
pub fn[R, M] App::send_json(
  self : App[R, M],
  home : String,
  name : String,
  args : Array[Json],
  key : String,
) -> Unit raise {
  guard self.instances().iter().find_first(n => n.home.to_string() == home)
    is Some(node) else {
    fail("no instance at \{home}")
  }
  (self.push)((node.message_task)(name, args, key))
}

///|
/// Delivers `sig` with `payload` to the root, as if a child had sent it: from the child `from`
/// reaches (which a `Signal::from` listener reads the key of), the root itself by default.
pub fn[R, M, T, C] App::hear(
  self : App[R, M],
  sig : Signal[T],
  payload : T,
  from? : Lens[R, C],
) -> Unit {
  let source = match from {
    Some(lens) => self.route.focus(lens).path
    None => self.route.path
  }
  (self.push)(notify_task(sig, payload, source, self.node))
}

///|
fn[N : @vdom.DomNode] Host::core(self : Host[N]) -> HostCore {
  {
    id: self.id,
    scope: self.scope,
    dev: self.dev,
    report: r => (self.on_report)(r),
    push: t => self.push_task(t),
    node_at: p => self.nodes.get(p),
  }
}

///|
/// Starts `comp` as the root with `state` and renders it.
/// `view` renders the root with that view instead of main.
pub fn[N : @vdom.DomNode, R, M] Host::start(
  self : Host[N],
  comp : Component[R, M],
  state : R,
  view? : String,
) -> App[R, M] {
  self.start_id += 1
  let cell = Ref(state)
  let route = Route::new(DispatchPath::root(), () => Some(cell.val), v => {
    cell.val = v
  })
  let node = comp.node(route, None)
  self.root = Some({
    render: env => {
      let out = []
      comp.render_at(cell.val, route, None, view, env, out)
      out
    },
    instances: () => {
      comp
      .instances_at(route, node)
      .map(n => if n.home.is_root() { node } else { n })
    },
    snapshot: () => {
      let v = cell.val
      {
        restore: () => cell.val = v,
        unchanged: () => physical_equal(cell.val, v),
      }
    },
  })
  self.root_node.set_attribute(host_attr, self.id.to_string())
  self.vdom = None
  self.render()
  {
    cell,
    comp,
    route,
    node,
    push: t => self.push_task(t),
    node_at: p => self.nodes.get(p),
  }
}

///|
/// Renders the root and morphs the DOM to it.
pub fn[N : @vdom.DomNode] Host::render(self : Host[N]) -> Unit {
  guard self.root is Some(root) else { return }
  // Events while rendering (a blur when the morph removes a focused node) wait for the next
  // tick, as in JS: their tasks run after this render, on the state it shows.
  self.rendering = true
  defer {
    self.rendering = false
    if self.tasks.length() > 0 && !self.handling {
      self.schedule_tick()
    }
  }
  self.gen += 1
  let env = RenderEnv::new(
    self.id,
    self.gen,
    start_id=self.start_id,
    settled=self.tasks.is_empty(),
    dev=self.dev,
    meta=self.meta,
  )
  current_env.val = Some(env)
  let vnodes = (root.render)(env)
  current_env.val = None
  for prune in env.prunes.values() {
    prune()
  }
  @vdom.render(self.doc, self.root_node, vnodes, prev?=self.vdom) catch {
    DuplicateKey(msg) => {
      self.vdom = None
      (self.on_report)(RenderFailed(msg))
      return
    }
  }
  self.vdom = Some(vnodes)
  self.handlers = Map::from_array(env.bindings)
  self.nodes = Map::from_array(env.nodes)
  for ev in env.events {
    if !self.listened.contains(ev) {
      self.listened.push(ev)
      (self.listen)(ev)
    }
  }
  self.last_settled = env.settled
  if env.issues.length() > 0 {
    (self.on_report)(StateInvalid(env.issues))
  }
  (self.on_report)(Rendered)
}

///|
/// Routes a DOM event: from `target` up, the first element whose handlers include `name`
/// makes the task, which runs right away. `info` is what the backend read off the DOM event.
/// Returns whether a handler took it.
pub fn[N : @vdom.DomNode] Host::handle_event(
  self : Host[N],
  target : N,
  name : String,
  info~ : EventInfo = EventInfo::new(),
) -> Bool {
  guard self.root is Some(_) else { return false }
  // As JS: the handlers of the innermost component around `target`, innermost first; an
  // element of a component around that one never handles it. The metadata comments mark where
  // a component starts; without them, the first handler's component is the innermost.
  let candidates : Array[(N, Bound)] = []
  let mut owner : String? = None
  let mut inside = true
  let mut enclosing : String? = None
  let mut at = Some(target)
  while at is Some(node) {
    // The root, or another host's root: what is above isn't this host's, or isn't its to
    // handle (a story preview inside the storybook UI).
    if node.is_same_node(self.root_node) ||
      node.get_attribute(host_attr) is Some(_) {
      break
    }
    if inside &&
      node.get_attribute(handler_attr) is Some(id) &&
      self.handlers.get(id) is Some(bound) {
      let mine = handler_owner(id)
      match owner {
        None => {
          owner = Some(mine)
          candidates.push((node, bound))
        }
        Some(o) if o == mine => candidates.push((node, bound))
        Some(_) => inside = false
      }
    }
    if self.meta && inside && opens_component(node) is Some(path) {
      inside = false
      enclosing = Some(escape_owner(path))
    }
    at = node.parent_node()
  }
  // As JS: with the comments, only handlers of the component the target is rendered in count;
  // an element outside every component, or carrying another component's id, routes nowhere.
  if self.meta && (enclosing is None || enclosing != owner) {
    return false
  }
  for candidate in candidates {
    let (node, bound) = candidate
    for handler in bound {
      if handler.0 == name {
        let is_checkbox = node.tag_name() == "INPUT" &&
          node.get_attribute("type") == Some("checkbox")
        let event = Event::new(
          name,
          target_value=node.get_value(),
          target_checked=node.get_checked(),
          is_checkbox~,
          info~,
        )
        match (handler.1)(event) {
          Some(task) => {
            self.tasks.push(task)
            self.handle_tasks()
          }
          None => ()
        }
        return true
      }
    }
  }
  false
}

///|
pub fn[N : @vdom.DomNode] Host::push_task(self : Host[N], task : Task) -> Unit {
  self.tasks.push(task)
  if !self.handling {
    self.schedule_tick()
  }
}

///|
fn[N : @vdom.DomNode] Host::schedule_tick(self : Host[N]) -> Unit {
  if self.tick_pending {
    return
  }
  match self.schedule {
    Some(schedule) => {
      self.tick_pending = true
      schedule(() => {
        self.tick_pending = false
        self.handle_tasks()
      })
    }
    None => ()
  }
}

///|
/// The bound handler ids in the last render, with the DOM events each handles.
pub fn[N] Host::handler_sites(self : Host[N]) -> Array[(String, Array[String])] {
  self.handlers.to_array().map(e => (e.0, e.1.map(h => h.0)))
}

///|
/// The queued tasks.
pub fn[N] Host::pending(self : Host[N]) -> Int32 {
  self.tasks.length()
}

///|
/// Drops the queued tasks; an async ask reply in flight still arrives.
pub fn[N] Host::clear_tasks(self : Host[N]) -> Unit {
  self.tasks.clear()
}

///|
/// Stops handling events and tasks.
pub fn[N] Host::stop(self : Host[N]) -> Unit {
  self.clear_tasks()
  self.root = None
  // Nothing the host rendered stays reachable from the root's listeners.
  self.handlers = Map([])
  self.nodes = Map([])
  self.vdom = None
  self.listened.clear() // A restart listens again.
  let stops = self.stops.copy()
  self.stops.clear()
  for f in stops {
    f()
  }
}

///|
/// Runs `f` when the host stops, as to remove a listener it added to the root.
pub fn[N] Host::on_stop(self : Host[N], f : () -> Unit) -> Unit {
  self.stops.push(f)
}

///|
/// Runs queued tasks for up to 16ms, then renders if the root changed (or the queue just
/// emptied since an unsettled render, so invariants get checked).
pub fn[N : @vdom.DomNode] Host::handle_tasks(self : Host[N]) -> Unit {
  if self.handling || self.rendering {
    return
  }
  guard self.root is Some(root) else { return }
  self.handling = true
  let t1 = (self.now)()
  let before = (root.snapshot)()
  while self.tasks.length() > 0 {
    let task = self.tasks.remove(0)
    self.handle_task(root, task)
    if (self.now)() - t1 > 16.0 {
      break
    }
  }
  self.handling = false
  if !(before.unchanged)() || (self.tasks.is_empty() && !self.last_settled) {
    self.render()
  }
  if self.tasks.length() > 0 {
    self.schedule_tick()
  }
}

///|
fn[N : @vdom.DomNode] Host::handle_task(
  self : Host[N],
  root : RootHandle,
  task : Task,
) -> Unit {
  let snapshot = (root.snapshot)()
  let tx = { core: self.core(), task, staged: [], }
  let children = try {
    (task.run)(tx)
    tx.staged.map(make => make())
  } catch {
    e => {
      (snapshot.restore)()
      (self.on_report)(TaskFailed(task, e.to_string()))
      return
    }
  }
  for child in children {
    self.tasks.push(child)
  }
  (self.on_report)(TaskHandled(task))
}

///|
/// Runs the queue until it is empty, rendering as it goes: for tests and hosts without a
/// scheduler.
pub fn[N : @vdom.DomNode] Host::drain(self : Host[N]) -> Unit {
  while self.tasks.length() > 0 && self.root is Some(_) {
    self.handle_tasks()
  }
}

///|
/// The component instances in the state, in the order JS walks it: a component, then what
/// its fields hold (as its `children` say), then any other the last render placed. An
/// instance rendered where its state lives is the rendered one, with its rendered ancestry.
pub fn[N] Host::instances(self : Host[N]) -> Array[Node] {
  let out : Array[Node] = []
  let seen : Map[String, Bool] = Map([])
  let add = (node : Node) => {
    let home = node.home.to_string()
    if !seen.contains(home) {
      seen[home] = true
      out.push(
        match self.nodes.get(home) {
          Some(n) if n.name == node.name && n.home.to_string() == home => n
          _ => node
        },
      )
    }
  }
  match self.root {
    Some(root) => (root.instances)().each(add)
    None => ()
  }
  // Then what the walk didn't reach; a component rendered from what an ancestor provides
  // (its path isn't where its state lives) was listed where its state is.
  for node in self.nodes.values() {
    if !node.transparent && node.path.to_string() == node.home.to_string() {
      add(node)
    }
  }
  out
}

///|
/// Sends the message `name` with JSON args to the instance at `path` (from the item `key`
/// for a signal it hears from a collection), as the storybook's form does.
pub fn[N : @vdom.DomNode] Host::send_json(
  self : Host[N],
  path : String,
  name : String,
  args : Array[Json],
  key : String,
) -> Unit raise {
  guard self.instances().iter().find_first(n => n.home.to_string() == path)
    is Some(node) else {
    fail("nothing is rendered at \{path}")
  }
  self.push_task((node.message_task)(name, args, key))
}

///|
/// What the last render produced, for tools.
pub fn[N] Host::vnodes(self : Host[N]) -> Array[@vdom.VNode] {
  self.vdom.unwrap_or([])
}
