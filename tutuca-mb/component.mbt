// Components: a state type S, a message type M, views, an update, listeners, provides and the
// dev-mode contract (pre, post, invariants).

///|
let next_component_id : Ref[Int32] = Ref(0)

///|
pub struct Component[S, M] {
  id : Int32
  name : String
  priv view_fn : () -> View[S, M]
  priv views_fn : () -> Array[(String, View[S, M])]
  priv update : (S, M, Ctx[S, M]) -> S raise
  priv listeners : Array[Listener[S, M]]
  priv provides : Array[Provision[S]]
  priv invariants : Array[(String, (S) -> Bool)]
  priv pre : ((S, M) -> Bool)?
  priv post : ((M, S, S) -> Bool)?
  priv show_msg : (M) -> String
  priv fields : Array[FieldInfo]
  priv messages : Messages[M]
  priv computed : Array[(String, (S) -> Json?)]
  priv children : () -> Array[Child[S]]
  priv transparent : Bool
  priv mut compiled : Compiled[S, M]?
  priv cache : Map[String, CacheEntry[S]]
}

///|
priv struct Compiled[S, M] {
  plans : Map[String, Plan[S, S, M]]
  irs : Array[(String, Ir)]
  event_names : Array[String]
}

///|
priv struct CacheEntry[S] {
  state : S
  mut gen : Int32
  vnodes : Array[@vdom.VNode]
  bindings : Array[(String, Bound)]
  nodes : Array[(String, Node)]
  deps : Array[() -> Bool]
  checked : Bool
}

///|
/// Defines a component. `view` is its main view and `views` its named ones; both are thunks,
/// lowered once on first use, so a view may render its own component. `update` handles the
/// component's messages, `on` the signals from below, `provides` what it offers descendants.
/// `pre`, `post` and `invariants` are checked in dev mode. `fields`, `messages` and `computed`
/// describe the state's fields, the messages (`json_messages`) and the values computed from
/// the state, for the dev tools and the storybook's form; `children` the child components its
/// state holds and `transparent` that it only shows its state's case's component, so the form
/// lists the instances in a state as JS does.
pub fn[S, M : Debug] component(
  name : String,
  view~ : () -> View[S, M],
  views~ : () -> Array[(String, View[S, M])] = () => [],
  update~ : (S, M, Ctx[S, M]) -> S raise? = (s, _, _) => s,
  on~ : Array[Listener[S, M]] = [],
  provides~ : Array[Provision[S]] = [],
  invariants~ : Array[(String, (S) -> Bool)] = [],
  pre? : (S, M) -> Bool,
  post? : (M, S, S) -> Bool,
  fields~ : Array[FieldInfo] = [],
  messages? : Messages[M],
  computed~ : Array[(String, (S) -> Json?)] = [],
  children~ : () -> Array[Child[S]] = () => [],
  transparent~ : Bool = false,
) -> Component[S, M] {
  next_component_id.val += 1
  {
    id: next_component_id.val,
    name,
    view_fn: view,
    views_fn: views,
    update: (s, m, ctx) => update(s, m, ctx),
    listeners: on,
    provides,
    invariants,
    pre,
    post,
    show_msg: m => @debug.to_string(m),
    fields,
    messages: messages.unwrap_or(no_messages()),
    computed,
    children,
    transparent,
    compiled: None,
    cache: Map([]),
  }
}

///|
fn[S, M] Component::sources(
  self : Component[S, M],
) -> Array[(String, View[S, M])] {
  [("main", (self.view_fn)()), ..(self.views_fn)()]
}

///|
/// The names of the component's views, `main` first.
pub fn[S, M] Component::view_names(self : Component[S, M]) -> Array[String] {
  ["main", ..(self.views_fn)().map(v => v.0)]
}

///|
/// What the check pass finds in the component's views, each issue prefixed with the
/// component and view.
pub fn[S, M] Component::check(self : Component[S, M]) -> Array[Issue] {
  let issues = []
  for source in self.sources() {
    let (name, view) = source
    for issue in check(view.ir()) {
      issues.push({
        path: "\{self.name}.\{name} \{issue.path}",
        message: issue.message,
      })
    }
  }
  issues
}

///|
/// The views' IR, by view name.
pub fn[S, M] Component::irs(self : Component[S, M]) -> Array[(String, Ir)] {
  self.sources().map(v => (v.0, v.1.ir()))
}

///|
/// Lowers the views once, raising what the check pass finds.
pub fn[S, M] Component::compile(self : Component[S, M]) -> Unit raise ViewError {
  ignore(self.compiled_views())
}

///|
fn[S, M] Component::compiled_views(
  self : Component[S, M],
) -> Compiled[S, M] raise ViewError {
  match self.compiled {
    Some(c) => c
    None => {
      let issues = self.check()
      if issues.length() > 0 {
        raise ViewError(issues)
      }
      let plans = Map([])
      let irs = []
      let event_names = []
      // One lowering for every view, so handler sites are numbered across them: two views of
      // one instance rendered at the same path keep their handlers apart.
      let lowerer = Lowerer::new()
      for source in self.sources() {
        let (name, view) = source
        let ir = view.ir()
        plans[name] = view.lower(lowerer)
        irs.push((name, ir))
        for ev in ir.event_names() {
          if !event_names.contains(ev) {
            event_names.push(ev)
          }
        }
      }
      let c = { plans, irs, event_names, }
      self.compiled = Some(c)
      c
    }
  }
}

///|
/// The lowered views' IR, by view name.
pub fn[S, M] Component::compiled_irs(
  self : Component[S, M],
) -> Array[(String, Ir)] raise ViewError {
  self.compiled_views().irs
}

///|
/// The DOM events the component's views handle.
pub fn[S, M] Component::event_names(
  self : Component[S, M],
) -> Array[String] raise ViewError {
  self.compiled_views().event_names
}

///|
/// The view to render: the one asked for, else the innermost pushed view the component has,
/// else main.
fn[S, M] best_view(
  plans : Map[String, Plan[S, S, M]],
  asked : String?,
  stack : Array[String],
) -> String {
  if asked is Some(name) && plans.contains(name) {
    return name
  }
  for i = stack.length() - 1; i >= 0; i = i - 1 {
    if plans.contains(stack[i]) {
      return stack[i]
    }
  }
  "main"
}

///|
/// This component placed at `route`, below `parent` in the rendered ancestry.
fn[S, M] Component::node(
  self : Component[S, M],
  route : Route[S],
  parent : Node?,
) -> Node {
  let path = route.path
  let node_ref : Ref[Node?] = Ref(None)
  let node : Node = {
    path,
    home: route.home,
    name: self.name,
    fields: self.fields.map(f => f.name),
    transparent: self.transparent,
    parent,
    messages: if self.messages.names.is_empty() {
      self.listeners.map(l => l.sig_name)
    } else {
      self.messages.names
    },
    keys_of: name => {
      match self.listeners.iter().find_first(l => l.sig_name == name) {
        Some(l) => {
          let state = route.read() catch { _ => return [] }
          (l.keys)(state).map(k => k.0)
        }
        None => []
      }
    },
    message_task: (name, args, key) => {
      let node = node_ref.val.unwrap()
      match self.messages.heard.iter().find_first(h => h.name == name) {
        Some(h) => {
          let source = match
            self.listeners.iter().find_first(l => l.sig_name == name) {
            Some({ items: Some(items), keys, .. }) =>
              match keys(route.read()).iter().find_first(k => k.0 == key) {
                Some((_, slot)) =>
                  path.push({
                    name: items,
                    item: Some(slot),
                    lens_id: 0,
                    provider: None,
                  })
                None => fail("\{name} needs a key of \{items}")
              }
            _ => path
          }
          let payload = match args {
            [] => Json::null()
            [one] => one
            many => Json::array(many)
          }
          (h.deliver)(node, source, payload)
        }
        None =>
          send_task(self, route, node, (self.messages.decode)(name, args), None)
      }
    },
    sample_args: (name, seed) => (self.messages.sample)(name, seed),
    listen: (sig_id, source, tx) => {
      for l in self.listeners {
        if l.sig_id == sig_id {
          let prev = route.read()
          let ctx = Ctx::new(tx, self, route, node_ref.val.unwrap(), None)
          match (l.run)(prev, source.frame_below(path), ctx) {
            Some(next) => {
              if !physical_equal(prev, next) {
                (route.set)(next)
              }
              return Some(ctx.stopped)
            }
            None => ()
          }
        }
      }
      None
    },
  }
  node_ref.val = Some(node)
  node
}

///|
/// Renders `state` at `route` into `out`, reusing the last render when the state, the view and
/// every provided value it read are the same objects as then.
fn[S, M] Component::render_at(
  self : Component[S, M],
  state : S,
  route : Route[S],
  parent : Node?,
  asked : String?,
  env : RenderEnv,
  out : Array[@vdom.VNode],
) -> Unit {
  let compiled = self.compiled_views() catch {
    ViewError(issues) =>
      abort(
        "\{self.name} has view issues:\n" +
        issues.map(i => i.to_string()).join("\n"),
      )
  }
  for ev in compiled.event_names {
    if !env.events.contains(ev) {
      env.events.push(ev)
    }
  }
  let view = best_view(compiled.plans, asked, env.view_stack)
  let key = "\{env.host_id}.\{env.start_id}|\{route.path.to_string()}|\{view}|\{env.view_stack.join(",")}"
  env.prunes[self.id] = () => self.prune(env.host_id, env.gen)
  if self.cache.get(key) is Some(entry) &&
    physical_equal(entry.state, state) &&
    entry.deps.iter().all(dep => dep()) &&
    !(env.dev && env.settled && !entry.checked) {
    entry.gen = env.gen
    for v in entry.vnodes {
      out.push(v)
    }
    for b in entry.bindings {
      env.bindings.push(b)
    }
    for n in entry.nodes {
      env.nodes.push(n)
    }
    for d in entry.deps {
      env.deps.push(d)
    }
    return
  }
  let node = self.node(route, parent)
  let nodes_start = env.nodes.length()
  env.nodes.push((route.path.to_string(), node))
  let pushed = self.provides.filter(p => (p.push)(state, route))
  let bindings_start = env.bindings.length()
  let deps_start = env.deps.length()
  let vnodes = []
  let r : Rctx[S, M] = {
    env,
    route,
    node,
    state,
    comp: self,
    keys: "",
    send: (m, again, ev) => event_task(self, route, node, m, again, ev),
  }
  compiled.plans[view].eval(state, route.get, r, vnodes)
  for p in pushed.rev() {
    (p.pop)()
  }
  if env.dev && env.settled {
    for inv in self.invariants {
      let (name, holds) = inv
      if !holds(state) {
        env.issues.push({
          path: "\{self.name} at \{route.path.to_string()}",
          message: "invariant `\{name}` does not hold",
        })
      }
    }
  }
  let vnodes = if env.meta {
    [
      @vdom.Comment(meta_open(self.name, route.path)),
      ..vnodes,
      meta_close_vnode,
    ]
  } else {
    vnodes
  }
  for v in vnodes {
    out.push(v)
  }
  self.cache[key] = {
    state,
    gen: env.gen,
    vnodes,
    bindings: env.bindings[bindings_start:].to_owned(),
    nodes: env.nodes[nodes_start:].to_owned(),
    deps: env.deps[deps_start:].to_owned(),
    checked: env.settled,
  }
}

///|
/// Drops the renders a host's last render didn't reuse.
fn[S, M] Component::prune(
  self : Component[S, M],
  host_id : Int32,
  gen : Int32,
) -> Unit {
  let prefix = "\{host_id}."
  let stale = []
  for key, entry in self.cache {
    if key.has_prefix(prefix) && entry.gen < gen {
      stale.push(key)
    }
  }
  for key in stale {
    self.cache.remove(key)
  }
}

///|
/// The constant class names the component's views use, every branch included; classes
/// computed from the state show up only when rendered.
pub fn[S, M] Component::class_names(self : Component[S, M]) -> Array[String] {
  let out = []
  for v in self.irs() {
    for c in v.1.class_names() {
      if !out.contains(c) {
        out.push(c)
      }
    }
  }
  out
}

///|
/// A value built on first use: components that reach each other through their views (an
/// array of values that may be arrays) are built by accessor functions that keep their one
/// component in a `Once`, since a toplevel `let` can't refer to itself.
pub struct Once[T] {
  priv mut value : T?
}

///|
pub fn[T] Once::new() -> Once[T] {
  { value: None, }
}

///|
pub fn[T] Once::get(self : Once[T], make : () -> T) -> T {
  match self.value {
    Some(v) => v
    None => {
      let v = make()
      self.value = Some(v)
      v
    }
  }
}

///|
/// The signals the component listens for, by name.
pub fn[S, M] Component::listens(self : Component[S, M]) -> Array[String] {
  self.listeners.map(l => l.sig_name)
}

///|
/// The names of what the component provides to descendants.
pub fn[S, M] Component::provided_names(self : Component[S, M]) -> Array[String] {
  self.provides.map(p => p.key_name)
}

///|
/// The names of the component's invariants.
pub fn[S, M] Component::invariant_names(
  self : Component[S, M],
) -> Array[String] {
  self.invariants.map(i => i.0)
}

///|
/// The state's fields, as the component describes them.
pub fn[S, M] Component::fields(self : Component[S, M]) -> Array[FieldInfo] {
  self.fields
}

///|
/// The names of the component's message variants, as it describes them.
pub fn[S, M] Component::message_names(self : Component[S, M]) -> Array[String] {
  self.messages.names
}

///|
/// This instance at `route` and the instances its state holds (`children`), parents first;
/// a transparent component (one that only shows the component of its state's case) is left
/// out, its children kept.
fn[S, M] Component::instances_at(
  self : Component[S, M],
  route : Route[S],
  parent : Node,
) -> Array[Node] {
  let node = self.node(route, Some(parent))
  let below = (self.children)()
    .map(c => {
      [
        ..(c.walk)(route, node),
        ..(c.selves)(route).map(r => self.instances_at(r, node)).flatten(),
      ]
    })
    .flatten()
  if self.transparent {
    below
  } else {
    [node, ..below]
  }
}

///|
/// The names of the values the component computes from its state, as JS lists its methods.
pub fn[S, M] Component::computed_names(self : Component[S, M]) -> Array[String] {
  self.computed.map(c => c.0)
}

///|
/// Those values for `state`, as JSON; None for one that takes arguments.
pub fn[S, M] Component::computed_values(
  self : Component[S, M],
  state : S,
) -> Array[(String, Json?)] {
  self.computed.map(c => (c.0, (c.1)(state)))
}

///|
/// Whether the component checks pre- and post-conditions on its messages.
pub fn[S, M] Component::has_contract(self : Component[S, M]) -> Bool {
  self.pre is Some(_) || self.post is Some(_)
}
