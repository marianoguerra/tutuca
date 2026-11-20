// Well-formedness, as the reference's lib/check.js: a type system. Every name
// must be a parameter, a const or something the host provides; every property,
// method and operator must exist for the type it is used at; only what the
// entry signature makes mutable may change. Checking is bidirectional and
// flow-sensitive, on paths of names and properties, as TypeScript's is.

///|
/// How an entry of a signature is seen: read-only all the way down, a draft the
/// program may change, or as written (read-only to pure-js).
#derive(Eq, Debug)
pub(all) enum Mode {
  Read
  Draft
  Plain
}

///|
#derive(Eq, Debug)
pub(all) struct Entry {
  mode : Mode
  ty : String
}

///|
pub fn read(ty : String) -> Entry {
  { mode: Read, ty, }
}

///|
pub fn draft(ty : String) -> Entry {
  { mode: Draft, ty, }
}

///|
pub fn plain(ty : String) -> Entry {
  { mode: Plain, ty, }
}

///|
/// What a program's this, parameters and result are. params None: nothing is
/// said of them (they need annotations).
#derive(Eq, Debug)
pub(all) struct Signature {
  this_ : Entry?
  params : Array[Entry]?
  result : Entry?
}

///|
pub struct CheckResult {
  diagnostics : Array[@diag.Diagnostic]
  /// What the program returns (inferred when nothing says it), as TypeScript.
  return_type : String
  return_ty : @types.Ty
}

///|
using @types {type Ty}

///|
let typeof_tags : Ty = @types.union(
  [
    "string", "number", "boolean", "undefined", "object", "function", "symbol", "bigint",
  ].map(s => @types.LitT(LStr(s))),
)

///|
/// The built-in methods as signatures, T standing for the receiver's elements.
let method_sigs : Map[String, Array[@types.Sig]] = {
  let h = @host.Host::new(@host.Declaration::empty()) catch { _ => panic() }
  let out = Map([])
  for receiver in [@tables.ListReceiver, StringReceiver, NumberReceiver] {
    for m in @tables.methods_of(receiver) {
      let node = match @parser.parse_type(m.sig) {
        Ok(n) => n
        Err(_) => panic()
      }
      match h.to_type(node, ["T"], (_, _) => ()) {
        FnT(sigs) => out["\{receiver_name(receiver)}.\{m.name}"] = sigs
        _ => panic()
      }
    }
  }
  out
}

///|
fn receiver_name(r : @tables.Receiver) -> String {
  match r {
    ListReceiver => "list"
    StringReceiver => "string"
    NumberReceiver => "number"
  }
}

///|
priv struct Env {
  mut refine : Map[String, Ty]
}

///|
fn Env::new() -> Env {
  { refine: Map([]), }
}

///|
fn Env::copy(self : Env) -> Env {
  { refine: self.refine.copy(), }
}

///|
fn Env::forget_under(self : Env, key : String?) -> Unit {
  guard key is Some(k) else { return }
  let prefix = "\{k}."
  for name in self.refine.keys().collect() {
    if name.has_prefix(prefix) {
      self.refine.remove(name)
    }
  }
}

///|
fn join(a : Env?, b : Env?) -> Env? {
  match (a, b) {
    (None, _) => b
    (_, None) => a
    (Some(a), Some(b)) => {
      let refine = Map([])
      for k, t in a.refine {
        match b.refine.get(k) {
          Some(u) => refine[k] = @types.union([t, u])
          None => ()
        }
      }
      Some({ refine, })
    }
  }
}

///|
/// What was forgotten in after (a call in a callback, the right of &&) is
/// forgotten in env.
fn forget_what_was_forgotten(env : Env, after : Env) -> Unit {
  for k, t in env.refine.copy() {
    if after.refine.get(k) != Some(t) {
      env.refine.remove(k)
    }
  }
}

///|
/// What a name is bound to: its kind (param, const, let, callback, helper,
/// namespace, import), its type, its mode (draft, fresh, read, value) and,
/// for a draft, its place; a helper's summary (fresh, the parameters it may
/// change) and its qualified name.
pub(all) struct Binding {
  kind : String
  ty : Ty
  mode : String
  place : String?
  qualified : String?
  fresh : Bool
  mut_params : Array[String]?
}

///|
fn plain_binding(kind : String, ty : Ty, mode : String) -> Binding {
  {
    kind,
    ty,
    mode,
    place: None,
    qualified: None,
    fresh: false,
    mut_params: None,
  }
}

///|
priv struct Scope {
  parent : Scope?
  names : Map[String, Binding]
}

///|
fn Scope::lookup(self : Scope, name : String) -> Binding? {
  match self.names.get(name) {
    Some(b) => Some(b)
    None =>
      match self.parent {
        Some(p) => p.lookup(name)
        None => None
      }
  }
}

///|
/// What the typed tree knows of a node: its type, its mode and its place.
pub(all) struct TypeEntry {
  start : Int32
  end : Int32
  ty : Ty
  mode : String
  place : String?
}

///|
/// A node's key in the typed tree: its span and its kind.
fn node_key(kind : String, at : @ast.Span) -> String {
  "\{at.start}:\{at.end}:\{kind}"
}

///|
fn expr_kind(e : @ast.Expr) -> String {
  match e {
    Ident(_) => "Identifier"
    This(_) => "ThisExpression"
    Lit(_, ..) => "Literal"
    Template(..) => "TemplateLiteral"
    ArrayLit(_, ..) => "ArrayExpression"
    ObjectLit(_, ..) => "ObjectExpression"
    Member(..) => "MemberExpression"
    Call(..) => "CallExpression"
    Spread(_, ..) => "SpreadElement"
    Chain(_, ..) => "ChainExpression"
    Unary(..) => "UnaryExpression"
    Update(..) => "UpdateExpression"
    Binary(..) => "BinaryExpression"
    Logical(..) => "LogicalExpression"
    Assign(..) => "AssignmentExpression"
    Cond(..) => "ConditionalExpression"
    Arrow(_) => "ArrowFunctionExpression"
  }
}

///|
/// Readonly<T> or readonly T[]: an annotation that says the value isn't changed.
pub fn is_readonly_node(node : @ast.TypeNode) -> Bool {
  match node {
    TReadonly(_, _) => true
    TRef("Readonly", args, _) => args.length() == 1
    _ => false
  }
}

///|
priv struct Checker {
  program : @ast.Program
  src : String
  host : @host.Host
  signature : Signature?
  deterministic : Bool
  diagnostics : Array[@diag.Diagnostic]
  mut scope : Scope
  mut this_type : Ty?
  mut this_mode : String
  mut returns : Array[Ty]
  /// The mode and type of each value returned, for a function's summary.
  mut return_modes : Array[String]
  mut return_types : Array[Ty]
  mut expected_return : Ty?
  /// The first parameter the program may change, for help texts.
  mut draft_name : String?
  /// The loops being checked, innermost last: what break and continue flow to.
  mut loops : Array[Array[Env]]
  /// A module's function: its annotations say what may change.
  module_function : Bool
  /// node key -> what it is, in the order first recorded (None: not kept).
  type_table : Map[String, TypeEntry]?
  /// node key -> mode, as computed when it was last checked.
  modes : Map[String, String]
}

///|
/// A checker for a program, or (outer) a module's function, whose module's
/// names are the scope outside.
fn new_checker(
  program : @ast.Program,
  host : @host.Host,
  signature : Signature?,
  deterministic : Bool,
  outer? : Scope,
  type_table? : Map[String, TypeEntry],
  module_function~ : Bool = false,
) -> Checker {
  {
    program,
    src: program.source,
    host,
    signature,
    deterministic,
    diagnostics: [],
    scope: match outer {
      Some(o) => o
      None => { parent: None, names: Map([]), }
    },
    this_type: None,
    this_mode: "read",
    returns: [],
    return_modes: [],
    return_types: [],
    expected_return: None,
    draft_name: None,
    loops: [],
    module_function,
    type_table,
    modes: Map([]),
  }
}

///|
/// What a node is, for the typed tree.
fn Checker::record(
  self : Checker,
  kind : String,
  at : @ast.Span,
  t : Ty,
  mode : String,
  place : String?,
) -> Unit {
  match self.type_table {
    Some(table) =>
      table[node_key(kind, at)] = {
        start: at.start,
        end: at.end,
        ty: t,
        mode,
        place,
      }
    None => ()
  }
}

///|
fn Checker::error(
  self : Checker,
  code : @diag.CheckCode,
  at : @ast.Span,
  message : String,
  help? : String,
) -> Unit {
  self.diagnostics.push(
    @diag.Diagnostic::new(Check(code), Check, message, at.start, at.end, help?),
  )
}

///|
fn Checker::resolve_ref(self : Checker) -> (Ty) -> Ty {
  t => self.host.resolve(t)
}

///|
fn Checker::rel(self : Checker, bindings? : Map[String, Ty]) -> @types.Relation {
  @types.Relation::new(self.resolve_ref(), bindings?)
}

///|
fn Checker::assignable(self : Checker, s : Ty, t : Ty) -> Bool {
  self.rel().assignable(s, t)
}

///|
fn Checker::resolve(self : Checker, t0 : Ty) -> Ty {
  let mut t = t0
  while t is RefT(..) {
    t = self.host.resolve(t)
  }
  t
}

///|
/// t with the aliases in it replaced by what they stand for, so a union's
/// members show.
fn Checker::expand(self : Checker, t : Ty) -> Ty {
  match t {
    RefT(..) => {
      let r = self.host.resolve(t)
      if r is (RecordT(..) | HandleT(..)) {
        t
      } else {
        self.expand(r)
      }
    }
    UnionT(ts) => @types.union(ts.map(u => self.expand(u)))
    _ => t
  }
}

///|
fn show(t : Ty) -> String {
  @types.type_to_string(t)
}

///|
fn Checker::text(self : Checker, at : @ast.Span) -> String {
  let raw = self.src
    .exact_view(start=at.start, end=at.end.min(self.src.length()))
    .to_owned()
  let sb = StringBuilder()
  let mut space = false
  for c in raw {
    if c == ' ' || c == '\n' || c == '\t' || c == '\r' {
      if !space {
        sb.write_char(' ')
      }
      space = true
    } else {
      sb.write_char(c)
      space = false
    }
  }
  let s = sb.to_string()
  if s.length() > 40 {
    "\{s.exact_view(end=37)}..."
  } else {
    s
  }
}

///|
/// Runs f without keeping what it reports: to know a type, to try an overload.
fn[T] Checker::quietly(self : Checker, f : () -> T) -> (T, Bool) {
  let n = self.diagnostics.length()
  let result = f()
  let failed = self.diagnostics.length() > n
  while self.diagnostics.length() > n {
    ignore(self.diagnostics.pop())
  }
  (result, failed)
}

///|
fn Checker::annotation(
  self : Checker,
  node : @ast.TypeNode,
  mutable : Bool,
) -> Ty {
  @types.with_mut(
    self.host.to_type(node, [], (at, message) => {
      self.error(UnknownType, at, message)
    }),
    mutable,
  )
}

///|
fn Checker::entry_type(self : Checker, e : Entry?) -> Ty? {
  guard e is Some(entry) else { return None }
  let ty = self.host.type_of(entry.ty) catch { _ => @types.UnknownT }
  Some(@types.with_mut(ty, entry.mode is Draft))
}

///|
/// The mode of a value bound from an entry: draft when the program may change it.
fn entry_mode(e : Entry?) -> String {
  match e {
    Some({ mode: Draft, .. }) => "draft"
    _ => "read"
  }
}

///|
/// An annotation in a module's function: a container written plainly may
/// change, written Readonly<T> or readonly T[] it may not.
fn Checker::declared_type(self : Checker, node : @ast.TypeNode) -> Ty {
  self.annotation(node, !is_readonly_node(node))
}

///|
fn Checker::push_scope(self : Checker) -> Unit {
  self.scope = { parent: Some(self.scope), names: Map([]), }
}

///|
fn Checker::pop_scope(self : Checker) -> Unit {
  match self.scope.parent {
    Some(p) => self.scope = p
    None => ()
  }
}

///|
fn containerish(t : Ty) -> Bool {
  @types.members(t).iter().any(u => u.is_container() || u is RefT(..))
}

///|
fn Checker::declare_name(
  self : Checker,
  id : @ast.Ident,
  t : Ty,
  kind : String,
  mode? : String,
  place? : String,
) -> Unit {
  let name = id.name
  if self.scope.lookup(name) is Some(_) ||
    self.host.binding(name) is Some(_) ||
    name == "undefined" {
    self.error(
      ShadowedName,
      id.span,
      "\{name} is already a name here: pick another one",
    )
  }
  let ms = @types.members(t)
  let m = if !containerish(t) {
    if ms.iter().any(u => u is HandleT(..)) {
      "read"
    } else {
      "value"
    }
  } else {
    match mode {
      Some(x) => x
      None => if ms.iter().any(u => u.top_mut()) { "fresh" } else { "read" }
    }
  }
  let pl = if m == "draft" { place } else { None }
  self.scope.names[name] = { ..plain_binding(kind, t, m), place: pl, }
  self.record("Identifier", id.span, t, m, pl)
}

///|
/// Binds what a pattern names, from a value of type (of mode, at place when
/// it's a draft's).
fn Checker::bind_pattern(
  self : Checker,
  p : @ast.Pattern,
  ty : Ty,
  kind~ : String = "const",
  mode? : String,
  place? : String,
) -> Unit {
  match p {
    PIdent(id) => self.declare_name(id, ty, kind, mode?, place?)
    PAssign(left~, right~, ..) => {
      let dt = self.value(right, Env::new(), Some(@types.remove_nullish(ty)))
      let defined = @types.filter_union(ty, u => !(u is UndefinedT))
      if !self.assignable(dt, defined) && !self.assignable(dt, ty) {
        self.error(
          NotAssignable,
          right.span(),
          "the default is \{show(dt)}, where \{show(ty)} is expected",
        )
      }
      self.bind_pattern(left, @types.union([defined, dt]), kind~, mode?)
    }
    PObject(props~, span~, ..) =>
      self.object_pattern(props, span, ty, kind, mode, place)
    PArray(elements~, span~, ..) => {
      let t = self.resolve(ty)
      for i, e in elements {
        guard e is Some(e) else { continue }
        if e is PRest(arg~, ..) {
          let rest = match t {
            TupleT(elems~, ..) =>
              @types.TupleT(
                elems=elems[i:]
                  .to_owned()
                  .mapi((j, _) => @types.tuple_elem_of(t, i + j)),
                mutable=true,
                deep=false,
              )
            ListT(..) =>
              @types.ListT(elem=@types.elem_of(t), mutable=true, deep=false)
            _ => @types.ListT(elem=UnknownT, mutable=true, deep=false)
          }
          self.bind_pattern(arg, rest, kind~, mode="fresh")
          continue
        }
        let et = match t {
          TupleT(elems~, ..) =>
            if i >= elems.length() {
              self.error(
                PatternType,
                e.span(),
                "the pattern takes element \{i + 1}, but \{show(t)} has \{elems.length()}",
              )
              @types.UnknownT
            } else {
              @types.tuple_elem_of(t, i)
            }
          ListT(..) => @types.union([@types.elem_of(t), UndefinedT])
          _ => {
            if !(t is UnknownT) || i == 0 {
              self.error(
                PatternType,
                span,
                "an array pattern takes a list or a tuple, not \{show(t)}",
              )
            }
            UnknownT
          }
        }
        self.bind_pattern(
          e,
          et,
          kind~,
          mode?=if mode == Some("draft") { Some("draft") } else { None },
          place?=place.map(pl => "\{pl}[\{i}]"),
        )
      }
    }
    PRest(..) => ()
  }
}

///|
fn Checker::object_pattern(
  self : Checker,
  props : Array[@ast.PatProp],
  span : @ast.Span,
  ty : Ty,
  kind : String,
  mode : String?,
  place : String?,
) -> Unit {
  let t = self.resolve(@types.remove_nullish(ty))
  if @types.has_nullish(ty) {
    self.error(
      PossiblyNull,
      span,
      "the value destructured may be \{show(@types.filter_union(ty, @types.is_nullish))}: check it first",
    )
  }
  let sub = if mode == Some("draft") { Some("draft") } else { None }
  let taken = []
  for prop in props {
    match prop {
      PPRest(arg~, ..) => {
        let rest = match t {
          RecordT(fields~, ..) => {
            let fs : Map[String, @types.Field] = Map([])
            for n, f in fields {
              if !taken.contains(n) {
                fs[n] = {
                  ty: @types.field_type_of(t, f),
                  optional: f.optional,
                  read_only: false,
                }
              }
            }
            @types.RecordT(
              name=None,
              fields=fs,
              methods=Map([]),
              mutable=true,
              deep=false,
              ns=None,
            )
          }
          DictT(..) =>
            @types.DictT(
              value=@types.dict_value_of(t),
              mutable=true,
              deep=false,
            )
          _ =>
            @types.RecordT(
              name=None,
              fields=Map([]),
              methods=Map([]),
              mutable=true,
              deep=false,
              ns=None,
            )
        }
        self.declare_name(arg, rest, kind, mode="fresh")
      }
      PPProp(key~, value~, ..) => {
        let name = match key {
          KIdent(id) => id.name
          KLit(LStr(s), ..) => s
          KLit(_, raw~, ..) => raw
          KComputed(_) => ""
        }
        taken.push(name)
        let ft = match t {
          RecordT(fields~, ..) | HandleT(fields~, ..) =>
            match fields.get(name) {
              None => {
                self.error(
                  UnknownProperty,
                  key.span(),
                  "\{show(t)} has no \{name}",
                )
                @types.UnknownT
              }
              Some(f) => {
                let mut x = @types.field_type_of(t, f)
                if f.optional {
                  x = @types.union([x, UndefinedT])
                }
                if t is HandleT(..) {
                  x = @types.with_mut(x, false)
                }
                x
              }
            }
          DictT(..) => @types.union([@types.dict_value_of(t), UndefinedT])
          _ => {
            self.error(
              PatternType,
              span,
              "an object pattern takes a record or a dictionary, not \{show(t)}",
            )
            UnknownT
          }
        }
        self.bind_pattern(
          value,
          ft,
          kind~,
          mode?=sub,
          place?=place.map(pl => "\{pl}.\{name}"),
        )
      }
    }
  }
}

///|
fn Checker::path_key(self : Checker, e : @ast.Expr) -> String? {
  match e {
    This(_) => Some("this")
    Ident(id) =>
      if self.scope.lookup(id.name) is Some(_) {
        Some(id.name)
      } else {
        None
      }
    Member(object~, property=Ident(p), computed=false, optional=false, ..) =>
      match self.path_key(object) {
        Some(o) => Some("\{o}.\{p.name}")
        None => None
      }
    _ => None
  }
}

///|
fn Checker::describe(self : Checker, e : @ast.Expr) -> String {
  match self.path_key(e) {
    Some(k) => k
    None => self.text(e.span())
  }
}

///|
fn Checker::run(self : Checker) -> Ty {
  let p = self.program
  let f = p.func
  let sigd = self.signature
  self.push_scope()
  match sigd {
    Some({ this_: Some(t), .. }) if !(p.form is ArrowForm) => {
      self.this_type = self.entry_type(Some(t))
      self.this_mode = entry_mode(Some(t))
    }
    _ => ()
  }
  match f.this_type {
    Some(node) => {
      let ann = if self.module_function {
        self.declared_type(node)
      } else {
        self.annotation(node, false)
      }
      match self.this_type {
        Some(t) if !self.assignable(t, ann) =>
          self.error(
            ParamType,
            node.span(),
            "this is \{show(t)}, not \{show(ann)}",
          )
        _ => ()
      }
      if self.this_type is None {
        self.this_type = Some(ann)
        self.this_mode = if ann.top_mut() { "draft" } else { "read" }
      }
    }
    None => ()
  }
  let params = match sigd {
    Some(s) => s.params
    None => None
  }
  for i, param in f.params {
    let mut ty = match params {
      None => None
      Some(ps) => self.entry_type(ps.get(i))
    }
    let mut mode = match params {
      Some(ps) if i < ps.length() => Some(entry_mode(ps.get(i)))
      _ => None
    }
    match params {
      Some(ps) if i >= ps.length() =>
        self.error(
          TooManyParams,
          param.span(),
          "the signature has \{ps.length()} parameters, this is parameter \{i + 1}",
        )
      _ => ()
    }
    match param.ann() {
      Some(node) => {
        let ann = if self.module_function && ty is None {
          self.declared_type(node)
        } else {
          self.annotation(node, ty.map(t => t.top_mut()).unwrap_or(false))
        }
        match ty {
          Some(t) if !self.assignable(t, ann) =>
            self.error(
              ParamType,
              node.span(),
              "the parameter is \{show(t)}, not \{show(ann)}",
            )
          _ => ()
        }
        if ty is None {
          ty = Some(ann)
          mode = Some(if ann.top_mut() { "draft" } else { "read" })
        }
      }
      None => ()
    }
    let t = match ty {
      Some(t) => t
      None => {
        self.error(
          MissingParamType,
          param.span(),
          "the parameter needs a type: annotate it or give the program a signature",
        )
        UnknownT
      }
    }
    let place = match (mode, param) {
      (Some("draft"), PIdent(id)) => Some(id.name)
      _ => None
    }
    self.bind_pattern(param, t, kind="param", mode?, place?)
    match param {
      PIdent(id) if self.draft_name is None && t.top_mut() =>
        self.draft_name = Some(id.name)
      _ => ()
    }
  }
  let declared_result = match sigd {
    Some(s) => s.result
    None => None
  }
  match f.return_type {
    Some(node) => {
      let ann = self.annotation(node, false)
      self.expected_return = Some(ann)
      match self.entry_type(declared_result) {
        Some(declared) if !self.assignable(ann, declared) =>
          self.error(
            ReturnType,
            node.span(),
            "the signature returns \{show(declared)}, not \{show(ann)}",
          )
        _ => ()
      }
    }
    None =>
      if declared_result is Some(_) {
        self.expected_return = self.entry_type(declared_result)
      }
  }
  let completes = match f.body {
    BlockBody(b) => self.statements(b.body, Env::new()) is Some(_)
    ExprBody(e) => {
      let t = self.value(e, Env::new(), self.expected_value_return())
      self.check_returned(e, t)
      false
    }
  }
  let expected = self.expected_return
  match expected {
    Some(e) if completes && !self.assignable(UndefinedT, e) && !(e is VoidT) => {
      let at = match f.body {
        BlockBody(b) => b.span
        ExprBody(x) => x.span()
      }
      self.error(
        MissingReturn,
        at,
        "the function must return \{show(e)} on every path",
      )
    }
    _ => ()
  }
  self.pop_scope()
  match expected {
    Some(e) => e
    None =>
      if self.returns.length() == 0 {
        VoidT
      } else {
        let all = self.returns.map(@types.widen)
        if completes {
          all.push(UndefinedT)
        }
        @types.union(all)
      }
  }
}

///|
fn Checker::expected_value_return(self : Checker) -> Ty? {
  match self.expected_return {
    None | Some(VoidT) => None
    e => e
  }
}

///|
fn Checker::check_returned(self : Checker, x : @ast.Expr, t : Ty) -> Unit {
  let at = x.span()
  self.return_modes.push(self.mode_of(x))
  self.return_types.push(t)
  match self.expected_return {
    None => self.returns.push(t)
    Some(VoidT) =>
      self.error(
        ReturnValue,
        at,
        "the function returns nothing: write return; alone",
      )
    Some(e) =>
      if !self.assignable(t, e) {
        self.error(
          ReturnType,
          at,
          "it returns \{show(e)}, and this is \{show(t)}",
        )
      }
  }
}

///|
/// Statements: each takes the flow state before it and returns the one after
/// it, or None when the statement never completes (it returns on every path).
fn Checker::statements(
  self : Checker,
  list : Array[@ast.Stmt],
  env : Env,
) -> Env? {
  let mut current = Some(env)
  for s in list {
    match current {
      None => {
        self.error(
          UnreachableCode,
          s.span(),
          "this statement never runs: a return before it always happens",
        )
        return None
      }
      Some(e) => current = self.statement(s, e)
    }
  }
  current
}

///|
fn Checker::statement(self : Checker, s : @ast.Stmt, env : Env) -> Env? {
  match s {
    VarDecl(kind~, decls~, ..) => {
      for d in decls {
        guard d.init is Some(init) else {
          self.error(
            LetNeedsValue,
            d.span,
            "a let needs a value to start with: let x = ...;",
          )
          if d.id is PIdent(id) {
            self.declare_name(
              id,
              match id.ann {
                Some(node) => self.annotation(node, true)
                None => UnknownT
              },
              kind,
            )
          }
          continue
        }
        let (t, declared, changed) = match d.id.ann() {
          Some(node) => {
            let ann = self.annotation(node, true)
            let t = self.value(init, env, Some(ann))
            if !self.assignable(t, ann) {
              self.error(
                NotAssignable,
                init.span(),
                "\{show(t)} is not \{show(ann)}",
              )
            }
            (t, @types.with_mut(ann, t.top_mut()), true)
          }
          None => {
            let t = self.value(init, env, None)
            if kind == "let" {
              (t, @types.widen(t), t is (LitT(_) | UnionT(_)))
            } else {
              (t, t, false)
            }
          }
        }
        let mode = self.mode_of(init)
        let place = if kind == "const" && mode == "draft" {
          self.place_of(init)
        } else {
          None
        }
        self.bind_pattern(
          d.id,
          declared,
          kind~,
          mode?=if mode == "value" { None } else { Some(mode) },
          place?,
        )
        // A let starts known to hold what it was given.
        if kind == "let" && changed && d.id is PIdent(id) {
          env.refine[id.name] = t
        }
      }
      Some(env)
    }
    ForOf(..) => self.for_of(s, env)
    Break(_) | Continue(_) => {
      match self.loops.last() {
        Some(exits) => exits.push(env.copy())
        None => ()
      }
      None
    }
    ExprStmt(e, ..) => {
      match e {
        Assign(..) => self.assignment(e, env)
        _ => ignore(self.expr(e, env, None))
      }
      Some(env)
    }
    If(cond~, cons~, alt~, ..) => {
      ignore(self.check_test(cond, env))
      let then = self.statement(cons, self.narrow(cond, env, true))
      let otherwise = match alt {
        None => Some(self.narrow(cond, env, false))
        Some(a) => self.statement(a, self.narrow(cond, env, false))
      }
      join(then, otherwise)
    }
    BlockStmt(b) => {
      self.push_scope()
      let out = self.statements(b.body, env)
      self.pop_scope()
      out
    }
    Return(arg, span~) => {
      match arg {
        None =>
          match self.expected_return {
            Some(e) if !(e is VoidT) && !self.assignable(UndefinedT, e) =>
              self.error(
                ReturnType,
                span,
                "it returns \{show(e)}: return a value",
              )
            _ => ()
          }
        Some(x) => {
          let t = self.value(x, env, self.expected_value_return())
          self.check_returned(x, t)
        }
      }
      None
    }
    // Forms the sieve stops (try, ...): nothing is known of them.
    _ => Some(env)
  }
}

///|
fn Checker::check_test(self : Checker, e : @ast.Expr, env : Env) -> Ty {
  let t = self.value(e, env, None)
  if !@types.is_testable(t) {
    self.error(
      NotTestable,
      e.span(),
      "a test takes a boolean, or a value that may be null or undefined; \{self.describe(e)} is \{show(t)}",
      help="compare it: === \"\", === 0, > 0",
    )
  }
  t
}

///|
/// Checks a program against a host and an entry signature.
pub fn check(
  program : @ast.Program,
  host : @host.Host,
  signature? : Signature,
  deterministic~ : Bool = false,
) -> CheckResult {
  let c = new_checker(program, host, signature, deterministic)
  let ret = c.run()
  { diagnostics: c.diagnostics, return_type: show(ret), return_ty: ret, }
}
