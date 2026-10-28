// The resolved model of a TCD package: what @gen generates from and @export
// describes. Names are TCD names (snake_case); `runtime` and `wax` give the
// other two spellings (names.mbt).

///|
/// A value type (tutuca's t.*). `Comp` names components or interfaces by their
/// TCD names; none means any component.
pub(all) enum Ty {
  Bool
  S32
  F64
  Str
  Any
  Null
  Enum(Array[String])
  Option(Ty)
  List(Ty)
  Map(Ty)
  Record(Array[(String, Ty)])
  OneOf(Array[Ty])
  Comp(Array[String])
  Result(Ty, Ty)
} derive(Eq, Debug, ToJson)

///|
/// A bound of a numeric interval.
pub(all) struct Bound {
  value : Double
  exclusive : Bool
} derive(Eq, Debug, ToJson)

///|
/// A where clause in normal form: what the JS schema's constraints object
/// holds, and the runtime's constraint array is built from.
pub(all) struct Norm {
  mut lo : Bound?
  mut hi : Bound?
  mut len_lo : Int32?
  mut len_hi : Int32?
  /// The value is one of these (an intersection of `in [..]` and `==`).
  mut one_of : Array[@syntax.Lit]?
  none_of : Array[@syntax.Lit]
  patterns : Array[String]
  /// A key of these fields (t.index).
  key_of : Array[String]
  /// One of the values of these fields.
  member_of : Array[String]
  /// Named predicates the implementation provides.
  checks : Array[String]
} derive(Eq, Debug, ToJson)

///|
pub fn Norm::new() -> Norm {
  {
    lo: None,
    hi: None,
    len_lo: None,
    len_hi: None,
    one_of: None,
    none_of: [],
    patterns: [],
    key_of: [],
    member_of: [],
    checks: [],
  }
}

///|
pub fn Norm::is_empty(self : Norm) -> Bool {
  self.lo is None &&
  self.hi is None &&
  self.len_lo is None &&
  self.len_hi is None &&
  self.one_of is None &&
  self.none_of.is_empty() &&
  self.patterns.is_empty() &&
  self.key_of.is_empty() &&
  self.member_of.is_empty() &&
  self.checks.is_empty()
}

///|
pub(all) enum SyncLevel {
  Shared
  Local
  NoSync
} derive(Eq, Debug, ToJson)

///|
/// A field, a computed property (`get`), an argument, a loop or scope bind.
pub(all) struct FieldM {
  name : String
  ty : Ty
  norm : Norm
  /// The literal default, when written.
  default : @syntax.Expr?
  /// No default meets the type and its constraints: init fails without it.
  required : Bool
  /// The component type a `make(name)` default makes, through the init
  /// context, when init gets none.
  make : String?
  sync : SyncLevel
  doc : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) enum EmitKindM {
  Notify
  Ask
  SendAt
  Make
} derive(Eq, Debug, ToJson)

///|
pub(all) struct EmitM {
  kind : EmitKindM
  /// The message (notify, ask, send) or type (make) emitted.
  name : String
  /// For send: the interface or component whose message it is.
  target : String?
} derive(Debug, ToJson)

///|
pub(all) struct MessageM {
  name : String
  params : Array[FieldM]
  swap : Bool
  source_key : FieldM?
  when_ : @syntax.Expr?
  changes : Array[String]?
  ensures : @syntax.Expr?
  emits : Array[EmitM]?
  doc : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
/// A notify the component sends, or an ask it makes (with the reply's type,
/// and what the handlers of its reply may emit: None when it doesn't say).
pub(all) struct SignalM {
  name : String
  params : Array[FieldM]
  result : Ty?
  emits : Array[EmitM]?
  doc : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct InvariantM {
  name : String
  cond : @syntax.Expr
  doc : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct LoopM {
  name : String
  prepare : Ty?
  iter : Bool
  key : Ty?
  filter : Bool
  enrich : Array[FieldM]?
  view : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct ScopeM {
  name : String
  binds : Array[FieldM]
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct ProvideM {
  name : String
  /// The field it provides.
  field : String
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct ViewM {
  name : String
  body : @syntax.ViewExpr
  doc : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct ComponentM {
  name : String
  /// The interfaces it implements, by TCD name.
  implements : Array[String]
  fields : Array[FieldM]
  gets : Array[FieldM]
  messages : Array[MessageM]
  notifies : Array[SignalM]
  asks : Array[SignalM]
  invariants : Array[InvariantM]
  init_hook : Bool
  loops : Array[LoopM]
  scopes : Array[ScopeM]
  provides : Array[ProvideM]
  views : Array[ViewM]
  /// The `check(p)` predicates its where clauses and conditions use, with
  /// the type of what they check (None for conditions over the state).
  checks : Array[(String, Ty?)]
  doc : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct InterfaceM {
  name : String
  fields : Array[FieldM]
  gets : Array[FieldM]
  messages : Array[MessageM]
  notifies : Array[SignalM]
  /// Declared in this package (registered with it), or used from another.
  declared_here : Bool
  doc : String?
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct RegisterM {
  component : String
  /// The name it registers under, a TCD name.
  as_ : String
} derive(Debug, ToJson)

///|
pub(all) enum StepM {
  Send(String, Array[@syntax.Expr])
  Expect(@syntax.Expr)
} derive(Debug, ToJson)

///|
pub(all) struct ExampleM {
  name : String
  component : String
  start : Array[(String, @syntax.Expr)]
  steps : Array[StepM]
  span : @diag.Span
} derive(Debug, ToJson)

///|
pub(all) struct Package {
  /// As written: tutuca:todos@0.1.0.
  full_name : String
  /// Its last segment, snake_case: the Wax prefix of package-level functions.
  name : String
  components : Array[ComponentM]
  interfaces : Array[InterfaceM]
  registers : Array[RegisterM]
  ask_handlers : Array[SignalM]
  host_asks : Array[String]
  examples : Array[ExampleM]
} derive(Debug, ToJson)

///|
pub fn Package::component(self : Package, name : String) -> ComponentM? {
  self.components.iter().find_first(c => c.name == name)
}

///|
pub fn Package::interface_named(self : Package, name : String) -> InterfaceM? {
  self.interfaces.iter().find_first(i => i.name == name)
}

///|
pub fn ComponentM::field(self : ComponentM, name : String) -> FieldM? {
  self.fields.iter().find_first(f => f.name == name)
}

///|
pub fn ComponentM::property(self : ComponentM, name : String) -> FieldM? {
  match self.field(name) {
    Some(f) => Some(f)
    None => self.gets.iter().find_first(f => f.name == name)
  }
}

///|
pub fn ComponentM::message(self : ComponentM, name : String) -> MessageM? {
  self.messages.iter().find_first(m => m.name == name)
}
