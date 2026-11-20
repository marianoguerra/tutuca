// Lowering: a pure-tutuca module's functions as the Wax the naming
// convention asks for (c_on_m, c_get_g, c_query_q), from pure-js's checked
// tree and its typed tree. Values are tutuca-wax's (pure-tutuca's are
// JavaScript's): a number is an f64 (an s32 field's i32 converted at its
// edges), a boolean an i32, a string a js_string, anything else a &value.
//
// - next is a loc per field the handler may write, and the state is made
//   again from them when one was written; a write through a draft (next.x,
//   an alias of a part of it) is a persistent update of the place it names.
// - A callback is inlined as a loop over the list, as Wax has no closures; a
//   return in it, and break and continue in a for-of, set a flag the
//   statements after them check, so every exit is structured.
// - Indexing reads what JavaScript reads (undefined past the end).

///|
#derive(Eq)
priv enum Repr {
  F64
  Bool
  Str
  Val
}

///|
fn repr_of_wax(t : String) -> Repr {
  match t {
    "f64" => F64
    "i32" => Bool
    "js_string" => Str
    _ => Val
  }
}

///|
fn repr_of_ty(t : @check.Ty) -> Repr {
  match t {
    F64 => F64
    Bool => Bool
    Str | Enum(_) => Str
    _ => Val
  }
}

///|
/// What a value of a pure-js type is held as.
fn repr_of_js(t : @types.Ty) -> Repr {
  match t {
    NumberT | LitT(LNum(_)) => F64
    BooleanT | LitT(LBool(_)) => Bool
    StringT | LitT(LStr(_)) => Str
    UnionT(ts) =>
      if ts.iter().all(u => u is (StringT | LitT(LStr(_)))) {
        Str
      } else if ts.iter().all(u => u is (BooleanT | LitT(LBool(_)))) {
        Bool
      } else {
        Val
      }
    _ => Val
  }
}

///|
/// A lowered expression: its Wax text and what it holds.
priv struct Low {
  code : String
  repr : Repr
}

///|
/// A step of a draft place below its field: a record's field, a list's
/// element (an i32 index), a dictionary's key.
priv enum Step {
  SField(String)
  SIndex(String)
  SKey(String)
}

///|
/// What a name is in lowered code.
priv enum Local {
  Plain(String, Repr)
  /// A part of next: its field's loc and the steps below it.
  Alias(String, Array[Step])
  /// next itself.
  Next
  /// The handler's ctx.
  CtxName
  /// init's ctx: it makes components, and nothing else.
  InitCtxName
  /// A component's state, its Wax local (this, and a condition's prev and
  /// next): its fields are struct fields, its queries getters.
  StateVar(String)
}

///|
priv struct Lower {
  path : String
  src : String
  ch : @purejs.ModuleChecked
  strings : Map[String, String]
  string_order : Array[String]
  diags : Array[@diag.Diagnostic]
  mut temp : Int32
  helpers : Array[String]
  /// The module's helpers: their parameters' and result's representations.
  helper_sigs : Map[String, (Array[Repr], Repr)]
  /// What the module imports from host modules (not tutuca/view): local
  /// name, module and member.
  host_imports : Map[String, (String, String)]
  /// The page's host modules: their calls go through host_call, and what
  /// they return is checked against its declared type.
  pages : Array[HostModule]
  /// The pl_fits_<n> functions written, by the type text they check.
  fits_fns : Map[String, String]
  /// The module's constants that are literals (a string, a number, a
  /// negative number, a boolean): read as their value.
  consts : Map[String, @ast.Expr]
  /// Every constant of the module, by name: a path one holds is its literal.
  decl_consts : Map[String, @ast.Expr]
}

///|
fn Lower::str_const(self : Lower, text : String) -> String {
  match self.strings.get(text) {
    Some(n) => n
    None => {
      let n = "pl_s\{self.string_order.length()}"
      self.strings[text] = n
      self.string_order.push(text)
      n
    }
  }
}

///|
fn Lower::fresh(self : Lower, base : String) -> String {
  self.temp += 1
  "pl_\{base}\{self.temp}"
}

///|
fn Lower::unsupported(self : Lower, at : @ast.Span, what : String) -> Unit {
  self.diags.push(
    @diag.error(
      "pure.lower.unsupported",
      span_of(self.path, self.src, at),
      "tutuca-wax can't compile \{what} yet",
    ),
  )
}

///|
/// What the typed tree says of a node.
fn Lower::js_type(self : Lower, e : @ast.Expr) -> @types.Ty? {
  let kind = match e {
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
  let s = e.span()
  self.ch.types.get("\{s.start}:\{s.end}:\{kind}").map(x => x.ty)
}

///|
fn Lower::repr_of(self : Lower, e : @ast.Expr) -> Repr {
  match self.js_type(e) {
    Some(t) => repr_of_js(t)
    None => Val
  }
}

///|
fn box_(l : Low) -> String {
  match l.repr {
    F64 => "value_number(\{l.code})"
    Bool => "value_bool(\{l.code})"
    Str => "value_string(\{l.code})"
    Val => l.code
  }
}

///|
/// l as r: boxed, unboxed or converted.
fn Lower::as_(self : Lower, l : Low, r : Repr) -> String {
  if l.repr == r {
    return l.code
  }
  match (l.repr, r) {
    (_, Val) => box_(l)
    (Val, F64) => "value_to_f64(\{l.code})"
    (Val, Bool) | (F64, Bool) | (Str, Bool) => "value_truthy(\{box_(l)})"
    (Val, Str) => "pl_string_of(\{l.code})"
    _ => {
      ignore(self)
      box_(l)
    }
  }
}

///|
/// A lowering context: the names in scope, the statements written, and the
/// flags that end the statements after a return in a callback, a break or a
/// continue.
priv struct Ctx {
  scope : Map[String, Local]
  out : Array[String]
  mut indent : String
  /// The component, its fields' locals (for next), and whether the handler
  /// writes next.
  comp : @check.ComponentM?
  cw : String
  /// What a return does: return the state (a handler), return a value (a
  /// getter, a helper), or set a callback's result.
  ret : RetMode
  /// The flags that, set, skip the statements after (a callback's return, a
  /// loop's break and continue).
  exits : Array[String]
  /// The loop's break and continue flags, innermost.
  mut brk : String?
  mut cont : String?
}

///|
priv enum RetMode {
  ReturnState
  /// A swap's run: what it returns is the component it becomes, nothing
  /// keeps it (and what next has).
  ReturnSwap
  /// An ask handler: what it returns is the ask's ok answer.
  ReturnOk(Repr)
  ReturnValue(Repr)
  /// A scope's or an enrich's binds: what it returns, a record, as the
  /// binds struct (its name, and its members' names and reprs).
  ReturnBinds(String, Array[(String, Repr)])
  SetResult(String, String, Repr) // result var, flag var, repr
}

///|
fn Ctx::emit(self : Ctx, line : String) -> Unit {
  self.out.push("\{self.indent}\{line}")
}

///|
fn Ctx::child(self : Ctx) -> Ctx {
  {
    scope: self.scope.copy(),
    out: self.out,
    indent: self.indent,
    comp: self.comp,
    cw: self.cw,
    ret: self.ret,
    exits: self.exits.copy(),
    brk: self.brk,
    cont: self.cont,
  }
}

///|
fn Lower::field_repr(self : Lower, ctx : Ctx, name : String) -> Repr {
  ignore(self)
  match ctx.comp {
    Some(c) =>
      match c.fields.search_by(f => f.name == name) {
        Some(i) => repr_of_ty(c.fields[i].ty)
        None => Val
      }
    None => Val
  }
}

///|
fn Lower::is_get(self : Lower, ctx : Ctx, name : String) -> @check.FieldM? {
  ignore(self)
  match ctx.comp {
    Some(c) =>
      match c.gets.search_by(g => g.name == name) {
        Some(i) => Some(c.gets[i])
        None => None
      }
    None => None
  }
}

///|
fn next_local(field : String) -> String {
  "pl_next_\{field}"
}

///|
/// Reads a place: a field's loc and the steps below it.
fn Lower::read_place(
  self : Lower,
  root : String,
  steps : ArrayView[Step],
) -> String {
  ignore(self)
  let mut code = root
  for s in steps {
    code = match s {
      SField(n) => "pl_member(\{code}, \{self.str_const(n)})"
      SIndex(i) => "pl_list_get(\{code}, \{i})"
      SKey(k) => "pl_member(\{code}, \{k})"
    }
  }
  code
}

///|
/// The value of root with what is at steps set to v.
fn Lower::write_place(
  self : Lower,
  root : String,
  steps : ArrayView[Step],
  v : String,
) -> String {
  match steps {
    [] => v
    [s, .. rest] => {
      let inner = match s {
        SField(n) => "pl_member(\{root}, \{self.str_const(n)})"
        SIndex(i) => "pl_list_get(\{root}, \{i})"
        SKey(k) => "pl_member(\{root}, \{k})"
      }
      let updated = self.write_place(inner, rest, v)
      match s {
        SField(n) => "map_assoc(\{root}, \{self.str_const(n)}, \{updated})"
        SIndex(i) => "pl_list_set(\{root}, \{i}, \{updated})"
        SKey(k) => "map_assoc(\{root}, \{k}, \{updated})"
      }
    }
  }
}

///|
/// Where a draft's part is, when e names one: next.f..., or an alias's.
fn Lower::place(
  self : Lower,
  ctx : Ctx,
  e : @ast.Expr,
) -> (String, Array[Step])? {
  match e {
    Ident(id) =>
      match ctx.scope.get(id.name) {
        Some(Alias(field, steps)) => Some((field, steps))
        _ => None
      }
    Member(object~, property~, computed~, ..) =>
      match object {
        Ident(id) if ctx.scope.get(id.name) is Some(Next) && !computed =>
          match property {
            Ident(p) => Some((p.name, []))
            _ => None
          }
        _ =>
          match self.place(ctx, object) {
            Some((f, steps)) =>
              if !computed {
                match property {
                  Ident(p) => Some((f, [..steps, SField(p.name)]))
                  _ => None
                }
              } else {
                let k = self.expr(ctx, property)
                let step = match k.repr {
                  Str => {
                    let t = self.fresh("k")
                    ctx.emit("let \{t} = \{k.code};")
                    SKey(t)
                  }
                  _ => {
                    let t = self.fresh("i")
                    ctx.emit("let \{t} = pl_index(\{self.as_(k, F64)});")
                    SIndex(t)
                  }
                }
                Some((f, [..steps, step]))
              }
            None => None
          }
      }
    _ => None
  }
}

///|
fn Lower::mark_dirty(self : Lower, ctx : Ctx) -> Unit {
  ignore(self)
  ctx.emit("pl_dirty = 1;")
}

///|
/// Writes v (a &value, or the field's repr at the root) to a place.
fn Lower::assign_place(
  self : Lower,
  ctx : Ctx,
  field : String,
  steps : Array[Step],
  v : Low,
) -> Unit {
  let loc = next_local(field)
  if steps.is_empty() {
    ctx.emit("\{loc} = \{self.as_(v, self.field_repr(ctx, field))};")
  } else {
    let root = self.as_({ code: loc, repr: self.field_repr(ctx, field), }, Val)
    let updated = self.write_place(root, steps[:], box_(v))
    let back = self.as_(
      { code: updated, repr: Val, },
      self.field_repr(ctx, field),
    )
    ctx.emit("\{loc} = \{back};")
  }
  self.mark_dirty(ctx)
}

///|
fn binop_code(op : String, a : String, b : String) -> String {
  "(\{a} \{op} \{b})"
}

///|
fn Lower::lit(self : Lower, l : @ast.Lit) -> Low {
  match l {
    LNull => { code: "value_null()", repr: Val, }
    LBool(b) => { code: if b { "1" } else { "0" }, repr: Bool, }
    LNum(n) => {
      let text = if n == n.floor() && n.abs() < 1.0e15 {
        "\{n.to_int64()}.0"
      } else {
        n.to_string()
      }
      { code: text, repr: F64, }
    }
    LStr(s) => { code: self.str_const(s), repr: Str, }
  }
}

///|
/// An expression; its statements written to ctx first, as control flow needs.
fn Lower::expr(self : Lower, ctx : Ctx, e : @ast.Expr) -> Low {
  match e {
    Lit(l, ..) => self.lit(l)
    Ident(id) =>
      if id.name == "undefined" && ctx.scope.get("undefined") is None {
        { code: "value_undefined()", repr: Val, }
      } else {
        match ctx.scope.get(id.name) {
          Some(Plain(name, r)) => { code: name, repr: r, }
          Some(Alias(f, steps)) =>
            if steps.is_empty() {
              { code: next_local(f), repr: self.field_repr(ctx, f), }
            } else {
              {
                code: self.read_place(
                  self.as_(
                    { code: next_local(f), repr: self.field_repr(ctx, f), },
                    Val,
                  ),
                  steps[:],
                ),
                repr: Val,
              }
            }
          None if self.consts.get(id.name) is Some(value) =>
            self.expr(ctx, value)
          _ => {
            self.unsupported(id.span, "\{id.name} as a value")
            { code: "value_undefined()", repr: Val, }
          }
        }
      }
    Template(quasis~, exprs~, ..) => {
      let mut code = self.str_const(quasis[0].cooked)
      for i, x in exprs {
        let l = self.expr(ctx, x)
        let text = match l.repr {
          Str => l.code
          F64 => "number_text(\{l.code})"
          Bool =>
            "(\{l.code} ? \{self.str_const("true")} : \{self.str_const("false")})"
          Val => "pl_text(\{l.code})"
        }
        code = "js_string_concat(\{code}, \{text})"
        let q = quasis[i + 1].cooked
        if q != "" {
          code = "js_string_concat(\{code}, \{self.str_const(q)})"
        }
      }
      { code, repr: Str, }
    }
    Member(object~, property~, computed~, span~, ..) =>
      self.member_expr(ctx, e, object, property, computed, span)
    Chain(inner, ..) => self.expr(ctx, inner)
    Call(..) => self.call(ctx, e)
    Unary(op~, arg~, span~) =>
      match op {
        "!" => {
          let a = self.expr(ctx, arg)
          { code: "!\{self.as_(a, Bool)}", repr: Bool, }
        }
        "-" => {
          let a = self.expr(ctx, arg)
          { code: "(0.0 - \{self.as_(a, F64)})", repr: F64, }
        }
        // typeof v: JavaScript's word for what v is (pl_typeof).
        "typeof" => {
          let a = self.expr(ctx, arg)
          { code: "pl_typeof(\{box_(a)})", repr: Str, }
        }
        _ => {
          self.unsupported(span, "the operator \{op}")
          { code: "value_undefined()", repr: Val, }
        }
      }
    Binary(op~, left~, right~, span~) => self.binary(ctx, op, left, right, span)
    Logical(op~, left~, right~, ..) => self.logical(ctx, e, op, left, right)
    Cond(cond~, cons~, alt~, ..) => {
      let r = self.repr_of(e)
      let t = self.fresh("c")
      let cond_v = self.expr(ctx, cond)
      ctx.emit("let \{t} = \{self.default_of(r)};")
      ctx.emit("if \{self.as_(cond_v, Bool)} {")
      let inner = ctx.child()
      inner.indent = ctx.indent + "    "
      let a = self.expr(inner, cons)
      inner.emit("\{t} = \{self.as_(a, r)};")
      ctx.emit("} else {")
      let b = self.expr(inner, alt)
      inner.emit("\{t} = \{self.as_(b, r)};")
      ctx.emit("}")
      { code: t, repr: r, }
    }
    ArrayLit(es, span~) => {
      let t = self.fresh("l")
      ctx.emit("let \{t} = list_empty();")
      for x in es {
        match x {
          Some(Spread(arg, ..)) => {
            let src = self.expr(ctx, arg)
            let i = self.fresh("i")
            ctx.emit("let \{i} = 0;")
            ctx.emit("while \{i} <s list_count(\{src.code}) {")
            ctx.emit(
              "    \{t} = list_push(\{t}, list_get(\{src.code}, \{i})!);",
            )
            ctx.emit("    \{i} += 1;")
            ctx.emit("}")
          }
          Some(x) => {
            let l = self.expr(ctx, x)
            ctx.emit("\{t} = list_push(\{t}, \{box_(l)});")
          }
          None => self.unsupported(span, "a hole in a list")
        }
      }
      { code: t, repr: Val, }
    }
    ObjectLit(ms, span~) => {
      let t = self.fresh("o")
      ctx.emit("let \{t} = map_empty();")
      for m in ms {
        match m {
          Prop(key~, value~, ..) => {
            let l = self.expr(ctx, value)
            ctx.emit(
              "\{t} = map_assoc(\{t}, \{self.str_const(key_name(key))}, \{box_(l)});",
            )
          }
          SpreadMember(arg, ..) => {
            let src = self.expr(ctx, arg)
            let keys = self.fresh("ks")
            let i = self.fresh("i")
            ctx.emit("let \{keys} = map_keys(\{src.code});")
            ctx.emit("let \{i} = 0;")
            ctx.emit("while \{i} <s list_count(\{keys}) {")
            ctx.emit("    let pl_key = pl_string_of(list_get(\{keys}, \{i})!);")
            ctx.emit(
              "    \{t} = map_assoc(\{t}, pl_key, map_get(\{src.code}, pl_key)!);",
            )
            ctx.emit("    \{i} += 1;")
            ctx.emit("}")
          }
          Method(..) => self.unsupported(span, "a method in an object")
        }
      }
      { code: t, repr: Val, }
    }
    _ => {
      self.unsupported(e.span(), "this expression")
      { code: "value_undefined()", repr: Val, }
    }
  }
}

///|
fn Lower::default_of(self : Lower, r : Repr) -> String {
  match r {
    F64 => "0.0"
    Bool => "0"
    Str => self.str_const("")
    Val => "value_undefined()"
  }
}

///|
fn Lower::member_expr(
  self : Lower,
  ctx : Ctx,
  e : @ast.Expr,
  object : @ast.Expr,
  property : @ast.Expr,
  computed : Bool,
  span : @ast.Span,
) -> Low {
  let r = self.repr_of(e)
  // this.f (or prev.f, next.f in a condition): a field of the state, or a
  // query.
  let state_var = match object {
    This(_) => ctx.scope.get("this")
    Ident(id) => ctx.scope.get(id.name)
    _ => None
  }
  if state_var is Some(CtxName) && !computed && property is Ident(p) {
    match p.name {
      "sourceKey" => {
        let v : Low = { code: "pl_source_key(ctx)", repr: Val, }
        return { code: self.as_(v, r), repr: r, }
      }
      "drag" => {
        let v : Low = { code: "ctx.drag", repr: Val, }
        return { code: self.as_(v, r), repr: r, }
      }
      // An answer's handler: the id its ask returned.
      "request" => {
        let v : Low = { code: "(ctx.request as f64_s)", repr: F64, }
        return { code: self.as_(v, r), repr: r, }
      }
      _ => self.unsupported(span, "ctx.\{p.name} as a value")
    }
  }
  if state_var is Some(StateVar(sv)) && !computed && property is Ident(p) {
    match self.is_get(ctx, p.name) {
      Some(g) =>
        return {
          code: "\{ctx.cw}_get_\{g.name}(\{sv})",
          repr: repr_of_ty(g.ty),
        }
      None => ()
    }
    let fr = self.field_repr(ctx, p.name)
    let code = "\{sv}.\{@check.wax(p.name)}"
    return { code, repr: fr, }
  }
  // A draft's part: read where it is.
  match self.place(ctx, e) {
    Some((f, steps)) =>
      if steps.is_empty() {
        return { code: next_local(f), repr: self.field_repr(ctx, f), }
      } else {
        let root = self.as_(
          { code: next_local(f), repr: self.field_repr(ctx, f), },
          Val,
        )
        let v : Low = { code: self.read_place(root, steps[:]), repr: Val, }
        return { code: self.as_(v, r), repr: r, }
      }
    None => ()
  }
  let o = self.expr(ctx, object)
  if !computed && property is Ident(p) {
    if p.name == "length" {
      return match o.repr {
        Str => { code: "(js_string_length(\{o.code}) as f64_s)", repr: F64, }
        _ => { code: "pl_length(\{box_(o)})", repr: F64, }
      }
    }
    let v : Low = {
      code: "pl_member(\{box_(o)}, \{self.str_const(p.name)})",
      repr: Val,
    }
    return { code: self.as_(v, r), repr: r, }
  }
  if computed {
    let k = self.expr(ctx, property)
    let v : Low = match k.repr {
      Str => { code: "pl_member(\{box_(o)}, \{k.code})", repr: Val, }
      _ => { code: "pl_index_get(\{box_(o)}, \{self.as_(k, F64)})", repr: Val, }
    }
    return { code: self.as_(v, r), repr: r, }
  }
  self.unsupported(span, "this member")
  { code: "value_undefined()", repr: Val, }
}

///|
fn Lower::binary(
  self : Lower,
  ctx : Ctx,
  op : String,
  left : @ast.Expr,
  right : @ast.Expr,
  span : @ast.Span,
) -> Low {
  let a = self.expr(ctx, left)
  let b = self.expr(ctx, right)
  match op {
    "+" =>
      if a.repr == Str || b.repr == Str {
        {
          code: "js_string_concat(\{self.as_(a, Str)}, \{self.as_(b, Str)})",
          repr: Str,
        }
      } else {
        {
          code: binop_code("+", self.as_(a, F64), self.as_(b, F64)),
          repr: F64,
        }
      }
    "-" | "*" | "/" =>
      { code: binop_code(op, self.as_(a, F64), self.as_(b, F64)), repr: F64, }
    "%" =>
      { code: "pl_rem(\{self.as_(a, F64)}, \{self.as_(b, F64)})", repr: F64, }
    "<" | ">" | "<=" | ">=" =>
      if a.repr == Str && b.repr == Str {
        let c = "pl_str_compare(\{a.code}, \{b.code})"
        let cmp = match op {
          "<" => "(\{c} <s 0)"
          ">" => "(\{c} >s 0)"
          "<=" => "(\{c} <=s 0)"
          _ => "(\{c} >=s 0)"
        }
        { code: cmp, repr: Bool, }
      } else {
        {
          code: binop_code(op, self.as_(a, F64), self.as_(b, F64)),
          repr: Bool,
        }
      }
    "===" | "!==" => {
      let same = if a.repr == Str && b.repr == Str {
        "js_string_equals(\{a.code}, \{b.code})"
      } else if a.repr == F64 && b.repr == F64 {
        "(\{self.as_(a, F64)} == \{self.as_(b, F64)})"
      } else if a.repr == Bool && b.repr == Bool {
        "(\{a.code} == \{b.code})"
      } else {
        "value_same(\{box_(a)}, \{box_(b)})"
      }
      { code: if op == "===" { same } else { "!\{same}" }, repr: Bool, }
    }
    _ => {
      self.unsupported(span, "the operator \{op}")
      { code: "0", repr: Bool, }
    }
  }
}

///|
fn Lower::logical(
  self : Lower,
  ctx : Ctx,
  e : @ast.Expr,
  op : String,
  left : @ast.Expr,
  right : @ast.Expr,
) -> Low {
  let r = self.repr_of(e)
  let t = self.fresh("v")
  let a = self.expr(ctx, left)
  match op {
    "??" => {
      ctx.emit("let \{t} = \{box_(a)};")
      ctx.emit("if pl_nullish(\{t}) {")
      let inner = ctx.child()
      inner.indent = ctx.indent + "    "
      let b = self.expr(inner, right)
      inner.emit("\{t} = \{box_(b)};")
      ctx.emit("}")
      let v : Low = { code: t, repr: Val, }
      { code: self.as_(v, r), repr: r, }
    }
    _ => {
      // a && b: b when a is truthy, else a (a || b the other way).
      ctx.emit("let \{t} = \{self.as_(a, r)};")
      let truthy = self.as_({ code: t, repr: r, }, Bool)
      ctx.emit(if op == "&&" { "if \{truthy} {" } else { "if !\{truthy} {" })
      let inner = ctx.child()
      inner.indent = ctx.indent + "    "
      let b = self.expr(inner, right)
      inner.emit("\{t} = \{self.as_(b, r)};")
      ctx.emit("}")
      { code: t, repr: r, }
    }
  }
}

///|
fn callee_parts(callee : @ast.Expr) -> (@ast.Expr, String)? {
  match callee {
    Member(object~, property=Ident(p), computed=false, ..) =>
      Some((object, p.name))
    _ => None
  }
}

///|
fn Lower::args_boxed(
  self : Lower,
  ctx : Ctx,
  args : ArrayView[@ast.Expr],
) -> String {
  let t = self.fresh("a")
  ctx.emit("let \{t} = [value_array|null; \{args.length()}];")
  for i, a in args {
    let l = self.expr(ctx, a)
    ctx.emit("\{t}[\{i}] = \{box_(l)};")
  }
  t
}

///|
/// A path (tutuca's: a step or an array of them, each "f", { item: "f", key }
/// or { seqItem: "f", keyField: "g" }) as a selector, its steps built here.
fn Lower::selector(
  self : Lower,
  ctx : Ctx,
  path : @ast.Expr?,
  span : @ast.Span,
) -> String {
  // A module const holding the path is its literal.
  let path = match path {
    Some(Ident(id)) if ctx.scope.get(id.name) is None =>
      match self.decl_consts.get(id.name) {
        Some(init) => Some(init)
        None => path
      }
    _ => path
  }
  let steps = match path {
    Some(ArrayLit(es, ..)) => es.filter_map(x => x)
    Some(e) => [e]
    None => []
  }
  let t = self.fresh("sel")
  ctx.emit("let \{t} = [selector_step_array|null; \{steps.length()}];")
  for i, step in steps {
    let st = self.fresh("step")
    match step {
      Lit(LStr(f), ..) =>
        ctx.emit(
          "let \{st}: &selector_step_field = { kind: selector_step_kind_field, name: \{self.str_const(f)} };",
        )
      ObjectLit(ms, ..) =>
        match (prop_of(ms, "item"), prop_of(ms, "seqItem")) {
          (Some(Lit(LStr(f), ..)), None) => {
            let key = match prop_of(ms, "key") {
              Some(k) => {
                let key = self.expr(ctx, k)
                match key.repr {
                  Str => "path_key_name(\{key.code})"
                  _ => "path_key_index(pl_to_i32(\{self.as_(key, F64)}))"
                }
              }
              None => {
                self.unsupported(span, "an item step without its key")
                "path_key_index(0)"
              }
            }
            ctx.emit(
              "let \{st}: &selector_step_item = { kind: selector_step_kind_item, name: \{self.str_const(f)}, key: \{key} };",
            )
          }
          (None, Some(Lit(LStr(f), ..))) => {
            let key_field = match prop_of(ms, "keyField") {
              Some(Lit(LStr(g), ..)) => self.str_const(g)
              _ => {
                self.unsupported(
                  span, "a seqItem step whose keyField isn't a string",
                )
                self.str_const("")
              }
            }
            ctx.emit(
              "let \{st}: &selector_step_seq_item = { kind: selector_step_kind_seq_item, name: \{self.str_const(f)}, key_field: \{key_field} };",
            )
          }
          _ => {
            self.unsupported(
              span, "a path step that isn't \"f\", { item: \"f\", key } or { seqItem: \"f\", keyField: \"g\" }",
            )
            ctx.emit(
              "let \{st}: &selector_step_field = { kind: selector_step_kind_field, name: \{self.str_const("")} };",
            )
          }
        }
      _ => {
        self.unsupported(span, "a path step whose field isn't a string")
        ctx.emit(
          "let \{st}: &selector_step_field = { kind: selector_step_kind_field, name: \{self.str_const("")} };",
        )
      }
    }
    ctx.emit("\{t}[\{i}] = \{st};")
  }
  "{selector| steps: \{t} }"
}

///|
/// The value of the member of an object literal named name.
fn prop_of(ms : Array[@ast.ObjMember], name : String) -> @ast.Expr? {
  for m in ms {
    if m is Prop(key~, value~, ..) && key_name(key) == name {
      return Some(value)
    }
  }
  None
}

///|
/// The elements a list literal holds, for ctx.notify(name, [args]).
fn list_items(e : @ast.Expr?) -> Array[@ast.Expr] {
  match e {
    Some(ArrayLit(es, ..)) => es.filter_map(x => x)
    _ => []
  }
}

///|
fn Lower::call(self : Lower, ctx : Ctx, e : @ast.Expr) -> Low {
  guard e is Call(callee~, args~, span~, ..) else {
    return { code: "value_undefined()", repr: Val, }
  }
  let r = self.repr_of(e)
  match callee {
    // A helper of the module.
    Ident(id) =>
      match id.name {
        "String" => {
          let l = self.expr(ctx, args[0])
          let text = match l.repr {
            Str => l.code
            F64 => "number_text(\{l.code})"
            Bool =>
              "(\{l.code} ? \{self.str_const("true")} : \{self.str_const("false")})"
            Val => "pl_text(\{l.code})"
          }
          { code: text, repr: Str, }
        }
        // Number(x): a string read as JS reads it, a boolean as 1 or 0.
        "Number" if args.length() == 1 => {
          let l = self.expr(ctx, args[0])
          let code = match l.repr {
            Str => "number_of_text(\{l.code})"
            F64 => l.code
            Bool => "(\{l.code} ? 1.0 : 0.0)"
            Val => "number_of_text(pl_string_of(\{l.code}))"
          }
          let v : Low = { code, repr: F64, }
          { code: self.as_(v, r), repr: r, }
        }
        name if self.host_imports.get(name) is Some((module_, mem_name)) =>
          self.module_call(ctx, module_, mem_name, args, r, span)
        name =>
          match self.helper_sigs.get(name) {
            Some((params, result)) => {
              let ps = []
              for i, a in args {
                let l = self.expr(ctx, a)
                ps.push(self.as_(l, params.get(i).unwrap_or(Val)))
              }
              let v : Low = {
                code: "pl_h_\{name}(\{ps.join(", ")})",
                repr: result,
              }
              { code: self.as_(v, r), repr: r, }
            }
            None => {
              self.unsupported(
                span,
                "calling \{name}, a helper of another module",
              )
              { code: self.default_of(r), repr: r, }
            }
          }
      }
    Member(object=Ident(m), property=Ident(p), computed=false, ..) if ctx.scope.get(
        m.name,
      )
      is None &&
      (
        ["Math", "tutuca", "Object", "Number", "Array"].contains(m.name) ||
        self.pages.iter().any(p => p.module_ == m.name)
      ) => self.module_call(ctx, m.name, p.name, args, r, span)
    Member(object=Ident(c), property=Ident(p), computed=false, ..) if ctx.scope.get(
        c.name,
      )
      is Some(CtxName) => self.ctx_call(ctx, p.name, args, r, span)
    Member(object=Ident(c), property=Ident(p), computed=false, ..) if ctx.scope.get(
        c.name,
      )
      is Some(InitCtxName) =>
      if p.name == "make" {
        let n = match args.get(0) {
          Some(Lit(LStr(s), ..)) => self.str_const(s)
          _ => {
            self.unsupported(span, "ctx.make with a name that isn't a string")
            self.str_const("")
          }
        }
        let fields = match args.get(1) {
          Some(f) => box_(self.expr(ctx, f))
          None => "map_empty()"
        }
        let v : Low = {
          code: "value_component(init_ctx_make(ctx, \{n}, \{fields}))",
          repr: Val,
        }
        { code: self.as_(v, r), repr: r, }
      } else {
        self.unsupported(
          span,
          "an init's ctx.\{p.name}: it only makes components",
        )
        { code: "value_undefined()", repr: Val, }
      }
    _ =>
      match callee_parts(callee) {
        Some((object, name)) =>
          self.method_call(ctx, e, object, name, args, r, span)
        None => {
          self.unsupported(span, "this call")
          { code: "value_undefined()", repr: Val, }
        }
      }
  }
}

///|
fn Lower::module_call(
  self : Lower,
  ctx : Ctx,
  m : String,
  name : String,
  args : Array[@ast.Expr],
  r : Repr,
  span : @ast.Span,
) -> Low {
  let num = (i : Int32) => self.as_(self.expr(ctx, args[i]), F64)
  if self.pages.iter().any(p => p.module_ == m) {
    return self.page_call(ctx, m, name, args, r, span)
  }
  match (m, name) {
    ("Math", "floor") => { code: "\{num(0)}.floor()", repr: F64, }
    ("Math", "ceil") => { code: "\{num(0)}.ceil()", repr: F64, }
    ("Math", "trunc") => { code: "\{num(0)}.trunc()", repr: F64, }
    ("Math", "abs") => { code: "\{num(0)}.abs()", repr: F64, }
    ("Math", "round") => { code: "pl_round(\{num(0)})", repr: F64, }
    ("Math", "max") | ("Math", "min") => {
      let f = if name == "max" { "pl_max" } else { "pl_min" }
      let mut code = num(0)
      for i in 1..<args.length() {
        code = "\{f}(\{code}, \{num(i)})"
      }
      { code, repr: F64, }
    }
    ("Data", "range") => { code: "pl_range(\{num(0)}, \{num(1)})", repr: Val, }
    ("Data", "without") => {
      let rec = box_(self.expr(ctx, args[0]))
      let key = self.as_(self.expr(ctx, args[1]), Str)
      { code: "map_dissoc(\{rec}, \{key})", repr: Val, }
    }
    ("Data", "get") => {
      let v = box_(self.expr(ctx, args[0]))
      let key = box_(self.expr(ctx, args[1]))
      { code: "pl_get(\{v}, \{key})", repr: Val, }
    }
    ("Data", "keysOf") => {
      let v = box_(self.expr(ctx, args[0]))
      { code: "pl_keys_of(\{v})", repr: Val, }
    }
    ("Data", "itemsOf") => {
      let v = box_(self.expr(ctx, args[0]))
      { code: "pl_items_of(\{v})", repr: Val, }
    }
    ("Data", "toJson") => {
      let v = box_(self.expr(ctx, args[0]))
      let indent = self.as_(self.expr(ctx, args[1]), F64)
      { code: "value_json(\{v}, pl_to_i32(\{indent}))", repr: Str, }
    }
    ("Data", "parseJson") => {
      let text = self.as_(self.expr(ctx, args[0]), Str)
      { code: "pl_parse_json(\{text})", repr: Val, }
    }
    ("Data", "kindOf") => {
      let v = box_(self.expr(ctx, args[0]))
      { code: "pl_kind_of(\{v})", repr: Str, }
    }
    ("Object", "keys") =>
      { code: "map_keys(\{box_(self.expr(ctx, args[0]))})", repr: Val, }
    ("Object", "entries") =>
      { code: "pl_entries(\{box_(self.expr(ctx, args[0]))})", repr: Val, }
    ("Object", "fromEntries") =>
      { code: "pl_from_entries(\{box_(self.expr(ctx, args[0]))})", repr: Val, }
    ("Object", "hasOwn") => {
      let rec = box_(self.expr(ctx, args[0]))
      let key = self.as_(self.expr(ctx, args[1]), Str)
      { code: "pl_has_own(\{rec}, \{key})", repr: Bool, }
    }
    ("Number", "isInteger") =>
      { code: "pl_is_integer(\{box_(self.expr(ctx, args[0]))})", repr: Bool, }
    ("Number", "isFinite") =>
      { code: "pl_is_finite(\{box_(self.expr(ctx, args[0]))})", repr: Bool, }
    ("Number", "isNaN") =>
      { code: "pl_is_nan(\{box_(self.expr(ctx, args[0]))})", repr: Bool, }
    ("Array", "isArray") =>
      {
        code: "(\{box_(self.expr(ctx, args[0]))}.kind == value_kind_list)",
        repr: Bool,
      }
    ("Math", "sign") => { code: "pl_sign(\{num(0)})", repr: F64, }
    ("tutuca", "errorMessage") => {
      let v = box_(self.expr(ctx, args[0]))
      { code: "pl_error_message(\{v})", repr: Str, }
    }
    ("tutuca", "apply") => {
      let child = self.expr(ctx, args[0])
      let msg = match args.get(1) {
        Some(Lit(LStr(s), ..)) => self.str_const(s)
        _ => {
          self.unsupported(
            span, "tutuca.apply with a message that isn't a string",
          )
          self.str_const("")
        }
      }
      let a = self.args_boxed(ctx, args[2:])
      let v : Low = {
        code: "component_apply(\{box_(child)}, \{msg}, \{a})",
        repr: Val,
      }
      { code: self.as_(v, r), repr: r, }
    }
    _ => {
      self.unsupported(span, "\{m}.\{name}")
      { code: "value_undefined()", repr: Val, }
    }
  }
}

///|
fn Lower::ctx_call(
  self : Lower,
  ctx : Ctx,
  name : String,
  args : Array[@ast.Expr],
  r : Repr,
  span : @ast.Span,
) -> Low {
  let name_arg = () => {
    match args.get(0) {
      Some(Lit(LStr(s), ..)) => self.str_const(s)
      _ => {
        self.unsupported(span, "ctx.\{name} with a name that isn't a string")
        self.str_const("")
      }
    }
  }
  match name {
    "notify" => {
      let a = self.args_boxed(ctx, list_items(args.get(1))[:])
      ctx.emit("ctx_notify(ctx, \{name_arg()}, \{a});")
      { code: "0", repr: Bool, }
    }
    // sendAt(name, args, path): a message to the component path reaches, its
    // steps built as tutuca's selector's.
    "sendAt" => {
      let a = self.args_boxed(ctx, list_items(args.get(1))[:])
      let selector = self.selector(ctx, args.get(2), span)
      match args.get(3) {
        // With a watch: settled and progress are messages sent back here,
        // timeout cancels it, detached puts it in no watch; its id.
        Some(ObjectLit(ms, ..)) => {
          let name_or_null = (key : String) => {
            match prop_of(ms, key) {
              Some(Lit(LStr(m), ..)) => self.str_const(m)
              Some(_) => {
                self.unsupported(span, "a watch's \{key} that isn't a string")
                "null"
              }
              None => "null"
            }
          }
          let timeout = match prop_of(ms, "timeout") {
            Some(t) => self.as_(self.expr(ctx, t), F64)
            None => "0.0"
          }
          let detached = match prop_of(ms, "detached") {
            Some(d) => self.as_(self.expr(ctx, d), Bool)
            None => "0"
          }
          let none = "[value_array|null; 0]"
          let v : Low = {
            code: "(ctx_send_watched(ctx, \{name_arg()}, \{a}, \{selector}, \{name_or_null("settled")}, \{none}, \{name_or_null("progress")}, \{none}, \{timeout}, \{detached}) as f64_s)",
            repr: F64,
          }
          { code: self.as_(v, r), repr: r, }
        }
        Some(_) => {
          self.unsupported(span, "a watch that isn't an object literal")
          { code: self.default_of(r), repr: r, }
        }
        None => {
          ctx.emit("ctx_send_at(ctx, \{name_arg()}, \{a}, \{selector});")
          { code: "0", repr: Bool, }
        }
      }
    }
    // reply(name, args): a message to the sender of the one being handled.
    "reply" => {
      let a = self.args_boxed(ctx, list_items(args.get(1))[:])
      ctx.emit("ctx_reply(ctx, \{name_arg()}, \{a});")
      { code: "0", repr: Bool, }
    }
    "cancel" => {
      let id = self.as_(self.expr(ctx, args[0]), F64)
      ctx.emit("ctx_cancel(ctx, pl_to_i32(\{id}));")
      { code: "0", repr: Bool, }
    }
    "log" => {
      let v = box_(self.expr(ctx, args[0]))
      ctx.emit("ctx_log(ctx, \{v});")
      { code: "0", repr: Bool, }
    }
    // ask(name, args, { detached }): the request's id, which its answer's
    // handler reads as ctx.request.
    "ask" => {
      let a = self.args_boxed(ctx, list_items(args.get(1))[:])
      let detached = match args.get(2) {
        Some(ObjectLit(ms, ..)) =>
          match prop_of(ms, "detached") {
            Some(Lit(LBool(true), ..)) => true
            _ => false
          }
        _ => false
      }
      let f = if detached { "ctx_ask_detached" } else { "ctx_ask" }
      let id = self.fresh("rq")
      ctx.emit("let \{id} = \{f}(ctx, \{name_arg()}, \{a});")
      let v : Low = { code: "(\{id} as f64_s)", repr: F64, }
      { code: self.as_(v, r), repr: r, }
    }
    "stopNext" => {
      ctx.emit("ctx_stop_next(ctx);")
      { code: "0", repr: Bool, }
    }
    "uuid" => { code: "ctx_uuid(ctx)", repr: Str, }
    "now" => {
      let v : Low = { code: "ctx_now(ctx)", repr: F64, }
      { code: self.as_(v, r), repr: r, }
    }
    // tryMake(name, fields?): ctx_try_make's outcome, { ok: the component }
    // or { err: { error, issues } }; its name may be computed (a name
    // componentNames gave).
    "tryMake" => {
      let n = match args.get(0) {
        Some(e) => self.as_(self.expr(ctx, e), Str)
        None => self.str_const("")
      }
      let fields = match args.get(1) {
        Some(f) => box_(self.expr(ctx, f))
        None => "map_empty()"
      }
      let v : Low = { code: "ctx_try_make(ctx, \{n}, \{fields})", repr: Val, }
      { code: self.as_(v, r), repr: r, }
    }
    // metaOf(name, uri): what the type the scope can make as name says under
    // uri, null when it can't make it.
    "metaOf" => {
      let n = match args.get(0) {
        Some(e) => self.as_(self.expr(ctx, e), Str)
        None => self.str_const("")
      }
      let uri = match args.get(1) {
        Some(e) => self.as_(self.expr(ctx, e), Str)
        None => self.str_const("")
      }
      let v : Low = { code: "ctx_meta_of(ctx, \{n}, \{uri})", repr: Val, }
      { code: self.as_(v, r), repr: r, }
    }
    // componentNames(walk?): the names the handling component's scope can make.
    "componentNames" => {
      let walk = match args.get(0) {
        Some(e) => self.as_(self.expr(ctx, e), Bool)
        None => "0"
      }
      let v : Low = { code: "ctx_component_names(ctx, \{walk})", repr: Val, }
      { code: self.as_(v, r), repr: r, }
    }
    "make" => {
      let fields = match args.get(1) {
        Some(f) => box_(self.expr(ctx, f))
        None => "map_empty()"
      }
      let v : Low = {
        code: "value_component(ctx_make(ctx, \{name_arg()}, \{fields}))",
        repr: Val,
      }
      { code: self.as_(v, r), repr: r, }
    }
    _ => {
      self.unsupported(span, "ctx.\{name}")
      { code: "value_undefined()", repr: Val, }
    }
  }
}

///|
/// A list method's loop: over src's items, i the index, each item bound to the
/// callback's parameters, body the callback's result.
fn Lower::each_item(
  self : Lower,
  ctx : Ctx,
  src : String,
  cb : @ast.Func,
  until : String?,
  on_item : (Ctx, Low, String, String) -> Unit,
  draft : (String, Array[Step])?,
) -> Unit {
  let i = self.fresh("i")
  let n = self.fresh("n")
  ctx.emit("let \{i} = 0;")
  ctx.emit("let \{n} = list_count(\{src});")
  let cond = match until {
    Some(flag) => "(\{i} <s \{n}) & !\{flag}"
    None => "\{i} <s \{n}"
  }
  ctx.emit("while \{cond} {")
  let inner = ctx.child()
  inner.indent = ctx.indent + "    "
  let item = self.fresh("it")
  inner.emit("let \{item} = list_get(\{src}, \{i})!;")
  for pi, p in cb.params {
    match (pi, p) {
      (0, PIdent(id)) if draft is Some((f, steps)) =>
        inner.scope[id.name] = Alias(f, [..steps, SIndex(i)])
      (0, _) => self.bind_pattern(inner, p, item)
      (1, PIdent(id)) => {
        let loc = self.fresh(id.name)
        inner.emit("let \{loc} = (\{i} as f64_s);")
        inner.scope[id.name] = Plain(loc, F64)
      }
      _ => ()
    }
  }
  // The callback's result: an expression, or a block's return.
  let result = match cb.body {
    ExprBody(x) => self.expr(inner, x)
    BlockBody(b) => {
      let r = self.cb_repr(cb)
      let res = self.fresh("r")
      let flag = self.fresh("ret")
      inner.emit("let \{res} = \{self.default_of(r)};")
      inner.emit("let \{flag} = 0;")
      let body = inner.child()
      body.exits.push(flag)
      body.brk = None
      body.cont = None
      let body = { ..body, ret: SetResult(res, flag, r), }
      self.stmts(body, b.body)
      { code: res, repr: r, }
    }
  }
  on_item(inner, result, item, i)
  inner.emit("\{i} += 1;")
  ctx.emit("}")
}

///|
/// Binds a pattern's names to the parts of v (a &value): a name, a list's
/// items (a hole skips one, ...rest is a slice), an object's members, a
/// default where the part is undefined.
fn Lower::bind_pattern(
  self : Lower,
  ctx : Ctx,
  p : @ast.Pattern,
  v : String,
) -> Unit {
  match p {
    PIdent(id) => {
      let r = self.pattern_repr(p)
      let loc = self.fresh(id.name)
      ctx.emit("let \{loc} = \{self.as_({ code: v, repr: Val }, r)};")
      ctx.scope[id.name] = Plain(loc, r)
    }
    PArray(elements~, ..) => {
      let t = self.fresh("d")
      ctx.emit("let \{t} = \{v};")
      for i, el in elements {
        match el {
          Some(PRest(arg~, ..)) =>
            self.bind_pattern(
              ctx,
              arg,
              "pl_list_slice(\{t}, \{i}.0, (list_count(\{t}) as f64_s))",
            )
          Some(e) => self.bind_pattern(ctx, e, "pl_list_get(\{t}, \{i})")
          None => ()
        }
      }
    }
    PObject(props~, span~, ..) => {
      let t = self.fresh("d")
      ctx.emit("let \{t} = \{v};")
      for pp in props {
        match pp {
          PPProp(key~, value~, ..) =>
            self.bind_pattern(
              ctx,
              value,
              "pl_member(\{t}, \{self.str_const(key_name(key))})",
            )
          PPRest(..) => self.unsupported(span, "...rest in an object pattern")
        }
      }
    }
    PAssign(left~, right~, ..) => {
      let t = self.fresh("d")
      ctx.emit("let \{t} = \{v};")
      ctx.emit("if \{t}.kind == value_kind_undefined {")
      let inner = ctx.child()
      inner.indent = ctx.indent + "    "
      let d = self.expr(inner, right)
      inner.emit("\{t} = \{box_(d)};")
      ctx.emit("}")
      self.bind_pattern(ctx, left, t)
    }
    PRest(span~, ..) => self.unsupported(span, "this rest pattern")
  }
}

///|
fn Lower::pattern_repr(self : Lower, p : @ast.Pattern) -> Repr {
  match p {
    PIdent(id) =>
      match self.ch.types.get("\{id.span.start}:\{id.span.end}:Identifier") {
        Some(t) => repr_of_js(t.ty)
        None => Val
      }
    _ => Val
  }
}

///|
/// What a callback with a block body returns: what its returns' values are.
fn Lower::cb_repr(self : Lower, cb : @ast.Func) -> Repr {
  ignore(self)
  ignore(cb)
  Val
}

///|
fn Lower::method_call(
  self : Lower,
  ctx : Ctx,
  e : @ast.Expr,
  object : @ast.Expr,
  name : String,
  args : Array[@ast.Expr],
  r : Repr,
  span : @ast.Span,
) -> Low {
  ignore(e)
  let draft = self.place(ctx, object)
  let o = self.expr(ctx, object)
  // A string held boxed (a helper's result, a value read from a list) is
  // still a string: its methods are the string ones.
  let held_str = match object {
    Call(callee=Ident(f), ..) if ctx.scope.get(f.name) is None =>
      self.helper_sigs.get(f.name).map(sig => sig.1) == Some(Str)
    _ =>
      match self.js_type(object) {
        Some(t) => repr_of_js(t) == Str
        // A record's field: the field's type, in the record's.
        None =>
          match object {
            Member(object=x, property=Ident(p), computed=false, ..) =>
              match self.js_type(x).map(t => self.ch.host.resolve(t)) {
                Some(RecordT(fields~, ..)) =>
                  fields.get(p.name).map(f => repr_of_js(f.ty)) == Some(Str)
                _ => false
              }
            _ => false
          }
      }
  }
  let o = if o.repr == Val && held_str {
    { code: self.as_(o, Str), repr: Str, }
  } else {
    o
  }
  // Strings.
  if o.repr == Str {
    let s = o.code
    let arg = (i : Int32) => self.expr(ctx, args[i])
    return match name {
      "trim" => { code: "str_trim(\{s})", repr: Str, }
      "toLowerCase" => { code: "str_lower(\{s})", repr: Str, }
      "toUpperCase" => { code: "str_upper(\{s})", repr: Str, }
      "includes" =>
        {
          code: "(str_index_of(\{s}, \{self.as_(arg(0), Str)}, 0) >=s 0)",
          repr: Bool,
        }
      "indexOf" =>
        {
          code: "(str_index_of(\{s}, \{self.as_(arg(0), Str)}, 0) as f64_s)",
          repr: F64,
        }
      "startsWith" =>
        { code: "pl_starts_with(\{s}, \{self.as_(arg(0), Str)})", repr: Bool, }
      "endsWith" =>
        { code: "pl_ends_with(\{s}, \{self.as_(arg(0), Str)})", repr: Bool, }
      "split" =>
        { code: "str_split(\{s}, \{self.as_(arg(0), Str)})", repr: Val, }
      "replaceAll" =>
        {
          code: "str_replace_all(\{s}, \{self.as_(arg(0), Str)}, \{self.as_(arg(1), Str)})",
          repr: Str,
        }
      "slice" => {
        let start = if args.length() > 0 {
          self.as_(arg(0), F64)
        } else {
          "0.0"
        }
        let end = if args.length() > 1 {
          self.as_(arg(1), F64)
        } else {
          "(js_string_length(\{s}) as f64_s)"
        }
        { code: "pl_str_slice(\{s}, \{start}, \{end})", repr: Str, }
      }
      _ => {
        self.unsupported(span, "the string method \{name}")
        { code: self.str_const(""), repr: Str, }
      }
    }
  }
  let list = box_(o)
  match name {
    "push" =>
      match draft {
        Some((f, steps)) => {
          let loc = self.fresh("l")
          ctx.emit("let \{loc} = \{list};")
          for a in args {
            let l = self.expr(ctx, a)
            ctx.emit("\{loc} = list_push(\{loc}, \{box_(l)});")
          }
          self.assign_place(ctx, f, steps, { code: loc, repr: Val, })
          { code: "(list_count(\{loc}) as f64_s)", repr: F64, }
        }
        None =>
          match object {
            Ident(id) =>
              match ctx.scope.get(id.name) {
                Some(Plain(loc, _)) => {
                  for a in args {
                    let l = self.expr(ctx, a)
                    ctx.emit("\{loc} = list_push(\{loc}, \{box_(l)});")
                  }
                  { code: "(list_count(\{loc}) as f64_s)", repr: F64, }
                }
                _ => {
                  self.unsupported(span, "push on this list")
                  { code: "0.0", repr: F64, }
                }
              }
            _ => {
              self.unsupported(span, "push on this list")
              { code: "0.0", repr: F64, }
            }
          }
      }
    "splice" =>
      match draft {
        Some((f, steps)) if args.length() >= 2 => {
          // As JS: a negative start counts from the end, both clamp; the
          // items after the count go in at start, in order; it gives the
          // removed items.
          let loc = self.fresh("l")
          ctx.emit("let \{loc} = \{list};")
          let at = self.fresh("i")
          ctx.emit(
            "let \{at} = pl_bound(\{self.as_(self.expr(ctx, args[0]), F64)}, list_count(\{loc}));",
          )
          let count = self.fresh("n")
          ctx.emit(
            "let \{count} = pl_to_i32(\{self.as_(self.expr(ctx, args[1]), F64)});",
          )
          let removed = self.fresh("r")
          ctx.emit("let \{removed} = list_empty();")
          ctx.emit("while (\{count} >s 0) & (\{at} <s list_count(\{loc})) {")
          ctx.emit(
            "    \{removed} = list_push(\{removed}, list_get(\{loc}, \{at})!);",
          )
          ctx.emit("    \{loc} = list_remove_at(\{loc}, \{at});")
          ctx.emit("    \{count} -= 1;")
          ctx.emit("}")
          for k, item in args[2:] {
            let v = box_(self.expr(ctx, item))
            ctx.emit("\{loc} = list_insert(\{loc}, \{at} + \{k}, \{v});")
          }
          self.assign_place(ctx, f, steps, { code: loc, repr: Val, })
          { code: removed, repr: Val, }
        }
        _ => {
          self.unsupported(span, "this splice")
          { code: "list_empty()", repr: Val, }
        }
      }
    "join" => {
      let sep = if args.length() > 0 {
        self.as_(self.expr(ctx, args[0]), Str)
      } else {
        self.str_const(",")
      }
      { code: "str_join(\{list}, \{sep})", repr: Str, }
    }
    "includes" | "indexOf" => {
      let needle = box_(self.expr(ctx, args[0]))
      let code = "pl_index_of(\{list}, \{needle})"
      if name == "includes" {
        { code: "(\{code} >=s 0)", repr: Bool, }
      } else {
        { code: "(\{code} as f64_s)", repr: F64, }
      }
    }
    "slice" => {
      let start = if args.length() > 0 {
        self.as_(self.expr(ctx, args[0]), F64)
      } else {
        "0.0"
      }
      let end = if args.length() > 1 {
        self.as_(self.expr(ctx, args[1]), F64)
      } else {
        "(list_count(\{list}) as f64_s)"
      }
      { code: "pl_list_slice(\{list}, \{start}, \{end})", repr: Val, }
    }
    "at" => {
      let v : Low = {
        code: "pl_index_get(\{list}, pl_at_index(\{list}, \{self.as_(self.expr(ctx, args[0]), F64)}))",
        repr: Val,
      }
      { code: self.as_(v, r), repr: r, }
    }
    "map"
    | "filter"
    | "find"
    | "findIndex"
    | "some"
    | "every"
    | "forEach"
    | "flatMap" => {
      guard args.get(0) is Some(Arrow(cb)) else {
        self.unsupported(span, "\{name} without a callback")
        return { code: "value_undefined()", repr: Val, }
      }
      let src = self.fresh("src")
      ctx.emit("let \{src} = \{list};")
      let out = self.fresh("out")
      let done = self.fresh("done")
      let (init, final_repr) : (String, Repr) = match name {
        "map" | "filter" | "flatMap" => ("list_empty()", Val)
        "find" => ("value_undefined()", Val)
        "findIndex" => ("-1.0", F64)
        "some" => ("0", Bool)
        "every" => ("1", Bool)
        _ => ("0", Bool)
      }
      ctx.emit("let \{out} = \{init};")
      ctx.emit("let \{done} = 0;")
      let until = match name {
        "find" | "findIndex" | "some" | "every" => Some(done)
        _ => None
      }
      self.each_item(
        ctx,
        src,
        cb,
        until,
        (inner, result, item, i) => {
          match name {
            "map" => inner.emit("\{out} = list_push(\{out}, \{box_(result)});")
            "flatMap" => {
              let j = self.fresh("j")
              inner.emit("let \{j} = 0;")
              inner.emit("let pl_sub = \{box_(result)};")
              inner.emit("while \{j} <s list_count(pl_sub) {")
              inner.emit(
                "    \{out} = list_push(\{out}, list_get(pl_sub, \{j})!);",
              )
              inner.emit("    \{j} += 1;")
              inner.emit("}")
            }
            "filter" =>
              inner.emit(
                "if \{self.as_(result, Bool)} { \{out} = list_push(\{out}, \{item}); }",
              )
            "find" =>
              inner.emit(
                "if \{self.as_(result, Bool)} { \{out} = \{item}; \{done} = 1; }",
              )
            "findIndex" =>
              inner.emit(
                "if \{self.as_(result, Bool)} { \{out} = (\{i} as f64_s); \{done} = 1; }",
              )
            "some" =>
              inner.emit(
                "if \{self.as_(result, Bool)} { \{out} = 1; \{done} = 1; }",
              )
            "every" =>
              inner.emit(
                "if !\{self.as_(result, Bool)} { \{out} = 0; \{done} = 1; }",
              )
            _ =>
              if result.code != "0" {
                inner.emit("let _ = \{box_(result)};")
              }
          }
        },
        if name == "forEach" {
          draft
        } else {
          None
        },
      )
      let v : Low = { code: out, repr: final_repr, }
      {
        code: self.as_(v, if name == "forEach" { Bool } else { r }),
        repr: if name == "forEach" {
          Bool
        } else {
          r
        },
      }
    }
    "reduce" => {
      guard args.get(0) is Some(Arrow(cb)) && args.get(1) is Some(init) else {
        self.unsupported(span, "this reduce")
        return { code: "value_undefined()", repr: Val, }
      }
      let acc_repr = r
      let acc = self.fresh("acc")
      let start = self.expr(ctx, init)
      ctx.emit("let \{acc} = \{self.as_(start, acc_repr)};")
      let src = self.fresh("src")
      ctx.emit("let \{src} = \{list};")
      // The accumulator is the callback's first parameter, the item its second.
      let i = self.fresh("i")
      ctx.emit("let \{i} = 0;")
      ctx.emit("while \{i} <s list_count(\{src}) {")
      let inner = ctx.child()
      inner.indent = ctx.indent + "    "
      match cb.params.get(0) {
        Some(PIdent(id)) => inner.scope[id.name] = Plain(acc, acc_repr)
        _ => ()
      }
      match cb.params.get(1) {
        Some(p) => self.bind_pattern(inner, p, "list_get(\{src}, \{i})!")
        None => ()
      }
      match cb.params.get(2) {
        Some(PIdent(id)) => {
          let loc = self.fresh(id.name)
          inner.emit("let \{loc} = (\{i} as f64_s);")
          inner.scope[id.name] = Plain(loc, F64)
        }
        _ => ()
      }
      match cb.body {
        ExprBody(x) => {
          let v = self.expr(inner, x)
          inner.emit("\{acc} = \{self.as_(v, acc_repr)};")
        }
        BlockBody(_) => self.unsupported(span, "a reduce with a block callback")
      }
      inner.emit("\{i} += 1;")
      ctx.emit("}")
      { code: acc, repr: acc_repr, }
    }
    "sort" => {
      // pure-js's sort: stable, compare(a, b) above 0 puts b first. A stable
      // sort's order is the comparator's, so a bottom-up merge sort gives
      // what pure-js's top-down one does; the comparator is inlined.
      guard args.get(0) is Some(Arrow(cb)) && cb.body is ExprBody(cmp_body) else {
        self.unsupported(span, "a sort without an expression callback")
        return { code: list, repr: Val, }
      }
      let src = self.fresh("src")
      let n = self.fresh("n")
      let w = self.fresh("w")
      let lo = self.fresh("lo")
      let mid = self.fresh("mid")
      let hi = self.fresh("hi")
      let a = self.fresh("a")
      let b = self.fresh("b")
      let out = self.fresh("out")
      let take = self.fresh("take")
      ctx.emit("let \{src} = \{list};")
      ctx.emit("let \{n} = list_count(\{src});")
      ctx.emit("let \{w} = 1;")
      ctx.emit("while \{w} <s \{n} {")
      ctx.emit("    let \{out} = list_empty();")
      ctx.emit("    let \{lo} = 0;")
      ctx.emit("    while \{lo} <s \{n} {")
      ctx.emit("        let \{mid} = \{lo} + \{w};")
      ctx.emit("        if \{mid} >s \{n} { \{mid} = \{n}; }")
      ctx.emit("        let \{hi} = \{mid} + \{w};")
      ctx.emit("        if \{hi} >s \{n} { \{hi} = \{n}; }")
      ctx.emit("        let \{a} = \{lo};")
      ctx.emit("        let \{b} = \{mid};")
      ctx.emit("        while (\{a} <s \{mid}) | (\{b} <s \{hi}) {")
      ctx.emit("            let \{take} = \{a} >=s \{mid};")
      ctx.emit("            if (\{a} <s \{mid}) & (\{b} <s \{hi}) {")
      let inner = ctx.child()
      inner.indent = ctx.indent + "                "
      match cb.params.get(0) {
        Some(p) => self.bind_pattern(inner, p, "list_get(\{src}, \{a})!")
        None => ()
      }
      match cb.params.get(1) {
        Some(p) => self.bind_pattern(inner, p, "list_get(\{src}, \{b})!")
        None => ()
      }
      let c = self.expr(inner, cmp_body)
      inner.emit("if \{self.as_(c, F64)} > 0.0 { \{take} = 1; }")
      ctx.emit("            }")
      ctx.emit("            if \{take} {")
      ctx.emit(
        "                \{out} = list_push(\{out}, list_get(\{src}, \{b})!);",
      )
      ctx.emit("                \{b} += 1;")
      ctx.emit("            } else {")
      ctx.emit(
        "                \{out} = list_push(\{out}, list_get(\{src}, \{a})!);",
      )
      ctx.emit("                \{a} += 1;")
      ctx.emit("            }")
      ctx.emit("        }")
      ctx.emit("        \{lo} = \{hi};")
      ctx.emit("    }")
      ctx.emit("    \{src} = \{out};")
      ctx.emit("    \{w} = \{w} + \{w};")
      ctx.emit("}")
      // It sorts in place: a draft's place, or a local, gets the sorted list.
      match draft {
        Some((f, steps)) =>
          self.assign_place(ctx, f, steps, { code: src, repr: Val, })
        None =>
          match object {
            Ident(id) =>
              match ctx.scope.get(id.name) {
                Some(Plain(loc, _)) => ctx.emit("\{loc} = \{src};")
                _ => ()
              }
            _ => ()
          }
      }
      { code: src, repr: Val, }
    }
    _ => {
      self.unsupported(span, "the method \{name}")
      { code: "value_undefined()", repr: Val, }
    }
  }
}

///|
/// Statements, each skipped once a flag the statements before set says so.
fn Lower::stmts(self : Lower, ctx : Ctx, list : Array[@ast.Stmt]) -> Unit {
  let mut guarded = ctx
  let mut opened = 0
  for s in list {
    self.stmt(guarded, s)
    if may_exit(s) && !guarded.exits.is_empty() {
      guarded.emit("if !(\{guarded.exits.join(" | ")}) {")
      let next = guarded.child()
      next.indent = guarded.indent + "    "
      guarded = next
      opened += 1
    }
  }
  let mut indent = guarded.indent
  for _ in 0..<opened {
    indent = indent.exact_view(end=indent.length() - 4).to_owned()
    ctx.out.push("\{indent}}")
  }
}

///|
/// Whether a statement may end the statements after it: a return, break or
/// continue in it (not in a callback of its).
fn may_exit(s : @ast.Stmt) -> Bool {
  match s {
    Return(_, ..) | Break(_) | Continue(_) => true
    If(cons~, alt~, ..) =>
      may_exit(cons) ||
      (match alt {
        Some(a) => may_exit(a)
        None => false
      })
    BlockStmt(b) => b.body.iter().any(may_exit)
    _ => false
  }
}

///|
fn Lower::stmt(self : Lower, ctx : Ctx, s : @ast.Stmt) -> Unit {
  match s {
    VarDecl(kind~, decls~, ..) =>
      for d in decls {
        guard d.init is Some(init) else { continue }
        match d.id {
          PIdent(id) =>
            // A const naming part of next is an alias of it.
            match self.place(ctx, init) {
              Some((f, steps)) if kind == "const" && self.repr_of(init) == Val =>
                ctx.scope[id.name] = Alias(f, steps)
              _ => {
                let v = self.expr(ctx, init)
                let r = match
                  self.ch.types.get(
                    "\{id.span.start}:\{id.span.end}:Identifier",
                  ) {
                  Some(t) => repr_of_js(t.ty)
                  None => v.repr
                }
                let loc = self.fresh(id.name)
                ctx.emit("let \{loc} = \{self.as_(v, r)};")
                ctx.scope[id.name] = Plain(loc, r)
              }
            }
          PObject(props~, ..) if self.place(ctx, init) is Some((f, steps)) &&
            props.iter().all(pp => pp is PPProp(value=PIdent(_), ..)) =>
            // Destructuring a draft: each name an alias of its part.
            for pp in props {
              if pp is PPProp(key~, value=PIdent(id), ..) {
                ctx.scope[id.name] = Alias(f, [..steps, SField(key_name(key))])
              }
            }
          pat => {
            let v = self.expr(ctx, init)
            self.bind_pattern(ctx, pat, box_(v))
          }
        }
      }
    ExprStmt(e, ..) =>
      match e {
        Assign(op~, left~, right~, span~) =>
          self.assign(ctx, op, left, right, span)
        _ => {
          let l = self.expr(ctx, e)
          if l.code.has_prefix("pl_h_") || l.code.has_prefix("component_apply") {
            ctx.emit("let _ = \{l.code};")
          }
        }
      }
    If(cond~, cons~, alt~, ..) => {
      let t = self.expr(ctx, cond)
      ctx.emit("if \{self.as_(t, Bool)} {")
      let a = ctx.child()
      a.indent = ctx.indent + "    "
      self.stmts(a, [cons])
      match alt {
        Some(x) => {
          ctx.emit("} else {")
          let b = ctx.child()
          b.indent = ctx.indent + "    "
          self.stmts(b, [x])
        }
        None => ()
      }
      ctx.emit("}")
    }
    BlockStmt(b) => self.stmts(ctx.child(), b.body)
    Return(arg, ..) =>
      match ctx.ret {
        ReturnState =>
          ctx.emit("return pl_done(state, pl_dirty\{self.next_args(ctx)});")
        ReturnOk(r) =>
          match arg {
            Some(x) => {
              let v = self.expr(ctx, x)
              ctx.emit(
                "return outcome_ok(\{box_({ code: self.as_(v, r), repr: r })});",
              )
            }
            None => ctx.emit("return outcome_ok(value_undefined());")
          }
        ReturnSwap =>
          match arg {
            Some(x) => {
              let v = box_(self.expr(ctx, x))
              let t = self.fresh("s")
              ctx.emit("let \{t} = \{v};")
              ctx.emit("if \{t}.kind != value_kind_undefined {")
              ctx.emit("    return \{ctx.cw}_swap_to(pl_component(\{t}));")
              ctx.emit("}")
              ctx.emit(
                "return \{ctx.cw}_keep(pl_done(state, pl_dirty\{self.next_args(ctx)}));",
              )
            }
            None =>
              ctx.emit(
                "return \{ctx.cw}_keep(pl_done(state, pl_dirty\{self.next_args(ctx)}));",
              )
          }
        ReturnValue(r) =>
          match arg {
            Some(x) => {
              let v = self.expr(ctx, x)
              ctx.emit("return \{self.as_(v, r)};")
            }
            None => ctx.emit("return \{self.default_of(r)};")
          }
        ReturnBinds(st, members) => {
          let t = self.fresh("b")
          match arg {
            Some(x) => {
              let v = self.expr(ctx, x)
              ctx.emit("let \{t} = \{box_(v)};")
            }
            None => ctx.emit("let \{t} = value_undefined();")
          }
          let fields = members.map(m => {
            let read : Low = {
              code: "pl_member(\{t}, \{self.str_const(m.0)})",
              repr: Val,
            }
            "\{@check.wax(m.0)}: \{self.as_(read, m.1)}"
          })
          ctx.emit("return {\{st}| \{fields.join(", ")} };")
        }
        SetResult(res, flag, r) => {
          match arg {
            Some(x) => {
              let v = self.expr(ctx, x)
              ctx.emit("\{res} = \{self.as_(v, r)};")
            }
            None => ()
          }
          ctx.emit("\{flag} = 1;")
        }
      }
    ForOf(left=VarDecl(decls~, ..), right~, body~, ..) => {
      let draft = self.place(ctx, right)
      let src = self.fresh("src")
      let v = self.expr(ctx, right)
      ctx.emit("let \{src} = \{box_(v)};")
      let brk = self.fresh("brk")
      let cont = self.fresh("cont")
      ctx.emit("let \{brk} = 0;")
      let i = self.fresh("i")
      ctx.emit("let \{i} = 0;")
      let outer = if ctx.exits.is_empty() {
        ""
      } else {
        " & !(\{ctx.exits.join(" | ")})"
      }
      ctx.emit("while (\{i} <s list_count(\{src})) & !\{brk}\{outer} {")
      let inner = ctx.child()
      inner.indent = ctx.indent + "    "
      inner.emit("let \{cont} = 0;")
      match (decls[0].id, draft) {
        (PIdent(id), Some((f, steps))) =>
          inner.scope[id.name] = Alias(f, [..steps, SIndex(i)])
        (pat, _) => self.bind_pattern(inner, pat, "list_get(\{src}, \{i})!")
      }
      let body_ctx = {
        ..inner,
        exits: [..inner.exits, brk, cont],
        brk: Some(brk),
        cont: Some(cont),
      }
      self.stmts(body_ctx, [body])
      inner.emit("\{i} += 1;")
      ctx.emit("}")
    }
    Break(_) =>
      match ctx.brk {
        Some(b) => ctx.emit("\{b} = 1;")
        None => ()
      }
    Continue(_) =>
      match ctx.cont {
        Some(c) => ctx.emit("\{c} = 1;")
        None => ()
      }
    _ => self.unsupported(s.span(), "this statement")
  }
}

///|
fn Lower::assign(
  self : Lower,
  ctx : Ctx,
  op : String,
  left : @ast.Expr,
  right : @ast.Expr,
  span : @ast.Span,
) -> Unit {
  let value = (current : Low?) => {
    let v = self.expr(ctx, right)
    match (op, current) {
      ("=", _) => v
      ("+=", Some(c)) =>
        if c.repr == Str {
          {
            code: "js_string_concat(\{c.code}, \{self.as_(v, Str)})",
            repr: Str,
          }
        } else {
          { code: "(\{self.as_(c, F64)} + \{self.as_(v, F64)})", repr: F64, }
        }
      (_, Some(c)) =>
        { code: "(\{self.as_(c, F64)} - \{self.as_(v, F64)})", repr: F64, }
      _ => v
    }
  }
  match left {
    Ident(id) =>
      match ctx.scope.get(id.name) {
        Some(Plain(loc, r)) => {
          let v = value(Some({ code: loc, repr: r, }))
          ctx.emit("\{loc} = \{self.as_(v, r)};")
        }
        _ => self.unsupported(span, "assigning to \{id.name}")
      }
    _ =>
      match self.place(ctx, left) {
        Some((f, steps)) => {
          let current = if op == "=" {
            None
          } else if steps.is_empty() {
            Some({ code: next_local(f), repr: self.field_repr(ctx, f), })
          } else {
            Some(
              (
                {
                  code: self.read_place(
                    self.as_(
                      { code: next_local(f), repr: self.field_repr(ctx, f), },
                      Val,
                    ),
                    steps[:],
                  ),
                  repr: Val,
                } : Low),
            )
          }
          let v = value(current)
          self.assign_place(ctx, f, steps, v)
        }
        None => self.unsupported(span, "this assignment")
      }
  }
}

///|
fn Lower::next_args(self : Lower, ctx : Ctx) -> String {
  ignore(self)
  match ctx.comp {
    Some(c) => c.fields.map(f => ", \{next_local(f.name)}").join("")
    None => ""
  }
}

///|
/// A component's handler, getter or query.
fn Lower::entry(
  self : Lower,
  c : @check.ComponentM,
  req : @gen.Required,
  f : @ast.Func,
  kind : String,
) -> Unit {
  let cw = c.name
  let ret = match kind {
    "on" if req.result.has_suffix("_swap_result") => ReturnSwap
    "on" | "answer" | "init" => ReturnState
    "binds" => {
      let st = req.result.trim_start(chars="&").to_owned()
      let lw = "\{cw}_loop_"
      let members = if st.has_prefix(lw) {
        c.loops
        .search_by(l => "\{lw}\{l.name}_binds" == st)
        .bind(i => c.loops[i].enrich)
        .unwrap_or([])
      } else {
        c.scopes
        .search_by(sc => "\{cw}_scope_\{sc.name}_binds" == st)
        .map(i => c.scopes[i].binds)
        .unwrap_or([])
      }
      ReturnBinds(st, members.map(m => (m.name, repr_of_ty(m.ty))))
    }
    _ => ReturnValue(repr_of_wax(req.result))
  }
  let ctx : Ctx = {
    scope: Map([]),
    out: [],
    indent: "    ",
    comp: Some(c),
    cw,
    ret,
    exits: [],
    brk: None,
    cont: None,
  }
  ctx.scope["this"] = StateVar("state")
  // The parameters: next, the args pattern's names, ctx.
  let wparams = req.params
  match kind {
    "on" | "answer" | "init" => {
      if f.params.get(0) is Some(PIdent(id)) {
        ctx.scope[id.name] = Next
      }
      // init's parameters are next and its ctx: it takes no args.
      if kind == "init" && f.params.get(1) is Some(PIdent(id)) {
        ctx.scope[id.name] = InitCtxName
      }
      match f.params.get(1) {
        Some(PArray(elements~, ..)) =>
          for i, el in elements {
            if el is Some(PIdent(id)) {
              // The handler's parameters after state (and ctx) are its args.
              let offset = if wparams.length() > 1 && wparams[1].0 == "ctx" {
                2
              } else {
                1
              }
              match wparams.get(offset + i) {
                Some((wname, wty)) =>
                  ctx.scope[id.name] = Plain(wname, repr_of_wax(wty))
                None => ()
              }
            }
          }
        _ => ()
      }
      if f.params.get(2) is Some(PIdent(id)) {
        ctx.scope[id.name] = CtxName
      }
      for field in c.fields {
        let r = repr_of_ty(field.ty)
        let wr = match r {
          Bool => "i32"
          F64 => "f64"
          Str => "js_string"
          Val => "&value"
        }
        ignore(wr)
        ctx.emit(
          "let \{next_local(field.name)} = state.\{@check.wax(field.name)};",
        )
      }
      ctx.emit("let pl_dirty = 0;")
    }
    _ =>
      for i, p in f.params {
        if p is PIdent(id) {
          match wparams.get(i + 1) {
            Some((wname, wty)) =>
              ctx.scope[id.name] = Plain(wname, repr_of_wax(wty))
            None => ()
          }
        }
      }
  }
  match f.body {
    BlockBody(b) => self.stmts(ctx, b.body)
    ExprBody(x) => self.stmt(ctx, Return(Some(x), span=x.span()))
  }
  match kind {
    "on" if req.result.has_suffix("_swap_result") =>
      ctx.emit("\{cw}_keep(pl_done(state, pl_dirty\{self.next_args(ctx)}));")
    "on" | "answer" | "init" =>
      ctx.emit("pl_done(state, pl_dirty\{self.next_args(ctx)});")
    "binds" => self.stmt(ctx, Return(None, span=f.span))
    _ => ctx.emit("\{self.default_of(repr_of_wax(req.result))};")
  }
  self.helpers.push("\{req.signature()} {\n\{ctx.out.join("\n")}\n}\n")
}

///|
/// An ask handler of the module (askHandlers.a): what it returns answers the
/// ask now, ok; its parameters are the ask's arguments.
fn Lower::ask_handler(
  self : Lower,
  req : @gen.Required,
  f : @ast.Func,
  result : Repr,
) -> Unit {
  let ctx : Ctx = {
    scope: Map([]),
    out: [],
    indent: "    ",
    comp: None,
    cw: "",
    ret: ReturnOk(result),
    exits: [],
    brk: None,
    cont: None,
  }
  for i, p in f.params {
    if p is PIdent(id) && req.params.get(i + 1) is Some((wname, wty)) {
      ctx.scope[id.name] = Plain(wname, repr_of_wax(wty))
    } else if p is PIdent(id) && i == f.params.length() - 1 {
      // The parameter after the ask's arguments: the asker's context.
      ctx.scope[id.name] = CtxName
    }
  }
  match f.body {
    BlockBody(b) => self.stmts(ctx, b.body)
    ExprBody(x) => {
      let v = self.expr(ctx, x)
      ctx.emit(
        "return outcome_ok(\{box_({ code: self.as_(v, result), repr: result })});",
      )
    }
  }
  ctx.emit("outcome_ok(value_undefined());")
  self.helpers.push("\{req.signature()} {\n\{ctx.out.join("\n")}\n}\n")
}

///|
/// A message's pre or post, or an invariant, as the predicate the glue
/// names: kind "pre" (prev, args, info), "post" (prev, next, args, info) or
/// "invariant" (no parameters); this is prev, as tutuca calls them. A
/// condition reads info's members only through what lowers (none yet).
fn Lower::condition(
  self : Lower,
  c : @check.ComponentM,
  kind : String,
  name : String,
  f : @ast.Func,
) -> Unit {
  let cw = c.name
  let st = "&\{cw}_state"
  let ctx : Ctx = {
    scope: Map([]),
    out: [],
    indent: "    ",
    comp: Some(c),
    cw,
    ret: ReturnValue(Bool),
    exits: [],
    brk: None,
    cont: None,
  }
  let (head, states, args_at) = match kind {
    "pre" =>
      (
        "fn \{cw}_when_\{name}: pre_fn (instance: &eq, args: &value_array, ctx: &context) -> i32 {",
        [("state", "instance")],
        1,
      )
    "post" =>
      (
        "fn \{cw}_ensures_\{name}: post_fn (prev: &eq, next: &eq, args: &value_array, ctx: &context) -> i32 {",
        [("prev_s", "prev"), ("next_s", "next")],
        2,
      )
    _ =>
      (
        "fn \{cw}_inv_\{name}: invariant_fn (instance: &eq) -> i32 {",
        [("state", "instance")],
        -1,
      )
  }
  for x in states {
    ctx.emit("let \{x.0} = \{x.1} as \{st};")
  }
  ctx.scope["this"] = StateVar(states[0].0)
  for i, p in f.params {
    match p {
      PIdent(id) if i < states.length() =>
        ctx.scope[id.name] = StateVar(states[i].0)
      PArray(elements~, ..) if i == args_at =>
        for j, el in elements {
          if el is Some(PIdent(id) as pat) {
            let r = self.pattern_repr(pat)
            let loc = self.fresh(id.name)
            ctx.emit(
              "let \{loc} = \{self.as_({ code: "pl_arg(args, \{j})", repr: Val }, r)};",
            )
            ctx.scope[id.name] = Plain(loc, r)
          }
        }
      _ => ()
    }
  }
  match f.body {
    BlockBody(b) => self.stmts(ctx, b.body)
    ExprBody(x) => {
      let v = self.expr(ctx, x)
      ctx.emit("return \{self.as_(v, Bool)};")
    }
  }
  ctx.emit("0;")
  self.helpers.push("\{head}\n\{ctx.out.join("\n")}\n}\n")
}

///|
/// A call of a page's host module: host_call with the arguments as a list;
/// an error (what the page threw) fails the task, and so does a result that
/// doesn't fit the member's declared result.
fn Lower::page_call(
  self : Lower,
  ctx : Ctx,
  m : String,
  name : String,
  args : Array[@ast.Expr],
  r : Repr,
  span : @ast.Span,
) -> Low {
  let qualified = "\{m}.\{name}"
  let results = match self.ch.host.find_member(m, name) {
    Some({ ty: FnT(sigs), .. }) => sigs.map(s => s.result)
    Some({ ty, .. }) => [ty]
    None => {
      self.unsupported(span, qualified)
      return { code: self.default_of(r), repr: r, }
    }
  }
  let a = self.fresh("ha")
  ctx.emit("let \{a} = list_empty();")
  for x in args {
    let l = self.expr(ctx, x)
    ctx.emit("\{a} = list_push(\{a}, \{box_(l)});")
  }
  let q = self.str_const(qualified)
  let res = self.fresh("hr")
  ctx.emit("let \{res} = pl_host_result(host_call(\{q}, \{a}));")
  let fits = self.fits_fn(
    if results.length() == 1 {
      results[0]
    } else {
      UnionT(results)
    },
  )
  let why = self.str_const(
    "\{qualified} returned a value that doesn't fit its declared type",
  )
  ctx.emit("if !\{fits}(\{res}) {")
  ctx.emit("    tutuca_fail(\{why});")
  ctx.emit("}")
  { code: self.as_({ code: res, repr: Val, }, r), repr: r, }
}

///|
/// The name of a function checking that a value is one of t's (writing it,
/// and those of the types it names, once each): data all the way down.
fn Lower::fits_fn(self : Lower, t : @types.Ty) -> String {
  let key = @purejs.type_text(t)
  match self.fits_fns.get(key) {
    Some(n) => return n
    None => ()
  }
  let n = "pl_fits_\{self.fits_fns.length()}"
  self.fits_fns[key] = n
  let out = ["fn \{n}: pl_fits_fn (v: &value) -> i32 {"]
  self.fits_body(t, "v", out, "    ")
  out.push("}")
  self.helpers.push(out.join("\n") + "\n")
  n
}

///|
/// Statements returning whether v is t's.
fn Lower::fits_body(
  self : Lower,
  t : @types.Ty,
  v : String,
  out : Array[String],
  ind : String,
) -> Unit {
  let ret = (e : String) => out.push("\{ind}\{e};")
  let fail_if = (cond : String) => {
    out.push("\{ind}if \{cond} {")
    out.push("\{ind}    return 0;")
    out.push("\{ind}}")
  }
  match t {
    NumberT => ret("pl_is_number(\{v})")
    StringT => ret("\{v}.kind == value_kind_string")
    BooleanT => ret("\{v}.kind == value_kind_bool")
    NullT | LitT(LNull) => ret("\{v}.kind == value_kind_null")
    UndefinedT | VoidT => ret("\{v}.kind == value_kind_undefined")
    // A generic member's result: data, as unknown.
    UnknownT | VarT(_) => ret("pl_is_data(\{v})")
    LitT(LStr(s)) =>
      ret(
        "(\{v}.kind == value_kind_string) & str_eq(pl_string_of(\{v}), \{self.str_const(s)})",
      )
    LitT(LNum(x)) =>
      ret(
        "pl_is_number(\{v}) & (value_to_f64(\{v}) == \{self.lit(LNum(x)).code})",
      )
    LitT(LBool(b)) =>
      ret("value_same(\{v}, value_bool(\{if b { 1 } else { 0 }}))")
    ListT(elem~, ..) => ret("pl_every_item(\{v}, \{self.fits_fn(elem)})")
    TupleT(elems~, ..) => {
      fail_if(
        "(\{v}.kind != value_kind_list) | (list_count(\{v}) != \{elems.length()})",
      )
      for i, e in elems {
        fail_if("!\{self.fits_fn(e)}(list_get(\{v}, \{i})!)")
      }
      ret("1")
    }
    DictT(value~, ..) =>
      ret(
        "(\{v}.kind == value_kind_map) & pl_every_item(map_values(\{v}), \{self.fits_fn(value)})",
      )
    RecordT(fields~, ..) => {
      fail_if("\{v}.kind != value_kind_map")
      for name, fld in fields {
        let f = self.fits_fn(fld.ty)
        let k = self.str_const(name)
        if fld.optional {
          // Absent, or undefined (null across the boundary), or one.
          fail_if(
            "!pl_nullish(pl_member(\{v}, \{k})) & !\{f}(pl_member(\{v}, \{k}))",
          )
        } else {
          fail_if("!map_has(\{v}, \{k}) | !\{f}(pl_member(\{v}, \{k}))")
        }
      }
      ret("1")
    }
    UnionT(ts) => {
      for x in ts {
        let f = self.fits_fn(x)
        out.push("\{ind}if \{f}(\{v}) {")
        out.push("\{ind}    return 1;")
        out.push("\{ind}}")
      }
      ret("0")
    }
    RefT(..) =>
      match self.ch.host.resolve(t) {
        RefT(..) => ret("0")
        resolved => ret("\{self.fits_fn(resolved)}(\{v})")
      }
    _ => ret("0")
  }
}

///|
/// A type's representation, from its text (a summary's).
fn repr_of_text(t : String) -> Repr {
  match t {
    "number" => F64
    "boolean" | "true" | "false" => Bool
    "string" => Str
    _ =>
      if t.split(" | ").all(p => p.has_prefix("\"") && p.has_suffix("\"")) {
        Str
      } else {
        Val
      }
  }
}

///|
fn wax_repr(r : Repr) -> String {
  match r {
    F64 => "f64"
    Bool => "i32"
    Str => "js_string"
    Val => "&value"
  }
}

///|
/// A module's helper, as pl_h_<name>.
fn Lower::helper(self : Lower, name : String, f : @ast.Func) -> Unit {
  guard self.helper_sigs.get(name) is Some((params, result)) else { return }
  let ctx : Ctx = {
    scope: Map([]),
    out: [],
    indent: "    ",
    comp: None,
    cw: "",
    ret: ReturnValue(result),
    exits: [],
    brk: None,
    cont: None,
  }
  let wparams = []
  for i, p in f.params {
    match p {
      PIdent(id) => {
        let w = "pl_p_\{id.name}"
        let r = params.get(i).unwrap_or(Val)
        ctx.scope[id.name] = Plain(w, r)
        wparams.push("\{w}: \{wax_repr(r)}")
      }
      _ => self.unsupported(f.span, "a helper parameter that isn't a name")
    }
  }
  match f.body {
    BlockBody(b) => self.stmts(ctx, b.body)
    ExprBody(x) => {
      let v = self.expr(ctx, x)
      ctx.emit("return \{self.as_(v, result)};")
    }
  }
  ctx.emit("\{self.default_of(result)};")
  self.helpers.push(
    "fn pl_h_\{name}(\{wparams.join(", ")}) -> \{wax_repr(result)} {\n\{ctx.out.join("\n")}\n}\n",
  )
}

///|
/// pl_done: the state again from next's locals, or the same state when
/// nothing was written.
fn Lower::done_fn(self : Lower, c : @check.ComponentM) -> String {
  ignore(self)
  let cw = c.name
  let params = c.fields.map(f => {
    let t = @gen.wax_ty(f.ty)
    ", \{@check.wax(f.name)}: \{t}"
  })
  let fields = c.fields.map(f => @check.wax(f.name)).join(", ")
  if c.fields.is_empty() {
    return "fn \{cw}_pl_done(state: &\{cw}_state, dirty: i32) -> &\{cw}_state {\n    state;\n}\n"
  }
  // Unchanged when every field is the one it was (Object.is, as immer keeps
  // a draft nothing changed in).
  let same = c.fields
    .map(f => {
      let n = @check.wax(f.name)
      match @gen.wax_ty(f.ty) {
        "js_string" => "str_eq(\{n}, state.\{n})"
        "f64" =>
          "((\{n} == state.\{n}) | ((\{n} != \{n}) & (state.\{n} != state.\{n})))"
        _ => "(\{n} == state.\{n})"
      }
    })
    .join(" & ")
  "fn \{cw}_pl_done(state: &\{cw}_state, dirty: i32\{params.join("")}) -> &\{cw}_state {\n    if !dirty {\n        return state;\n    }\n    if \{same} {\n        return state;\n    }\n    {\{cw}_state| \{fields} };\n}\n"
}

///|
/// The Wax implementing a checked module's components, and what couldn't be
/// lowered.
pub fn lower(
  path : String,
  src : String,
  checked : Checked,
  pkg : @check.Package,
) -> (String, Array[@diag.Diagnostic]) {
  let l : Lower = {
    path,
    src,
    ch: checked.checked,
    strings: Map([]),
    string_order: [],
    diags: [],
    temp: 0,
    helpers: [],
    helper_sigs: Map([]),
    host_imports: Map([]),
    pages: checked.pages,
    fits_fns: Map([]),
    consts: Map([]),
    decl_consts: checked.decls.consts,
  }
  for name, init in checked.decls.consts {
    match init {
      Lit(_, ..) | Unary(op="-", arg=Lit(LNum(_), ..), ..) =>
        l.consts[name] = init
      _ => ()
    }
  }
  for item in checked.m.items {
    if item.declaration() is Import(type_only=false, specs~, source~, ..) {
      let module_ = if source == data_host.specifier {
        Some(data_host.module_)
      } else {
        match checked.pages.search_by(p => p.specifier == source) {
          Some(i) => Some(checked.pages[i].module_)
          None => None
        }
      }
      if module_ is Some(mn) {
        for sp in specs {
          l.host_imports[sp.local_.name] = (mn, sp.imported.name)
        }
      }
    }
  }
  let helper_funcs = []
  for item in checked.m.items {
    if item.declaration() is FunctionDecl(f) && f.id is Some(id) {
      match checked.checked.summaries.search_by(x => x.0 == id.name) {
        Some(si) => {
          let summary = checked.checked.summaries[si].1
          l.helper_sigs[id.name] = (
            summary.params.map(p => repr_of_text(p.1)),
            repr_of_text(summary.result),
          )
          if summary.params.iter().any(p => p.2) {
            l.unsupported(f.span, "a helper that changes its parameters")
          }
          helper_funcs.push((id.name, f))
        }
        None => ()
      }
    }
  }
  for h in helper_funcs {
    l.helper(h.0, h.1)
  }
  let parts = []
  for c in pkg.components {
    guard components_of(checked.decls).search_by(x => x.name == c.name)
      is Some(ci) else {
      continue
    }
    let comp = components_of(checked.decls)[ci]
    let cw = c.name
    parts.push(l.done_fn(c))
    // The pre, post and invariant entries the glue names.
    for m in c.messages {
      guard handlers_of(comp, "on").search_by(h => h.0 == m.name) is Some(hi) else {
        continue
      }
      let h = handlers_of(comp, "on")[hi].1
      if m.pre_entry && member_of(h, "pre") is Some(Function(f, _)) {
        l.condition(c, "pre", m.name, f)
      }
      if m.post_entry && member_of(h, "post") is Some(Function(f, _)) {
        l.condition(c, "post", m.name, f)
      }
    }
    for inv in members_in(value_of(comp.literal, "invariants")) {
      if inv.1 is Function(f, _) {
        l.condition(c, "invariant", inv.0, f)
      }
    }
    let reqs = @gen.required_of(pkg, c)
    for req in reqs {
      let n = req.name
      if n.has_prefix("\{cw}_on_") {
        match c.messages.search_by(m => "\{cw}_on_\{m.name}" == n) {
          Some(mi) =>
            match
              handlers_of(comp, "on").search_by(h => h.0 == c.messages[mi].name) {
              Some(hi) =>
                match handler_run(handlers_of(comp, "on")[hi].1) {
                  Some(f) => l.entry(c, req, f, "on")
                  None => ()
                }
              None => ()
            }
          None => ()
        }
      } else if n == "\{cw}_init" {
        if member_of(comp.literal, "init") is Some(Function(f, _)) {
          l.entry(c, req, f, "init")
        }
      } else if n.has_prefix("\{cw}_reply_") {
        // An answer's outcome: answers.a.ok (error, unhandled).
        for a in handlers_of(comp, "answers") {
          for outcome in ["ok", "error", "unhandled"] {
            if "\{cw}_reply_\{a.0}_\{outcome}" == n &&
              member_of(a.1, outcome) is Some(Function(f, _)) {
              l.entry(c, req, f, "answer")
            }
          }
        }
      } else if n.has_prefix("\{cw}_loop_") {
        // A loop's hook: (state, key, item), this the state.
        for lp in members_in(value_of(comp.literal, "loops")) {
          guard lp.1 is Value(hooks) else { continue }
          for hook in ["prepare", "iter", "key", "filter", "enrich"] {
            if "\{cw}_loop_\{lp.0}_\{hook}" == n &&
              member_of(hooks, hook) is Some(Function(f, _)) {
              l.entry(
                c,
                req,
                f,
                if hook == "enrich" {
                  "binds"
                } else {
                  "loop"
                },
              )
            }
          }
        }
      } else if n.has_prefix("\{cw}_scope_") {
        // A scope's binds: binds.s(), this the state.
        for sc in members_in(value_of(comp.literal, "binds")) {
          if "\{cw}_scope_\{sc.0}" == n && sc.1 is Function(f, _) {
            l.entry(c, req, f, "binds")
          }
        }
      } else if n.has_prefix("\{cw}_get_") || n.has_prefix("\{cw}_query_") {
        for q in members_in(value_of(comp.literal, "queries")) {
          let prefix = if n.has_prefix("\{cw}_get_") {
            "\{cw}_get_"
          } else {
            "\{cw}_query_"
          }
          if "\{prefix}\{q.0}" == n && q.1 is Function(f, _) {
            l.entry(c, req, f, "query")
          }
        }
      }
    }
  }
  // The module's ask handlers.
  for req in @gen.required_of_package(pkg) {
    match checked.decls.consts.get("askHandlers") {
      Some(hs) =>
        for h in members_in(Some(hs)) {
          if req.name == "\{pkg.name}_answer_\{h.0}" && h.1 is Function(f, _) {
            let result = match
              checked.checked.entries.search_by(e => {
                e.path.join(".") == "askHandlers.\{h.0}"
              }) {
              Some(i) => repr_of_text(checked.checked.entries[i].return_type)
              None => Val
            }
            l.ask_handler(req, f, result)
          }
        }
      None => ()
    }
  }
  // The handlers end with pl_done(...): their component's, the name before
  // the first _ (KanbanLane_on_take is KanbanLane's), as no name has a _.
  let body = l.helpers
    .map(h => {
      let owner = pkg.components
        .iter()
        .find_first(c => h.has_prefix("fn \{c.name}_"))
      match owner {
        Some(c) => h.replace_all(old="pl_done(", new="\{c.name}_pl_done(")
        None => h
      }
    })
    .join("\n")
  let sb = StringBuilder()
  sb.write_string(
    "// Lowered by pure-tutuca from \{path}: the module's functions, as Wax. Don't edit it.\n\n",
  )
  if !l.string_order.is_empty() {
    sb.write_string("import \"'\" {\n")
    for t in l.string_order {
      sb.write_string("    #[import = \{wax_string_lit(t)}]\n")
      sb.write_string("    const \{l.strings[t]}: js_string;\n")
    }
    sb.write_string("}\n\n")
  }
  sb.write_string(runtime_helpers)
  sb.write_string("\n")
  for p in parts {
    sb.write_string(p)
    sb.write_string("\n")
  }
  sb.write_string(body)
  (sb.to_string(), l.diags)
}

///|
fn wax_string_lit(s : String) -> String {
  let sb = StringBuilder()
  sb.write_char('"')
  for c in s {
    match c {
      '"' => sb.write_string("\\\"")
      '\\' => sb.write_string("\\\\")
      '\n' => sb.write_string("\\n")
      '\t' => sb.write_string("\\t")
      _ => sb.write_char(c)
    }
  }
  sb.write_char('"')
  sb.to_string()
}
