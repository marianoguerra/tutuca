// A host: everything a program may name besides its own parameters and
// consts, as the reference's lib/host.js. Its declaration is data,
// TypeScript signatures as strings; what a host function does is the
// evaluator's business (eval's `Runtime` answers calls by qualified name), so
// a host is checked against without its implementations.

///|
/// A declaration: named records (and aliases), handles (opaque host objects),
/// modules of members, top-level functions, members whose results depend on
/// more than their arguments, members whose results the program may change.
/// A member is one signature or several (overloads).
pub(all) struct Declaration {
  types : Array[(String, String)]
  handles : Array[(String, String)]
  modules : Array[(String, Array[(String, Array[String])])]
  functions : Array[(String, Array[String])]
  nondeterministic : Array[String]
  fresh : Array[String]
  /// What a module imports from a specifier: one of the host's modules.
  imports : Array[(String, String)]
}

///|
pub fn Declaration::empty() -> Declaration {
  {
    types: [],
    handles: [],
    modules: [],
    functions: [],
    nondeterministic: [],
    fresh: [],
    imports: [],
  }
}

///|
priv enum NamedKind {
  Record
  Handle
}

///|
priv struct Named {
  kind : NamedKind
  node : @ast.TypeNode
  mut ty : @types.Ty?
}

///|
pub struct Member {
  qualified : String
  ty : @types.Ty
}

///|
/// A member as declared: its signatures' nodes, made into a type the first
/// time it's used (as the reference's host does), by the host using it.
priv struct MemberDecl {
  qualified : String
  nodes : Array[@ast.TypeNode]
  mut ty : @types.Ty?
}

///|
/// A free name of a program, as the host has it.
pub(all) enum Binding {
  /// A module, and its signatures when it is also called (Number).
  ModuleBinding(String, call~ : @types.Ty?)
  FunctionBinding(String, @types.Ty)
}

///|
pub struct Host {
  declaration : Declaration
  priv named : Map[String, Named]
  priv modules : Map[String, Map[String, MemberDecl]]
  priv functions : Map[String, MemberDecl]
  nondeterministic : Array[String]
  fresh : Array[String]
  priv imports : Map[String, String]
}

///|
fn check_name(name : String, what : String) -> Unit raise Failure {
  let ok = name.length() > 0 &&
    !name.has_prefix("$") &&
    name
    .iter()
    .all(c => c.is_ascii_alphabetic() || c.is_ascii_digit() || c == '_') &&
    !name.get_char(0).unwrap().is_ascii_digit()
  if !ok {
    fail("a host \{what} needs a plain name, not \{@types.json_string(name)}")
  }
}

///|
fn parse_decl(src : String, what : String) -> @ast.TypeNode raise Failure {
  match @parser.parse_type(src) {
    Ok(t) => t
    Err(d) =>
      fail(
        "\{what} \{@types.json_string(src)}: \{d.message} (at column \{d.start + 1})",
      )
  }
}

///|
pub fn Host::new(d : Declaration) -> Host raise Failure {
  let named : Map[String, Named] = Map([])
  for e in d.types {
    check_name(e.0, "type")
    if named.contains(e.0) {
      fail("the host declares \{e.0} twice")
    }
    named[e.0] = { kind: Record, node: parse_decl(e.1, e.0), ty: None, }
  }
  for e in d.handles {
    check_name(e.0, "handle")
    if named.contains(e.0) {
      fail("the host declares \{e.0} twice")
    }
    named[e.0] = { kind: Handle, node: parse_decl(e.1, e.0), ty: None, }
  }
  let host : Host = {
    declaration: d,
    named,
    modules: Map([]),
    functions: Map([]),
    nondeterministic: d.nondeterministic,
    fresh: d.fresh,
    imports: Map(d.imports),
  }
  let decl_of = (srcs : Array[String], what : String) => {
    srcs.map(src => parse_decl(src, what))
  }
  for m in d.modules {
    check_name(m.0, "module")
    let ms : Map[String, MemberDecl] = host.modules.get(m.0).unwrap_or(Map([]))
    for e in m.1 {
      ms[e.0] = {
        qualified: "\{m.0}.\{e.0}",
        nodes: decl_of(e.1, "\{m.0}.\{e.0}"),
        ty: None,
      }
    }
    host.modules[m.0] = ms
  }
  for f in d.functions {
    check_name(f.0, "function")
    host.functions[f.0] = {
      qualified: f.0,
      nodes: decl_of(f.1, f.0),
      ty: None,
    }
  }
  for i in d.imports {
    if !host.modules.contains(i.1) {
      fail(
        "the host's import \{@types.json_string(i.0)} names \{i.1}, which isn't one of its modules",
      )
    }
  }
  host
}

///|
/// The module a specifier imports from, when the host offers it.
pub fn Host::import_module(self : Host, spec : String) -> String? {
  self.imports.get(spec)
}

///|
/// Whether the host declares a named type.
pub fn Host::has_type(self : Host, name : String) -> Bool {
  self.named.contains(name)
}

///|
/// A host that also has these named types, as type nodes (a module's): they
/// are made into types when first used, and a bad one reads as unknown.
pub fn Host::with_type_nodes(
  self : Host,
  nodes : Array[(String, @ast.TypeNode)],
) -> Host {
  let named : Map[String, Named] = Map([])
  for k, v in self.named {
    named[k] = v
  }
  for e in nodes {
    named[e.0] = { kind: Record, node: e.1, ty: None, }
  }
  { ..self, named, }
}

///|
/// Makes a named type unknown: what a module's type that doesn't check means.
pub fn Host::forget_type(self : Host, name : String) -> Unit {
  match self.named.get(name) {
    Some(e) => e.ty = Some(UnknownT)
    None => ()
  }
}

///|
/// A host that also has what more declares; more wins where both have it.
pub fn Host::with_declaration(
  self : Host,
  more : Declaration,
) -> Host raise Failure {
  let d = self.declaration
  let merge = (a : Array[(String, String)], b : Array[(String, String)]) => {
    let out = a.filter(e => !b.iter().any(x => x.0 == e.0))
    out.push_iter(b.iter())
    out
  }
  let modules = d.modules.copy()
  for m in more.modules {
    match modules.search_by(x => x.0 == m.0) {
      Some(i) => {
        let members = modules[i].1.filter(e => !m.1.iter().any(x => x.0 == e.0))
        members.push_iter(m.1.iter())
        modules[i] = (m.0, members)
      }
      None => modules.push(m)
    }
  }
  let functions = d.functions.filter(e => {
    !more.functions.iter().any(x => x.0 == e.0)
  })
  functions.push_iter(more.functions.iter())
  Host::new({
    types: merge(d.types, more.types),
    handles: merge(d.handles, more.handles),
    modules,
    functions,
    nondeterministic: [..d.nondeterministic, ..more.nondeterministic],
    fresh: [..d.fresh, ..more.fresh],
    imports: merge(d.imports, more.imports),
  })
}

///|
/// A type node as a type; report says what is wrong with one (an unknown
/// name, a type pure-js doesn't have), which then reads as unknown.
pub fn Host::to_type(
  self : Host,
  node : @ast.TypeNode,
  tvars : Array[String],
  report : (@ast.Span, String) -> Unit,
) -> @types.Ty {
  let to = (n : @ast.TypeNode) => self.to_type(n, tvars, report)
  match node {
    TKeyword(name, span) =>
      match @types.primitive(name) {
        Some(p) => p
        None => {
          report(span, "pure-js has no type \{name}")
          UnknownT
        }
      }
    TLiteral(v, _) => LitT(v)
    TArray(e, _) => @types.list(to(e))
    TTuple(es, _) => TupleT(elems=es.map(to), mutable=false, deep=true)
    TUnion(ts, _) => @types.union(ts.map(to))
    TReadonly(operand, _) => to(operand)
    TRef(name, args, span) =>
      if tvars.contains(name) {
        VarT(name)
      } else if name == "Readonly" &&
        args.length() == 1 &&
        !self.named.contains("Readonly") {
        // Readonly<T> is T: what may change is decided where a value is bound.
        to(args[0])
      } else if self.named.contains(name) {
        RefT(name~, mutable=false)
      } else {
        report(span, "there is no type \{name}")
        UnknownT
      }
    TFunction(..) => FnT([self.to_sig_node(node, tvars, report)])
    TObject(members, span) => {
      let index = members.filter(m => m is TMIndex(..))
      if index.length() > 0 {
        if members.length() > 1 {
          report(span, "a type is a record or a dictionary, not both")
          return UnknownT
        }
        guard index[0] is TMIndex(value~, ..) else { return UnknownT }
        return DictT(value=to(value), mutable=false, deep=true)
      }
      let fields : Map[String, @types.Field] = Map([])
      let methods : Map[String, Array[@types.Sig]] = Map([])
      for m in members {
        match m {
          TMMethod(name~, ..) => {
            let sigs = methods.get(name).unwrap_or([])
            sigs.push(self.to_sig_member(m, tvars, report))
            methods[name] = sigs
          }
          TMProperty(name~, optional~, read_only~, value~, ..) =>
            fields[name] = { ty: to(value), optional, read_only, }
          TMIndex(..) => ()
        }
      }
      RecordT(name=None, fields~, methods~, mutable=false, deep=true, ns=None)
    }
  }
}

///|
fn Host::to_sig_node(
  self : Host,
  node : @ast.TypeNode,
  tvars : Array[String],
  report : (@ast.Span, String) -> Unit,
) -> @types.Sig {
  let (type_params, params, result) = match node {
    TFunction(type_params~, params~, result~, ..) =>
      (type_params, params, result)
    _ => ([], [], node)
  }
  self.sig_of(type_params, params, result, tvars, report)
}

///|
fn Host::sig_of(
  self : Host,
  type_params : Array[String],
  params : Array[@ast.TypeParam],
  result : @ast.TypeNode,
  tvars : Array[String],
  report : (@ast.Span, String) -> Unit,
) -> @types.Sig {
  let vars = [..tvars, ..type_params]
  {
    type_params,
    params: params.map(p => {
      name: p.name,
      ty: self.to_type(p.value, vars, report),
      optional: p.optional,
      rest: p.rest,
    }),
    result: self.to_type(result, vars, report),
  }
}

///|
/// A method member of an object type as a signature.
fn Host::to_sig_member(
  self : Host,
  m : @ast.TypeMember,
  tvars : Array[String],
  report : (@ast.Span, String) -> Unit,
) -> @types.Sig {
  match m {
    TMMethod(type_params~, params~, result~, ..) =>
      self.sig_of(type_params, params, result, tvars, report)
    _ => { type_params: [], params: [], result: UnknownT, }
  }
}

///|
/// What a named type is: a record (with the ref's mutability), a handle, or
/// what it aliases.
pub fn Host::resolve(self : Host, r : @types.Ty) -> @types.Ty {
  guard r is RefT(name~, mutable~) else { return r }
  guard self.named.get(name) is Some(entry) else { return UnknownT }
  let ty = match entry.ty {
    Some(t) => t
    None => {
      let t = self.to_type(entry.node, [], (_, _) => ())
      let t = match (entry.kind, t) {
        (Handle, RecordT(fields~, methods~, ..)) =>
          @types.HandleT(name~, fields~, methods~)
        (Record, RecordT(fields~, methods~, mutable~, deep~, ..)) =>
          RecordT(name=Some(name), fields~, methods~, mutable~, deep~, ns=None)
        _ => t
      }
      entry.ty = Some(t)
      t
    }
  }
  if ty is HandleT(..) {
    ty
  } else {
    @types.with_mut(ty, mutable)
  }
}

///|
/// A member's type: its signatures (overloads) as one function type.
fn Host::member_type(self : Host, m : MemberDecl) -> @types.Ty {
  match m.ty {
    Some(t) => t
    None => {
      let tys = m.nodes.map(n => self.to_type(n, [], (_, _) => ()))
      let t = if tys.iter().all(t => t is FnT(_)) {
        @types.FnT(
          tys.map(t => if t is FnT(sigs) { sigs } else { [] }).flatten(),
        )
      } else {
        tys[0]
      }
      m.ty = Some(t)
      t
    }
  }
}

///|
/// What a program's free name is in this host.
pub fn Host::binding(self : Host, name : String) -> Binding? {
  let f = self.functions.get(name)
  if self.modules.contains(name) {
    return Some(ModuleBinding(name, call=f.map(m => self.member_type(m))))
  }
  match f {
    Some(m) => Some(FunctionBinding(name, self.member_type(m)))
    None => None
  }
}

///|
pub fn Host::find_member(
  self : Host,
  module_name : String,
  name : String,
) -> Member? {
  match self.modules.get(module_name) {
    Some(ms) =>
      match ms.get(name) {
        Some(m) => Some({ qualified: m.qualified, ty: self.member_type(m), })
        None => None
      }
    None => None
  }
}

///|
pub fn Host::names(self : Host) -> Array[String] {
  let out = self.modules.keys().collect()
  for k, _ in self.functions {
    if !out.contains(k) {
      out.push(k)
    }
  }
  out
}

///|
pub fn Host::is_nondeterministic(self : Host, qualified : String) -> Bool {
  self.nondeterministic.contains(qualified)
}

///|
pub fn Host::is_fresh(self : Host, qualified : String) -> Bool {
  self.fresh.contains(qualified)
}

///|
/// A type's source as a type of this host, for entry signatures.
pub fn Host::type_of(self : Host, src : String) -> @types.Ty raise Failure {
  let errors = []
  let t = self.to_type(parse_decl(src, "the signature's type"), [], (_, m) => {
    errors.push(m)
  })
  if errors.length() > 0 {
    fail(errors.join("; "))
  }
  t
}
