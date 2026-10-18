// Typed keys: Signal (notify), Ask (effects resolved by scope) and Provide (values for
// descendants). Each carries its payload type, so the names JS looked up by string are
// checked by the compiler. Handlers of different payload types are stored as closures built
// inside the generic constructors, so nothing is ever cast.

///|
let next_key_id : Ref[Int32] = Ref(0)

///|
fn fresh_key_id() -> Int32 {
  next_key_id.val += 1
  next_key_id.val
}

// --- Signal --------------------------------------------------------------------------------

///|
/// A notification. A component sends it with `ctx.notify(sig, payload)`; it bubbles up the
/// rendered ancestry until a listener calls `ctx.stop()` or it reaches the root. Components
/// without a listener pass it on, so a child never depends on where it is used.
pub struct Signal[T] {
  id : Int32
  name : String
  priv mut slot : T? // The payload in flight while listeners run.
}

///|
pub fn[T] Signal::new(name : String) -> Signal[T] {
  { id: fresh_key_id(), name, slot: None, }
}

///|
/// Runs `k` with `payload` in flight, restoring what was in flight before.
fn[T, R] Signal::deliver(
  self : Signal[T],
  payload : T,
  k : () -> R raise,
) -> R raise {
  let prev = self.slot
  self.slot = Some(payload)
  defer {
    self.slot = prev
  }
  k()
}

///|
/// A component's handler for a signal. `run` returns None when the listener doesn't apply
/// (a `from` listener for a signal that came through another collection).
pub struct Listener[S, M] {
  sig_id : Int32
  sig_name : String
  run : (S, Frame?, Ctx[S, M]) -> S? raise
  /// For a `from` listener, the collection it hears from and its items' keys now, as text
  /// and as the frame slot a signal from that item comes through.
  items : String?
  keys : (S) -> Array[(String, SlotKey)]
}

///|
/// Listens for the signal from anywhere below.
pub fn[S, M, T] Signal::on(
  self : Signal[T],
  f : (S, T, Ctx[S, M]) -> S raise?,
) -> Listener[S, M] {
  {
    sig_id: self.id,
    sig_name: self.name,
    run: (s, _, ctx) => {
      match self.slot {
        Some(p) => Some(f(s, p, ctx))
        None => None
      }
    },
    items: None,
    keys: _ => [],
  }
}

///|
/// Listens for the signal when it comes from an item of `items`, which `f` gets the key of:
/// what JS's `sourceKey: t.index(...)` checked at run time. The collection is matched by its
/// name, as JS paths match keys, so any lens on the same field will do.
pub fn[S, M, T, K, I] Signal::from(
  self : Signal[T],
  items : Items[S, K, I],
  f : (S, T, K, Ctx[S, M]) -> S raise?,
) -> Listener[S, M] {
  {
    sig_id: self.id,
    sig_name: self.name,
    run: (s, frame, ctx) => {
      match (self.slot, frame) {
        (Some(p), Some({ name, item: Some(slot), provider: None, .. })) if name ==
          items.name =>
          match (items.key_of)(slot) {
            Some(k) => Some(f(s, p, k, ctx))
            None => None
          }
        _ => None
      }
    },
    items: Some(items.name),
    keys: s => {
      (items.entries)(s)
      .map(e => {
        let slot = (items.slot_of)(e.0)
        (slot_text(slot), slot)
      })
      .to_array()
    },
  }
}

// --- Ask -----------------------------------------------------------------------------------

///|
/// What an ask gets back.
pub(all) enum AskResult[R] {
  Ok(R)
  Err(String)
  NotFound // No scope has a handler for it.
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub extend AskResult with Eq::{equal, not_equal}

///|
pub extend AskResult with Debug::{to_repr}

///|
/// An effect a component asks for with `ctx.ask(key, arg, reply)`, handled outside the
/// component tree by the nearest scope that has a handler: what JS's `registerAskHandlers` held
/// by name. The handler replies once, now or later.
pub struct Ask[A, R] {
  id : Int32
  name : String
  priv handlers : Map[Int32, (A, (AskResult[R]) -> Unit) -> Unit raise]
}

///|
pub fn[A, R] Ask::new(name : String) -> Ask[A, R] {
  { id: fresh_key_id(), name, handlers: Map([]), }
}

///|
/// A registry of ask handlers. `enter` makes a child scope whose handlers shadow its parent's.
pub struct Scope {
  id : Int32
  parent : Scope?
}

///|
pub fn Scope::new() -> Scope {
  { id: fresh_key_id(), parent: None, }
}

///|
pub fn Scope::enter(self : Scope) -> Scope {
  { id: fresh_key_id(), parent: Some(self), }
}

///|
/// Handles `key` in this scope; `handler` calls `reply` once, now or later.
pub fn[A, R] Scope::handle(
  self : Scope,
  key : Ask[A, R],
  handler : (A, (AskResult[R]) -> Unit) -> Unit raise?,
) -> Unit {
  key.handlers[self.id] = (arg, reply) => handler(arg, reply)
}

///|
/// Handles `key` with a function that answers right away; raising answers `Err`.
pub fn[A, R] Scope::answer(
  self : Scope,
  key : Ask[A, R],
  f : (A) -> R raise?,
) -> Unit {
  self.handle(key, (arg, reply) => reply(Ok(f(arg))))
}

///|
pub fn[A, R] Scope::lookup(
  self : Scope,
  key : Ask[A, R],
) -> ((A, (AskResult[R]) -> Unit) -> Unit raise)? {
  let mut scope = Some(self)
  while scope is Some(s) {
    if key.handlers.get(s.id) is Some(h) {
      return Some(h)
    }
    scope = s.parent
  }
  None
}

// --- Provide -------------------------------------------------------------------------------

///|
/// A value a component provides to everything rendered below it.
pub struct Provide[T] {
  id : Int32
  name : String
  priv stack : Array[Provided[T]]
}

///|
priv struct Provided[T] {
  value : T
  route : Route[T]
}

///|
pub fn[T] Provide::new(name : String) -> Provide[T] {
  { id: fresh_key_id(), name, stack: [], }
}

///|
/// The value provided here, while rendering; None outside any provider. Reading it makes the
/// render depend on it.
pub fn[T] Provide::current(self : Provide[T]) -> T? {
  match self.stack.last() {
    Some(top) => {
      let v = top.value
      record_dep(() => {
        match self.stack.last() {
          Some(now) => physical_equal(now.value, v)
          None => false
        }
      })
      Some(v)
    }
    None => {
      record_dep(() => self.stack.is_empty())
      None
    }
  }
}

///|
fn[T] Provide::top(self : Provide[T]) -> Provided[T]? {
  self.stack.last()
}

///|
/// What a component declares in `provides`: it pushes the value its lens reaches while its
/// subtree renders.
pub struct Provision[S] {
  key_id : Int32
  key_name : String
  push : (S, Route[S]) -> Bool // False when the lens found nothing, so there is nothing to pop.
  pop : () -> Unit
}

///|
/// Provides what `lens` reaches.
pub fn[S, T] Provide::from(
  self : Provide[T],
  lens : Lens[S, T],
) -> Provision[S] {
  self.provision(_ => lens)
}

///|
/// Provides the item of `items` at the key the state selects: JS's
/// `provides: { cur: (b) => b.seqItem("items", "selected") }`.
pub fn[S, K, T] Provide::at(
  self : Provide[T],
  items : Items[S, K, T],
  key : (S) -> K,
) -> Provision[S] {
  self.provision(s => items.at(key(s)))
}

///|
fn[S, T] Provide::provision(
  self : Provide[T],
  lens_for : (S) -> Lens[S, T],
) -> Provision[S] {
  {
    key_id: self.id,
    key_name: self.name,
    push: (s, route) => {
      let lens = lens_for(s)
      match (lens.get)(s) {
        Some(value) => {
          let path = route.path.push({
            name: lens.name,
            item: lens.slot,
            lens_id: lens.id,
            provider: Some(self.name),
          })
          self.stack.push({ value, route: route.focus(lens, path~), })
          true
        }
        None => false
      }
    },
    pop: () => ignore(self.stack.pop()),
  }
}

///|
/// A key as the storybook shows it: `0`, `a`, `0.1` for an item of an item.
fn slot_text(slot : SlotKey) -> String {
  match slot {
    Index(i) => i.to_string()
    Name(n) => n
    Pair(a, b) => "\{slot_text(a)}.\{slot_text(b)}"
  }
}
