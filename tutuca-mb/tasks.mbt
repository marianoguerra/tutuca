// Tasks: the units the host runs, one transaction each, and the Ctx a handler gets.

///|
pub(all) enum TaskKind {
  Send // A message to a component: from ctx.send, ctx.send_to or outside the app.
  Event // A message a DOM event made.
  Notify // A signal bubbling to an ancestor.
  Ask // An effect being resolved by a scope.
  Reply // An ask's reply that came later.
} derive(Eq, Debug)

///|
pub extend TaskKind with Eq::{equal, not_equal}

///|
pub extend TaskKind with Debug::{to_repr}

///|
pub struct Task {
  kind : TaskKind
  label : String
  path : DispatchPath // Where it runs.
  trigger : String? // The DOM event that made it, if one did.
  run : (Tx) -> Unit raise
}

///|
/// A component placed in the rendered ancestry: its path, its parent, and how it hears a
/// signal (None: it has no listener that applies; Some(stopped)).
pub struct Node {
  path : DispatchPath
  /// Where its state lives (see `Route::home`).
  home : DispatchPath
  name : String
  /// Its state's fields, as it declares them, in their order.
  fields : Array[String]
  /// Whether it only shows its state's case's component (no instance of its own for JS).
  transparent : Bool
  parent : Node?
  /// The names of the messages it takes, as JS's (its declared ones, or the signals it hears).
  messages : Array[String]
  /// The keys a message from an item can come from (for `Signal::from` listeners).
  keys_of : (String) -> Array[String]
  /// The task that sends it the message `name` with JSON args, from the item `key` for a
  /// signal it hears from a collection: the storybook's step form.
  message_task : (String, Array[Json], String) -> Task raise
  /// Generated args for one of its messages.
  sample_args : (String, UInt64) -> Array[Json]
  listen : (Int32, DispatchPath, Tx) -> Bool? raise
}

///|
/// What a task's transaction can reach of the host.
pub struct HostCore {
  id : Int32
  scope : Scope
  dev : Bool
  report : (Report) -> Unit
  push : (Task) -> Unit // Queues a task after this transaction, as an async reply does.
  node_at : (String) -> Node? // The component the last render placed at a path.
}

///|
/// One transaction: the tasks it queues are staged and only queued if it commits. A staged
/// task is made at commit, so it sees the state the transaction committed.
pub struct Tx {
  core : HostCore
  task : Task
  staged : Array[() -> Task raise]
}

///|
/// What a handler can do besides returning the next state.
pub struct Ctx[S, M] {
  priv tx : Tx
  priv comp : Component[S, M]
  priv route : Route[S]
  priv node : Node
  priv event_ : Event?
  priv mut stopped : Bool
}

///|
fn[S, M] Ctx::new(
  tx : Tx,
  comp : Component[S, M],
  route : Route[S],
  node : Node,
  event : Event?,
) -> Ctx[S, M] {
  { tx, comp, route, node, event_: event, stopped: false, }
}

///|
/// The DOM event that sent this message, if one did.
pub fn[S, M] Ctx::event(self : Ctx[S, M]) -> Event? {
  self.event_
}

///|
/// Where the component was rendered.
pub fn[S, M] Ctx::path(self : Ctx[S, M]) -> DispatchPath {
  self.node.path
}

///|
/// Stops the signal being handled from bubbling further.
pub fn[S, M] Ctx::stop(self : Ctx[S, M]) -> Unit {
  self.stopped = true
}

///|
/// Sends `msg` to this component, after this transaction.
pub fn[S, M] Ctx::send(self : Ctx[S, M], msg : M) -> Unit {
  self.tx.staged.push(() => {
    send_task(self.comp, self.route, self.node, msg, None)
  })
}

///|
/// Sends `msg` to the child `at` reaches. `at` reads the state this transaction commits, so
/// a selected-item lens selects what the transaction selected.
pub fn[S, M, C, CM] Ctx::send_to(
  self : Ctx[S, M],
  comp : Component[C, CM],
  at : (S) -> Lens[S, C],
  msg : CM,
) -> Unit {
  self.tx.staged.push(() => {
    let lens = at(self.route.read())
    let route = self.route.focus(lens)
    send_task(
      comp,
      route,
      rendered_node(self.tx.core.node_at, comp, route, self.node),
      msg,
      None,
    )
  })
}

///|
/// Notifies the ancestors: each one that listens for `sig` runs its listener, until one
/// stops it.
pub fn[S, M, T] Ctx::notify(
  self : Ctx[S, M],
  sig : Signal[T],
  payload : T,
) -> Unit {
  match self.node.parent {
    Some(parent) =>
      self.tx.staged.push(() => {
        notify_task(sig, payload, self.node.path, parent)
      })
    None => ()
  }
}

///|
/// Asks the nearest scope with a handler for `key`. `reply` turns the answer into a message to
/// this component, or nothing.
pub fn[S, M, A, R] Ctx::ask(
  self : Ctx[S, M],
  key : Ask[A, R],
  arg : A,
  reply : (AskResult[R]) -> M?,
) -> Unit {
  self.tx.staged.push(() => {
    ask_task(self.comp, self.route, self.node, key, arg, reply)
  })
}

///|
/// Runs `msg` through the component's update at `route`, checking its contract in dev mode.
fn[S, M] apply(
  comp : Component[S, M],
  route : Route[S],
  node : Node,
  msg : M,
  tx : Tx,
  event : Event?,
) -> Unit raise {
  let prev = route.read()
  let ctx = Ctx::new(tx, comp, route, node, event)
  let issues = []
  if tx.core.dev && comp.pre is Some(pre) && !pre(prev, msg) {
    issues.push("pre")
  }
  let next = (comp.update)(prev, msg, ctx)
  if tx.core.dev && comp.post is Some(post) && !post(msg, prev, next) {
    issues.push("post")
  }
  if issues.length() > 0 {
    (tx.core.report)(MessageInvalid(tx.task, issues))
  }
  if !physical_equal(prev, next) {
    (route.set)(next)
  }
}

///|
fn[S, M] send_task(
  comp : Component[S, M],
  route : Route[S],
  node : Node,
  msg : M,
  event : Event?,
  kind? : TaskKind,
) -> Task {
  {
    kind: kind.unwrap_or(if event is Some(_) { Event } else { Send }),
    label: "\{comp.name}.\{(comp.show_msg)(msg)}",
    path: route.path,
    trigger: event.map(e => e.name),
    run: tx => apply(comp, route, node, msg, tx, event),
  }
}

///|
/// The task for an event: `msg` labels it, and the handler runs with what `again` makes then,
/// once the tasks before it have run (`msg` if the view no longer reads anything there).
fn[S, M] event_task(
  comp : Component[S, M],
  route : Route[S],
  node : Node,
  msg : M,
  again : () -> M?,
  event : Event,
) -> Task {
  {
    kind: Event,
    label: "\{comp.name}.\{(comp.show_msg)(msg)}",
    path: route.path,
    trigger: Some(event.name),
    run: tx => apply(comp, route, node, again().unwrap_or(msg), tx, Some(event)),
  }
}

///|
/// Delivers `sig` to `target`, or the nearest ancestor of it that listens. If that one doesn't
/// stop it, the signal goes on to its parent in a task of its own.
fn[T] notify_task(
  sig : Signal[T],
  payload : T,
  source : DispatchPath,
  target : Node,
) -> Task {
  {
    kind: Notify,
    label: "\{sig.name} from \{source.to_string()}",
    path: target.path,
    trigger: None,
    run: tx => {
      let mut at = Some(target)
      while at is Some(node) {
        match sig.deliver(payload, () => (node.listen)(sig.id, source, tx)) {
          None => at = node.parent
          Some(stopped) => {
            if !stopped && node.parent is Some(parent) {
              tx.staged.push(() => notify_task(sig, payload, source, parent))
            }
            break
          }
        }
      }
    },
  }
}

///|
/// Resolves an ask. A reply given while the handler runs is handled in this task; a later one
/// is queued as a task of its own.
fn[S, M, A, R] ask_task(
  comp : Component[S, M],
  route : Route[S],
  node : Node,
  key : Ask[A, R],
  arg : A,
  reply : (AskResult[R]) -> M?,
) -> Task {
  {
    kind: Ask,
    label: "\{comp.name} asks \{key.name}",
    path: route.path,
    trigger: None,
    run: tx => {
      let answer = (result : AskResult[R]) => {
        match reply(result) {
          Some(msg) => apply(comp, route, node, msg, tx, None)
          None => ()
        }
      }
      match tx.core.scope.lookup(key) {
        None => answer(NotFound)
        Some(handler) => {
          let pending : Ref[AskResult[R]?] = Ref(None)
          let running = Ref(true)
          let core = tx.core
          handler(arg, result => {
            if running.val {
              pending.val = Some(result)
            } else {
              match reply(result) {
                Some(msg) =>
                  (core.push)(
                    send_task(comp, route, node, msg, None, kind=Reply),
                  )
                None => ()
              }
            }
          }) catch {
            e => pending.val = Some(Err(e.to_string()))
          }
          running.val = false
          if pending.val is Some(result) {
            answer(result)
          }
        }
      }
    },
  }
}

///|
/// Where a message sent to `route` runs: the node the last render placed there, so its
/// notifications bubble through its rendered ancestors as in JS; a node below `parent` when
/// nothing is rendered there.
fn[C, CM] rendered_node(
  node_at : (String) -> Node?,
  comp : Component[C, CM],
  route : Route[C],
  parent : Node,
) -> Node {
  match node_at(route.path.to_string()) {
    Some(node) if node.name == comp.name => node
    _ => comp.node(route, Some(parent))
  }
}
