// The parser: recursive descent over the tokens. A syntax error inside a
// member or an item is reported and the parser skips to its end (the next
// `;` at the same depth, or the `}` closing it), so one file can report more
// than its first mistake.

///|
priv suberror ParseFailed {
  ParseFailed(@diag.Diagnostic)
}

///|
priv struct Parser {
  toks : Array[Token]
  mut i : Int32
  diags : Array[@diag.Diagnostic]
}

///|
fn Parser::peek(self : Parser, ahead~ : Int32 = 0) -> Token {
  let i = self.i + ahead
  if i < self.toks.length() {
    self.toks[i]
  } else {
    self.toks[self.toks.length() - 1]
  }
}

///|
fn Parser::next(self : Parser) -> Token {
  let t = self.peek()
  if self.i < self.toks.length() - 1 {
    self.i += 1
  }
  t
}

///|
fn Parser::prev_span(self : Parser) -> @diag.Span {
  if self.i == 0 {
    self.peek().span
  } else {
    self.toks[self.i - 1].span
  }
}

///|
fn tok_text(t : Tok) -> String {
  match t {
    Ident(s) => "`\{s}`"
    Str(s) => s.escape()
    Int(s) | Float(s) => s
    Punct(s) => "`\{s}`"
    Eof => "the end of the file"
  }
}

///|
fn Parser::fail(self : Parser, what : String) -> ParseFailed {
  let t = self.peek()
  ParseFailed(
    @diag.error(
      "tcd.syntax.expected",
      t.span,
      "expected \{what}, found \{tok_text(t.tok)}",
    ),
  )
}

///|
fn Parser::is_punct(self : Parser, p : String) -> Bool {
  self.peek().tok is Punct(q) && q == p
}

///|
fn Parser::is_word(self : Parser, w : String, ahead~ : Int32 = 0) -> Bool {
  self.peek(ahead~).tok is Ident(s) && s == w
}

///|
fn Parser::eat_punct(self : Parser, p : String) -> Bool {
  if self.is_punct(p) {
    ignore(self.next())
    true
  } else {
    false
  }
}

///|
fn Parser::eat_word(self : Parser, w : String) -> Bool {
  if self.is_word(w) {
    ignore(self.next())
    true
  } else {
    false
  }
}

///|
fn Parser::expect_punct(
  self : Parser,
  p : String,
) -> @diag.Span raise ParseFailed {
  if self.is_punct(p) {
    self.next().span
  } else {
    raise self.fail("`\{p}`")
  }
}

///|
fn Parser::expect_word(self : Parser, w : String) -> Unit raise ParseFailed {
  if !self.eat_word(w) {
    raise self.fail("`\{w}`")
  }
}

///|
fn Parser::name(
  self : Parser,
  what~ : String = "a name",
) -> Name raise ParseFailed {
  let t = self.peek()
  match t.tok {
    Ident(s) => {
      ignore(self.next())
      { text: s, span: t.span, }
    }
    _ => raise self.fail(what)
  }
}

///|
fn Parser::names(self : Parser) -> Array[Name] raise ParseFailed {
  let out = [self.name()]
  while self.eat_punct(",") {
    out.push(self.name())
  }
  out
}

///|
/// Skips to the end of what failed: past the next `;` at this depth, or up
/// to (not past) a `}` that closes an enclosing block.
fn Parser::recover(self : Parser) -> Unit {
  let mut depth = 0
  for ;; {
    let t = self.peek()
    match t.tok {
      Eof => break
      Punct("{" | "(" | "[") => depth += 1
      Punct("}" | ")" | "]") => {
        if depth == 0 {
          break
        }
        depth -= 1
        if depth == 0 && t.tok is Punct("}") {
          ignore(self.next())
          if self.is_punct(";") {
            ignore(self.next())
          }
          break
        }
      }
      Punct(";") =>
        if depth == 0 {
          ignore(self.next())
          break
        }
      _ => ()
    }
    ignore(self.next())
  }
}

// ---- Literals and conditions ------------------------------------------------

///|
fn Parser::literal(self : Parser) -> (Lit, @diag.Span)? {
  let t = self.peek()
  let negative = self.is_punct("-") &&
    (self.peek(ahead=1).tok is Int(_) || self.peek(ahead=1).tok is Float(_))
  if negative {
    ignore(self.next())
    let n = self.next()
    let span = t.span.merge(n.span)
    return match n.tok {
      Int(s) => Some((Int(-int64_of(s)), span))
      Float(s) => Some((Float(-double_of(s)), span))
      _ => None
    }
  }
  let lit : Lit? = match t.tok {
    Int(s) => Some(Int(int64_of(s)))
    Float(s) => Some(Float(double_of(s)))
    Str(s) => Some(Str(s))
    Ident("true") => Some(Bool(true))
    Ident("false") => Some(Bool(false))
    Ident("null") => Some(Null)
    _ => None
  }
  match lit {
    Some(l) => {
      ignore(self.next())
      Some((l, t.span))
    }
    None => None
  }
}

///|
/// The lexer only makes number tokens of digits, so these don't fail.
fn int64_of(s : String) -> Int64 {
  @string.parse_int64(s) catch {
    _ => 0L
  }
}

///|
fn double_of(s : String) -> Double {
  @string.parse_double(s) catch {
    _ => 0.0
  }
}

///|
fn Parser::expr(self : Parser) -> Expr raise ParseFailed {
  let mut left = self.and_expr()
  while self.is_word("or") {
    ignore(self.next())
    let right = self.and_expr()
    left = Bin(Or, left, right, span=left.span().merge(right.span()))
  }
  left
}

///|
fn Parser::and_expr(self : Parser) -> Expr raise ParseFailed {
  let mut left = self.not_expr()
  while self.is_word("and") {
    ignore(self.next())
    let right = self.not_expr()
    left = Bin(And, left, right, span=left.span().merge(right.span()))
  }
  left
}

///|
fn Parser::not_expr(self : Parser) -> Expr raise ParseFailed {
  if self.is_word("not") && !self.is_word("in", ahead=1) {
    let start = self.next().span
    let e = self.not_expr()
    return Not(e, span=start.merge(e.span()))
  }
  self.relation()
}

///|
fn cmp_op(t : Tok) -> BinOp? {
  match t {
    Punct("==") => Some(Eq)
    Punct("!=") => Some(Ne)
    Punct("<") => Some(Lt)
    Punct("<=") => Some(Le)
    Punct(">") => Some(Gt)
    Punct(">=") => Some(Ge)
    _ => None
  }
}

///|
/// A comparison, chains included: `0 <= count < 100` is
/// `0 <= count and count < 100`.
fn Parser::relation(self : Parser) -> Expr raise ParseFailed {
  let first = self.sum()
  if self.is_word("in") {
    ignore(self.next())
    let right = self.sum()
    return Bin(In, first, right, span=first.span().merge(right.span()))
  }
  if self.is_word("not") && self.is_word("in", ahead=1) {
    ignore(self.next())
    ignore(self.next())
    let right = self.sum()
    return Bin(NotIn, first, right, span=first.span().merge(right.span()))
  }
  if self.is_word("matches") {
    ignore(self.next())
    let t = self.next()
    guard t.tok is Str(pattern) else {
      raise ParseFailed(
        @diag.error(
          "tcd.syntax.expected",
          t.span,
          "expected a pattern string after `matches`",
        ),
      )
    }
    return Matches(first, pattern, span=first.span().merge(t.span))
  }
  let mut left = first
  let mut result : Expr? = None
  while cmp_op(self.peek().tok) is Some(op) {
    ignore(self.next())
    let right = self.sum()
    let one = Bin(op, left, right, span=left.span().merge(right.span()))
    result = match result {
      None => Some(one)
      Some(r) => Some(Bin(And, r, one, span=r.span().merge(one.span())))
    }
    left = right
  }
  result.unwrap_or(first)
}

///|
fn Parser::sum(self : Parser) -> Expr raise ParseFailed {
  let mut left = self.atom()
  for ;; {
    let op : BinOp = if self.is_punct("+") {
      Add
    } else if self.is_punct("-") {
      Sub
    } else {
      break
    }
    ignore(self.next())
    let right = self.atom()
    left = Bin(op, left, right, span=left.span().merge(right.span()))
  }
  left
}

///|
fn Parser::atom(self : Parser) -> Expr raise ParseFailed {
  if self.literal() is Some((l, span)) {
    return Lit(l, span~)
  }
  // `not x` as an operand: `next.done == not done`.
  if self.is_word("not") && !self.is_word("in", ahead=1) {
    let start = self.next().span
    let e = self.atom()
    return Not(e, span=start.merge(e.span()))
  }
  let start = self.peek().span
  if self.eat_punct("(") {
    let e = self.expr()
    ignore(self.expect_punct(")"))
    return e
  }
  if self.eat_punct("[") {
    let items = []
    if !self.is_punct("]") {
      items.push(self.expr())
      while self.eat_punct(",") {
        if self.is_punct("]") {
          break
        }
        items.push(self.expr())
      }
    }
    let end = self.expect_punct("]")
    return List(items, span=start.merge(end))
  }
  if self.eat_punct("{") {
    let entries = []
    while !self.is_punct("}") {
      let n = self.name(what="a key")
      ignore(self.expect_punct(":"))
      entries.push((n, self.expr()))
      if !self.eat_punct(",") {
        break
      }
    }
    let end = self.expect_punct("}")
    return Record(entries, span=start.merge(end))
  }
  let n = self.name(what="a value, a name or a call")
  if self.eat_punct("(") {
    let args = []
    if !self.is_punct(")") {
      args.push(self.expr())
      while self.eat_punct(",") {
        args.push(self.expr())
      }
    }
    let end = self.expect_punct(")")
    return Call(n, args, span=n.span.merge(end))
  }
  let parts = [n]
  while self.is_punct(".") {
    ignore(self.next())
    parts.push(self.name(what="a member name"))
  }
  Path(parts, span=n.span.merge(parts[parts.length() - 1].span))
}

// ---- Types --------------------------------------------------------------------

///|
fn Parser::type_expr(self : Parser) -> TypeExpr raise ParseFailed {
  let n = self.name(what="a type")
  if n.text == "enum" {
    ignore(self.expect_punct("{"))
    let members = self.names()
    ignore(self.eat_punct(","))
    let end = self.expect_punct("}")
    return Enum(members, span=n.span.merge(end))
  }
  if n.text == "record" {
    ignore(self.expect_punct("{"))
    let fields = []
    while !self.is_punct("}") {
      let f = self.name(what="a field name")
      ignore(self.expect_punct(":"))
      fields.push((f, self.type_expr()))
      if !self.eat_punct(",") {
        break
      }
    }
    let end = self.expect_punct("}")
    return Record(fields, span=n.span.merge(end))
  }
  if self.eat_punct("<") {
    let args = [self.type_expr()]
    while self.eat_punct(",") {
      args.push(self.type_expr())
    }
    let end = self.expect_punct(">")
    return Apply(n, args, span=n.span.merge(end))
  }
  Named(n)
}

///|
fn Parser::where_clause(self : Parser) -> Expr? raise ParseFailed {
  if self.eat_word("where") {
    Some(self.expr())
  } else {
    None
  }
}

///|
fn Parser::params(self : Parser) -> Array[Param] raise ParseFailed {
  ignore(self.expect_punct("("))
  let out = []
  while !self.is_punct(")") {
    let name = self.name(what="a parameter name")
    ignore(self.expect_punct(":"))
    let ty = self.type_expr()
    let where_ = self.where_clause()
    out.push({ name, ty, where_, })
    if !self.eat_punct(",") {
      break
    }
  }
  ignore(self.expect_punct(")"))
  out
}

// ---- Views ----------------------------------------------------------------------

///|
fn Parser::view(self : Parser) -> ViewExpr raise ParseFailed {
  if self.literal() is Some((l, span)) {
    return Lit(l, span~)
  }
  let n = self.name(what="a view: a literal or a call")
  if !self.eat_punct("(") {
    return Name(n)
  }
  let attrs = []
  let childs = []
  while !self.is_punct(")") {
    // `key: value` is an attribute; a quoted key too.
    let is_attr = (self.peek().tok is Ident(_) || self.peek().tok is Str(_)) &&
      self.peek(ahead=1).tok is Punct(":")
    if is_attr {
      let t = self.next()
      let key : Name = match t.tok {
        Ident(s) | Str(s) => { text: s, span: t.span, }
        _ => panic()
      }
      ignore(self.next())
      let value = self.view()
      if !childs.is_empty() {
        self.diags.push(
          @diag.error(
            "tcd.view.attr_after_child",
            key.span,
            "the attribute \{key.text} comes after a child; attributes go first",
          ),
        )
      }
      attrs.push({ key, value, })
    } else {
      childs.push(self.view())
    }
    if !self.eat_punct(",") {
      break
    }
  }
  let end = self.expect_punct(")")
  Call(n, attrs, childs, span=n.span.merge(end))
}

// ---- Members ----------------------------------------------------------------------

///|
fn Parser::end_member(self : Parser) -> @diag.Span raise ParseFailed {
  self.expect_punct(";")
}

///|
fn Parser::field(
  self : Parser,
  doc : String?,
  is_get : Bool,
) -> Field raise ParseFailed {
  let start = self.prev_span()
  let name = self.name(what="a field name")
  ignore(self.expect_punct(":"))
  let ty = self.type_expr()
  let default = if !is_get && self.eat_punct("=") {
    Some(self.atom())
  } else {
    None
  }
  let where_ = self.where_clause()
  let sync = if !is_get && self.eat_punct("@") {
    self.expect_word("sync")
    ignore(self.expect_punct("("))
    let level = self.name(what="a sync level: shared, local or none")
    ignore(self.expect_punct(")"))
    Some(level)
  } else {
    None
  }
  let end = self.end_member()
  { doc, name, ty, default, where_, sync, span: start.merge(end), }
}

///|
fn Parser::emits(self : Parser) -> Array[Emit] raise ParseFailed {
  if self.eat_word("nothing") {
    return []
  }
  let out = []
  for ;; {
    let k = self.name(what="notify, ask, send or make")
    let kind : EmitKind = match k.text {
      "notify" => Notify
      "ask" => Ask
      "send" => Send
      "make" => Make
      _ =>
        raise ParseFailed(
          @diag.error(
            "tcd.syntax.emit",
            k.span,
            "an emit is notify, ask, send or make, not \{k.text}",
          ),
        )
    }
    let target = [self.name()]
    while self.eat_punct(".") {
      target.push(self.name())
    }
    out.push({
      kind,
      target,
      span: k.span.merge(target[target.length() - 1].span),
    })
    if !self.eat_punct(",") {
      break
    }
  }
  out
}

///|
fn Parser::message(self : Parser, doc : String?) -> Message raise ParseFailed {
  let start = self.prev_span()
  let name = self.name(what="a message name")
  let params = self.params()
  let mut swap = false
  if self.eat_punct("->") {
    self.expect_word("swap")
    swap = true
  }
  let mut source_key : Param? = None
  let mut when_ : Expr? = None
  let mut changes : Array[Name]? = None
  let mut ensures : Expr? = None
  let mut emits : Array[Emit]? = None
  for ;; {
    if self.is_word("source_key") {
      let k = self.next()
      ignore(self.expect_punct(":"))
      let ty = self.type_expr()
      let where_ = self.where_clause()
      source_key = Some({
        name: { text: "source_key", span: k.span, },
        ty,
        where_,
      })
    } else if self.eat_word("when") {
      when_ = Some(self.expr())
    } else if self.eat_word("changes") {
      changes = Some(if self.eat_word("nothing") { [] } else { self.names() })
    } else if self.eat_word("ensures") {
      ensures = Some(self.expr())
    } else if self.eat_word("emits") {
      emits = Some(self.emits())
    } else {
      break
    }
  }
  let end = self.end_member()
  {
    doc,
    name,
    params,
    swap,
    source_key,
    when_,
    changes,
    ensures,
    emits,
    span: start.merge(end),
  }
}

///|
fn Parser::signal(
  self : Parser,
  doc : String?,
  has_result : Bool,
) -> Signal raise ParseFailed {
  let start = self.prev_span()
  let name = self.name()
  let params = if self.is_punct("(") { self.params() } else { [] }
  let result = if has_result {
    ignore(self.expect_punct("->"))
    Some(self.type_expr())
  } else {
    None
  }
  let end = self.end_member()
  { doc, name, params, result, span: start.merge(end), }
}

///|
fn Parser::binds(self : Parser) -> Array[(Name, TypeExpr)] raise ParseFailed {
  ignore(self.expect_punct("{"))
  let out = []
  while !self.is_punct("}") {
    let n = self.name(what="a bind name")
    ignore(self.expect_punct(":"))
    out.push((n, self.type_expr()))
    if !self.eat_punct(",") && !self.eat_punct(";") {
      break
    }
  }
  ignore(self.expect_punct("}"))
  out
}

///|
fn Parser::loop_decl(self : Parser) -> LoopDecl raise ParseFailed {
  let start = self.prev_span()
  let name = self.name(what="a loop name")
  ignore(self.expect_punct("{"))
  let mut prepare : TypeExpr? = None
  let mut iter = false
  let mut key : TypeExpr? = None
  let mut filter = false
  let mut enrich : Array[(Name, TypeExpr)]? = None
  let mut view : Name? = None
  while !self.is_punct("}") {
    let hook = self.name(
      what="a loop hook: prepare, iter, key, filter, enrich or view",
    )
    match hook.text {
      "prepare" => {
        ignore(self.expect_punct(":"))
        prepare = Some(self.type_expr())
      }
      "iter" => iter = true
      "key" => {
        ignore(self.expect_punct(":"))
        key = Some(self.type_expr())
      }
      "filter" => filter = true
      "enrich" => enrich = Some(self.binds())
      "view" => {
        ignore(self.expect_punct(":"))
        view = Some(self.name(what="a view name"))
      }
      _ =>
        raise ParseFailed(
          @diag.error(
            "tcd.syntax.loop_hook",
            hook.span,
            "a loop hook is prepare, iter, key, filter, enrich or view, not \{hook.text}",
          ),
        )
    }
    if !self.eat_punct(";") && !self.eat_punct(",") {
      break
    }
  }
  let end = self.expect_punct("}")
  ignore(self.eat_punct(";"))
  { name, prepare, iter, key, filter, enrich, view, span: start.merge(end), }
}

///|
fn Parser::one_member(self : Parser) -> Member raise ParseFailed {
  let t = self.next()
  let doc = t.doc
  guard t.tok is Ident(word) else {
    self.i -= 1
    raise self.fail(
      "a member: field, get, message, notify, ask, invariant, init, loop, scope, provide or view",
    )
  }
  match word {
    "field" => Field(self.field(doc, false))
    "get" => Get(self.field(doc, true))
    "message" => Message(self.message(doc))
    "notify" => Notify(self.signal(doc, false))
    "ask" => Ask(self.signal(doc, true))
    "invariant" => {
      let name = self.name(what="an invariant name")
      ignore(self.expect_punct(":"))
      let cond = self.expr()
      let end = self.end_member()
      Invariant({ doc, name, cond, span: t.span.merge(end), })
    }
    "init" => Init(t.span.merge(self.end_member()))
    "loop" => Loop(self.loop_decl())
    "scope" => {
      let name = self.name(what="a scope name")
      let binds = self.binds()
      ignore(self.eat_punct(";"))
      Scope({ name, binds, span: t.span.merge(self.prev_span()), })
    }
    "provide" => {
      let name = self.name(what="a provided name")
      ignore(self.expect_punct("="))
      let source = self.view()
      let end = self.end_member()
      Provide({ name, source, span: t.span.merge(end), })
    }
    "view" => {
      let name = self.name(what="a view name")
      ignore(self.expect_punct("="))
      let body = self.view()
      let end = self.end_member()
      View({ doc, name, body, span: t.span.merge(end), })
    }
    _ => {
      self.i -= 1
      raise self.fail(
        "a member: field, get, message, notify, ask, invariant, init, loop, scope, provide or view",
      )
    }
  }
}

///|
fn Parser::decl(
  self : Parser,
  start : Token,
  implements_ok : Bool,
) -> Decl raise ParseFailed {
  let name = self.name(what="a name")
  let implements = if implements_ok && self.eat_punct(":") {
    self.names()
  } else {
    []
  }
  ignore(self.expect_punct("{"))
  let members = []
  while !self.is_punct("}") && !(self.peek().tok is Eof) {
    let at = self.i
    members.push(self.one_member()) catch {
      ParseFailed(d) => {
        self.diags.push(d)
        self.recover()
        if self.i == at {
          ignore(self.next())
        }
      }
    }
  }
  let end = self.expect_punct("}")
  { doc: start.doc, name, implements, members, span: start.span.merge(end), }
}

// ---- Items ------------------------------------------------------------------------

///|
fn Parser::example(self : Parser, start : Token) -> Example raise ParseFailed {
  let name = self.name(what="an example name")
  self.expect_word("for")
  let component = self.name(what="a component name")
  ignore(self.expect_punct("{"))
  let mut state = []
  let steps = []
  while !self.is_punct("}") {
    if self.eat_word("start") {
      match self.atom() {
        Record(entries, ..) => state = entries
        e =>
          raise ParseFailed(
            @diag.error(
              "tcd.syntax.expected",
              e.span(),
              "expected the start state as { field: value, ... }",
            ),
          )
      }
      ignore(self.eat_punct(";"))
    } else if self.is_word("send") {
      let s = self.next().span
      let msg = self.name(what="a message name")
      ignore(self.expect_punct("("))
      let args = []
      while !self.is_punct(")") {
        args.push(self.expr())
        if !self.eat_punct(",") {
          break
        }
      }
      let end = self.expect_punct(")")
      ignore(self.expect_punct(";"))
      steps.push(Step::Send(msg, args, span=s.merge(end)))
    } else if self.is_word("expect") {
      let s = self.next().span
      let cond = self.expr()
      let end = self.expect_punct(";")
      steps.push(Expect(cond, span=s.merge(end)))
    } else {
      raise self.fail("start, send or expect")
    }
  }
  let end = self.expect_punct("}")
  { name, component, start: state, steps, span: start.span.merge(end), }
}

///|
fn Parser::item(self : Parser, f : File) -> Unit raise ParseFailed {
  let t = self.next()
  guard t.tok is Ident(word) else {
    self.i -= 1
    raise self.fail(
      "an item: interface, component, register, ask_handler, host_ask, use or example",
    )
  }
  match word {
    "interface" => f.items.push(Interface(self.decl(t, false)))
    "component" => f.items.push(Component(self.decl(t, true)))
    "register" => {
      let regs = []
      for ;; {
        let name = self.name(what="a component name")
        let as_ = if self.eat_word("as") { Some(self.name()) } else { None }
        regs.push({ name, as_, })
        if !self.eat_punct(",") {
          break
        }
      }
      let end = self.end_member()
      f.items.push(Register(regs, span=t.span.merge(end)))
    }
    "ask_handler" => f.items.push(AskHandler(self.signal(t.doc, true)))
    "host_ask" => {
      let name = self.name(what="an ask name")
      ignore(self.end_member())
      f.items.push(HostAsk(name))
    }
    "use" => {
      let p = self.next()
      guard p.tok is Str(path) else {
        self.i -= 1
        raise self.fail("the quoted path of a .tcd file")
      }
      ignore(self.expect_punct("."))
      ignore(self.expect_punct("{"))
      let names = self.names()
      ignore(self.expect_punct("}"))
      let end = self.end_member()
      f.uses.push({ path, names, span: t.span.merge(end), })
    }
    "example" => f.items.push(Example(self.example(t)))
    _ => {
      self.i -= 1
      raise self.fail(
        "an item: interface, component, register, ask_handler, host_ask, use or example",
      )
    }
  }
}

///|
/// `package ns:name@version;`, its text as written.
fn Parser::package_line(
  self : Parser,
) -> (String, @diag.Span)? raise ParseFailed {
  if !self.is_word("package") {
    return None
  }
  let start = self.next().span
  let sb = StringBuilder()
  while !self.is_punct(";") && !(self.peek().tok is Eof) {
    let t = self.next()
    match t.tok {
      Ident(s) | Int(s) | Float(s) | Punct(s) => sb.write_string(s)
      _ => raise self.fail("a package name, like tutuca:todos@0.1.0")
    }
  }
  let end = self.end_member()
  Some((sb.to_string(), start.merge(end)))
}

///|
/// The syntax tree of a TCD file, and what it couldn't parse.
pub fn parse(path : String, src : String) -> (File, Array[@diag.Diagnostic]) {
  let (toks, lex_diags) = tokenize(path, src)
  let p = { toks, i: 0, diags: lex_diags, }
  let f = { path, package_decl: None, uses: [], items: [], }
  let package_decl = p.package_line() catch {
    ParseFailed(d) => {
      p.diags.push(d)
      p.recover()
      None
    }
  }
  let f = { ..f, package_decl, }
  while !(p.peek().tok is Eof) {
    let at = p.i
    p.item(f) catch {
      ParseFailed(d) => {
        p.diags.push(d)
        p.recover()
        if p.i == at {
          ignore(p.next())
        }
      }
    }
  }
  (f, p.diags)
}
