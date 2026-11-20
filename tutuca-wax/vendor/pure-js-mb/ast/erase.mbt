///|
/// The program without its type annotations: the JavaScript it stands for.
pub fn Program::erase(self : Program) -> Program {
  { ..self, func: erase_func(self.func), }
}

///|
fn erase_func(f : Func) -> Func {
  {
    ..f,
    params: f.params.map(erase_pattern),
    this_type: None,
    return_type: None,
    body: match f.body {
      BlockBody(b) => BlockBody(erase_block(b))
      ExprBody(e) => ExprBody(erase_expr(e))
    },
  }
}

///|
fn erase_block(b : Block) -> Block {
  { ..b, body: b.body.map(erase_stmt), }
}

///|
fn erase_ident(id : Ident) -> Ident {
  { ..id, ann: None, }
}

///|
fn erase_pattern(p : Pattern) -> Pattern {
  match p {
    PIdent(id) => PIdent(erase_ident(id))
    PArray(elements~, span~, ..) =>
      PArray(elements=elements.map(e => e.map(erase_pattern)), ann=None, span~)
    PObject(props~, span~, ..) =>
      PObject(
        props=props.map(prop => {
          match prop {
            PPProp(key~, value~, shorthand~, span~) =>
              PPProp(
                key=erase_key(key),
                value=erase_pattern(value),
                shorthand~,
                span~,
              )
            PPRest(..) => prop
          }
        }),
        ann=None,
        span~,
      )
    PRest(arg~, span~, ..) => PRest(arg=erase_pattern(arg), ann=None, span~)
    PAssign(left~, right~, span~) =>
      PAssign(left=erase_pattern(left), right=erase_expr(right), span~)
  }
}

///|
fn erase_key(k : PropKey) -> PropKey {
  match k {
    KComputed(e) => KComputed(erase_expr(e))
    _ => k
  }
}

///|
fn erase_expr(e : Expr) -> Expr {
  match e {
    Arrow(f) => Arrow(erase_func(f))
    Template(quasis~, exprs~, span~) =>
      Template(quasis~, exprs=exprs.map(erase_expr), span~)
    ArrayLit(es, span~) => ArrayLit(es.map(x => x.map(erase_expr)), span~)
    ObjectLit(ms, span~) =>
      ObjectLit(
        ms.map(m => {
          match m {
            Prop(key~, value~, shorthand~, span~) =>
              Prop(
                key=erase_key(key),
                value=erase_expr(value),
                shorthand~,
                span~,
              )
            SpreadMember(x, span~) => SpreadMember(erase_expr(x), span~)
            Method(key~, func~, getter~, span~) =>
              Method(key~, func=erase_func(func), getter~, span~)
          }
        }),
        span~,
      )
    Member(object~, property~, computed~, optional~, span~) =>
      Member(
        object=erase_expr(object),
        property=erase_expr(property),
        computed~,
        optional~,
        span~,
      )
    Call(callee~, args~, optional~, span~) =>
      Call(
        callee=erase_expr(callee),
        args=args.map(erase_expr),
        optional~,
        span~,
      )
    Spread(x, span~) => Spread(erase_expr(x), span~)
    Chain(x, span~) => Chain(erase_expr(x), span~)
    Unary(op~, arg~, span~) => Unary(op~, arg=erase_expr(arg), span~)
    Update(op~, prefix~, arg~, span~) =>
      Update(op~, prefix~, arg=erase_expr(arg), span~)
    Binary(op~, left~, right~, span~) =>
      Binary(op~, left=erase_expr(left), right=erase_expr(right), span~)
    Logical(op~, left~, right~, span~) =>
      Logical(op~, left=erase_expr(left), right=erase_expr(right), span~)
    Assign(op~, left~, right~, span~) =>
      Assign(op~, left=erase_expr(left), right=erase_expr(right), span~)
    Cond(cond~, cons~, alt~, span~) =>
      Cond(
        cond=erase_expr(cond),
        cons=erase_expr(cons),
        alt=erase_expr(alt),
        span~,
      )
    Ident(_) | This(_) | Lit(_, ..) => e
  }
}

///|
fn erase_stmt(s : Stmt) -> Stmt {
  match s {
    VarDecl(kind~, decls~, span~) =>
      VarDecl(
        kind~,
        decls=decls.map(d => {
          ..d,
          id: erase_pattern(d.id),
          init: d.init.map(erase_expr),
        }),
        span~,
      )
    ExprStmt(e, directive~, span~) => ExprStmt(erase_expr(e), directive~, span~)
    If(cond~, cons~, alt~, span~) =>
      If(
        cond=erase_expr(cond),
        cons=erase_stmt(cons),
        alt=alt.map(erase_stmt),
        span~,
      )
    BlockStmt(b) => BlockStmt(erase_block(b))
    Return(arg, span~) => Return(arg.map(erase_expr), span~)
    ForOf(left~, right~, body~, span~) =>
      ForOf(
        left=erase_stmt(left),
        right=erase_expr(right),
        body=erase_stmt(body),
        span~,
      )
    Try(block~, handler~, finalizer~, span~) =>
      Try(
        block=erase_block(block),
        handler=handler.map(h => {
          ..h,
          param: h.param.map(erase_pattern),
          body: erase_block(h.body),
        }),
        finalizer=finalizer.map(erase_block),
        span~,
      )
    Throw(e, span~) => Throw(erase_expr(e), span~)
    Break(_) | Continue(_) => s
  }
}

///|
/// The module without its types: its type items and type imports go, and the
/// rest lose their annotations.
pub fn Module::erase(self : Module) -> Module {
  { ..self, items: self.items.filter(i => !i.is_type_item()).map(erase_item), }
}

///|
fn erase_item(i : Item) -> Item {
  match i {
    Export(d, span~) => Export(erase_item(d), span~)
    Const(s) => Const(erase_stmt(s))
    FunctionDecl(f) => FunctionDecl(erase_func(f))
    _ => i
  }
}
