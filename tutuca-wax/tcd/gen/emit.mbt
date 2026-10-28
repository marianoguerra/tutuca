// What every generated file is written with: the string constants the code
// uses (one `'` import each, shared by the contract, the glue and the
// implementation), blocks of statements with fresh temporaries, and the Wax
// spelling of types, values and schemas.

///|
/// The string constants a package's generated code uses: each runtime
/// string gets one const, `gs_<what it says>`, which the implementation may
/// use too.
pub(all) struct Strings {
  by_text : Map[String, String]
  order : Array[String]
}

///|
pub fn Strings::new() -> Strings {
  { by_text: Map([]), order: [], }
}

///|
fn sanitize(s : String) -> String {
  let sb = StringBuilder()
  let mut last_us = false
  for c in s {
    let ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
    if ok {
      sb.write_char(c)
      last_us = false
    } else if c >= 'A' && c <= 'Z' {
      sb.write_char(c.to_ascii_lowercase())
      last_us = false
    } else if !last_us {
      sb.write_char('_')
      last_us = true
    }
  }
  let out = sb.to_string()
  let trimmed = out.trim(chars="_").to_owned()
  if trimmed.length() > 40 {
    trimmed.unsafe_substring(start=0, end=40)
  } else {
    trimmed
  }
}

///|
/// The const holding text.
pub fn Strings::get(self : Strings, text : String) -> String {
  match self.by_text.get(text) {
    Some(n) => n
    None => {
      // Only the empty text is gs_empty: text of only symbols ("+", "×")
      // is gs_text, so an implementation's gs_empty is always "".
      let base = if text == "" {
        "gs_empty"
      } else if sanitize(text) == "" {
        "gs_text"
      } else {
        "gs_" + sanitize(text)
      }
      let mut name = base
      let mut i = 2
      while self.by_text.values().any(n => n == name) {
        name = base + "_" + i.to_string()
        i += 1
      }
      self.by_text[text] = name
      self.order.push(text)
      name
    }
  }
}

///|
fn wax_string(s : String) -> String {
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

///|
/// The `'` import block of every string used, in the order they came.
pub fn Strings::imports(self : Strings) -> String {
  let sb = StringBuilder()
  sb.write_string("import \"'\" {\n")
  for t in self.order {
    sb.write_string("    #[import = \{wax_string(t)}]\n")
    sb.write_string("    const \{self.by_text[t]}: js_string;\n")
  }
  sb.write_string("}\n")
  sb.to_string()
}

///|
/// Statements being written, with fresh temporaries.
priv struct Block {
  lines : Array[String]
  mut next_temp : Int32
}

///|
fn Block::new() -> Block {
  { lines: [], next_temp: 0, }
}

///|
fn Block::temp(self : Block) -> String {
  let n = self.next_temp
  self.next_temp += 1
  "t\{n}"
}

///|
fn Block::stmt(self : Block, s : String) -> Unit {
  self.lines.push(s)
}

///|
/// A fresh local holding expr; its name.
fn Block::bind(self : Block, expr : String) -> String {
  let t = self.temp()
  self.stmt("let \{t} = \{expr};")
  t
}

///|
/// An array of the given type ([view_array|null; n] ...) holding items; its name.
fn Block::array(self : Block, ty : String, items : Array[String]) -> String {
  let t = self.temp()
  self.stmt("let \{t} = [\{ty}|null; \{items.length()}];")
  for i, item in items {
    self.stmt("\{t}[\{i}] = \{item};")
  }
  t
}

///|
fn Block::render(self : Block, indent : String) -> String {
  self.lines.map(l => indent + l).join("\n")
}

///|
/// Writing one generated file.
priv struct Out {
  sb : StringBuilder
}

///|
fn Out::new() -> Out {
  { sb: StringBuilder(), }
}

///|
fn Out::write(self : Out, s : String) -> Unit {
  self.sb.write_string(s)
}

///|
fn Out::line(self : Out, s : String) -> Unit {
  self.sb.write_string(s)
  self.sb.write_char('\n')
}

///|
fn Out::to_string(self : Out) -> String {
  self.sb.to_string()
}

///|
/// `/// text` lines for a doc comment, or nothing.
fn doc_lines(doc : String?, indent~ : String = "") -> String {
  match doc {
    None => ""
    Some(d) => d.split("\n").map(l => "\{indent}// \{l}\n").collect().join("")
  }
}
