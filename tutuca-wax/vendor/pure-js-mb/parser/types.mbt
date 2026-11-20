// Types: what TypeScript writes after a colon, as far as pure-js reads it.
// Hosts declare with the same grammar, so it also has function types,
// generics and methods.

///|
fn Parser::type_(self : Parser) -> @ast.TypeNode raise Stop {
  if self.punct("<") {
    return self.function_type()
  }
  if self.punct("(") && self.paren_arrow_ahead() {
    return self.function_type()
  }
  self.union_type()
}

///|
fn Parser::type_params(self : Parser) -> Array[String] raise Stop {
  let names = []
  if !self.eat("<") {
    return names
  }
  while !self.punct(">") {
    let t = self.tok
    if !(t.kind is Name) {
      raise self.unexpected(message="expected a type parameter")
    }
    self.next()
    if self.is_name("extends") {
      raise excluded(GenericType, t.start, self.tok.end)
    }
    names.push(t.text)
    if !self.punct(">") {
      self.expect(",")
    }
  }
  self.next()
  names
}

///|
fn Parser::type_param_list(self : Parser) -> Array[@ast.TypeParam] raise Stop {
  self.expect("(")
  let params = []
  while !self.punct(")") {
    let start = self.tok.start
    let rest = self.eat("...")
    let t = self.tok
    if !(t.kind is Name) {
      raise self.unexpected(message="expected a parameter name")
    }
    self.next()
    let optional = self.eat("?")
    self.expect(":")
    let value = self.type_()
    params.push(
      (
        { name: t.text, optional, rest, value, span: self.here(start), } :
        @ast.TypeParam),
    )
    if !self.punct(")") {
      self.expect(",")
    }
  }
  self.next()
  params
}

///|
fn Parser::function_type(self : Parser) -> @ast.TypeNode raise Stop {
  let start = self.tok.start
  let type_params = self.type_params()
  let params = self.type_param_list()
  self.expect("=>")
  let result = self.type_()
  TFunction(type_params~, params~, result~, span=self.here(start))
}

///|
fn Parser::union_type(self : Parser) -> @ast.TypeNode raise Stop {
  let start = self.tok.start
  ignore(self.eat("|"))
  let first = self.array_type()
  if !self.punct("|") {
    return first
  }
  let types = [first]
  while self.eat("|") {
    types.push(self.array_type())
  }
  TUnion(types, self.here(start))
}

///|
fn Parser::array_type(self : Parser) -> @ast.TypeNode raise Stop {
  let start = self.tok.start
  let mut t = self.primary_type()
  while self.punct("[") && !self.tok.newline_before {
    if !tok_is(self.peek(), Punct, text="]") {
      break
    }
    self.next()
    self.next()
    t = TArray(t, self.here(start))
  }
  t
}

///|
fn Parser::primary_type(self : Parser) -> @ast.TypeNode raise Stop {
  let t = self.tok
  let start = t.start
  match t.kind {
    Name => {
      if type_keyword_names.contains(t.text) || t.text == "null" {
        self.next()
        return TKeyword(t.text, self.here(start))
      }
      if t.text == "true" || t.text == "false" {
        self.next()
        return TLiteral(LBool(t.text == "true"), self.here(start))
      }
      if t.text == "readonly" {
        self.next()
        let operand = self.array_type()
        return TReadonly(operand, self.here(start))
      }
      if ["typeof", "keyof", "infer", "unique"].contains(t.text) {
        raise excluded(TypeKeyword, start, t.end)
      }
      if @tables.is_keyword(t.text) {
        raise self.unexpected(message="expected a type")
      }
      self.next()
      let args = []
      if self.eat("<") {
        while !self.punct(">") {
          args.push(self.type_())
          if !self.punct(">") {
            self.expect(",")
          }
        }
        self.next()
      }
      if self.punct(".") {
        raise excluded(GenericType, start, self.tok.end)
      }
      TRef(t.text, args, self.here(start))
    }
    Str => {
      self.next()
      TLiteral(LStr(t.text), self.here(start))
    }
    Num => {
      self.next()
      TLiteral(LNum(t.number), self.here(start))
    }
    Template => raise excluded(TypeKeyword, start, t.end)
    _ => {
      if self.punct("-") {
        self.next()
        if !(self.tok.kind is Num) {
          raise self.unexpected(message="expected a number")
        }
        let value = -self.tok.number
        self.next()
        return TLiteral(LNum(value), self.here(start))
      }
      if self.punct("(") {
        self.next()
        let inner = self.type_()
        self.expect(")")
        return inner
      }
      if self.punct("[") {
        self.next()
        let elements = []
        while !self.punct("]") {
          elements.push(self.type_())
          if !self.punct("]") {
            self.expect(",")
          }
        }
        self.next()
        return TTuple(elements, self.here(start))
      }
      if self.punct("{") {
        return self.object_type()
      }
      raise self.unexpected(message="expected a type")
    }
  }
}

///|
fn Parser::object_type(self : Parser) -> @ast.TypeNode raise Stop {
  let start = self.tok.start
  self.next()
  let members = []
  while !self.punct("}") {
    let mstart = self.tok.start
    let mut read_only = false
    if self.is_name("readonly") {
      match self.peek() {
        Some(n) if !(n.kind is Punct &&
          (n.text == ":" || n.text == "?" || n.text == "(")) => {
          self.next()
          read_only = true
        }
        _ => ()
      }
    }
    if self.punct("[") {
      self.next()
      let k = self.tok
      if !(k.kind is Name) {
        raise self.unexpected(message="expected a key name")
      }
      self.next()
      self.expect(":")
      let key = self.type_()
      self.expect("]")
      self.expect(":")
      let value = self.type_()
      members.push(
        @ast.TMIndex(key_name=k.text, key~, value~, span=self.here(mstart)),
      )
    } else {
      let k = self.tok
      if !(k.kind is Name || k.kind is Str) {
        raise self.unexpected(message="expected a member name")
      }
      self.next()
      let optional = self.eat("?")
      if self.punct("(") || self.punct("<") {
        let type_params = self.type_params()
        let params = self.type_param_list()
        self.expect(":")
        let result = self.type_()
        members.push(
          TMMethod(
            name=k.text,
            optional~,
            type_params~,
            params~,
            result~,
            span=self.here(mstart),
          ),
        )
      } else {
        self.expect(":")
        let value = self.type_()
        members.push(
          TMProperty(
            name=k.text,
            optional~,
            read_only~,
            value~,
            span=self.here(mstart),
          ),
        )
      }
    }
    if !self.eat(";") &&
      !self.eat(",") &&
      !self.punct("}") &&
      !self.tok.newline_before {
      raise self.unexpected(message="expected ; or }")
    }
  }
  self.next()
  TObject(members, self.here(start))
}

///|
/// Parses one program: Ok(program), or the diagnostic it stopped at.
pub fn parse(source : String) -> Result[@ast.Program, @diag.Diagnostic] {
  try {
    let p = Parser::new(source)
    p.program()
  } catch {
    Stop(d) => Err(d)
  } noraise {
    program => Ok(program)
  }
}

///|
/// Parses a type on its own, as hosts declare them.
pub fn parse_type(source : String) -> Result[@ast.TypeNode, @diag.Diagnostic] {
  try {
    let p = Parser::new(source)
    let t = p.type_()
    if !(p.tok.kind is Eof) {
      raise p.unexpected(message="expected the end of the type")
    }
    t
  } catch {
    Stop(d) => Err(d)
  } noraise {
    t => Ok(t)
  }
}
