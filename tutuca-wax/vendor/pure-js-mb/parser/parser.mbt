// The parser, as the reference's lib/parse.js: pure-js source to a Program. It
// parses the subset, what profiles may admit (let, for-of, try, destructuring)
// and TypeScript's erasable annotations, making the nodes acorn makes. Forms it
// can't represent and pure-js leaves out it reports by their feature; the sieve
// decides the rest. It stops at the first problem.

///|
let strict_unbindable : Array[String] = [
  "eval", "arguments", "implements", "interface", "let", "package", "private", "protected",
  "public", "static", "yield", "await",
]

///|
fn prec(op : String) -> Int32? {
  match op {
    "??" | "||" => Some(1)
    "&&" => Some(2)
    "|" => Some(3)
    "^" => Some(4)
    "&" => Some(5)
    "==" | "!=" | "===" | "!==" => Some(6)
    "<" | ">" | "<=" | ">=" | "in" | "instanceof" => Some(7)
    "<<" | ">>" | ">>>" => Some(8)
    "+" | "-" => Some(9)
    "*" | "/" | "%" => Some(10)
    "**" => Some(11)
    _ => None
  }
}

///|
let assign_ops : Array[String] = [
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=",
  "&&=", "||=", "??=",
]

///|
let type_keyword_names : Array[String] = [
  "number", "string", "boolean", "undefined", "unknown", "void", "any", "never",
  "object", "symbol", "bigint",
]

///|
priv struct Scope {
  names : Array[String]
  params : Array[String]?
}

///|
priv struct Parser {
  src : String
  lex : @lexer.Lexer
  mut tok : @lexer.Token
  mut prev_end : Int32
  /// The spans of parenthesized expressions.
  parenthesized : Array[@ast.Span]
  scopes : Array[Scope]
  mut loops : Int32
  /// A module's goal: its items, methods and getters in object literals (the
  /// sieve says where they may be), and this parameters.
  module_goal : Bool
  type_names : Array[String]
}

///|
using @diag {type Stop}

///|
fn Parser::new(src : String, module_goal~ : Bool = false) -> Parser raise Stop {
  let lex = @lexer.Lexer::new(src)
  let tok = lex.next()
  {
    src,
    lex,
    tok,
    prev_end: 0,
    parenthesized: [],
    scopes: [],
    loops: 0,
    module_goal,
    type_names: [],
  }
}

///|
fn Parser::next(self : Parser) -> Unit raise Stop {
  self.prev_end = self.tok.end
  self.tok = self.lex.next()
}

///|
fn Parser::punct(self : Parser, p : String) -> Bool {
  self.tok.kind is Punct && self.tok.text == p
}

///|
fn Parser::is_name(self : Parser, n : String) -> Bool {
  self.tok.kind is Name && self.tok.text == n
}

///|
fn Parser::eat(self : Parser, p : String) -> Bool raise Stop {
  if !self.punct(p) {
    return false
  }
  self.next()
  true
}

///|
fn Parser::expect(self : Parser, p : String) -> Unit raise Stop {
  if !self.eat(p) {
    raise self.unexpected(message="expected \{p}")
  }
}

///|
fn Parser::unexpected(self : Parser, message? : String) -> Stop {
  let t = self.tok
  let what = if t.kind is Eof {
    "the end of the program"
  } else {
    self.src.exact_view(start=t.start, end=t.end).to_owned().escape()
  }
  let text = match message {
    None => "unexpected \{what}"
    Some(m) => "\{m}, found \{what}"
  }
  @diag.syntax_error(text, t.start, end=t.end)
}

///|
fn span(start : Int32, end : Int32) -> @ast.Span {
  { start, end, }
}

///|
fn Parser::here(self : Parser, start : Int32) -> @ast.Span {
  { start, end: self.prev_end, }
}

///|
/// What the tokens after the current one are, without consuming them; a
/// problem along the way is false.
fn[T] Parser::lookahead(
  self : Parser,
  f : () -> T raise Stop,
  fallback : T,
) -> T {
  let saved = (self.lex.save(), self.tok, self.prev_end)
  let result = f() catch { _ => fallback }
  self.lex.restore(saved.0)
  self.tok = saved.1
  self.prev_end = saved.2
  result
}

///|
fn Parser::peek(self : Parser) -> @lexer.Token? {
  self.lookahead(
    () => {
      self.next()
      Some(self.tok)
    },
    None,
  )
}

///|
fn tok_is(t : @lexer.Token?, kind : @lexer.Kind, text? : String) -> Bool {
  match t {
    Some(t) => t.kind == kind && (text is None || text == Some(t.text))
    None => false
  }
}

///|
/// Whether the ( here closes with a ) followed by => (or by a return type and =>).
fn Parser::paren_arrow_ahead(self : Parser) -> Bool {
  self.lookahead(
    () => {
      let mut depth = 0
      while true {
        let t = self.tok
        if t.kind is Eof {
          return false
        }
        if t.kind is Punct {
          if t.text == "(" || t.text == "[" || t.text == "{" {
            depth += 1
          }
          if t.text == ")" || t.text == "]" || t.text == "}" {
            depth -= 1
          }
        }
        self.next()
        if depth == 0 {
          if self.eat(":") {
            ignore(self.type_())
          }
          return self.punct("=>")
        }
      }
      false
    },
    false,
  )
}

///|
fn Parser::push_scope(self : Parser, is_function : Bool) -> Unit {
  self.scopes.push({
    names: [],
    params: if is_function {
      Some([])
    } else {
      None
    },
  })
}

///|
fn Parser::pop_scope(self : Parser) -> Unit {
  ignore(self.scopes.pop())
}

///|
fn check_bindable(id : @ast.Ident) -> Unit raise Stop {
  if strict_unbindable.contains(id.name) {
    raise @diag.syntax_error(
      "\{id.name} can't be bound in strict mode",
      id.span.start,
      end=id.span.end,
    )
  }
}

///|
fn Parser::bind_name(
  self : Parser,
  id : @ast.Ident,
  as_param : Bool,
) -> Unit raise Stop {
  check_bindable(id)
  let s = self.scopes[self.scopes.length() - 1]
  let taken = s.names.contains(id.name) ||
    (match s.params {
      Some(ps) => ps.contains(id.name)
      None => false
    })
  if taken {
    raise @diag.syntax_error(
      "\{id.name} is already declared",
      id.span.start,
      end=id.span.end,
    )
  }
  match (as_param, s.params) {
    (true, Some(ps)) => ps.push(id.name)
    _ => s.names.push(id.name)
  }
}

///|
fn Parser::declare_pattern(
  self : Parser,
  p : @ast.Pattern?,
  as_param : Bool,
) -> Unit raise Stop {
  match p {
    None => ()
    Some(PIdent(id)) => self.bind_name(id, as_param)
    Some(PArray(elements~, ..)) =>
      for e in elements {
        self.declare_pattern(e, as_param)
      }
    Some(PObject(props~, ..)) =>
      for prop in props {
        match prop {
          PPProp(value~, ..) => self.declare_pattern(Some(value), as_param)
          PPRest(arg~, ..) => self.bind_name(arg, as_param)
        }
      }
    Some(PRest(arg~, ..)) => self.declare_pattern(Some(arg), as_param)
    Some(PAssign(left~, ..)) => self.declare_pattern(Some(left), as_param)
  }
}

///|
fn excluded(f : @tables.Feature, start : Int32, end : Int32) -> Stop {
  @diag.excluded_at(f, start, end)
}
