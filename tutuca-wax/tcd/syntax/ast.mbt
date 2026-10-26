// The syntax tree of a TCD file, as written: names keep their spans, and
// nothing is resolved yet (that's @check's job).

///|
pub(all) struct Name {
  text : String
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) enum Lit {
  Int(Int64)
  Float(Double)
  Str(String)
  Bool(Bool)
  Null
} derive(Eq, Debug, ToJson)

///|
pub(all) enum BinOp {
  Add
  Sub
  Eq
  Ne
  Lt
  Le
  Gt
  Ge
  And
  Or
  In
  NotIn
} derive(Eq, Debug, ToJson)

///|
/// What `where`, `when`, `ensures`, `invariant`, `expect` and defaults are
/// written in. `where` only accepts the forms that map onto schema
/// constraints; @check enforces that.
pub(all) enum Expr {
  Lit(Lit, span~ : @diag.Span)
  /// `count`, `next.count`, `it.id`, `entry.key`.
  Path(Array[Name], span~ : @diag.Span)
  /// `len(x)`, `keys(f)`, `values(f)`, `all(xs, cond)`, `any(xs, cond)`, `check(p)`.
  Call(Name, Array[Expr], span~ : @diag.Span)
  List(Array[Expr], span~ : @diag.Span)
  /// `{ a: 1, b: "x" }`, for defaults and example states.
  Record(Array[(Name, Expr)], span~ : @diag.Span)
  Not(Expr, span~ : @diag.Span)
  Bin(BinOp, Expr, Expr, span~ : @diag.Span)
  Matches(Expr, String, span~ : @diag.Span)
} derive(Eq, Debug, ToJson)

///|
pub fn Expr::span(self : Expr) -> @diag.Span {
  match self {
    Lit(_, span~)
    | Path(_, span~)
    | Call(_, _, span~)
    | List(_, span~)
    | Record(_, span~)
    | Not(_, span~)
    | Bin(_, _, _, span~)
    | Matches(_, _, span~) => span
  }
}

///|
pub(all) enum TypeExpr {
  /// `bool`, `s32`, `f64`, `string`, `any`, `component`, or a component or
  /// interface name.
  Named(Name)
  /// `option<T>`, `list<T>`, `map<T>`, `one_of<A, B>`, `result<T, E>`, `index<f>`.
  Apply(Name, Array[TypeExpr], span~ : @diag.Span)
  Enum(Array[Name], span~ : @diag.Span)
  Record(Array[(Name, TypeExpr)], span~ : @diag.Span)
} derive(Eq, Debug, ToJson)

///|
pub fn TypeExpr::span(self : TypeExpr) -> @diag.Span {
  match self {
    Named(n) => n.span
    Apply(_, _, span~) | Enum(_, span~) | Record(_, span~) => span
  }
}

///|
/// A view: literals, bare names (arguments that name things: `field(count)`),
/// and calls, whose named arguments (attributes) come before the positional
/// ones (children).
pub(all) enum ViewExpr {
  Lit(Lit, span~ : @diag.Span)
  Name(Name)
  Call(Name, Array[Attr], Array[ViewExpr], span~ : @diag.Span)
} derive(Eq, Debug, ToJson)

///|
pub fn ViewExpr::span(self : ViewExpr) -> @diag.Span {
  match self {
    Lit(_, span~) | Call(_, _, _, span~) => span
    Name(n) => n.span
  }
}

///|
/// `key: value`; a quoted key keeps its text as written ("aria-label",
/// "on_keydown+enter+prevent").
pub(all) struct Attr {
  key : Name
  value : ViewExpr
} derive(Eq, Debug, ToJson)

///|
pub(all) struct Field {
  doc : String?
  name : Name
  ty : TypeExpr
  default : Expr?
  where_ : Expr?
  sync : Name?
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) struct Param {
  name : Name
  ty : TypeExpr
  where_ : Expr?
} derive(Eq, Debug, ToJson)

///|
pub(all) enum EmitKind {
  Notify
  Ask
  Send
  Make
} derive(Eq, Debug, ToJson)

///|
/// `notify x`, `ask x`, `send iface.msg`, `make type`.
pub(all) struct Emit {
  kind : EmitKind
  target : Array[Name]
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) struct Message {
  doc : String?
  name : Name
  params : Array[Param]
  swap : Bool
  source_key : Param?
  when_ : Expr?
  changes : Array[Name]?
  ensures : Expr?
  emits : Array[Emit]?
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
/// `notify name(params)`, `ask name(params) -> T`, `ask_handler name(params) -> T`.
pub(all) struct Signal {
  doc : String?
  name : Name
  params : Array[Param]
  result : TypeExpr?
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) struct Invariant {
  doc : String?
  name : Name
  cond : Expr
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) struct LoopDecl {
  name : Name
  prepare : TypeExpr?
  iter : Bool
  key : TypeExpr?
  filter : Bool
  enrich : Array[(Name, TypeExpr)]?
  view : Name?
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) struct ScopeDecl {
  name : Name
  binds : Array[(Name, TypeExpr)]
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) struct Provide {
  name : Name
  source : ViewExpr
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) struct ViewDecl {
  doc : String?
  name : Name
  body : ViewExpr
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) enum Member {
  Field(Field)
  Get(Field)
  Message(Message)
  Notify(Signal)
  Ask(Signal)
  Invariant(Invariant)
  Init(@diag.Span)
  Loop(LoopDecl)
  Scope(ScopeDecl)
  Provide(Provide)
  View(ViewDecl)
} derive(Eq, Debug, ToJson)

///|
pub(all) struct Decl {
  doc : String?
  name : Name
  implements : Array[Name]
  members : Array[Member]
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) enum Step {
  Send(Name, Array[Expr], span~ : @diag.Span)
  Expect(Expr, span~ : @diag.Span)
} derive(Eq, Debug, ToJson)

///|
/// `example name for component { start { f: v, ... } send m(args); expect cond; }`
pub(all) struct Example {
  name : Name
  component : Name
  start : Array[(Name, Expr)]
  steps : Array[Step]
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
/// `register a, b as c;`
pub(all) struct Register {
  name : Name
  as_ : Name?
} derive(Eq, Debug, ToJson)

///|
/// `use "other.tcd".{ a, b };` interfaces declared in another file.
pub(all) struct Use {
  path : String
  names : Array[Name]
  span : @diag.Span
} derive(Eq, Debug, ToJson)

///|
pub(all) enum Item {
  Interface(Decl)
  Component(Decl)
  Register(Array[Register], span~ : @diag.Span)
  AskHandler(Signal)
  HostAsk(Name)
  Example(Example)
} derive(Eq, Debug, ToJson)

///|
pub(all) struct File {
  path : String
  package_decl : (String, @diag.Span)?
  uses : Array[Use]
  items : Array[Item]
} derive(Eq, Debug, ToJson)
