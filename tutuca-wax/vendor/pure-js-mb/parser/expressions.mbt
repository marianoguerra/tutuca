///|
fn Parser::binding_identifier(self : Parser) -> @ast.Ident raise Stop {
  let t = self.tok
  if !(t.kind is Name) || @tables.is_keyword(t.text) {
    raise self.unexpected(message="expected a name")
  }
  self.next()
  let id : @ast.Ident = { name: t.text, span: self.here(t.start), ann: None, }
  check_bindable(id)
  id
}

///|
fn Parser::binding_target(self : Parser) -> @ast.Pattern raise Stop {
  if self.punct("[") {
    self.array_pattern()
  } else if self.punct("{") {
    self.object_pattern()
  } else {
    PIdent(self.binding_identifier())
  }
}

///|
/// A parameter or pattern element: a target, with a type when it's a
/// parameter, and a default.
fn Parser::binding_element(
  self : Parser,
  is_param : Bool,
) -> @ast.Pattern raise Stop {
  let start = self.tok.start
  if self.punct("...") {
    self.next()
    let arg = self.binding_target()
    let rest = @ast.PRest(arg~, ann=None, span=self.here(start))
    return if is_param && self.eat(":") {
      with_ann(rest, self.type_())
    } else {
      rest
    }
  }
  let mut target = self.binding_target()
  if is_param && self.punct("?") {
    raise excluded(OptionalParameter, self.tok.start, self.tok.end)
  }
  if is_param && self.eat(":") {
    target = with_ann(target, self.type_())
  }
  if self.eat("=") {
    let right = self.assign()
    return PAssign(left=target, right~, span=self.here(start))
  }
  target
}

///|
fn Parser::array_pattern(self : Parser) -> @ast.Pattern raise Stop {
  let start = self.tok.start
  self.next()
  let elements = []
  while !self.punct("]") {
    if self.punct(",") {
      self.next()
      elements.push(None)
      continue
    }
    let el = self.binding_element(false)
    elements.push(Some(el))
    if el is PRest(..) && !self.punct("]") {
      raise self.unexpected(message="a rest element must be last")
    }
    if !self.punct("]") {
      self.expect(",")
    }
  }
  self.next()
  PArray(elements~, ann=None, span=self.here(start))
}

///|
fn Parser::object_pattern(self : Parser) -> @ast.Pattern raise Stop {
  let start = self.tok.start
  self.next()
  let props = []
  while !self.punct("}") {
    let pstart = self.tok.start
    if self.punct("...") {
      self.next()
      let arg = self.binding_identifier()
      props.push(@ast.PPRest(arg~, span=self.here(pstart)))
    } else {
      let key = self.property_key()
      let (value, shorthand) = if self.eat(":") {
        (self.binding_element(false), false)
      } else {
        guard key is KIdent(kid) && !@tables.is_keyword(kid.name) else {
          raise self.unexpected(message="expected :")
        }
        check_bindable(kid)
        let copy = @ast.PIdent(kid)
        if self.eat("=") {
          let right = self.assign()
          (@ast.PAssign(left=copy, right~, span=self.here(pstart)), true)
        } else {
          (copy, true)
        }
      }
      props.push(PPProp(key~, value~, shorthand~, span=self.here(pstart)))
    }
    if !self.punct("}") {
      self.expect(",")
    }
  }
  self.next()
  PObject(props~, ann=None, span=self.here(start))
}

///|
fn Parser::property_key(self : Parser) -> @ast.PropKey raise Stop {
  let t = self.tok
  if self.punct("[") {
    self.next()
    let key = self.assign()
    self.expect("]")
    return KComputed(key)
  }
  match t.kind {
    Name => {
      self.next()
      KIdent({ name: t.text, span: self.here(t.start), ann: None, })
    }
    Str => {
      self.next()
      KLit(LStr(t.text), raw=t.raw, span=self.here(t.start))
    }
    Num => {
      self.next()
      KLit(LNum(t.number), raw=t.raw, span=self.here(t.start))
    }
    _ => {
      if self.punct("#") {
        raise excluded(PrivateName, t.start, t.end)
      }
      raise self.unexpected(message="expected a property name")
    }
  }
}

///|
fn Parser::expression(self : Parser) -> @ast.Expr raise Stop {
  let expr = self.assign()
  if self.punct(",") {
    raise excluded(Sequence, expr.span().start, self.tok.end)
  }
  expr
}

///|
fn Parser::arrow_ahead(self : Parser) -> Bool {
  let t = self.tok
  if t.kind is Name && !@tables.is_keyword(t.text) {
    return tok_is(self.peek(), Punct, text="=>")
  }
  self.punct("(") && self.paren_arrow_ahead()
}

///|
fn Parser::arrow(self : Parser) -> @ast.Func raise Stop {
  let start = self.tok.start
  self.push_scope(true)
  let params = if self.tok.kind is Name {
    let id = self.binding_identifier()
    self.bind_name(id, true)
    [@ast.PIdent(id)]
  } else {
    self.params()
  }
  let return_type = if self.eat(":") { Some(self.type_()) } else { None }
  if self.tok.newline_before {
    raise @diag.syntax_error(
      "a line break can't come before =>",
      self.tok.start,
      end=self.tok.end,
    )
  }
  self.expect("=>")
  let body = if self.punct("{") {
    @ast.BlockBody(self.function_body())
  } else {
    let loops = self.loops
    self.loops = 0
    let e = self.assign()
    self.loops = loops
    ExprBody(e)
  }
  self.pop_scope()
  {
    id: None,
    this_type: None,
    params,
    body,
    return_type,
    arrow: true,
    decl: false,
    span: self.here(start),
  }
}

///|
fn Parser::assign(self : Parser) -> @ast.Expr raise Stop {
  if self.arrow_ahead() {
    return Arrow(self.arrow())
  }
  if self.is_name("yield") {
    raise excluded(Generator, self.tok.start, self.tok.end)
  }
  let start = self.tok.start
  let left = self.conditional()
  if self.tok.kind is Punct && assign_ops.contains(self.tok.text) {
    let op = self.tok.text
    let ls = left.span()
    match left {
      ArrayLit(_, ..) | ObjectLit(_, ..) => {
        if op == "=" {
          raise excluded(DestructuringAssignment, ls.start, ls.end)
        }
        raise @diag.syntax_error(
          "invalid assignment target",
          ls.start,
          end=ls.end,
        )
      }
      Ident(id) => check_bindable(id)
      Member(..) => ()
      _ =>
        raise @diag.syntax_error(
          "invalid assignment target",
          ls.start,
          end=ls.end,
        )
    }
    self.next()
    let right = self.assign()
    return Assign(op~, left~, right~, span=self.here(start))
  }
  left
}

///|
fn Parser::conditional(self : Parser) -> @ast.Expr raise Stop {
  let start = self.tok.start
  let cond = self.binary()
  if !self.eat("?") {
    return cond
  }
  let cons = self.assign()
  self.expect(":")
  let alt = self.assign()
  Cond(cond~, cons~, alt~, span=self.here(start))
}

///|
fn Parser::binop(self : Parser) -> String? {
  let t = self.tok
  if t.kind is Punct && prec(t.text) is Some(_) {
    return Some(t.text)
  }
  if t.kind is Name && (t.text == "in" || t.text == "instanceof") {
    return Some(t.text)
  }
  None
}

///|
fn Parser::binary(self : Parser) -> @ast.Expr raise Stop {
  let start = self.tok.start
  let left = self.unary()
  self.binary_rest(left, start, -1)
}

///|
fn Parser::binary_rest(
  self : Parser,
  left : @ast.Expr,
  left_start : Int32,
  min_prec : Int32,
) -> @ast.Expr raise Stop {
  guard self.binop() is Some(op) else { return left }
  let mut p = prec(op).unwrap()
  if p <= min_prec {
    return left
  }
  if op == "**" {
    raise excluded(Exponent, self.tok.start, self.tok.end)
  }
  let logical = op == "||" || op == "&&"
  let coalesce = op == "??"
  if coalesce {
    p = 2
  }
  self.next()
  let right_start = self.tok.start
  let right = self.binary_rest(self.unary(), right_start, p)
  let node = if logical || coalesce {
    @ast.Logical(op~, left~, right~, span=self.here(left_start))
  } else {
    @ast.Binary(op~, left~, right~, span=self.here(left_start))
  }
  let next_op = self.binop()
  if (logical && next_op == Some("??")) ||
    (coalesce && (next_op == Some("||") || next_op == Some("&&"))) {
    raise @diag.syntax_error(
      "?? can't be mixed with || or && without parentheses",
      self.tok.start,
      end=self.tok.end,
    )
  }
  self.binary_rest(node, left_start, min_prec)
}

///|
fn Parser::unary(self : Parser) -> @ast.Expr raise Stop {
  let t = self.tok
  let start = t.start
  let is_unary = (t.kind is Punct && ["!", "-", "+", "~"].contains(t.text)) ||
    (t.kind is Name && ["typeof", "void", "delete"].contains(t.text))
  if is_unary {
    self.next()
    let arg = self.unary()
    if self.punct("**") {
      raise excluded(Exponent, self.tok.start, self.tok.end)
    }
    return Unary(op=t.text, arg~, span=self.here(start))
  }
  if self.punct("++") || self.punct("--") {
    self.next()
    let arg = self.unary()
    check_update_target(arg)
    return Update(op=t.text, prefix=true, arg~, span=self.here(start))
  }
  if self.is_name("await") {
    raise excluded(Async, start, t.end)
  }
  let mut expr = self.subscripts(self.atom(), start)
  if (self.punct("++") || self.punct("--")) && !self.tok.newline_before {
    let op = self.tok.text
    check_update_target(expr)
    self.next()
    expr = Update(op~, prefix=false, arg=expr, span=self.here(start))
  }
  expr
}

///|
fn check_update_target(e : @ast.Expr) -> Unit raise Stop {
  if !(e is (Ident(_) | Member(..))) {
    let s = e.span()
    raise @diag.syntax_error("invalid update target", s.start, end=s.end)
  }
}

///|
fn Parser::subscripts(
  self : Parser,
  base : @ast.Expr,
  start : Int32,
) -> @ast.Expr raise Stop {
  let mut expr = base
  let mut chained = false
  while true {
    if self.punct(".") {
      self.next()
      let property = @ast.Expr::Ident(self.member_name())
      expr = Member(
        object=expr,
        property~,
        computed=false,
        optional=false,
        span=self.here(start),
      )
    } else if self.punct("?.") {
      chained = true
      self.next()
      if self.punct("(") {
        let args = self.call_arguments()
        expr = Call(callee=expr, args~, optional=true, span=self.here(start))
      } else if self.punct("[") {
        self.next()
        let property = self.expression()
        self.expect("]")
        expr = Member(
          object=expr,
          property~,
          computed=true,
          optional=true,
          span=self.here(start),
        )
      } else if self.tok.kind is Template {
        raise @diag.syntax_error(
          "a template can't follow ?.",
          self.tok.start,
          end=self.tok.end,
        )
      } else {
        let property = @ast.Expr::Ident(self.member_name())
        expr = Member(
          object=expr,
          property~,
          computed=false,
          optional=true,
          span=self.here(start),
        )
      }
    } else if self.punct("[") {
      self.next()
      let property = self.expression()
      self.expect("]")
      expr = Member(
        object=expr,
        property~,
        computed=true,
        optional=false,
        span=self.here(start),
      )
    } else if self.punct("(") {
      let args = self.call_arguments()
      expr = Call(callee=expr, args~, optional=false, span=self.here(start))
    } else if self.tok.kind is Template && self.tok.head {
      raise excluded(TaggedTemplate, start, self.tok.end)
    } else if self.punct("!") && !self.tok.newline_before {
      raise excluded(TypeAssertion, start, self.tok.end)
    } else if (self.is_name("as") || self.is_name("satisfies")) &&
      !self.tok.newline_before {
      raise excluded(TypeAssertion, start, self.tok.end)
    } else {
      break
    }
  }
  if chained {
    expr = Chain(expr, span=self.here(start))
  }
  expr
}

///|
fn Parser::member_name(self : Parser) -> @ast.Ident raise Stop {
  let t = self.tok
  if self.punct("#") {
    raise excluded(PrivateName, t.start, t.end)
  }
  if !(t.kind is Name) {
    raise self.unexpected(message="expected a property name")
  }
  self.next()
  { name: t.text, span: self.here(t.start), ann: None, }
}

///|
fn Parser::call_arguments(self : Parser) -> Array[@ast.Expr] raise Stop {
  self.expect("(")
  let args = []
  while !self.punct(")") {
    if self.punct("...") {
      let start = self.tok.start
      self.next()
      let arg = self.assign()
      args.push(@ast.Spread(arg, span=self.here(start)))
    } else {
      args.push(self.assign())
    }
    if !self.punct(")") {
      self.expect(",")
    }
  }
  self.next()
  args
}

///|
fn Parser::atom(self : Parser) -> @ast.Expr raise Stop {
  let t = self.tok
  let start = t.start
  match t.kind {
    Name => {
      match t.text {
        "this" => {
          self.next()
          return This(self.here(start))
        }
        "null" => {
          self.next()
          return Lit(LNull, raw="null", span=self.here(start))
        }
        "true" | "false" => {
          self.next()
          return Lit(LBool(t.text == "true"), raw=t.text, span=self.here(start))
        }
        "function" => raise excluded(FunctionExpression, start, t.end)
        "class" => raise excluded(Class, start, t.end)
        "new" => {
          let n = self.peek()
          if tok_is(n, Punct, text=".") {
            raise excluded(MetaProperty, start, n.unwrap().end)
          }
          raise excluded(New, start, t.end)
        }
        "super" => raise excluded(Super, start, t.end)
        "import" => {
          let n = self.peek()
          raise excluded(
            if tok_is(n, Punct, text=".") {
              MetaProperty
            } else {
              DynamicImport
            },
            start,
            t.end,
          )
        }
        "async" => {
          let n = self.peek()
          match n {
            Some(n) if !n.newline_before &&
              (n.text == "function" || n.kind is Name) =>
              raise excluded(Async, start, n.end)
            _ => ()
          }
        }
        _ => ()
      }
      if @tables.is_keyword(t.text) {
        raise self.unexpected()
      }
      self.next()
      Ident({ name: t.text, span: self.here(start), ann: None, })
    }
    Num => {
      self.next()
      Lit(LNum(t.number), raw=t.raw, span=self.here(start))
    }
    Str => {
      self.next()
      Lit(LStr(t.text), raw=t.raw, span=self.here(start))
    }
    Template => self.template()
    Punct =>
      match t.text {
        "(" => {
          self.next()
          let expr = self.expression()
          self.expect(")")
          self.parenthesized.push(expr.span())
          expr
        }
        "[" => self.array_literal()
        "{" => self.object_literal()
        "/" | "/=" => raise excluded(Regex, start, t.end)
        "#" => raise excluded(PrivateName, start, t.end)
        "@" => raise excluded(Decorator, start, t.end)
        "<" => raise excluded(TypeAssertion, start, t.end)
        _ => raise self.unexpected()
      }
    Eof => raise self.unexpected()
  }
}

///|
fn Parser::template(self : Parser) -> @ast.Expr raise Stop {
  let start = self.tok.start
  let quasis = []
  let exprs = []
  while true {
    let t = self.tok
    if !(t.kind is Template) {
      raise self.unexpected(message="expected } in the template")
    }
    quasis.push(
      (
        {
          raw: t.raw,
          cooked: t.text,
          tail: t.tail,
          span: span(t.value_start, t.value_end),
        } : @ast.Quasi),
    )
    self.next()
    if t.tail {
      break
    }
    exprs.push(self.expression())
  }
  Template(quasis~, exprs~, span=self.here(start))
}

///|
fn Parser::array_literal(self : Parser) -> @ast.Expr raise Stop {
  let start = self.tok.start
  self.next()
  let elements : Array[@ast.Expr?] = []
  while !self.punct("]") {
    if self.punct(",") {
      self.next()
      elements.push(None)
      continue
    }
    if self.punct("...") {
      let sstart = self.tok.start
      self.next()
      let arg = self.assign()
      elements.push(Some(Spread(arg, span=self.here(sstart))))
    } else {
      elements.push(Some(self.assign()))
    }
    if !self.punct("]") {
      self.expect(",")
    }
  }
  self.next()
  ArrayLit(elements, span=self.here(start))
}

///|
fn Parser::object_literal(self : Parser) -> @ast.Expr raise Stop {
  let start = self.tok.start
  self.next()
  let members = []
  while !self.punct("}") {
    let pstart = self.tok.start
    if self.punct("...") {
      self.next()
      let arg = self.assign()
      members.push(@ast.SpreadMember(arg, span=self.here(pstart)))
    } else {
      if self.is_name("get") || self.is_name("set") || self.is_name("async") {
        match self.peek() {
          Some(n) if !(n.kind is Punct) || n.text == "[" || n.text == "*" => {
            if self.module_goal && self.is_name("get") && n.kind is Name {
              self.next()
              let key = self.property_key()
              let func = self.function_rest(self.tok.start, None)
              if func.params.length() > 0 {
                raise @diag.syntax_error(
                  "a getter takes no parameters",
                  func.span.start,
                  end=func.span.end,
                )
              }
              members.push(
                @ast.Method(key~, func~, getter=true, span=self.here(pstart)),
              )
              if !self.punct("}") {
                self.expect(",")
              }
              continue
            }
            raise excluded(
              if self.is_name("async") {
                Async
              } else {
                ObjectMethod
              },
              pstart,
              n.end,
            )
          }
          _ => ()
        }
      }
      if self.punct("*") {
        raise excluded(Generator, pstart, self.tok.end)
      }
      let key = self.property_key()
      if self.punct("(") {
        if !self.module_goal || key is KComputed(_) {
          raise excluded(ObjectMethod, pstart, self.tok.end)
        }
        let func = self.function_rest(self.tok.start, None)
        members.push(
          @ast.Method(key~, func~, getter=false, span=self.here(pstart)),
        )
        if !self.punct("}") {
          self.expect(",")
        }
        continue
      }
      let (value, shorthand) = if self.eat(":") {
        (self.assign(), false)
      } else {
        match key {
          KIdent(kid) if self.punct(",") || self.punct("}") => {
            if @tables.is_keyword(kid.name) {
              raise @diag.syntax_error(
                "\{kid.name} is a keyword",
                kid.span.start,
                end=kid.span.end,
              )
            }
            (@ast.Ident(kid), true)
          }
          _ => raise self.unexpected(message="expected :")
        }
      }
      members.push(Prop(key~, value~, shorthand~, span=self.here(pstart)))
    }
    if !self.punct("}") {
      self.expect(",")
    }
  }
  self.next()
  ObjectLit(members, span=self.here(start))
}
