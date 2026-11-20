// The model of a pure-tutuca module: what @gen generates from and @export
// describes, built from the checked module by @pure and checked here. Names
// are the module's, as written.

///|
/// A value type (tutuca's t.*). `Comp` names components or interfaces; none
/// means any component.
#derive(Eq, Debug, ToJson)
pub(all) enum Ty {
  Bool
  /// A JS number; a whole one has its Norm's int.
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
}

///|
/// A value the model holds (a default, a meta's, an example's), and what
/// the checks reason about before anything runs; Unknown is what can't be
/// known then (a component, a property, a field without a default).
#derive(Eq, Debug, ToJson)
pub(all) enum Val {
  VNull
  VBool(Bool)
  VNum(Double)
  VStr(String)
  VList(Array[Val])
  VMap(Array[(String, Val)])
  Unknown
}

///|
/// JSON as a value: objects as maps, in their order.
pub fn val_of_json(j : Json) -> Val {
  match j {
    Null => VNull
    True => VBool(true)
    False => VBool(false)
    Number(n, ..) => VNum(n)
    String(s) => VStr(s)
    Array(xs) => VList(xs.map(val_of_json))
    Object(m) => {
      let out = []
      for k, v in m {
        out.push((k, val_of_json(v)))
      }
      VMap(out)
    }
  }
}

///|
/// A value as JSON: a map an object, Unknown null.
pub fn Val::json(self : Val) -> Json {
  match self {
    VNull | Unknown => Json::null()
    VBool(b) => Json::boolean(b)
    VNum(n) => Json::number(n)
    VStr(s) => Json::string(s)
    VList(xs) => Json::array(xs.map(x => x.json()))
    VMap(entries) =>
      Json::object(Map::from_array(entries.map(e => (e.0, e.1.json()))))
  }
}

///|
/// A bound of a numeric interval.
#derive(Eq, Debug, ToJson)
pub(all) struct Bound {
  value : Double
  exclusive : Bool
}

///|
/// A field's (or an argument's) constraints: what the JS schema's
/// constraints object holds, and the runtime's constraint array is built
/// from.
#derive(Eq, Debug, ToJson)
pub(all) struct Norm {
  mut lo : Bound?
  mut hi : Bound?
  mut len_lo : Int32?
  /// A whole number (pure-tutuca's int constraint on a number).
  mut int : Bool
  mut len_hi : Int32?
  patterns : Array[String]
  /// A key of these fields (t.index).
  key_of : Array[String]
}

///|
pub fn Norm::new() -> Norm {
  {
    lo: None,
    hi: None,
    len_lo: None,
    int: false,
    len_hi: None,
    patterns: [],
    key_of: [],
  }
}

///|
pub fn Norm::is_empty(self : Norm) -> Bool {
  !self.int &&
  self.lo is None &&
  self.hi is None &&
  self.len_lo is None &&
  self.len_hi is None &&
  self.patterns.is_empty() &&
  self.key_of.is_empty()
}

///|
#derive(Eq, Debug, ToJson)
pub(all) enum SyncLevel {
  Shared
  Local
  NoSync
}

///|
/// A field, a computed property (a getter), an argument, a loop or scope
/// bind.
#derive(Debug, ToJson)
pub(all) struct FieldM {
  name : String
  ty : Ty
  norm : Norm
  /// The default, when the module gives one.
  default : Val?
  /// No default meets the type and its constraints: making it needs it.
  required : Bool
  /// The component type made, through the init context, when it isn't
  /// given: the first its type names.
  make : String?
  sync : SyncLevel
  doc : String?
  span : @diag.Span
}

///|
#derive(Eq, Debug, ToJson)
pub(all) enum EmitKindM {
  Notify
  Ask
  SendAt
  Make
  /// A message back to the sender (ctx_reply), whose type isn't known here.
  Reply
}

///|
#derive(Debug, ToJson)
pub(all) struct EmitM {
  kind : EmitKindM
  /// The message (notify, ask, send) or type (make) emitted.
  name : String
  /// For send: the interface or component whose message it is.
  target : String?
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct MessageM {
  name : String
  params : Array[FieldM]
  /// Its handler takes no context: a parent can apply it to a child.
  pure_ : Bool
  swap : Bool
  source_key : FieldM?
  /// Why its pre doesn't hold, in words.
  why : String?
  changes : Array[String]?
  /// Whether it has pre and post entries: functions the implementation
  /// defines (<c>_when_<m>, <c>_ensures_<m>).
  pre_entry : Bool
  post_entry : Bool
  emits : Array[EmitM]?
  doc : String?
  span : @diag.Span
}

///|
/// A notify the component sends, or an ask it makes (with the answer's type,
/// and what the handlers of its answer may emit: None when they emit
/// nothing).
#derive(Debug, ToJson)
pub(all) struct SignalM {
  name : String
  params : Array[FieldM]
  result : Ty?
  emits : Array[EmitM]?
  doc : String?
  span : @diag.Span
}

///|
/// An invariant: the implementation defines <c>_inv_<n>.
#derive(Debug, ToJson)
pub(all) struct InvariantM {
  name : String
  doc : String?
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct LoopM {
  name : String
  prepare : Ty?
  iter : Bool
  key : Ty?
  filter : Bool
  enrich : Array[FieldM]?
  view : String?
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct ScopeM {
  name : String
  binds : Array[FieldM]
  span : @diag.Span
}

///|
/// What a component says about itself to hosts under a URI: a record of
/// constants.
#derive(Debug, ToJson)
pub(all) struct MetaM {
  uri : String
  value : Val
  span : @diag.Span
}

///|
/// value as JSON.
pub fn MetaM::json(self : MetaM) -> Json {
  self.value.json()
}

///|
/// What components may say under a meta URI (tutuca's registerMetaSchemas):
/// a field per key, with its type, constraints and default. Declared here, a
/// package registers it in the scope it's registered in.
#derive(Debug, ToJson)
pub(all) struct MetaSchemaM {
  name : String
  uri : String
  fields : Array[FieldM]
  /// Declared in this package, or imported from another.
  declared_here : Bool
  doc : String?
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct ProvideM {
  name : String
  /// The field it provides, or that holds the item it provides.
  field : String
  /// For an item of field: the field holding the item's key.
  key : String?
  span : @diag.Span
}

///|
/// A send argument: what the event gives, a constant, or a when of them.
#derive(Eq, Debug, ToJson)
pub(all) enum SendArg {
  TargetValue(span~ : @diag.Span)
  SourceKey(span~ : @diag.Span)
  DragKey(span~ : @diag.Span)
  /// A property of the event, by its DOM name (eventKey() is key's).
  Event(String, span~ : @diag.Span)
  Value(Val, span~ : @diag.Span)
  Cond(SendArg, SendArg, SendArg?, span~ : @diag.Span)
}

///|
pub fn SendArg::span(self : SendArg) -> @diag.Span {
  match self {
    TargetValue(span~)
    | SourceKey(span~)
    | DragKey(span~)
    | Event(_, span~)
    | Value(_, span~)
    | Cond(_, _, _, span~) => span
  }
}

///|
/// An element's handler: on event (with its modifiers), send message with
/// args.
#derive(Eq, Debug, ToJson)
pub(all) struct OnM {
  event : String
  mods : Array[String]
  message : String
  args : Array[SendArg]
  span : @diag.Span
}

///|
#derive(Eq, Debug, ToJson)
pub(all) struct AttrM {
  name : String
  value : ViewNode
  span : @diag.Span
}

///|
/// A view, as tutuca's view constructors build it: constants, the state's
/// values read, conditionals, loops, the components rendered and elements.
#derive(Eq, Debug, ToJson)
pub(all) enum ViewNode {
  /// A literal: text, or an attribute's value.
  Const(Val, span~ : @diag.Span)
  Field(String, span~ : @diag.Span)
  /// The item of a list or map field at the key another field holds.
  SeqItem(String, String, span~ : @diag.Span)
  Provided(String, span~ : @diag.Span)
  Query(String, Array[ViewNode], span~ : @diag.Span)
  Bind(String, span~ : @diag.Span)
  If(ViewNode, ViewNode, ViewNode?, span~ : @diag.Span)
  Frag(Array[ViewNode], span~ : @diag.Span)
  /// A component read from the state, with a view of its.
  Render(ViewNode, String?, span~ : @diag.Span)
  /// Each component of a list, in a loop.
  RenderEach(ViewNode, String?, span~ : @diag.Span)
  /// A body for each item of a list or map, in a loop.
  Each(ViewNode, ViewNode, String?, span~ : @diag.Span)
  /// The item an each body renders, with a view of its.
  RenderIt(String?, span~ : @diag.Span)
  /// A scope's binds, around body.
  Scope(String, ViewNode, span~ : @diag.Span)
  /// The components body renders, with the view named (by a value) when
  /// they have it.
  PushView(ViewNode, ViewNode, span~ : @diag.Span)
  Element(
    tag~ : String,
    ns~ : String?,
    attrs~ : Array[AttrM],
    key~ : ViewNode?,
    children~ : Array[ViewNode],
    ons~ : Array[OnM],
    span~ : @diag.Span
  )
}

///|
pub fn ViewNode::span(self : ViewNode) -> @diag.Span {
  match self {
    Const(_, span~)
    | Field(_, span~)
    | SeqItem(_, _, span~)
    | Provided(_, span~)
    | Query(_, _, span~)
    | Bind(_, span~)
    | If(_, _, _, span~)
    | Frag(_, span~)
    | Render(_, _, span~)
    | RenderEach(_, _, span~)
    | Each(_, _, _, span~)
    | RenderIt(_, span~)
    | Scope(_, _, span~)
    | PushView(_, _, span~)
    | Element(span~, ..) => span
  }
}

///|
#derive(Debug, ToJson)
pub(all) struct ViewM {
  name : String
  /// The render target it's for (tutuca's renders), None for the page.
  target : String?
  body : ViewNode
  doc : String?
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct ComponentM {
  name : String
  /// The interfaces it implements, by name.
  implements : Array[String]
  fields : Array[FieldM]
  gets : Array[FieldM]
  messages : Array[MessageM]
  notifies : Array[SignalM]
  asks : Array[SignalM]
  /// Properties that take arguments: params and result, no emits.
  queries : Array[SignalM]
  invariants : Array[InvariantM]
  init_hook : Bool
  loops : Array[LoopM]
  scopes : Array[ScopeM]
  provides : Array[ProvideM]
  /// Its public fields, by name: each is also a query that takes nothing and
  /// gives the field (tutuca's .public()).
  publics : Array[String]
  /// What it says about itself to hosts, by URI, in the order written.
  metas : Array[MetaM]
  views : Array[ViewM]
  doc : String?
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct InterfaceM {
  name : String
  fields : Array[FieldM]
  gets : Array[FieldM]
  messages : Array[MessageM]
  notifies : Array[SignalM]
  /// The queries an implementing type answers: params and result.
  queries : Array[SignalM]
  /// Declared in this package (registered with it), or imported from another.
  declared_here : Bool
  doc : String?
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct RegisterM {
  component : String
  /// The name it registers under.
  as_ : String
}

///|
/// An example's step: a message sent, or what the state then has (each
/// field or property named equals its value).
#derive(Debug, ToJson)
pub(all) enum StepM {
  Send(String, Array[Val], span~ : @diag.Span)
  Expect(Array[(String, Val)], span~ : @diag.Span)
}

///|
#derive(Debug, ToJson)
pub(all) struct ExampleM {
  name : String
  component : String
  start : Array[(String, Val)]
  steps : Array[StepM]
  span : @diag.Span
}

///|
#derive(Debug, ToJson)
pub(all) struct Package {
  /// Its name: the module's file name, without its extensions.
  full_name : String
  /// The Wax prefix of package-level functions: the same name.
  name : String
  components : Array[ComponentM]
  interfaces : Array[InterfaceM]
  /// The meta schemas it declares or imports, which its components' metas
  /// are checked against.
  meta_schemas : Array[MetaSchemaM]
  registers : Array[RegisterM]
  ask_handlers : Array[SignalM]
  host_asks : Array[String]
  examples : Array[ExampleM]
}

///|
pub fn Package::component(self : Package, name : String) -> ComponentM? {
  self.components.iter().find_first(c => c.name == name)
}

///|
pub fn Package::interface_named(self : Package, name : String) -> InterfaceM? {
  self.interfaces.iter().find_first(i => i.name == name)
}

///|
pub fn Package::meta_schema_for(self : Package, uri : String) -> MetaSchemaM? {
  self.meta_schemas.iter().find_first(m => m.uri == uri)
}

///|
/// The fields and properties of the component or interface named, for
/// reading members of it, or None.
pub fn Package::members_of(self : Package, name : String) -> Array[FieldM]? {
  match self.component(name) {
    Some(c) => {
      let out = c.fields.copy()
      out.append(c.gets)
      Some(out)
    }
    None =>
      self
      .interface_named(name)
      .map(i => {
        let out = i.fields.copy()
        out.append(i.gets)
        out
      })
  }
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
