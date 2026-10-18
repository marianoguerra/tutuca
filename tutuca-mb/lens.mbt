// Lenses: how a component reaches the state of a child it renders. They replace the JS keys,
// field("child") and seqItem, with typed get and set.

///|
/// The item a frame selects in a collection: what `sourceKey` was in JS.
pub(all) enum SlotKey {
  Index(Int32)
  Name(String)
  Pair(SlotKey, SlotKey) // An item of an item, from `Items::then`.
} derive(Eq, Debug)

///|
pub extend SlotKey with Eq::{equal, not_equal}

///|
pub extend SlotKey with Debug::{to_repr}

///|
pub fn SlotKey::to_string(self : SlotKey) -> String {
  match self {
    Index(i) => "[\{i}]"
    Name(s) => "[\{@debug.to_string(s)}]"
    Pair(a, b) => a.to_string() + b.to_string()
  }
}

///|
let next_lens_id : Ref[Int32] = Ref(0)

///|
fn fresh_lens_id() -> Int32 {
  next_lens_id.val += 1
  next_lens_id.val
}

///|
/// A typed path from S to C. `get` is partial: an item may be gone by the time a task runs.
/// `id` identifies the field or collection the lens came from, for `Signal::from`.
pub struct Lens[S, C] {
  id : Int32
  name : String
  slot : SlotKey?
  get : (S) -> C?
  set : (S, C) -> S
}

///|
/// A lens on a field of S.
pub fn[S, C] field(
  name : String,
  get : (S) -> C,
  set : (S, C) -> S,
) -> Lens[S, C] {
  { id: fresh_lens_id(), name, slot: None, get: s => Some(get(s)), set, }
}

///|
/// A lens that may find nothing, e.g. an optional child.
pub fn[S, C] Lens::partial(
  name : String,
  get : (S) -> C?,
  set : (S, C) -> S,
) -> Lens[S, C] {
  { id: fresh_lens_id(), name, slot: None, get, set, }
}

///|
/// A lens on one case of S, an enum whose cases are different components' states: it adds no
/// frame to paths, so the component of that case sits where S does, as a JS field holds any
/// component's instance.
pub fn[S, C] Lens::variant(get : (S) -> C?, set : (S, C) -> S) -> Lens[S, C] {
  { id: fresh_lens_id(), name: "", slot: None, get, set, }
}

///|
/// The name of `inner` seen through an outer lens; a variant lens adds nothing.
fn joined_name(outer : String, slot : SlotKey?, inner : String) -> String {
  let outer = outer + slot.map(k => k.to_string()).unwrap_or("")
  if inner == "" {
    outer
  } else if outer == "" {
    inner
  } else {
    "\{outer}.\{inner}"
  }
}

///|
/// The lens `inner` seen from S through `self`.
pub fn[S, C, D] Lens::then(self : Lens[S, C], inner : Lens[C, D]) -> Lens[S, D] {
  {
    id: inner.id,
    name: joined_name(self.name, self.slot, inner.name),
    slot: inner.slot,
    get: s => (self.get)(s).bind(c => (inner.get)(c)),
    set: (s, d) => {
      match (self.get)(s) {
        Some(c) => (self.set)(s, (inner.set)(c, d))
        None => s
      }
    },
  }
}

///|
/// A lens on a collection in S whose items are T, by keys of type K: Int over a Vec, String
/// over a map.
pub struct Items[S, K, T] {
  id : Int32
  name : String
  entries : (S) -> Iter[(K, T)]
  get_at : (S, K) -> T?
  set_at : (S, K, T) -> S
  slot_of : (K) -> SlotKey
  key_of : (SlotKey) -> K?
}

///|
/// The items of a Vec field.
pub fn[S, T] items(
  name : String,
  get : (S) -> Vec[T],
  set : (S, Vec[T]) -> S,
) -> Items[S, Int32, T] {
  {
    id: fresh_lens_id(),
    name,
    entries: s => get(s).iter().mapi((i, t) => (i, t)),
    get_at: (s, i) => get(s).get(i),
    set_at: (s, i, t) => set(s, get(s).set(i, t)),
    slot_of: i => Index(i),
    key_of: k => if k is Index(i) { Some(i) } else { None },
  }
}

///|
/// The entries of a string-keyed map field, in key order.
pub fn[S, T] entries(
  name : String,
  get : (S) -> @sorted_map.SortedMap[String, T],
  set : (S, @sorted_map.SortedMap[String, T]) -> S,
) -> Items[S, String, T] {
  {
    id: fresh_lens_id(),
    name,
    entries: s => get(s).iter(),
    get_at: (s, k) => get(s).get(k),
    set_at: (s, k, t) => {
      let m = get(s)
      if m.contains(k) {
        set(s, m.add(k, t))
      } else {
        s
      }
    },
    slot_of: k => Name(k),
    key_of: k => if k is Name(s) { Some(s) } else { None },
  }
}

///|
/// The lens on the item at `key`.
pub fn[S, K, T] Items::at(self : Items[S, K, T], key : K) -> Lens[S, T] {
  {
    id: self.id,
    name: self.name,
    slot: Some((self.slot_of)(key)),
    get: s => (self.get_at)(s, key),
    set: (s, t) => (self.set_at)(s, key, t),
  }
}

///|
/// The collection `inner` seen from S through `self`: its items, keyed as `inner` keys them.
pub fn[S, C, K, T] Lens::then_items(
  self : Lens[S, C],
  inner : Items[C, K, T],
) -> Items[S, K, T] {
  {
    id: inner.id,
    name: joined_name(self.name, self.slot, inner.name),
    entries: s => {
      match (self.get)(s) {
        Some(c) => (inner.entries)(c)
        None => Iter::empty()
      }
    },
    get_at: (s, k) => (self.get)(s).bind(c => (inner.get_at)(c, k)),
    set_at: (s, k, t) => {
      match (self.get)(s) {
        Some(c) => (self.set)(s, (inner.set_at)(c, k, t))
        None => s
      }
    },
    slot_of: inner.slot_of,
    key_of: inner.key_of,
  }
}

///|
/// The items of every item of `self`, keyed by both keys: what JS reached with `each` over
/// `each` and `renderIt`, or with a `seqItem` collection (keep the selected outer key with a
/// filter). The keys are fixed when they are read, so an event goes to the item it was
/// rendered for.
pub fn[S, J, C, K, T] Items::then(
  self : Items[S, J, C],
  inner : Items[C, K, T],
) -> Items[S, (J, K), T] {
  {
    id: fresh_lens_id(),
    name: joined_name(self.name, None, inner.name),
    entries: s => {
      (self.entries)(s).flat_map(outer => {
        (inner.entries)(outer.1).map(e => ((outer.0, e.0), e.1))
      })
    },
    get_at: (s, k) => (self.get_at)(s, k.0).bind(c => (inner.get_at)(c, k.1)),
    set_at: (s, k, t) => {
      match (self.get_at)(s, k.0) {
        Some(c) => (self.set_at)(s, k.0, (inner.set_at)(c, k.1, t))
        None => s
      }
    },
    slot_of: k => Pair((self.slot_of)(k.0), (inner.slot_of)(k.1)),
    key_of: slot => {
      match slot {
        Pair(a, b) =>
          match ((self.key_of)(a), (inner.key_of)(b)) {
            (Some(j), Some(k)) => Some((j, k))
            _ => None
          }
        _ => None
      }
    },
  }
}
