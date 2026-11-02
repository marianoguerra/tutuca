///|
/// A parsed query. Every case is a filter: one input in, a sequence of outputs out.
pub(all) enum Expr {
  /// `.`
  Identity
  /// `..`, the input and everything below it, in pre-order
  Recurse
  /// `e.k`, `e."k"`, `e["k"]`
  Field(Expr, String)
  /// `e[n]`, from the end when negative
  Index(Expr, Int64)
  /// `e[]`
  Each(Expr)
  Literal(@model.Value)
  Var(String)
  Pipe(Expr, Expr)
  Comma(Expr, Expr)
  /// `a // b`
  Alt(Expr, Expr)
  And(Expr, Expr)
  Or(Expr, Expr)
  Compare(CmpOp, Expr, Expr)
  /// `e ~ P`
  Match(Expr, Pattern)
  /// `e as P | body`
  As(Expr, Pattern, Expr)
  /// `[e]`
  Collect(Expr)
  Call(Builtin, Expr?)
}

///|
pub(all) enum CmpOp {
  Eq
  Ne
  Lt
  Le
  Gt
  Ge
}

///|
/// The built-in functions, a closed set. The ones written with `(q)` take one argument.
pub(all) enum Builtin {
  Select
  Not
  Empty
  Type
  TypeId
  Length
  Keys
  Has
  StartsWith
  EndsWith
  Contains
  First
  Any
  All
}

///|
/// A destructuring pattern. Matching one can bind names; a name bound twice must be bound to
/// equal values.
pub(all) enum Pattern {
  /// `$name`
  Bind(String)
  /// `_`
  Wild
  Lit(@model.Value)
  /// `{k: P, …}`, open: other keys are ignored
  Obj(Array[(String, Pattern)])
  /// `[P, …]`, `[P, …, ..]`, `[P, …, ..$rest]`
  Arr(Array[Pattern], Rest)
  /// `#"type_id" P`
  Typed(String, Pattern)
  /// `<tag attrs children>`
  Node(Pattern, Pattern, Pattern)
  /// `$name @ P`
  At(String, Pattern)
  /// `(P | P | …)`, tried left to right
  Alts(Array[Pattern])
}

///|
/// What an array pattern does with the elements after its items.
pub(all) enum Rest {
  /// none may remain: `[P, P]`
  Exact
  /// any may remain: `[P, P, ..]`
  Open
  /// they are bound as an array: `[P, P, ..$rest]`
  RestBind(String)
}

///|
fn Builtin::from_name(name : String) -> (Builtin, Bool)? {
  // (the builtin, whether it takes an argument)
  match name {
    "select" => Some((Select, true))
    "not" => Some((Not, false))
    "empty" => Some((Empty, false))
    "type" => Some((Type, false))
    "type_id" => Some((TypeId, false))
    "length" => Some((Length, false))
    "keys" => Some((Keys, false))
    "has" => Some((Has, true))
    "starts_with" => Some((StartsWith, true))
    "ends_with" => Some((EndsWith, true))
    "contains" => Some((Contains, true))
    "first" => Some((First, true))
    "any" => Some((Any, true))
    "all" => Some((All, true))
    _ => None
  }
}
