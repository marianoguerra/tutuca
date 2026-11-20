// A module, as the reference's Parser.module: imports and declarations (const,
// function, type, interface), each maybe exported. Types live apart from
// values, as in TypeScript: a type and a const may share a name.

///|
fn Parser::module_(self : Parser) -> @ast.Module raise Stop {
  let start = self.tok.start
  self.push_scope(true)
  let items = []
  while !(self.tok.kind is Eof) {
    items.push(self.item())
  }
  self.pop_scope()
  { items, span: self.here(start), source: self.src, }
}

///|
fn Parser::item(self : Parser) -> @ast.Item raise Stop {
  let start = self.tok.start
  if self.is_name("import") {
    return self.import_declaration()
  }
  if self.is_name("export") {
    self.next()
    if self.is_name("default") || self.punct("{") || self.punct("*") {
      raise excluded(DefaultExport, start, self.tok.end)
    }
    let d = self.declaration_item()
    return Export(d, span=self.here(start))
  }
  self.declaration_item()
}

///|
fn Parser::declaration_item(self : Parser) -> @ast.Item raise Stop {
  let t = self.tok
  if t.kind is Name {
    let n = self.peek()
    match t.text {
      "const" => return Const(self.declaration("const"))
      "let" => raise excluded(ModuleLet, t.start, t.end)
      "var" => raise excluded(VarDeclaration, t.start, t.end)
      "function" => {
        self.next()
        if self.punct("*") {
          raise excluded(Generator, t.start, self.tok.end)
        }
        let id = self.binding_identifier()
        self.bind_name(id, false)
        return FunctionDecl(self.function_rest(t.start, Some(id), decl=true))
      }
      "async" =>
        raise excluded(
          Async,
          t.start,
          match n {
            Some(n) => n.end
            None => t.end
          },
        )
      "class" => raise excluded(ClassDeclaration, t.start, t.end)
      "type" => if tok_is(n, Name) { return self.type_alias() }
      "interface" => if tok_is(n, Name) { return self.interface_declaration() }
      _ => ()
    }
  }
  let end = self.lookahead(
    () => {
      let s = self.statement(false)
      s.span().end
    },
    t.end,
  )
  raise excluded(ModuleStatement, t.start, end)
}

///|
fn Parser::type_name(self : Parser) -> @ast.Ident raise Stop {
  let t = self.tok
  if !(t.kind is Name) ||
    @tables.is_keyword(t.text) ||
    type_keyword_names.contains(t.text) {
    raise self.unexpected(message="expected a type name")
  }
  self.next()
  if self.type_names.contains(t.text) {
    raise @diag.syntax_error(
      "the type \{t.text} is already declared",
      t.start,
      end=t.end,
    )
  }
  self.type_names.push(t.text)
  if self.punct("<") {
    raise excluded(GenericType, t.start, self.tok.end)
  }
  { name: t.text, span: span(t.start, t.end), ann: None, }
}

///|
fn Parser::type_alias(self : Parser) -> @ast.Item raise Stop {
  let start = self.tok.start
  self.next()
  let id = self.type_name()
  self.expect("=")
  let value = self.type_()
  self.semicolon()
  TypeAlias(id~, value~, span=self.here(start))
}

///|
fn Parser::interface_declaration(self : Parser) -> @ast.Item raise Stop {
  let start = self.tok.start
  self.next()
  let id = self.type_name()
  if self.is_name("extends") {
    raise excluded(GenericType, self.tok.start, self.tok.end)
  }
  if !self.punct("{") {
    raise self.unexpected(message="expected {")
  }
  let body = self.object_type()
  Interface(id~, body~, span=self.here(start))
}

///|
fn Parser::import_declaration(self : Parser) -> @ast.Item raise Stop {
  let start = self.tok.start
  self.next()
  let mut type_only = false
  if self.is_name("type") && tok_is(self.peek(), Punct, text="{") {
    self.next()
    type_only = true
  }
  if self.tok.kind is Str || self.punct("*") {
    raise excluded(NamespaceImport, start, self.tok.end)
  }
  if !self.punct("{") {
    raise excluded(DefaultExport, start, self.tok.end)
  }
  self.next()
  let specs = []
  while !self.punct("}") {
    let sstart = self.tok.start
    let it = self.tok
    if !(it.kind is Name) {
      raise self.unexpected(message="expected a name to import")
    }
    self.next()
    let imported : @ast.Ident = {
      name: it.text,
      span: span(it.start, it.end),
      ann: None,
    }
    let mut local_ = imported
    if self.is_name("as") {
      self.next()
      local_ = self.binding_identifier()
    }
    if type_only {
      if self.type_names.contains(local_.name) {
        raise @diag.syntax_error(
          "the type \{local_.name} is already declared",
          local_.span.start,
          end=local_.span.end,
        )
      }
      self.type_names.push(local_.name)
    } else {
      self.bind_name(local_, false)
    }
    specs.push(
      ({ imported, local_, span: self.here(sstart), } : @ast.ImportSpec),
    )
    if !self.punct("}") {
      self.expect(",")
    }
  }
  self.next()
  if !self.is_name("from") {
    raise self.unexpected(message="expected from")
  }
  self.next()
  let st = self.tok
  if !(st.kind is Str) {
    raise self.unexpected(message="expected where to import from")
  }
  self.next()
  self.semicolon()
  Import(
    type_only~,
    specs~,
    source=st.text,
    raw=st.raw,
    source_span=span(st.start, st.end),
    span=self.here(start),
  )
}

///|
/// Parses a module: Ok(module), or the diagnostic it stopped at.
pub fn parse_module(source : String) -> Result[@ast.Module, @diag.Diagnostic] {
  try {
    let p = Parser::new(source, module_goal=true)
    p.module_()
  } catch {
    Stop(d) => Err(d)
  } noraise {
    m => Ok(m)
  }
}
