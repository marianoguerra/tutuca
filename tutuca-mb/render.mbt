// Rendering: the per-render environment, the context a plan renders in, and the builders that
// render components.

///|
/// An element's bound handlers: DOM event name to the task it makes.
pub type Bound = Array[(String, (Event) -> Task?)]

///|
/// One host render: the handlers it bound, the provided values it read, the view stack, and
/// what dev mode found.
pub struct RenderEnv {
  host_id : Int32
  start_id : Int32 // Which start of the host: renders of an earlier root are never reused.
  gen : Int32
  settled : Bool // The task queue was empty: invariants are checked.
  dev : Bool
  meta : Bool // Wrap each component's render in metadata comments, for tools.
  bindings : Array[(String, Bound)]
  nodes : Array[(String, Node)] // The components it placed, by path: where send_to delivers.
  deps : Array[() -> Bool]
  view_stack : Array[String]
  issues : Array[Issue]
  events : Array[String]
  prunes : Map[Int32, () -> Unit]
}

///|
pub fn RenderEnv::new(
  host_id : Int32,
  gen : Int32,
  start_id~ : Int32 = 0,
  settled~ : Bool,
  dev~ : Bool,
  meta~ : Bool = false,
) -> RenderEnv {
  {
    host_id,
    start_id,
    gen,
    settled,
    dev,
    meta,
    bindings: [],
    nodes: [],
    deps: [],
    view_stack: [],
    issues: [],
    events: [],
    prunes: Map([]),
  }
}

///|
fn RenderEnv::bind(self : RenderEnv, id : String, bound : Bound) -> Unit {
  self.bindings.push((id, bound))
}

///|
let current_env : Ref[RenderEnv?] = Ref(None)

///|
fn record_dep(dep : () -> Bool) -> Unit {
  if current_env.val is Some(env) {
    env.deps.push(dep)
  }
}

///|
/// What a plan renders in: the component it belongs to, its state and route, where it is in
/// the rendered ancestry, and the loop keys that make handler ids unique.
pub struct Rctx[S, M] {
  env : RenderEnv
  route : Route[S]
  node : Node
  state : S
  comp : Component[S, M]
  keys : String
  // The task for an event's message: `msg` names it, and `again` makes it once the task runs.
  send : (M, () -> M?, Event) -> Task
}

///|
fn[S, M] Rctx::enter_key(self : Rctx[S, M], key : String) -> Rctx[S, M] {
  { ..self, keys: "\{self.keys}[\{key}]", }
}

///|
/// The id of a handler site: stable across renders while the structure is. What comes before
/// its first `#` is the component's path, so `handler_owner` can tell whose it is.
fn[S, M] Rctx::handler_id(self : Rctx[S, M], eid : Int32) -> String {
  "\{escape_owner(self.route.path.to_string())}#\{eid}\{self.keys}"
}

///|
/// A component path as a handler id starts with it: without `#`, which ends it.
fn escape_owner(path : String) -> String {
  path.replace_all(old="%", new="%25").replace_all(old="#", new="%23")
}

///|
/// The component a handler id belongs to, as its escaped path.
fn handler_owner(id : String) -> String {
  match id.find("#") {
    Some(i) => id.view(end_offset=i).to_owned()
    None => id
  }
}

///|
fn[C, CM] render_ir(
  kind : String,
  comp : Component[C, CM],
  view : String?,
) -> Ir {
  IRender({
    kind,
    provided: None,
    component: () => comp.name,
    view_name: view,
    view_names: () => comp.view_names(),
  })
}

///|
fn key_text(slot : SlotKey) -> String {
  match slot {
    Index(i) => i.to_string()
    Name(s) => s
    Pair(a, b) => "\{key_text(a)}.\{key_text(b)}"
  }
}

///|
/// Renders the child that `lens` reaches, with its `view` or the best one for the view stack.
pub fn[X, S, M, C, CM] render(
  lens : Lens[S, C],
  comp : Component[C, CM],
  view? : String,
) -> ViewAt[X, S, M] {
  Ext(render_ir("render", comp, view), _ => {
    PDyn((_, _, r, out) => {
      match (lens.get)(r.state) {
        Some(child) =>
          comp.render_at(
            child,
            r.route.focus(lens),
            Some(r.node),
            view,
            r.env,
            out,
          )
        None => ()
      }
    })
  })
}

///|
/// Renders the item of `items` at the key `key` computes: JS's `seqItem` and `renderIt`.
pub fn[X, S, M, K, C, CM] render_key(
  items : Items[S, K, C],
  key : (X) -> K,
  comp : Component[C, CM],
  view? : String,
) -> ViewAt[X, S, M] {
  Ext(render_ir("render_key", comp, view), _ => {
    PDyn((x, _, r, out) => {
      let lens = items.at(key(x))
      match (lens.get)(r.state) {
        Some(child) =>
          comp.render_at(
            child,
            r.route.focus(lens),
            Some(r.node),
            view,
            r.env,
            out,
          )
        None => ()
      }
    })
  })
}

///|
/// Renders every item of `items` that `filter` keeps, each in a fragment keyed by `key` (the
/// item's key by default): JS's `renderEach`.
pub fn[X, S, M, K, C, CM] render_each(
  items : Items[S, K, C],
  comp : Component[C, CM],
  view? : String,
  filter? : (S, K, C) -> Bool,
  key? : (K, C) -> String,
) -> ViewAt[X, S, M] {
  Ext(render_ir("render_each", comp, view), _ => {
    PDyn((_, _, r, out) => {
      let frags = []
      for entry in (items.entries)(r.state) {
        let (k, child) = entry
        if filter is Some(keep) && !keep(r.state, k, child) {
          continue
        }
        let childs = []
        let route = r.route.focus(items.at(k))
        comp.render_at(child, route, Some(r.node), view, r.env, childs)
        let fkey = match key {
          Some(f) => f(k, child)
          None => key_text((items.slot_of)(k))
        }
        frags.push(@vdom.VNode::fragment(childs, key=fkey))
      }
      out.push(@vdom.VNode::fragment(frags))
    })
  })
}

///|
/// Renders a child of the component's own type, for recursive components.
pub fn[X, S, M] render_self(
  lens : Lens[S, S],
  view? : String,
) -> ViewAt[X, S, M] {
  Ext(
    IRender({
      kind: "render_self",
      provided: None,
      component: () => "self",
      view_name: None,
      view_names: () => [],
    }),
    _ => {
      PDyn((_, _, r, out) => {
        match (lens.get)(r.state) {
          Some(child) =>
            r.comp.render_at(
              child,
              r.route.focus(lens),
              Some(r.node),
              view,
              r.env,
              out,
            )
          None => ()
        }
      })
    },
  )
}

///|
/// `render_each` for items of the component's own type.
pub fn[X, S, M, K] render_self_each(
  items : Items[S, K, S],
  view? : String,
  filter? : (S, K, S) -> Bool,
  key? : (K, S) -> String,
) -> ViewAt[X, S, M] {
  Ext(
    IRender({
      kind: "render_self_each",
      provided: None,
      component: () => "self",
      view_name: None,
      view_names: () => [],
    }),
    _ => {
      PDyn((_, _, r, out) => {
        let frags = []
        for entry in (items.entries)(r.state) {
          let (k, child) = entry
          if filter is Some(keep) && !keep(r.state, k, child) {
            continue
          }
          let childs = []
          let route = r.route.focus(items.at(k))
          r.comp.render_at(child, route, Some(r.node), view, r.env, childs)
          let fkey = match key {
            Some(f) => f(k, child)
            None => key_text((items.slot_of)(k))
          }
          frags.push(@vdom.VNode::fragment(childs, key=fkey))
        }
        out.push(@vdom.VNode::fragment(frags))
      })
    },
  )
}

///|
/// Renders the component an ancestor provides as `key`. Its state is reached through the
/// provider; its notifications bubble through here, where it was rendered.
pub fn[X, S, M, C, CM] render_provided(
  key : Provide[C],
  comp : Component[C, CM],
  view? : String,
) -> ViewAt[X, S, M] {
  let ir = match render_ir("render_provided", comp, view) {
    IRender(r) => IRender({ ..r, provided: Some(key.name), })
    other => other
  }
  Ext(ir, _ => {
    PDyn((_, _, r, out) => {
      ignore(key.current())
      match key.top() {
        Some(top) => {
          let path = match top.route.path.frames.last() {
            Some(frame) => r.route.path.push(frame)
            None => r.route.path
          }
          let route = { ..top.route, path, }
          comp.render_at(top.value, route, Some(r.node), view, r.env, out)
        }
        None => ()
      }
    })
  })
}

///|
/// The body, reading the value an ancestor provides as `key`, when one does.
pub fn[X, S, M, T] when_provided(
  key : Provide[T],
  body : ViewAt[With[X, T], S, M],
  else_? : ViewAt[X, S, M],
) -> ViewAt[X, S, M] {
  let ir = IProvided(
    key.name,
    IIf(body.ir(), else_.map(v => v.ir()).unwrap_or(IFrag([]))),
  )
  Ext(ir, lw => {
    let plan = body.lower(lw)
    let other = else_.map(v => v.lower(lw))
    PDyn((x, now, r, out) => {
      // In a fragment of its own, as an if_ branch, so siblings keep their places.
      let branch = []
      match key.current() {
        Some(value) =>
          plan.eval(
            { up: x, value, },
            () => now().map(p => { up: p, value, }),
            r,
            branch,
          )
        None => if other is Some(p) { p.eval(x, now, r, branch) }
      }
      out.push(@vdom.VNode::fragment(branch))
    })
  })
}

///|
/// Renders the body with `name` pushed on the view stack: components below that have a view
/// of that name render it instead of main.
pub fn[X, S, M] push_view(
  name : (X) -> String,
  body : ViewAt[X, S, M],
) -> ViewAt[X, S, M] {
  pushed_view(None, name, body)
}

///|
/// `push_view` with a constant name, which `check_set` checks some component has a view of.
pub fn[X, S, M] push_view_named(
  name : String,
  body : ViewAt[X, S, M],
) -> ViewAt[X, S, M] {
  pushed_view(Some(name), _ => name, body)
}

///|
fn[X, S, M] pushed_view(
  constant : String?,
  name : (X) -> String,
  body : ViewAt[X, S, M],
) -> ViewAt[X, S, M] {
  Ext(IPushView(constant, body.ir()), lw => {
    let plan = body.lower(lw)
    PDyn((x, now, r, out) => {
      r.env.view_stack.push(name(x))
      plan.eval(x, now, r, out)
      ignore(r.env.view_stack.pop())
    })
  })
}

///|
/// Renders the item at the key `at` computes of the collection an ancestor provides as `key`:
/// JS's `each(provided("things"), renderIt())`. Its state is reached through the provider; its
/// notifications bubble through here, where it was rendered.
pub fn[X, S, M, T, K, C, CM] render_provided_key(
  key : Provide[T],
  items : Items[T, K, C],
  at : (X) -> K,
  comp : Component[C, CM],
  view? : String,
) -> ViewAt[X, S, M] {
  let ir = match render_ir("render_provided_key", comp, view) {
    IRender(r) => IRender({ ..r, provided: Some(key.name), })
    other => other
  }
  Ext(ir, _ => {
    PDyn((x, _, r, out) => {
      ignore(key.current())
      match key.top() {
        Some(top) => {
          let lens = items.at(at(x))
          match (lens.get)(top.value) {
            Some(child) => {
              let base = match top.route.path.frames.last() {
                Some(frame) => r.route.path.push(frame)
                None => r.route.path
              }
              let path = base.push({
                name: lens.name,
                item: lens.slot,
                lens_id: lens.id,
                provider: None,
              })
              comp.render_at(
                child,
                top.route.focus(lens, path~),
                Some(r.node),
                view,
                r.env,
                out,
              )
            }
            None => ()
          }
        }
        None => ()
      }
    })
  })
}
