///|
/// A query that doesn't parse: what was expected and where, in plain words.
pub(all) suberror ParseError {
  ParseError(String)
}

///|
pub fn ParseError::message(self : ParseError) -> String {
  match self {
    ParseError(s) => s
  }
}

///|
priv enum Tok {
  Dot
  DotDot
  /// `.k` or `."k"`
  FieldName(String)
  Ident(String)
  VarName(String)
  Str(String)
  Num(@model.Value)
  Punct(String)
  Eof
}

///|
priv struct Token {
  tok : Tok
  pos : Int32
}

///|
fn is_ident_start(c : Int32) -> Bool {
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'
}

///|
fn is_ident_char(c : Int32) -> Bool {
  is_ident_start(c) || (c >= '0' && c <= '9')
}

///|
fn where_(text : String, pos : Int32) -> String {
  let mut line = 1
  let mut start = 0
  for i in 0..<pos {
    if i < text.length() && text[i].to_int() == 10 {
      line += 1
      start = i + 1
    }
  }
  "line \{line}, col \{pos - start + 1}"
}

///|
fn fail_at(text : String, pos : Int32, what : String) -> Unit raise ParseError {
  raise ParseError("\{what} at \{where_(text, pos)}")
}

///|
fn code(text : String, i : Int32) -> Int32 {
  if i < text.length() {
    text[i].to_int()
  } else {
    -1
  }
}

///|
/// The end of the JSON string starting at `start` (its opening quote), past the closing quote.
fn string_end(text : String, start : Int32) -> Int32 raise ParseError {
  let mut i = start + 1
  while i < text.length() {
    let c = text[i].to_int()
    if c == '"' {
      return i + 1
    }
    i += if c == '\\' { 2 } else { 1 }
  }
  fail_at(text, start, "unterminated string")
  0
}

///|
/// Decodes the JSON token text[start:end] (a string or a number) with the JSON reader.
fn json_token(
  text : String,
  start : Int32,
  end : Int32,
) -> @model.Value raise ParseError {
  @json.decode_value(sub(text, start, end)) catch {
    e => {
      let reason = match e {
        @json.DecodeError(s) => s
      }
      // The reader's own position is within the token; report the token's.
      let what = match reason.find(" at line ") {
        Some(i) => sub(reason, 0, i)
        None => reason
      }
      fail_at(text, start, what)
      Null
    }
  }
}

///|
fn lex(text : String) -> Array[Token] raise ParseError {
  let out : Array[Token] = []
  let n = text.length()
  let mut i = 0
  while true {
    while i < n {
      let c = text[i].to_int()
      if c != 32 && c != 9 && c != 10 && c != 13 {
        break
      }
      i += 1
    }
    let start = i
    if i >= n {
      out.push({ tok: Eof, pos: i, })
      break
    }
    let c = text[i].to_int()
    if c == '.' {
      if code(text, i + 1) == '.' {
        out.push({ tok: DotDot, pos: start, })
        i += 2
      } else if is_ident_start(code(text, i + 1)) {
        i += 1
        while is_ident_char(code(text, i)) {
          i += 1
        }
        out.push({ tok: FieldName(sub(text, start + 1, i)), pos: start, })
      } else if code(text, i + 1) == '"' {
        let end = string_end(text, i + 1)
        guard json_token(text, i + 1, end) is String(k) else { panic() }
        out.push({ tok: FieldName(k), pos: start, })
        i = end
      } else {
        out.push({ tok: Dot, pos: start, })
        i += 1
      }
    } else if c == '$' {
      i += 1
      if !is_ident_start(code(text, i)) {
        fail_at(text, start, "expected a name after \"$\"")
      }
      while is_ident_char(code(text, i)) {
        i += 1
      }
      out.push({ tok: VarName(sub(text, start + 1, i)), pos: start, })
    } else if is_ident_start(c) {
      while is_ident_char(code(text, i)) {
        i += 1
      }
      out.push({ tok: Ident(sub(text, start, i)), pos: start, })
    } else if c == '"' {
      let end = string_end(text, i)
      guard json_token(text, i, end) is String(s) else { panic() }
      out.push({ tok: Str(s), pos: start, })
      i = end
    } else if (c >= '0' && c <= '9') ||
      (c == '-' && code(text, i + 1) >= '0' && code(text, i + 1) <= '9') {
      i += 1
      while true {
        let d = code(text, i)
        if (d >= '0' && d <= '9') || d == '.' || d == 'e' || d == 'E' {
          i += 1
        } else if (d == '+' || d == '-') &&
          (code(text, i - 1) == 'e' || code(text, i - 1) == 'E') {
          i += 1
        } else {
          break
        }
      }
      out.push({ tok: Num(json_token(text, start, i)), pos: start, })
    } else {
      let two = if i + 1 < n { sub(text, i, i + 2) } else { "" }
      match two {
        "//" | "==" | "!=" | "<=" | ">=" => {
          out.push({ tok: Punct(two), pos: start, })
          i += 2
        }
        _ => {
          let one = sub(text, i, i + 1)
          match one {
            "|"
            | ","
            | "("
            | ")"
            | "["
            | "]"
            | "{"
            | "}"
            | ":"
            | "<"
            | ">"
            | "~"
            | "@"
            | "#" => {
              out.push({ tok: Punct(one), pos: start, })
              i += 1
            }
            _ => fail_at(text, start, "unexpected character \{quote(one)}")
          }
        }
      }
    }
  }
  out
}

///|
fn quote(s : String) -> String {
  let sb = StringBuilder()
  @json.write_string(sb, s) catch {
    _ => return "\"…\""
  }
  sb.to_string()
}

///|
priv struct Parser {
  text : String
  toks : Array[Token]
  mut i : Int32
}

///|
fn Parser::peek(self : Parser) -> Tok {
  self.toks[self.i].tok
}

///|
fn Parser::fail(self : Parser, what : String) -> Unit raise ParseError {
  fail_at(self.text, self.toks[self.i].pos, what)
}

///|
fn Parser::next(self : Parser) -> Tok {
  let t = self.toks[self.i].tok
  if self.i + 1 < self.toks.length() {
    self.i += 1
  }
  t
}

///|
fn Parser::is_punct(self : Parser, p : String) -> Bool {
  self.peek() is Punct(q) && q == p
}

///|
fn Parser::is_word(self : Parser, w : String) -> Bool {
  self.peek() is Ident(q) && q == w
}

///|
fn Parser::eat(self : Parser, p : String) -> Bool {
  if self.is_punct(p) {
    self.i += 1
    return true
  }
  false
}

///|
fn Parser::expect(self : Parser, p : String) -> Unit raise ParseError {
  if !self.eat(p) {
    self.fail("expected \"\{p}\"")
  }
}

///|
/// Parses a query.
pub fn parse(text : String) -> Expr raise ParseError {
  let p = Parser::{ text, toks: lex(text), i: 0, }
  let e = p.pipe()
  if !(p.peek() is Eof) {
    p.fail("unexpected \{describe(p.peek())}")
  }
  e
}

///|
fn describe(t : Tok) -> String {
  match t {
    Dot => "\".\""
    DotDot => "\"..\""
    FieldName(k) => "\".\{k}\""
    Ident(w) => "\"\{w}\""
    VarName(v) => "\"$\{v}\""
    Str(s) => "the string \{quote(s)}"
    Num(_) => "a number"
    Punct(p) => "\"\{p}\""
    Eof => "the end of the query"
  }
}

///|
/// pipe := comma ('as' pattern '|' pipe | '|' pipe)?
fn Parser::pipe(self : Parser) -> Expr raise ParseError {
  let lhs = self.comma()
  if self.is_word("as") {
    self.i += 1
    let pat = self.pattern()
    self.expect("|")
    return As(lhs, pat, self.pipe())
  }
  if self.eat("|") {
    return Pipe(lhs, self.pipe())
  }
  lhs
}

///|
fn Parser::comma(self : Parser) -> Expr raise ParseError {
  let mut e = self.alt()
  while self.eat(",") {
    e = Comma(e, self.alt())
  }
  e
}

///|
fn Parser::alt(self : Parser) -> Expr raise ParseError {
  let mut e = self.or_()
  while self.eat("//") {
    e = Alt(e, self.or_())
  }
  e
}

///|
fn Parser::or_(self : Parser) -> Expr raise ParseError {
  let mut e = self.and_()
  while self.is_word("or") {
    self.i += 1
    e = Or(e, self.and_())
  }
  e
}

///|
fn Parser::and_(self : Parser) -> Expr raise ParseError {
  let mut e = self.compare()
  while self.is_word("and") {
    self.i += 1
    e = And(e, self.compare())
  }
  e
}

///|
fn Parser::compare(self : Parser) -> Expr raise ParseError {
  let lhs = self.match_()
  let op : CmpOp? = match self.peek() {
    Punct("==") => Some(Eq)
    Punct("!=") => Some(Ne)
    Punct("<") => Some(Lt)
    Punct("<=") => Some(Le)
    Punct(">") => Some(Gt)
    Punct(">=") => Some(Ge)
    _ => None
  }
  match op {
    Some(op) => {
      self.i += 1
      let rhs = self.match_()
      if self.peek() is Punct("==" | "!=" | "<" | "<=" | ">" | ">=") {
        self.fail("comparisons don't chain; use parentheses")
      }
      Compare(op, lhs, rhs)
    }
    None => lhs
  }
}

///|
fn Parser::match_(self : Parser) -> Expr raise ParseError {
  let e = self.postfix()
  if self.eat("~") {
    return Match(e, self.pattern())
  }
  e
}

///|
fn Parser::postfix(self : Parser) -> Expr raise ParseError {
  let mut e = self.primary()
  while true {
    match self.peek() {
      FieldName(k) => {
        self.i += 1
        e = Field(e, k)
      }
      Dot if self.toks[self.i + 1].tok is Punct("[") => self.i += 1
      Punct("[") => {
        self.i += 1
        e = self.subscript(e)
      }
      _ => break
    }
  }
  e
}

///|
/// After `[`: `]`, an index or a key, then `]`.
fn Parser::subscript(self : Parser, e : Expr) -> Expr raise ParseError {
  if self.eat("]") {
    return Each(e)
  }
  let out : Expr = match self.peek() {
    Num(Int(n)) => Index(e, n)
    Str(k) => Field(e, k)
    _ => {
      self.fail("expected an integer index or a string key")
      e
    }
  }
  self.i += 1
  self.expect("]")
  out
}

///|
fn Parser::primary(self : Parser) -> Expr raise ParseError {
  let tok = self.peek()
  match tok {
    Dot => {
      self.i += 1
      if self.is_punct("[") {
        self.i += 1
        return self.subscript(Identity)
      }
      Identity
    }
    DotDot => {
      self.i += 1
      Recurse
    }
    FieldName(k) => {
      self.i += 1
      Field(Identity, k)
    }
    VarName(v) => {
      self.i += 1
      Var(v)
    }
    Str(_) | Num(_) => Literal(self.literal())
    Punct("(") => {
      self.i += 1
      let e = self.pipe()
      self.expect(")")
      e
    }
    Punct("[") => {
      self.i += 1
      if self.eat("]") {
        return Literal(Array([]))
      }
      let e = self.pipe()
      self.expect("]")
      Collect(e)
    }
    Ident("true" | "false" | "null" | "ref" | "inst") => Literal(self.literal())
    Ident(name) =>
      match Builtin::from_name(name) {
        Some((b, takes_arg)) => {
          self.i += 1
          if !takes_arg {
            if self.is_punct("(") {
              self.fail("\{name} takes no argument")
            }
            return Call(b, None)
          }
          if !self.is_punct("(") {
            self.fail("\{name} takes an argument: \{name}(…)")
          }
          self.i += 1
          let arg = self.pipe()
          self.expect(")")
          Call(b, Some(arg))
        }
        None => {
          self.fail("unknown function \{quote(name)}")
          Identity
        }
      }
    _ => {
      self.fail("expected a query, found \{describe(tok)}")
      Identity
    }
  }
}

///|
/// A literal: a string, a number, true, false, null, ref("uri"), inst("ns").
fn Parser::literal(self : Parser) -> @model.Value raise ParseError {
  let tok = self.next()
  match tok {
    Str(s) => String(s)
    Num(v) => v
    Ident("true") => Bool(true)
    Ident("false") => Bool(false)
    Ident("null") => Null
    Ident("ref" | "inst" as w) => {
      self.expect("(")
      let at = self.i
      guard self.next() is Str(s) else {
        self.i = at
        self.fail("\{w}(…) takes a string")
        panic()
      }
      self.expect(")")
      if w == "ref" {
        return Ref(s)
      }
      let decoded : @model.Value? = Some(
        @json.decode_value("[\"inst\",\{quote(s)}]"),
      ) catch {
        _ => None
      }
      match decoded {
        Some(Instant(ns)) => @model.Value::Instant(ns)
        _ => {
          self.i = at
          self.fail("inst(…) takes the decimal nanoseconds of an Instant")
          Null
        }
      }
    }
    _ => {
      self.i -= 1
      self.fail("expected a literal")
      Null
    }
  }
}

///|
fn Parser::pattern(self : Parser) -> Pattern raise ParseError {
  let tok = self.peek()
  match tok {
    VarName(v) => {
      self.i += 1
      if self.eat("@") {
        return At(v, self.pattern())
      }
      Bind(v)
    }
    Ident("_") => {
      self.i += 1
      Wild
    }
    Str(_) | Num(_) | Ident("true" | "false" | "null" | "ref" | "inst") =>
      Lit(self.literal())
    Punct("{") => {
      self.i += 1
      let fields : Array[(String, Pattern)] = []
      while !self.is_punct("}") {
        let at = self.i
        let key = match self.next() {
          Ident(k) | Str(k) => k
          _ => {
            self.i = at
            self.fail("expected a key")
            ""
          }
        }
        if fields.iter().any(f => f.0 == key) {
          self.i = at
          self.fail("a duplicate key \{quote(key)}")
        }
        self.expect(":")
        fields.push((key, self.pattern()))
        if !self.eat(",") {
          break
        }
      }
      self.expect("}")
      Obj(fields)
    }
    Punct("[") => {
      self.i += 1
      let items : Array[Pattern] = []
      let mut rest : Rest = Exact
      while !self.is_punct("]") {
        if self.peek() is DotDot {
          self.i += 1
          rest = match self.peek() {
            VarName(v) => {
              self.i += 1
              RestBind(v)
            }
            _ => Open
          }
          break
        }
        items.push(self.pattern())
        if !self.eat(",") {
          break
        }
      }
      self.expect("]")
      Arr(items, rest)
    }
    Punct("#") => {
      self.i += 1
      let at = self.i
      guard self.next() is Str(type_id) else {
        self.i = at
        self.fail("expected a type_id string after \"#\"")
        panic()
      }
      Typed(type_id, self.pattern())
    }
    Punct("<") => {
      self.i += 1
      let tag = self.pattern()
      let attrs = self.pattern()
      let children = self.pattern()
      self.expect(">")
      Node(tag, attrs, children)
    }
    Punct("(") => {
      self.i += 1
      let alts = [self.pattern()]
      while self.eat("|") {
        alts.push(self.pattern())
      }
      self.expect(")")
      if alts.length() == 1 {
        alts[0]
      } else {
        Alts(alts)
      }
    }
    _ => {
      self.fail("expected a pattern, found \{describe(tok)}")
      Wild
    }
  }
}

///|
fn sub(s : String, start : Int32, end : Int32) -> String {
  s.exact_view(start~, end~).to_owned()
}
