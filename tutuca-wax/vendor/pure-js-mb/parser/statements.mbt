///|
/// The program: one function, as a function expression, a method, a getter
/// or an arrow.
fn Parser::program(self : Parser) -> @ast.Program raise Stop {
  let start = self.tok.start
  let next_tok = self.peek()
  if self.is_name("async") &&
    (match next_tok {
      Some(n) => !n.newline_before && !(n.kind is Punct)
      None => false
    }) {
    raise excluded(Async, start, next_tok.unwrap().end)
  }
  let mut name : String? = None
  let (form, func) = if self.is_name("function") {
    self.next()
    if self.punct("*") {
      raise excluded(Generator, start, self.tok.end)
    }
    let id = if self.tok.kind is Name && !self.punct("(") {
      Some(self.binding_identifier())
    } else {
      None
    }
    (@ast.FunctionForm, self.function_rest(start, id))
  } else if self.punct("*") {
    raise excluded(Generator, start, self.tok.end)
  } else if (self.is_name("get") || self.is_name("set")) &&
    tok_is(next_tok, Name) {
    let kind = self.tok.text
    self.next()
    name = Some(self.tok.text)
    self.next()
    if kind == "set" {
      raise excluded(ObjectMethod, start, self.prev_end)
    }
    let f = self.function_rest(self.tok.start, None)
    if f.params.length() > 0 {
      raise @diag.syntax_error(
        "a getter takes no parameters",
        f.span.start,
        end=f.span.end,
      )
    }
    (@ast.GetterForm, f)
  } else if self.tok.kind is Name && tok_is(next_tok, Punct, text="(") {
    name = Some(self.tok.text)
    self.next()
    (@ast.MethodForm, self.function_rest(self.tok.start, None))
  } else if self.arrow_ahead() {
    (@ast.ArrowForm, self.arrow())
  } else {
    raise self.unexpected(message="expected a function")
  }
  if !(self.tok.kind is Eof) {
    raise self.unexpected(message="expected the end of the program")
  }
  { form, name, func, span: span(start, func.span.end), source: self.src, }
}

///|
fn Parser::function_rest(
  self : Parser,
  start : Int32,
  id : @ast.Ident?,
  decl~ : Bool = false,
) -> @ast.Func raise Stop {
  self.push_scope(true)
  let this_type = self.this_param()
  let params = self.params(open=this_type is Some(_))
  let return_type = if self.eat(":") { Some(self.type_()) } else { None }
  let body = self.function_body()
  self.pop_scope()
  {
    id,
    this_type,
    params,
    body: BlockBody(body),
    return_type,
    arrow: false,
    decl,
    span: self.here(start),
  }
}

///|
/// TypeScript's this parameter, (this: T, ...): what this is, erased as types
/// are. Only a module's functions have one.
fn Parser::this_param(self : Parser) -> @ast.TypeNode? raise Stop {
  if !self.module_goal || !self.punct("(") {
    return None
  }
  let at = self.lookahead(
    () => {
      self.next()
      self.is_name("this")
    },
    false,
  )
  if !at {
    return None
  }
  self.next()
  self.next()
  if !self.eat(":") {
    raise self.unexpected(message="expected : after this")
  }
  let t = self.type_()
  if !self.punct(")") {
    self.expect(",")
  }
  Some(t)
}

///|
fn Parser::params(
  self : Parser,
  open~ : Bool = false,
) -> Array[@ast.Pattern] raise Stop {
  if !open {
    self.expect("(")
  }
  let params = []
  while !self.punct(")") {
    params.push(self.binding_element(true))
    if !self.punct(")") {
      self.expect(",")
    }
  }
  self.next()
  for p in params {
    self.declare_pattern(Some(p), true)
  }
  params
}

///|
fn Parser::function_body(self : Parser) -> @ast.Block raise Stop {
  let start = self.tok.start
  self.expect("{")
  let loops = self.loops
  self.loops = 0
  let body = []
  let mut prologue = true
  while !self.punct("}") {
    if self.tok.kind is Eof {
      raise self.unexpected(message="expected }")
    }
    let stmt = self.statement(false)
    let stmt = match stmt {
      ExprStmt(Lit(LStr(_), raw~, span=lspan) as e, span~, ..) if prologue &&
        !self.parenthesized.contains(lspan) =>
        @ast.ExprStmt(
          e,
          directive=Some(
            raw.exact_view(start=1, end=raw.length() - 1).to_owned(),
          ),
          span~,
        )
      _ => {
        prologue = false
        stmt
      }
    }
    body.push(stmt)
  }
  self.next()
  self.loops = loops
  { body, span: self.here(start), }
}

///|
fn Parser::statement(self : Parser, single : Bool) -> @ast.Stmt raise Stop {
  let t = self.tok
  let start = t.start
  if t.kind is Punct {
    if t.text == "{" {
      return BlockStmt(self.block())
    }
    if t.text == ";" {
      raise excluded(EmptyStatement, start, t.end)
    }
  }
  if t.kind is Name {
    match t.text {
      "const" => {
        if single {
          raise @diag.syntax_error(
            "a declaration can't be a single statement",
            start,
            end=t.end,
          )
        }
        return self.declaration("const")
      }
      "let" => {
        let n = self.peek()
        if tok_is(n, Name) ||
          tok_is(n, Punct, text="[") ||
          tok_is(n, Punct, text="{") {
          if single {
            raise @diag.syntax_error(
              "a declaration can't be a single statement",
              start,
              end=t.end,
            )
          }
          return self.declaration("let")
        }
      }
      "var" => raise excluded(VarDeclaration, start, t.end)
      "if" => return self.if_statement()
      "return" => return self.return_statement()
      "for" => return self.for_statement()
      "while" | "do" => raise excluded(LoopStatement, start, t.end)
      "switch" => raise excluded(SwitchStatement, start, t.end)
      "try" => return self.try_statement()
      "throw" => return self.throw_statement()
      "break" | "continue" => return self.loop_control()
      "function" => raise excluded(FunctionDeclaration, start, t.end)
      "class" => raise excluded(ClassDeclaration, start, t.end)
      "export" => raise excluded(ModuleSyntax, start, t.end)
      "import" => {
        let n = self.peek()
        if !(tok_is(n, Punct, text="(") || tok_is(n, Punct, text=".")) {
          raise excluded(ModuleSyntax, start, t.end)
        }
      }
      "with" => raise excluded(WithStatement, start, t.end)
      "debugger" => raise excluded(DebuggerStatement, start, t.end)
      "async" => {
        let n = self.peek()
        match n {
          Some(n) if n.kind is Name && n.text == "function" && !n.newline_before =>
            raise excluded(Async, start, n.end)
          _ => ()
        }
      }
      _ => {
        let n = self.peek()
        if !@tables.is_keyword(t.text) && tok_is(n, Punct, text=":") {
          raise excluded(LabeledStatement, start, n.unwrap().end)
        }
      }
    }
  }
  let expression = self.expression()
  self.semicolon()
  ExprStmt(expression, directive=None, span=self.here(start))
}

///|
fn Parser::semicolon(self : Parser) -> Unit raise Stop {
  if self.eat(";") {
    return
  }
  let t = self.tok
  if t.kind is Eof || self.punct("}") || t.newline_before {
    raise excluded(MissingSemicolon, self.prev_end, self.prev_end)
  }
  raise self.unexpected(message="expected ;")
}

///|
fn Parser::block(self : Parser) -> @ast.Block raise Stop {
  let start = self.tok.start
  self.expect("{")
  self.push_scope(false)
  let body = []
  while !self.punct("}") {
    if self.tok.kind is Eof {
      raise self.unexpected(message="expected }")
    }
    body.push(self.statement(false))
  }
  self.next()
  self.pop_scope()
  { body, span: self.here(start), }
}

///|
fn with_ann(p : @ast.Pattern, ann : @ast.TypeNode) -> @ast.Pattern {
  match p {
    PIdent(id) => PIdent({ ..id, ann: Some(ann), })
    PArray(elements~, span~, ..) => PArray(elements~, ann=Some(ann), span~)
    PObject(props~, span~, ..) => PObject(props~, ann=Some(ann), span~)
    PRest(arg~, span~, ..) => PRest(arg~, ann=Some(ann), span~)
    PAssign(..) => p
  }
}

///|
fn Parser::declaration(self : Parser, kind : String) -> @ast.Stmt raise Stop {
  let start = self.tok.start
  self.next()
  let decls = []
  while true {
    let dstart = self.tok.start
    let mut id = self.binding_target()
    if self.eat(":") {
      id = with_ann(id, self.type_())
    }
    let init = if self.eat("=") {
      Some(self.assign())
    } else if kind == "const" {
      raise @diag.syntax_error(
        "a const needs a value",
        dstart,
        end=self.prev_end,
      )
    } else {
      None
    }
    decls.push(({ id, init, span: self.here(dstart), } : @ast.Declarator))
    self.declare_pattern(Some(id), false)
    if !self.eat(",") {
      break
    }
  }
  self.semicolon()
  VarDecl(kind~, decls~, span=self.here(start))
}

///|
fn Parser::if_statement(self : Parser) -> @ast.Stmt raise Stop {
  let start = self.tok.start
  self.next()
  self.expect("(")
  let cond = self.expression()
  self.expect(")")
  let cons = self.statement(true)
  let alt = if self.is_name("else") {
    self.next()
    Some(self.statement(true))
  } else {
    None
  }
  If(cond~, cons~, alt~, span=self.here(start))
}

///|
fn Parser::return_statement(self : Parser) -> @ast.Stmt raise Stop {
  let start = self.tok.start
  self.next()
  let mut argument = None
  if !self.punct(";") {
    if self.tok.kind is Eof || self.punct("}") {
      raise excluded(MissingSemicolon, self.prev_end, self.prev_end)
    }
    if self.tok.newline_before {
      raise excluded(LineBreakAfterReturn, start, self.tok.start)
    }
    argument = Some(self.expression())
  }
  self.semicolon()
  Return(argument, span=self.here(start))
}

///|
fn Parser::for_statement(self : Parser) -> @ast.Stmt raise Stop {
  let start = self.tok.start
  self.next()
  if self.is_name("await") {
    raise excluded(Async, start, self.tok.end)
  }
  self.expect("(")
  let kind = if self.tok.kind is Name { self.tok.text } else { "" }
  let is_decl = kind == "const" || kind == "let" || kind == "var"
  let follows = (word : String) => {
    is_decl &&
    self.lookahead(
      () => {
        self.next()
        ignore(self.binding_target())
        self.is_name(word)
      },
      false,
    )
  }
  if follows("in") {
    raise excluded(ForInStatement, start, self.tok.end)
  }
  if !follows("of") {
    raise excluded(LoopStatement, start, self.tok.end)
  }
  if kind == "var" {
    raise excluded(VarDeclaration, self.tok.start, self.tok.end)
  }
  self.push_scope(false)
  let lstart = self.tok.start
  self.next()
  let dstart = self.tok.start
  let id = self.binding_target()
  self.declare_pattern(Some(id), false)
  let declarator : @ast.Declarator = {
    id,
    init: None,
    span: self.here(dstart),
  }
  let left = @ast.VarDecl(kind~, decls=[declarator], span=self.here(lstart))
  self.next() // of
  let right = self.assign()
  self.expect(")")
  self.loops += 1
  let body = self.statement(true)
  self.loops -= 1
  self.pop_scope()
  ForOf(left~, right~, body~, span=self.here(start))
}

///|
fn Parser::try_statement(self : Parser) -> @ast.Stmt raise Stop {
  let start = self.tok.start
  self.next()
  let block = self.block()
  let mut handler = None
  let mut finalizer = None
  if self.is_name("catch") {
    let cstart = self.tok.start
    self.next()
    self.push_scope(true)
    let mut param = None
    if self.eat("(") {
      let p = self.binding_target()
      self.declare_pattern(Some(p), true)
      self.expect(")")
      param = Some(p)
    }
    let bstart = self.tok.start
    self.expect("{")
    let body = []
    while !self.punct("}") {
      if self.tok.kind is Eof {
        raise self.unexpected(message="expected }")
      }
      body.push(self.statement(false))
    }
    self.next()
    self.pop_scope()
    let cbody : @ast.Block = { body, span: self.here(bstart), }
    handler = Some(
      ({ param, body: cbody, span: self.here(cstart), } : @ast.CatchClause),
    )
  }
  if self.is_name("finally") {
    self.next()
    finalizer = Some(self.block())
  }
  if handler is None && finalizer is None {
    raise self.unexpected(message="expected catch or finally")
  }
  Try(block~, handler~, finalizer~, span=self.here(start))
}

///|
fn Parser::throw_statement(self : Parser) -> @ast.Stmt raise Stop {
  let start = self.tok.start
  self.next()
  if self.tok.newline_before {
    raise @diag.syntax_error(
      "a line break can't follow throw",
      start,
      end=self.tok.start,
    )
  }
  let argument = self.expression()
  self.semicolon()
  Throw(argument, span=self.here(start))
}

///|
fn Parser::loop_control(self : Parser) -> @ast.Stmt raise Stop {
  let start = self.tok.start
  let kind = self.tok.text
  self.next()
  if self.tok.kind is Name && !self.tok.newline_before {
    raise excluded(LabeledStatement, start, self.tok.end)
  }
  if self.loops == 0 {
    raise @diag.syntax_error(
      "\{kind} is only allowed in a loop",
      start,
      end=self.prev_end,
    )
  }
  self.semicolon()
  if kind == "break" {
    Break(self.here(start))
  } else {
    Continue(self.here(start))
  }
}
