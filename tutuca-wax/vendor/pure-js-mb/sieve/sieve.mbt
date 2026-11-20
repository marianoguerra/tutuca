// The sieve, as the reference's lib/sieve.js: whether a parsed program uses
// only the forms its profile admits. One walk, each node's feature looked up in
// the table, with the rules of where a form may appear: an arrow only as a
// call's argument, an assignment only as a statement, a statement only if it
// does something.

///|
/// The features a profile enables: the core ones and those it adds (module
/// adds those of let, destructuring and forOf too).
pub fn profile_features(
  profile : String,
) -> Array[@tables.Feature] raise Failure {
  if !@tables.profiles.contains(profile) {
    fail(
      "there is no profile \{profile} in this version of pure-js (there is \{@tables.profiles.join(", ")})",
    )
  }
  let adds = if profile == "module" {
    ["module", "let", "destructuring", "forOf"]
  } else {
    [profile]
  }
  @tables.all_features.filter(f => {
    f.status() is Core ||
    (
      f.status() is Omitted &&
      (match f.profile() {
        Some(p) => adds.contains(p)
        None => false
      })
    )
  })
}

///|
priv struct Sieve {
  enabled : Array[@tables.Feature]
  diagnostics : Array[@diag.Diagnostic]
  /// The let names in scope, innermost last, for assignments to names.
  lets : Array[Array[String]]
  /// The spans of the object literals that are a module's namespaces.
  namespaces : Array[@ast.Span]
}

///|
fn Sieve::is_let(self : Sieve, name : String) -> Bool {
  self.lets.iter().any(s => s.contains(name))
}

///|
fn Sieve::use_(self : Sieve, f : @tables.Feature, at : @ast.Span) -> Unit {
  if self.enabled.contains(f) {
    return
  }
  self.diagnostics.push(@diag.excluded(f, Sieve, at.start, at.end))
}

///|
fn Sieve::name(self : Sieve, id : @ast.Ident) -> Unit {
  if id.name.has_prefix("$") {
    self.use_(DollarName, id.span)
  }
}

///|
fn Sieve::property_name(self : Sieve, name : String, at : @ast.Span) -> Unit {
  if @tables.is_reserved(name) {
    self.use_(ReservedName, at)
  }
}

///|
fn Sieve::function(self : Sieve, f : @ast.Func) -> Unit {
  self.lets.push([])
  if f.this_type is Some(t) {
    self.use_(ThisParameter, t.span())
    self.type_(t)
  }
  for p in f.params {
    self.param(p)
  }
  match f.return_type {
    Some(t) => self.type_(t)
    None => ()
  }
  match f.body {
    BlockBody(b) => self.statements(b.body)
    ExprBody(e) => self.expression(e, Other)
  }
  ignore(self.lets.pop())
}

///|
/// A parameter: a name, or an array pattern of names (and holes).
fn Sieve::param(self : Sieve, p : @ast.Pattern) -> Unit {
  match p {
    PIdent(id) => self.name(id)
    PArray(elements~, span~, ..) => {
      self.use_(ArrayPatternParam, span)
      for e in elements {
        match e {
          None => ()
          Some(PIdent(id)) => self.name(id)
          Some(other) => self.pattern(other, Some(NestedPattern))
        }
      }
    }
    _ => self.pattern(p, None)
  }
  match p.ann() {
    Some(t) => self.type_(t)
    None => ()
  }
}

///|
/// A pattern where the profile may not admit one; feature names what it is there.
fn Sieve::pattern(
  self : Sieve,
  p : @ast.Pattern,
  feature : @tables.Feature?,
) -> Unit {
  match p {
    PIdent(id) => self.name(id)
    PArray(elements~, span~, ..) => {
      match feature {
        Some(f) => self.use_(f, span)
        None => ()
      }
      for e in elements {
        if e is Some(x) {
          self.pattern(x, Some(NestedPattern))
        }
      }
    }
    PObject(props~, span~, ..) => {
      self.use_(feature.unwrap_or(ObjectPattern), span)
      for prop in props {
        match prop {
          PPRest(arg~, span~) => {
            self.use_(RestElement, span)
            self.name(arg)
          }
          PPProp(key~, value~, ..) => {
            if key is KComputed(k) {
              self.use_(ComputedKey, k.span())
            }
            self.pattern(value, Some(NestedPattern))
          }
        }
      }
    }
    PRest(arg~, span~, ..) => {
      self.use_(RestElement, span)
      self.pattern(arg, Some(NestedPattern))
    }
    PAssign(left~, right~, span~) => {
      self.use_(DefaultValue, span)
      self.pattern(left, None)
      self.expression(right, Other)
    }
  }
}

///|
fn Sieve::statements(self : Sieve, list : Array[@ast.Stmt]) -> Unit {
  for s in list {
    self.statement(s)
  }
}

///|
fn Sieve::statement(self : Sieve, s : @ast.Stmt) -> Unit {
  match s {
    VarDecl(kind~, decls~, span~) => {
      self.use_(
        if kind == "const" {
          ConstDeclaration
        } else {
          LetDeclaration
        },
        span,
      )
      if decls.length() > 1 {
        self.use_(MultipleDeclarators, span)
      }
      for d in decls {
        if kind == "let" && self.lets.length() > 0 {
          for n in d.id.bound_names() {
            self.lets[self.lets.length() - 1].push(n)
          }
        }
        match d.id {
          PIdent(id) => self.name(id)
          other => self.pattern(other, Some(DestructuringDeclaration))
        }
        match d.id.ann() {
          Some(t) => self.type_(t)
          None => ()
        }
        match d.init {
          Some(e) => self.expression(e, Other)
          None => ()
        }
      }
    }
    ExprStmt(e, span~, ..) => {
      self.use_(ExpressionStatement, span)
      let effect = match e {
        Call(..) | Assign(..) | Update(..) | Chain(Call(..), ..) => true
        _ => false
      }
      self.expression(e, Statement)
      if !effect {
        self.use_(UselessExpression, span)
      }
    }
    If(cond~, cons~, alt~, span~) => {
      self.use_(IfStatement, span)
      self.expression(cond, Other)
      self.statement(cons)
      if alt is Some(a) {
        self.statement(a)
      }
    }
    BlockStmt(b) => {
      self.use_(BlockStatement, b.span)
      self.lets.push([])
      self.statements(b.body)
      ignore(self.lets.pop())
    }
    Return(arg, span~) => {
      self.use_(ReturnStatement, span)
      if arg is Some(e) {
        self.expression(e, Other)
      }
    }
    ForOf(left~, right~, body~, span~) => {
      self.use_(ForOfStatement, span)
      self.statement(left)
      self.expression(right, Other)
      self.statement(body)
    }
    Break(span) | Continue(span) => self.use_(LoopControl, span)
    Try(block~, handler~, finalizer~, span~) => {
      self.use_(TryStatement, span)
      self.statement(BlockStmt(block))
      match handler {
        Some(h) => {
          if h.param is Some(p) {
            self.pattern(p, None)
          }
          self.statement(BlockStmt(h.body))
        }
        None => ()
      }
      if finalizer is Some(f) {
        self.statement(BlockStmt(f))
      }
    }
    Throw(e, span~) => {
      self.use_(ThrowStatement, span)
      self.expression(e, Other)
    }
  }
}

///|
/// Where an expression is, as far as the rules care: a list method's callback
/// (the first argument of xs.map(...), the only place an arrow may be), an
/// expression statement, a function's body, anywhere else.
priv enum Place {
  Callback
  Statement
  Other
}

///|
fn Sieve::expression(self : Sieve, e : @ast.Expr, place : Place) -> Unit {
  match e {
    Ident(id) => {
      self.use_(Identifier, id.span)
      self.name(id)
    }
    Lit(v, span~, ..) =>
      self.use_(
        match v {
          LNull => NullLiteral
          LStr(_) => StringLiteral
          LNum(_) => NumberLiteral
          LBool(_) => BooleanLiteral
        },
        span,
      )
    Template(exprs~, span~, ..) => {
      self.use_(TemplateLiteral, span)
      for x in exprs {
        self.expression(x, Other)
      }
    }
    This(span) => self.use_(This, span)
    ArrayLit(elements, span~) => {
      self.use_(ArrayLiteral, span)
      for el in elements {
        match el {
          None => self.use_(ArrayHole, span)
          Some(x) => self.expression(x, Other)
        }
      }
    }
    ObjectLit(members, span~) => {
      self.use_(ObjectLiteral, span)
      let in_namespace = self.namespaces.contains(span)
      for m in members {
        match m {
          Method(key~, func~, span~, ..) => {
            self.use_(
              if in_namespace {
                NamespaceMethod
              } else {
                ObjectMethod
              },
              span,
            )
            match key {
              KIdent(id) => self.property_name(id.name, id.span)
              KLit(LStr(s), span~, ..) => self.property_name(s, span)
              _ => ()
            }
            self.function(func)
          }
          SpreadMember(arg, span~) => {
            self.use_(Spread, span)
            self.expression(arg, Other)
          }
          Prop(key~, value~, ..) => {
            match key {
              KComputed(k) => {
                self.use_(ComputedKey, k.span())
                self.expression(k, Other)
              }
              KLit(LNum(_), span~, ..) => self.use_(NumericKey, span)
              KLit(LStr(s), span~, ..) => self.property_name(s, span)
              KLit(_, span~, ..) => self.use_(NumericKey, span)
              KIdent(id) => self.property_name(id.name, id.span)
            }
            if in_namespace && value is ObjectLit(_, span=vspan) {
              self.namespaces.push(vspan)
            }
            self.expression(value, Other)
          }
        }
      }
    }
    Spread(arg, span~) => {
      self.use_(Spread, span)
      self.expression(arg, Other)
    }
    Member(object~, property~, computed~, optional~, span~) => {
      if computed {
        self.use_(ComputedMember, span)
        self.expression(property, Other)
      } else {
        self.use_(if optional { OptionalMember } else { Member }, span)
        if property is Ident(id) {
          self.property_name(id.name, id.span)
        }
      }
      self.expression(object, Other)
    }
    Chain(inner, ..) => {
      // Indexing inside an optional chain would have to short-circuit through
      // the runtime's guard: left for a later version.
      let mut link = inner
      while true {
        match link {
          Member(object~, computed~, span~, ..) => {
            if computed {
              self.use_(OptionalComputedMember, span)
            }
            link = object
          }
          Call(callee~, ..) => link = callee
          _ => break
        }
      }
      self.expression(inner, Other)
    }
    Call(callee~, args~, optional~, span~) => {
      self.use_(if optional { OptionalCall } else { Call }, span)
      self.expression(callee, Other)
      let takes_callback = callee
        is Member(computed=false, property=Ident({ name, .. }), ..) &&
        @tables.is_callback_method(name)
      for i, a in args {
        self.expression(
          a,
          if i == 0 && takes_callback {
            Callback
          } else {
            Other
          },
        )
      }
    }
    Arrow(f) => {
      if place is Callback {
        self.use_(CallbackArrow, f.span)
      } else {
        self.use_(ArrowNotCallback, f.span)
      }
      if f.body is BlockBody(_) {
        self.use_(BlockArrow, f.span)
      }
      if f.return_type is Some(t) {
        self.use_(ArrowReturnType, t.span())
      }
      self.function(f)
    }
    Unary(op~, arg~, span~) => {
      self.use_(@tables.unary_feature(op).unwrap(), span)
      self.expression(arg, Other)
    }
    Update(arg~, span~, ..) => {
      self.use_(Update, span)
      self.expression(arg, Other)
    }
    Binary(op~, left~, right~, span~) | Logical(op~, left~, right~, span~) => {
      self.use_(@tables.operator_feature(op).unwrap(), span)
      self.expression(left, Other)
      self.expression(right, Other)
    }
    Cond(cond~, cons~, alt~, span~) => {
      self.use_(Conditional, span)
      self.expression(cond, Other)
      self.expression(cons, Other)
      self.expression(alt, Other)
    }
    Assign(op~, left~, right~, span~) => {
      if !(place is Statement) {
        self.use_(AssignmentExpression, span)
      }
      self.use_(
        @tables.assignment_feature(op).unwrap_or(CompoundAssignment),
        span,
      )
      match left {
        Ident(id) =>
          self.use_(
            if self.is_let(id.name) {
              LetAssignment
            } else {
              Reassignment
            },
            id.span,
          )
        Member(computed=true, ..) if op != "=" =>
          self.use_(ComputedCompoundAssignment, span)
        _ => ()
      }
      self.expression(left, Other)
      self.expression(right, Other)
    }
  }
}

///|
fn Sieve::type_(self : Sieve, t : @ast.TypeNode) -> Unit {
  self.use_(TypeAnnotation, t.span())
  match t {
    TKeyword(name, span) =>
      match @tables.type_keyword_feature(name) {
        Some(f) => self.use_(f, span)
        None => ()
      }
    TLiteral(_, _) => ()
    TArray(e, _) => self.type_(e)
    TTuple(es, _) =>
      for e in es {
        self.type_(e)
      }
    TUnion(ts, _) =>
      for u in ts {
        self.type_(u)
      }
    TObject(members, _) =>
      for m in members {
        match m {
          TMMethod(span~, ..) => self.use_(MethodType, span)
          TMIndex(key~, value~, ..) => {
            if !(key is TKeyword("string", _)) {
              self.use_(TypeKeyword, key.span())
            }
            self.type_(value)
          }
          TMProperty(name~, read_only~, value~, span~, ..) => {
            if read_only {
              self.use_(ReadonlyType, span)
            }
            self.property_name(name, span)
            self.type_(value)
          }
        }
      }
    TRef(name, args, span) =>
      if name == "Readonly" && args.length() == 1 {
        self.use_(ReadonlyType, span)
        self.type_(args[0])
      } else if args.length() > 0 {
        self.use_(GenericType, span)
      }
    TFunction(span~, ..) => self.use_(FunctionType, span)
    TReadonly(operand, span) => {
      self.use_(ReadonlyType, span)
      self.type_(operand)
    }
  }
}

///|
/// The diagnostics of the forms in program that profile doesn't admit.
pub fn sieve(
  program : @ast.Program,
  profile~ : String = "core",
) -> Array[@diag.Diagnostic] raise Failure {
  let s : Sieve = {
    enabled: profile_features(profile),
    diagnostics: [],
    lets: [],
    namespaces: [],
  }
  s.use_(
    match program.form {
      FunctionForm => FunctionProgram
      MethodForm => MethodProgram
      GetterForm => GetterProgram
      ArrowForm => ArrowProgram
    },
    program.span,
  )
  s.function(program.func)
  s.diagnostics
}

///|
/// The diagnostics of the forms in a module that profile doesn't admit: a
/// top-level const's object literal is a namespace, whose methods and getters
/// (and those of the object literals it holds) are entries.
pub fn sieve_module(
  m : @ast.Module,
  profile~ : String = "core",
) -> Array[@diag.Diagnostic] raise Failure {
  let s : Sieve = {
    enabled: profile_features(profile),
    diagnostics: [],
    lets: [],
    namespaces: [],
  }
  s.use_(ModuleProgram, m.span)
  for item in m.items {
    let d = match item {
      Export(d, span~) => {
        s.use_(ExportDeclaration, span)
        d
      }
      d => d
    }
    match d {
      Import(specs~, span~, ..) => {
        s.use_(ImportDeclaration, span)
        for sp in specs {
          s.name(sp.local_)
        }
      }
      Const(VarDecl(decls~, ..) as stmt) => {
        for x in decls {
          if x.init is Some(ObjectLit(_, span~)) {
            s.namespaces.push(span)
          }
        }
        s.statement(stmt)
      }
      Const(stmt) => s.statement(stmt)
      FunctionDecl(f) => {
        s.use_(HelperFunction, f.span)
        if f.id is Some(id) {
          s.name(id)
        }
        s.function(f)
      }
      TypeAlias(value~, span~, ..) => {
        s.use_(TypeAlias, span)
        s.type_(value)
      }
      Interface(body~, span~, ..) => {
        s.use_(InterfaceDeclaration, span)
        s.type_(body)
      }
      Export(_, ..) => ()
    }
  }
  s.diagnostics
}
