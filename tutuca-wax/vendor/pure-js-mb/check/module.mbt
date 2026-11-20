// Modules, as the reference's lib/module.js: a program of declarations. A
// module declares types (aliases and interfaces), constants, helper functions
// and namespaces, and imports what other modules export and what the host
// offers by specifier. Functions are never values: a helper is called by
// name, a namespace's methods and getters are entries the embedder calls
// (with a signature it gives for each, by path). The calls between functions
// are known from the tree, so a cycle of them is rejected and every run still
// ends; constants are made in the order they're written.

///|
/// An entry of a module: a namespace's method or getter, by path.
pub(all) struct ModuleEntry {
  path : Array[String]
  getter : Bool
  func : @ast.Func
  return_type : String
}

///|
/// A helper's summary: its parameters (name, type, whether it may change
/// them), its result, and whether that is fresh.
pub(all) struct Summary {
  params : Array[(String, String, Bool)]
  result : String
  fresh : Bool
}

///|
/// What checking a module gives.
pub struct ModuleChecked {
  diagnostics : Array[@diag.Diagnostic]
  entries : Array[ModuleEntry]
  /// The exported types' names, and the exported values' bindings.
  exported_types : Array[String]
  exported_values : Map[String, Binding]
  /// This module's types and those it reaches, by name.
  type_nodes : Array[(String, @ast.TypeNode)]
  /// The typed tree, in the order the reference records it.
  types : Map[String, TypeEntry]
  /// Each helper's callees, in the order they're first called.
  call_graph : Array[(String, Array[String])]
  summaries : Array[(String, Summary)]
  host : @host.Host
}

///|
/// Whether an object literal holds methods or getters, itself or in the
/// object literals it holds: a namespace.
pub fn is_namespace_literal(e : @ast.Expr) -> Bool {
  match e {
    ObjectLit(members, ..) =>
      members
      .iter()
      .any(m => {
        match m {
          Method(..) => true
          Prop(value~, ..) => is_namespace_literal(value)
          _ => false
        }
      })
    _ => false
  }
}

///|
fn prop_name(k : @ast.PropKey) -> String {
  match k {
    KIdent(id) => id.name
    KLit(LStr(s), ..) => s
    KLit(_, raw~, ..) => raw
    KComputed(_) => ""
  }
}

///|
/// The entries of a namespace literal, by path.
pub fn entries_of(
  literal : @ast.Expr,
  prefix : Array[String],
) -> Array[(Array[String], Bool, @ast.Func)] {
  let out = []
  guard literal is ObjectLit(members, ..) else { return out }
  for m in members {
    match m {
      Method(key~, func~, getter~, ..) =>
        out.push(([..prefix, prop_name(key)], getter, func))
      Prop(key~, value~, ..) if is_namespace_literal(value) =>
        out.push_iter(entries_of(value, [..prefix, prop_name(key)]).iter())
      _ => ()
    }
  }
  out
}

///|
/// The Identifier nodes under an expression or a function's body that name
/// one of names, in the reference's walk order; a namespace's entries aren't
/// walked.
fn refs_in_expr(
  e : @ast.Expr,
  names : Array[String],
  out : Array[@ast.Ident],
) -> Unit {
  match e {
    Ident(id) => if names.contains(id.name) { out.push(id) }
    This(_) | Lit(_, ..) => ()
    Template(exprs~, ..) =>
      for x in exprs {
        refs_in_expr(x, names, out)
      }
    ArrayLit(es, ..) =>
      for x in es {
        if x is Some(y) {
          refs_in_expr(y, names, out)
        }
      }
    ObjectLit(ms, ..) =>
      for m in ms {
        match m {
          Prop(key~, value~, ..) => {
            if key is KComputed(k) {
              refs_in_expr(k, names, out)
            }
            refs_in_expr(value, names, out)
          }
          SpreadMember(x, ..) => refs_in_expr(x, names, out)
          Method(..) => ()
        }
      }
    Member(object~, property~, computed~, ..) => {
      refs_in_expr(object, names, out)
      if computed {
        refs_in_expr(property, names, out)
      }
    }
    Call(callee~, args~, ..) => {
      refs_in_expr(callee, names, out)
      for x in args {
        refs_in_expr(x, names, out)
      }
    }
    Spread(x, ..) | Chain(x, ..) | Unary(arg=x, ..) | Update(arg=x, ..) =>
      refs_in_expr(x, names, out)
    Binary(left~, right~, ..)
    | Logical(left~, right~, ..)
    | Assign(left~, right~, ..) => {
      refs_in_expr(left, names, out)
      refs_in_expr(right, names, out)
    }
    Cond(cond~, cons~, alt~, ..) => {
      refs_in_expr(cond, names, out)
      refs_in_expr(cons, names, out)
      refs_in_expr(alt, names, out)
    }
    Arrow(f) => refs_in_func(f, names, out)
  }
}

///|
fn refs_in_pattern(
  p : @ast.Pattern,
  names : Array[String],
  out : Array[@ast.Ident],
) -> Unit {
  match p {
    PIdent(id) => if names.contains(id.name) { out.push(id) }
    PArray(elements~, ..) =>
      for e in elements {
        if e is Some(x) {
          refs_in_pattern(x, names, out)
        }
      }
    PObject(props~, ..) =>
      for prop in props {
        match prop {
          PPProp(key~, value~, ..) => {
            if key is KComputed(k) {
              refs_in_expr(k, names, out)
            }
            refs_in_pattern(value, names, out)
          }
          PPRest(arg~, ..) => if names.contains(arg.name) { out.push(arg) }
        }
      }
    PRest(arg~, ..) => refs_in_pattern(arg, names, out)
    PAssign(left~, right~, ..) => {
      refs_in_pattern(left, names, out)
      refs_in_expr(right, names, out)
    }
  }
}

///|
fn refs_in_stmt(
  s : @ast.Stmt,
  names : Array[String],
  out : Array[@ast.Ident],
) -> Unit {
  match s {
    VarDecl(decls~, ..) =>
      for d in decls {
        refs_in_pattern(d.id, names, out)
        if d.init is Some(e) {
          refs_in_expr(e, names, out)
        }
      }
    ExprStmt(e, ..) => refs_in_expr(e, names, out)
    If(cond~, cons~, alt~, ..) => {
      refs_in_expr(cond, names, out)
      refs_in_stmt(cons, names, out)
      if alt is Some(a) {
        refs_in_stmt(a, names, out)
      }
    }
    BlockStmt(b) =>
      for x in b.body {
        refs_in_stmt(x, names, out)
      }
    Return(arg, ..) => if arg is Some(e) { refs_in_expr(e, names, out) }
    ForOf(left~, right~, body~, ..) => {
      refs_in_stmt(left, names, out)
      refs_in_expr(right, names, out)
      refs_in_stmt(body, names, out)
    }
    Try(block~, handler~, finalizer~, ..) => {
      for x in block.body {
        refs_in_stmt(x, names, out)
      }
      if handler is Some(h) {
        if h.param is Some(p) {
          refs_in_pattern(p, names, out)
        }
        for x in h.body.body {
          refs_in_stmt(x, names, out)
        }
      }
      if finalizer is Some(b) {
        for x in b.body {
          refs_in_stmt(x, names, out)
        }
      }
    }
    Throw(e, ..) => refs_in_expr(e, names, out)
    Break(_) | Continue(_) => ()
  }
}

///|
fn refs_in_func(
  f : @ast.Func,
  names : Array[String],
  out : Array[@ast.Ident],
) -> Unit {
  if f.id is Some(id) && names.contains(id.name) {
    out.push(id)
  }
  for p in f.params {
    refs_in_pattern(p, names, out)
  }
  match f.body {
    ExprBody(x) => refs_in_expr(x, names, out)
    BlockBody(b) =>
      for x in b.body {
        refs_in_stmt(x, names, out)
      }
  }
}

///|
priv struct ConstItem {
  id : @ast.Ident
  init : @ast.Expr
  index : Int32
}

///|
priv struct ModuleChecker {
  m : @ast.Module
  src : String
  base_host : @host.Host
  resolve : ((String) -> String?)?
  signature_of : (Array[String]) -> Signature?
  data_type_of : (Array[String]) -> String?
  deterministic : Bool
  cache : Map[String, ModuleChecked]
  visiting : Array[String]
  diagnostics : Array[@diag.Diagnostic]
  type_table : Map[String, TypeEntry]
  type_nodes : Array[(String, @ast.TypeNode)]
  exported_types : Array[String]
  exported : Array[String]
  imported : Array[(String, Binding)]
  consts : Array[ConstItem]
  helpers : Array[@ast.Func]
  local_types : Array[(@ast.Ident, @ast.TypeNode)]
  call_graph : Array[(String, Array[String])]
  summaries : Array[(String, Summary)]
  mut host : @host.Host
  scope : Scope
  mut checker : Checker?
}

///|
fn ModuleChecker::report(
  self : ModuleChecker,
  code : @diag.CheckCode,
  at : @ast.Span,
  message : String,
) -> Unit {
  self.diagnostics.push(
    @diag.Diagnostic::new(Check(code), Check, message, at.start, at.end),
  )
}

///|
fn helper_name(f : @ast.Func) -> String {
  match f.id {
    Some(id) => id.name
    None => ""
  }
}

///|
fn ModuleChecker::collect(self : ModuleChecker) -> Unit {
  for item in self.m.items {
    let exported = item is Export(_, ..)
    match item.declaration() {
      Import(..) as d => self.import_from(d)
      TypeAlias(id~, value~, ..) => {
        self.local_types.push((id, value))
        if exported {
          self.exported_types.push(id.name)
        }
      }
      Interface(id~, body~, ..) => {
        self.local_types.push((id, body))
        if exported {
          self.exported_types.push(id.name)
        }
      }
      Const(VarDecl(decls~, ..)) =>
        for d in decls {
          match (d.id, d.init) {
            (PIdent(id), Some(init)) => {
              self.consts.push({ id, init, index: self.consts.length(), })
              if exported {
                self.exported.push(id.name)
              }
            }
            _ =>
              self.report(
                ModulePattern,
                d.id.span(),
                "a module's const names one value: const name = ...;",
              )
          }
        }
      FunctionDecl(f) => {
        self.helpers.push(f)
        if exported {
          self.exported.push(helper_name(f))
        }
      }
      _ => ()
    }
  }
}

///|
fn ModuleChecker::add_type_node(
  self : ModuleChecker,
  name : String,
  node : @ast.TypeNode,
  at : @ast.Span,
) -> Unit {
  match self.type_nodes.search_by(e => e.0 == name) {
    Some(i) =>
      if self.type_nodes[i].1 != node {
        self.report(
          TypeNameClash,
          at,
          "two modules declare a type \{name}: types share one namespace",
        )
      }
    None => self.type_nodes.push((name, node))
  }
}

///|
fn ModuleChecker::import_from(self : ModuleChecker, d : @ast.Item) -> Unit {
  guard d is Import(type_only~, specs~, source~, source_span~, ..) else {
    return
  }
  let spec = source
  match self.base_host.import_module(spec) {
    Some(hm) => {
      if type_only {
        self.report(
          UnknownImport,
          source_span,
          "\{@types.json_string(spec)} is the host's: it offers values, not types",
        )
        return
      }
      for sp in specs {
        match self.base_host.find_member(hm, sp.imported.name) {
          None =>
            self.report(
              UnknownImport,
              sp.imported.span,
              "\{@types.json_string(spec)} has no \{sp.imported.name}",
            )
          Some(m) =>
            self.imported.push(
              (
                sp.local_.name,
                {
                  ..plain_binding("import", m.ty, "value"),
                  qualified: Some(m.qualified),
                },
              ),
            )
        }
      }
      return
    }
    None => ()
  }
  guard self.import_module(spec, source_span) is Some(sub) else { return }
  for e in sub.type_nodes {
    self.add_type_node(e.0, e.1, source_span)
  }
  for sp in specs {
    let name = sp.imported.name
    if type_only {
      if !sub.exported_types.contains(name) {
        self.report(
          UnknownImport,
          sp.imported.span,
          "\{@types.json_string(spec)} exports no type \{name}",
        )
        continue
      }
      if sp.local_.name != name {
        self.add_type_node(sp.local_.name, TRef(name, [], sp.span), sp.span)
      }
      continue
    }
    match sub.exported_values.get(name) {
      None =>
        self.report(
          UnknownImport,
          sp.imported.span,
          "\{@types.json_string(spec)} exports no \{name}",
        )
      Some(b) =>
        self.imported.push(
          (
            sp.local_.name,
            { ..b, qualified: Some(b.qualified.unwrap_or("\{spec}#\{name}")), },
          ),
        )
    }
  }
}

///|
fn ModuleChecker::import_module(
  self : ModuleChecker,
  spec : String,
  at : @ast.Span,
) -> ModuleChecked? {
  guard self.resolve is Some(resolve) else {
    self.report(
      UnknownImport,
      at,
      "nothing says where \{@types.json_string(spec)} is: the embedder resolves imports",
    )
    return None
  }
  match self.cache.get(spec) {
    Some(c) => return Some(c)
    None => ()
  }
  if self.visiting.contains(spec) {
    self.report(
      ImportCycle,
      at,
      "\{@types.json_string(spec)} imports this module back",
    )
    return None
  }
  guard resolve(spec) is Some(text) else {
    self.report(
      UnknownImport,
      at,
      "there is no module \{@types.json_string(spec)}",
    )
    return None
  }
  let parsed = @parser.parse_module(text)
  let first = match parsed {
    Err(d) => Some(d)
    Ok(sub) => {
      let inner = @sieve.sieve_module(sub, profile="module") catch { _ => [] }
      inner.get(0)
    }
  }
  if first is Some(d) {
    self.report(
      ImportError,
      at,
      "\{@types.json_string(spec)} doesn't check: \{d.message}",
    )
    return None
  }
  guard parsed is Ok(sub_module) else { return None }
  self.visiting.push(spec)
  let sub = check_module_with(
    sub_module,
    self.base_host,
    self.resolve,
    _ => None,
    _ => None,
    self.deterministic,
    self.cache,
    self.visiting,
  )
  ignore(self.visiting.pop())
  if sub.diagnostics.get(0) is Some(d) {
    self.report(
      ImportError,
      at,
      "\{@types.json_string(spec)} doesn't check: \{d.message}",
    )
  }
  self.cache[spec] = sub
  Some(sub)
}

///|
/// The host this module's code is checked against: the embedder's, with the
/// module's types (and those of the modules it imports).
fn ModuleChecker::build_host(self : ModuleChecker) -> @host.Host {
  for lt in self.local_types {
    let (id, node) = lt
    if self.base_host.has_type(id.name) {
      self.report(
        TypeNameClash,
        id.span,
        "the host already has a type \{id.name}",
      )
      continue
    }
    self.add_type_node(id.name, node, id.span)
  }
  let host = self.base_host.with_type_nodes(self.type_nodes)
  for lt in self.local_types {
    let (id, node) = lt
    let mut bad = false
    ignore(
      host.to_type(node, [], (at, message) => {
        bad = true
        self.report(UnknownType, at, message)
      }),
    )
    if bad {
      host.forget_type(id.name)
    }
  }
  host
}

///|
fn ModuleChecker::make_checker(
  self : ModuleChecker,
  program : @ast.Program,
  signature? : Signature,
) -> Checker {
  new_checker(
    program,
    self.host,
    signature,
    self.deterministic,
    outer=self.scope,
    type_table=self.type_table,
    module_function=true,
  )
}

///|
fn ModuleChecker::program_of(
  self : ModuleChecker,
  form : @ast.Form,
  name : String?,
  f : @ast.Func,
) -> @ast.Program {
  { form, name, func: f, span: f.span, source: self.src, }
}

///|
/// Whether a parameter of type t may be changed: a container, or a named type
/// that is one (or a union holding one), not Readonly. An alias of strings or
/// numbers can't be.
fn ModuleChecker::is_mutable(
  self : ModuleChecker,
  t : Ty,
  seen : Array[String],
) -> Bool {
  match t {
    UnionT(ts) => ts.iter().any(m => self.is_mutable(m, seen))
    _ if !t.top_mut() => false
    RefT(name~, ..) =>
      if seen.contains(name) {
        true
      } else {
        seen.push(name)
        let r = self.host.resolve(t)
        r is HandleT(..) || self.is_mutable(r, seen)
      }
    _ => t.is_container()
  }
}

///|
fn param_of(
  p : @ast.Pattern,
  i : Int32,
  type_of : (@ast.TypeNode) -> Ty,
) -> @types.Param {
  let target = match p {
    PAssign(left~, ..) => left
    _ => p
  }
  let (rest, node) = match p {
    PRest(ann~, ..) => (true, ann)
    _ => (false, target.ann())
  }
  let name = match (target, p) {
    (PIdent(id), _) => id.name
    (_, PRest(arg=PIdent(id), ..)) => id.name
    _ => "arg\{i}"
  }
  {
    name,
    ty: match node {
      Some(n) => type_of(n)
      None => UnknownT
    },
    optional: p is PAssign(..),
    rest,
  }
}

///|
/// A helper's type before its body is checked: what its annotations say.
fn ModuleChecker::provisional(self : ModuleChecker, f : @ast.Func) -> Binding {
  let quiet = (node : @ast.TypeNode) => {
    @types.with_mut(
      self.host.to_type(node, [], (_, _) => ()),
      !is_readonly_node(node),
    )
  }
  let params = f.params.mapi((i, p) => param_of(p, i, quiet))
  let result = match f.return_type {
    Some(n) => quiet(n)
    None => UnknownT
  }
  {
    ..plain_binding(
      "helper",
      FnT([{ type_params: [], params, result, }]),
      "value",
    ),
    qualified: Some(helper_name(f)),
    mut_params: Some(
      params.filter(p => self.is_mutable(p.ty, [])).map(p => p.name),
    ),
  }
}

///|
/// The order consts and helpers are checked in: what each refers to first. A
/// cycle of helpers is a recursion; one through a const, a const that needs
/// itself.
fn ModuleChecker::order(self : ModuleChecker) -> Array[(Bool, Int32)] {
  // name -> (is a const, index in consts or helpers)
  let names : Map[String, (Bool, Int32)] = Map([])
  for c in self.consts {
    names[c.id.name] = (true, c.index)
  }
  for i, h in self.helpers {
    names[helper_name(h)] = (false, i)
  }
  let keys = names.keys().collect()
  let refs : Map[String, Array[@ast.Ident]] = Map([])
  for name, n in names {
    let ids = []
    if n.0 {
      refs_in_expr(self.consts[n.1].init, keys, ids)
    } else {
      match self.helpers[n.1].body {
        ExprBody(x) => refs_in_expr(x, keys, ids)
        BlockBody(b) =>
          for x in b.body {
            refs_in_stmt(x, keys, ids)
          }
      }
    }
    refs[name] = ids
    if !n.0 {
      let callees = []
      for id in ids {
        if names[id.name].0 == false && !callees.contains(id.name) {
          callees.push(id.name)
        }
      }
      self.call_graph.push((name, callees))
    }
  }
  let out = []
  let state : Map[String, Bool] = Map([]) // false: visiting, true: done
  let stack = []
  fn visit(name : String) -> Unit {
    match state.get(name) {
      Some(true) => return
      Some(false) => {
        let from_index = stack.search(name).unwrap_or(0)
        let cycle = stack[from_index:].to_owned()
        let all_helpers = cycle.iter().all(c => names[c].0 == false)
        let from = cycle[cycle.length() - 1]
        let at = refs[from].iter().find_first(i => i.name == name).unwrap().span
        let path = [..cycle, name]
        if all_helpers {
          self.report(
            RecursiveCall,
            at,
            "\{path.join(" calls ")}: the functions of a module can't call themselves, so every run ends",
          )
        } else {
          self.report(
            ConstCycle,
            at,
            "\{path.join(" needs ")}: a const can't need itself",
          )
        }
        return
      }
      None => ()
    }
    state[name] = false
    stack.push(name)
    for id in refs[name] {
      visit(id.name)
    }
    ignore(stack.pop())
    state[name] = true
    out.push(names[name])
  }

  for name in keys {
    visit(name)
  }
  self.const_order(names, refs)
  out
}

///|
/// A const is made when its line runs, as in JavaScript: what its value needs
/// (itself, or through the functions it calls) must be made before it.
fn ModuleChecker::const_order(
  self : ModuleChecker,
  names : Map[String, (Bool, Int32)],
  refs : Map[String, Array[@ast.Ident]],
) -> Unit {
  for c in self.consts {
    let seen = []
    let pending = refs[c.id.name].map(id => (id, id))
    while pending.pop() is Some((id, via)) {
      let n = names[id.name]
      if n.0 {
        if n.1 >= c.index {
          self.report(
            ConstOrder,
            via.span,
            if n.1 == c.index {
              "\{c.id.name} needs itself to be made"
            } else {
              "\{c.id.name} needs \{id.name}, which is declared after it: move \{id.name} up"
            },
          )
        }
        continue
      }
      if seen.contains(id.name) {
        continue
      }
      seen.push(id.name)
      for next in refs[id.name] {
        pending.push((next, via))
      }
    }
  }
}

///|
fn ModuleChecker::check_helper(self : ModuleChecker, f : @ast.Func) -> Unit {
  let name = helper_name(f)
  if f.this_type is Some(t) {
    self.report(
      HelperThis,
      t.span(),
      "\{name} is called by name, so nothing gives it a this: pass what it needs as a parameter",
    )
  }
  let c = self.make_checker(self.program_of(FunctionForm, Some(name), f))
  let result = c.run()
  self.diagnostics.push_iter(c.diagnostics.iter())
  let params = f.params.mapi((i, p) => {
    param_of(p, i, node => c.quietly(() => c.declared_type(node)).0)
  })
  let declared_result = f.return_type.map(n => {
    c.quietly(() => c.declared_type(n)).0
  })
  // Fresh: every value it returns is made in it, all the way down.
  let fresh = c.return_modes.iter().any(m => m == "fresh") &&
    c.return_types.iter().all(t => @types.is_primitive(t) || c.may_change(t)) &&
    !(match f.return_type {
      Some(n) => is_readonly_node(n)
      None => false
    })
  let mut_params = params
    .filter(p => self.is_mutable(p.ty, []))
    .map(p => p.name)
  let result_t = declared_result.unwrap_or(result)
  self.scope.names[name] = {
    ..plain_binding(
      "helper",
      FnT([
        { type_params: [], params, result: @types.with_mut(result_t, false), },
      ]),
      "value",
    ),
    qualified: Some(name),
    fresh,
    mut_params: Some(mut_params),
  }
  self.summaries.push(
    (
      name,
      {
        params: params.map(p => {
          (p.name, show(p.ty), mut_params.contains(p.name))
        }),
        result: show(result_t),
        fresh,
      },
    ),
  )
}

///|
fn ModuleChecker::check_const(self : ModuleChecker, c : ConstItem) -> Unit {
  guard self.checker is Some(checker) else { return }
  let n0 = checker.diagnostics.length()
  let t = if is_namespace_literal(c.init) {
    if c.id.ann is Some(ann) {
      self.report(
        NamespaceAnnotation,
        ann.span(),
        "a namespace's type is what it holds: it takes no annotation",
      )
    }
    self.namespace_type(checker, c.init, [c.id.name])
  } else {
    match c.id.ann {
      Some(node) => {
        let ann = checker.annotation(node, false)
        let v = checker.value(c.init, Env::new(), Some(ann))
        if !checker.assignable(v, ann) {
          checker.error(
            NotAssignable,
            c.init.span(),
            "\{show(v)} is not \{show(ann)}",
          )
        }
        @types.with_mut(ann, false)
      }
      None =>
        if c.init is ObjectLit(members, ..) &&
          self.typed_members(members, [c.id.name]) {
          @types.with_mut(
            self.data_record(checker, members, [c.id.name]),
            false,
          )
        } else {
          @types.with_mut(checker.value(c.init, Env::new(), None), false)
        }
    }
  }
  for i in n0..<checker.diagnostics.length() {
    self.diagnostics.push(checker.diagnostics[i])
  }
  while checker.diagnostics.length() > n0 {
    ignore(checker.diagnostics.pop())
  }
  let is_ns = t is RecordT(ns=Some(_), ..)
  self.scope.names[c.id.name] = plain_binding(
    if is_ns {
      "namespace"
    } else {
      "const"
    },
    t,
    if is_ns {
      "value"
    } else {
      "read"
    },
  )
  checker.record("Identifier", c.id.span, t, "read", None)
}

///|
/// A namespace's type: a record of its data members, read-only, that knows
/// its entries are there but can't be read or called.
fn ModuleChecker::namespace_type(
  self : ModuleChecker,
  checker : Checker,
  literal : @ast.Expr,
  path : Array[String],
) -> Ty {
  let fields : Map[String, @types.Field] = Map([])
  let entries = []
  guard literal is ObjectLit(members, ..) else { return UnknownT }
  for m in members {
    match m {
      SpreadMember(_, span~) =>
        self.report(
          NamespaceSpread,
          span,
          "a namespace lists its members: it can't spread another value in",
        )
      Method(key~, ..) => entries.push(prop_name(key))
      Prop(key~, value~, ..) => {
        let name = prop_name(key)
        let t = if is_namespace_literal(value) {
          self.namespace_type(checker, value, [..path, name])
        } else {
          @types.with_mut(
            self.data_value(checker, value, [..path, name]),
            false,
          )
        }
        fields[name] = { ty: t, optional: false, read_only: true, }
      }
    }
  }
  RecordT(
    name=None,
    fields~,
    methods=Map([]),
    mutable=false,
    deep=true,
    ns=Some({ path: path.join("."), entries, }),
  )
}

///|
/// Whether the embedder types any member of a const's object literal.
fn ModuleChecker::typed_members(
  self : ModuleChecker,
  members : Array[@ast.ObjMember],
  path : Array[String],
) -> Bool {
  members
  .iter()
  .any(m => {
    match m {
      Prop(key~, ..) if !(key is KComputed(_)) =>
        (self.data_type_of)([..path, prop_name(key)]) is Some(_)
      _ => false
    }
  })
}

///|
/// A const's object literal whose members the embedder types: a record of
/// what they are.
fn ModuleChecker::data_record(
  self : ModuleChecker,
  checker : Checker,
  members : Array[@ast.ObjMember],
  path : Array[String],
) -> Ty {
  let fields : Map[String, @types.Field] = Map([])
  for m in members {
    match m {
      Prop(key~, value~, ..) if !(key is KComputed(_)) => {
        let name = prop_name(key)
        fields[name] = {
          ty: @types.widen(self.data_value(checker, value, [..path, name])),
          optional: false,
          read_only: false,
        }
      }
      Prop(value~, ..) => ignore(checker.value(value, Env::new(), None))
      SpreadMember(x, ..) => ignore(checker.value(x, Env::new(), None))
      Method(..) => ()
    }
  }
  RecordT(
    name=None,
    fields~,
    methods=Map([]),
    mutable=true,
    deep=false,
    ns=None,
  )
}

///|
/// A namespace's data member: of the type the embedder gives for its path,
/// when it gives one.
fn ModuleChecker::data_value(
  self : ModuleChecker,
  checker : Checker,
  node : @ast.Expr,
  path : Array[String],
) -> Ty {
  match (self.data_type_of)(path) {
    None => checker.value(node, Env::new(), None)
    Some(text) => {
      let expected = checker.entry_type(Some(plain(text))).unwrap_or(UnknownT)
      let v = checker.value(node, Env::new(), Some(expected))
      if !checker.assignable(v, expected) {
        checker.error(
          NotAssignable,
          node.span(),
          "\{path.join(".")} is \{show(expected)}; this is \{show(v)}",
        )
      }
      v
    }
  }
}

///|
fn ModuleChecker::check_entry(
  self : ModuleChecker,
  path : Array[String],
  getter : Bool,
  f : @ast.Func,
) -> ModuleEntry {
  let signature = (self.signature_of)(path)
  let program = self.program_of(
    if getter {
      GetterForm
    } else {
      MethodForm
    },
    Some(path[path.length() - 1]),
    f,
  )
  let c = self.make_checker(program, signature?)
  let result = c.run()
  self.diagnostics.push_iter(c.diagnostics.iter())
  { path, getter, func: f, return_type: show(result), }
}

///|
fn ModuleChecker::run(self : ModuleChecker) -> ModuleChecked {
  self.collect()
  self.host = self.build_host()
  for imp in self.imported {
    self.scope.names[imp.0] = imp.1
  }
  // Every const and helper is a name from the start, so a reference checks
  // whatever order the declarations come in.
  for c in self.consts {
    self.scope.names[c.id.name] = plain_binding("const", NeverT, "read")
  }
  for h in self.helpers {
    self.scope.names[helper_name(h)] = self.provisional(h)
  }
  let dummy : @ast.Func = {
    id: None,
    this_type: None,
    params: [],
    body: BlockBody({ body: [], span: self.m.span, }),
    return_type: None,
    arrow: false,
    decl: false,
    span: self.m.span,
  }
  self.checker = Some(
    self.make_checker(self.program_of(FunctionForm, None, dummy)),
  )
  for n in self.order() {
    if n.0 {
      self.check_const(self.consts[n.1])
    } else {
      self.check_helper(self.helpers[n.1])
    }
  }
  let entries = []
  for c in self.consts {
    if !is_namespace_literal(c.init) {
      continue
    }
    for e in entries_of(c.init, [c.id.name]) {
      entries.push(self.check_entry(e.0, e.1, e.2))
    }
  }
  let values : Map[String, Binding] = Map([])
  for name in self.exported {
    match self.scope.names.get(name) {
      Some(b) => values[name] = b
      None => ()
    }
  }
  {
    diagnostics: self.diagnostics,
    entries,
    exported_types: self.exported_types,
    exported_values: values,
    type_nodes: self.type_nodes,
    types: self.type_table,
    call_graph: self.call_graph,
    summaries: self.summaries,
    host: self.host,
  }
}

///|
fn check_module_with(
  m : @ast.Module,
  host : @host.Host,
  resolve : ((String) -> String?)?,
  signature_of : (Array[String]) -> Signature?,
  data_type_of : (Array[String]) -> String?,
  deterministic : Bool,
  cache : Map[String, ModuleChecked],
  visiting : Array[String],
) -> ModuleChecked {
  let mc : ModuleChecker = {
    m,
    src: m.source,
    base_host: host,
    resolve,
    signature_of,
    data_type_of,
    deterministic,
    cache,
    visiting,
    diagnostics: [],
    type_table: Map([]),
    type_nodes: [],
    exported_types: [],
    exported: [],
    imported: [],
    consts: [],
    helpers: [],
    local_types: [],
    call_graph: [],
    summaries: [],
    host,
    scope: { parent: None, names: Map([]), },
    checker: None,
  }
  mc.run()
}

///|
/// Checks a parsed module against a host: resolve gives another module's
/// source by specifier, signature_of the signature of the entry at a path,
/// data_type_of the type (TypeScript text) of a namespace's data member.
pub fn check_module(
  m : @ast.Module,
  host : @host.Host,
  resolve? : (String) -> String?,
  signature_of~ : (Array[String]) -> Signature? = _ => None,
  data_type_of~ : (Array[String]) -> String? = _ => None,
  deterministic~ : Bool = false,
) -> ModuleChecked {
  check_module_with(
    m,
    host,
    resolve,
    signature_of,
    data_type_of,
    deterministic,
    Map([]),
    [],
  )
}
