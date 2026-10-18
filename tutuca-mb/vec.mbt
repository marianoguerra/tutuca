// Vec: the persistent sequence state is made of. Updates return a new Vec and share the rest,
// so an unchanged item stays the same object and its render is reused.

///|
pub struct Vec[T](@vector.Vector[T])

///|
pub fn[T] Vec::of(items : ArrayView[T]) -> Vec[T] {
  Vec(@vector.Vector(items))
}

///|
pub fn[T] Vec::from_iter(items : Iter[T]) -> Vec[T] {
  Vec(@vector.from_iter(items))
}

///|
pub fn[T] Vec::new() -> Vec[T] {
  Vec(@vector.new())
}

///|
pub fn[T] Vec::length(self : Vec[T]) -> Int32 {
  self.0.length()
}

///|
pub fn[T] Vec::is_empty(self : Vec[T]) -> Bool {
  self.0.is_empty()
}

///|
#alias("_[_]")
pub fn[T] Vec::at(self : Vec[T], i : Int32) -> T {
  self.0.at(i)
}

///|
pub fn[T] Vec::get(self : Vec[T], i : Int32) -> T? {
  self.0.get(i)
}

///|
pub fn[T] Vec::first(self : Vec[T]) -> T? {
  self.0.get(0)
}

///|
pub fn[T] Vec::last(self : Vec[T]) -> T? {
  self.0.get(self.0.length() - 1)
}

///|
pub fn[T] Vec::push(self : Vec[T], item : T) -> Vec[T] {
  Vec(self.0.push(item))
}

///|
/// Replaces the item at `i`; out of range leaves the Vec as it is.
pub fn[T] Vec::set(self : Vec[T], i : Int32, item : T) -> Vec[T] {
  if i >= 0 && i < self.0.length() {
    Vec(self.0.set(i, item))
  } else {
    self
  }
}

///|
/// Applies `f` to the item at `i`.
pub fn[T] Vec::update(self : Vec[T], i : Int32, f : (T) -> T) -> Vec[T] {
  match self.0.get(i) {
    Some(item) => self.set(i, f(item))
    None => self
  }
}

///|
pub fn[T] Vec::remove(self : Vec[T], i : Int32) -> Vec[T] {
  if i >= 0 && i < self.0.length() {
    Vec(self.0.take(i) + self.0.drop(i + 1))
  } else {
    self
  }
}

///|
pub fn[T] Vec::insert(self : Vec[T], i : Int32, item : T) -> Vec[T] {
  let i = if i < 0 {
    0
  } else if i > self.0.length() {
    self.0.length()
  } else {
    i
  }
  Vec(self.0.take(i).push(item) + self.0.drop(i))
}

///|
/// Swaps the items at `i` and `j`; out of range leaves the Vec as it is.
pub fn[T] Vec::swap(self : Vec[T], i : Int32, j : Int32) -> Vec[T] {
  match (self.0.get(i), self.0.get(j)) {
    (Some(a), Some(b)) => Vec(self.0.set(i, b).set(j, a))
    _ => self
  }
}

///|
pub fn[T] Vec::iter(self : Vec[T]) -> Iter[T] {
  self.0.iter()
}

///|
pub fn[T] Vec::iter2(self : Vec[T]) -> Iter2[Int32, T] {
  self.0.iter().iter2()
}

///|
/// The items with their indices.
pub fn[T] Vec::entries(self : Vec[T]) -> Iter[(Int32, T)] {
  self.0.iter().mapi((i, t) => (i, t))
}

///|
pub fn[T, U] Vec::map(self : Vec[T], f : (T) -> U) -> Vec[U] {
  Vec(self.0.map(f))
}

///|
pub fn[T] Vec::filter(self : Vec[T], f : (T) -> Bool) -> Vec[T] {
  Vec(self.0.filter(f))
}

///|
pub fn[T, A] Vec::fold(self : Vec[T], init~ : A, f : (A, T) -> A) -> A {
  self.0.fold(init~, f)
}

///|
pub fn[T] Vec::any(self : Vec[T], f : (T) -> Bool) -> Bool {
  self.0.iter().any(f)
}

///|
pub fn[T] Vec::all(self : Vec[T], f : (T) -> Bool) -> Bool {
  self.0.iter().all(f)
}

///|
pub fn[T] Vec::count(self : Vec[T], f : (T) -> Bool) -> Int32 {
  self.0.fold(init=0, (n, item) => if f(item) { n + 1 } else { n })
}

///|
pub fn[T] Vec::find_index(self : Vec[T], f : (T) -> Bool) -> Int32? {
  let mut i = 0
  for item in self.0 {
    if f(item) {
      return Some(i)
    }
    i += 1
  }
  None
}

///|
pub fn[T : Eq] Vec::contains(self : Vec[T], item : T) -> Bool {
  self.0.contains(item)
}

///|
pub fn[T] Vec::to_array(self : Vec[T]) -> Array[T] {
  self.0.to_array()
}

///|
pub fn[T] Vec::concat(self : Vec[T], other : Vec[T]) -> Vec[T] {
  Vec(self.0 + other.0)
}

///|
pub impl[T] Default for Vec[T] with fn default() {
  Vec(@vector.new())
}

///|
pub impl[T : Eq] Eq for Vec[T] with fn equal(a, b) {
  a.0 == b.0
}

///|
pub impl[T : Debug] Debug for Vec[T] with fn to_repr(self) {
  Debug::to_repr(self.0.to_array())
}

///|
pub impl[T : ToJson] ToJson for Vec[T] with fn to_json(self) {
  Json(self.0.to_array())
}

///|
pub impl[T : FromJson] FromJson for Vec[T] with fn from_json(json, path) {
  let items : Array[T] = FromJson::from_json(json, path)
  Vec::of(items)
}

///|
pub impl[T : @quickcheck.Arbitrary] @quickcheck.Arbitrary for Vec[T] with fn arbitrary(
  size,
  rs,
) {
  let items : Array[T] = @quickcheck.Arbitrary::arbitrary(size, rs)
  Vec::of(items)
}

///|
pub impl[T : @quickcheck.Shrink] @quickcheck.Shrink for Vec[T] with fn shrink(
  self,
) {
  @quickcheck.Shrink::shrink(self.0.to_array()).map(items => Vec::of(items))
}

///|
pub extend Vec with Eq::{equal, not_equal}

///|
pub extend Vec with Debug::{to_repr}

///|
pub extend Vec with Default::{default}

///|
pub extend Vec with ToJson::{to_json}

///|
pub extend Vec with FromJson::{from_json}

///|
pub extend Vec with @quickcheck.Arbitrary::{arbitrary}

///|
pub extend Vec with @quickcheck.Shrink::{shrink}
