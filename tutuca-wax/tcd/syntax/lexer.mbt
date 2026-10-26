// The lexer: identifiers (snake_case and digits), quoted strings, numbers,
// punctuation, and `///` doc comments attached to the token after them.

///|
pub(all) enum Tok {
  Ident(String)
  Str(String)
  Int(String)
  Float(String)
  Punct(String)
  Eof
} derive(Eq, Debug)

///|
pub(all) struct Token {
  tok : Tok
  span : @diag.Span
  /// The `///` lines right before it.
  doc : String?
} derive(Debug)

///|
priv struct Lexer {
  file : String
  src : String
  mut pos : Int32
  mut line : Int32
  mut col : Int32
  diags : Array[@diag.Diagnostic]
}

///|
fn Lexer::peek(self : Lexer, ahead~ : Int32 = 0) -> Int32 {
  let i = self.pos + ahead
  if i < self.src.length() {
    self.src[i].to_int()
  } else {
    -1
  }
}

///|
fn Lexer::here(self : Lexer) -> @diag.Pos {
  { line: self.line, col: self.col, offset: self.pos, }
}

///|
fn Lexer::advance(self : Lexer) -> Unit {
  if self.peek() == '\n'.to_int() {
    self.line += 1
    self.col = 1
  } else {
    self.col += 1
  }
  self.pos += 1
}

///|
fn is_ident_start(c : Int32) -> Bool {
  (c >= 'a'.to_int() && c <= 'z'.to_int()) ||
  (c >= 'A'.to_int() && c <= 'Z'.to_int()) ||
  c == '_'.to_int()
}

///|
fn is_digit(c : Int32) -> Bool {
  c >= '0'.to_int() && c <= '9'.to_int()
}

///|
fn is_ident_char(c : Int32) -> Bool {
  is_ident_start(c) || is_digit(c)
}

///|
fn Lexer::slice(self : Lexer, start : Int32) -> String {
  self.src.unsafe_substring(start~, end=self.pos)
}

///|
fn Lexer::span_from(self : Lexer, start : @diag.Pos) -> @diag.Span {
  { file: self.file, start, end: self.here(), }
}

///|
/// Skips spaces and comments; returns the `///` doc lines it passed, joined.
fn Lexer::skip_trivia(self : Lexer) -> String? {
  let doc : Array[String] = []
  for ;; {
    let c = self.peek()
    if c == ' '.to_int() ||
      c == '\t'.to_int() ||
      c == '\n'.to_int() ||
      c == '\r'.to_int() {
      self.advance()
    } else if c == '/'.to_int() && self.peek(ahead=1) == '/'.to_int() {
      let is_doc = self.peek(ahead=2) == '/'.to_int() &&
        self.peek(ahead=3) != '/'.to_int()
      let start = self.pos
      while self.peek() != -1 && self.peek() != '\n'.to_int() {
        self.advance()
      }
      if is_doc {
        let text = self.slice(start + 3)
        doc.push(text.trim(chars=" ").to_owned())
      } else {
        doc.clear()
      }
    } else {
      break
    }
  }
  if doc.is_empty() {
    None
  } else {
    Some(doc.join("\n"))
  }
}

///|
let puncts2 : Array[String] = ["->", "==", "!=", "<=", ">="]

///|
let puncts1 : String = "{}()[]<>,;:.=+-@*/!"

///|
fn Lexer::string(self : Lexer, start : @diag.Pos) -> String {
  self.advance() // the opening quote
  let sb = StringBuilder()
  for ;; {
    let c = self.peek()
    if c == -1 || c == '\n'.to_int() {
      self.diags.push(
        @diag.error(
          "tcd.syntax.unterminated_string",
          self.span_from(start),
          "this string has no closing quote",
        ),
      )
      break
    }
    self.advance()
    if c == '"'.to_int() {
      break
    }
    if c == '\\'.to_int() {
      let e = self.peek()
      self.advance()
      match e {
        'n' => sb.write_char('\n')
        't' => sb.write_char('\t')
        'r' => sb.write_char('\r')
        '"' => sb.write_char('"')
        '\\' => sb.write_char('\\')
        _ =>
          self.diags.push(
            @diag.error(
              "tcd.syntax.escape",
              self.span_from(start),
              "unknown escape in a string; the ones there are: \\n \\t \\r \\\" \\\\",
            ),
          )
      }
    } else {
      sb.write_char(Int32::unsafe_to_char(c))
    }
  }
  sb.to_string()
}

///|
/// Tokens of src, ending in Eof, and what it couldn't read.
pub fn tokenize(
  file : String,
  src : String,
) -> (Array[Token], Array[@diag.Diagnostic]) {
  let lx = { file, src, pos: 0, line: 1, col: 1, diags: [], }
  let out : Array[Token] = []
  for ;; {
    let doc = lx.skip_trivia()
    let start = lx.here()
    let c = lx.peek()
    if c == -1 {
      out.push({ tok: Eof, span: lx.span_from(start), doc, })
      break
    }
    if is_ident_start(c) {
      let s = lx.pos
      while is_ident_char(lx.peek()) {
        lx.advance()
      }
      out.push({ tok: Ident(lx.slice(s)), span: lx.span_from(start), doc, })
      continue
    }
    if is_digit(c) {
      let s = lx.pos
      while is_digit(lx.peek()) {
        lx.advance()
      }
      let mut float = false
      if lx.peek() == '.'.to_int() && is_digit(lx.peek(ahead=1)) {
        float = true
        lx.advance()
        while is_digit(lx.peek()) {
          lx.advance()
        }
      }
      let text = lx.slice(s)
      out.push({
        tok: if float {
          Float(text)
        } else {
          Int(text)
        },
        span: lx.span_from(start),
        doc,
      })
      continue
    }
    if c == '"'.to_int() {
      let s = lx.string(start)
      out.push({ tok: Str(s), span: lx.span_from(start), doc, })
      continue
    }
    let two = if lx.pos + 2 <= src.length() {
      src.unsafe_substring(start=lx.pos, end=lx.pos + 2)
    } else {
      ""
    }
    if puncts2.contains(two) {
      lx.advance()
      lx.advance()
      out.push({ tok: Punct(two), span: lx.span_from(start), doc, })
      continue
    }
    let ch = Int32::unsafe_to_char(c)
    if puncts1.contains_char(ch) {
      lx.advance()
      out.push({ tok: Punct(ch.to_string()), span: lx.span_from(start), doc, })
      continue
    }
    lx.advance()
    lx.diags.push(
      @diag.error(
        "tcd.syntax.character",
        lx.span_from(start),
        "unexpected character \{ch.to_string().escape()}",
      ),
    )
  }
  (out, lx.diags)
}
