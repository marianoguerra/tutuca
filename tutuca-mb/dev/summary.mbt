// Plain language for values, as JS's src/dev/summary.js: what a dev node shows in its readable
// view. The code view shows the tokens panel.mbt makes, as the formatters print them.

///|
let max_brief : Int32 = 40

///|
fn clip(text : String) -> String {
  if text.length() > max_brief {
    text.view(end_offset=max_brief).to_owned() + "…"
  } else {
    text
  }
}

///|
fn plural(n : Int32, one : String, many? : String) -> String {
  if n == 1 {
    "1 \{one}"
  } else {
    "\{n} \{many.unwrap_or(one + "s")}"
  }
}

///|
fn quote(s : String) -> String {
  "“\{clip(s)}”"
}

///|
/// A value in a few words: "“hello”", "42", "list of 3", "2 entries".
pub fn brief(v : Json) -> String {
  match v {
    Null => "nothing"
    True => "true"
    False => "false"
    Number(n, ..) => n.to_string()
    String(s) => quote(s)
    Array(items) =>
      if items.is_empty() {
        "empty list"
      } else {
        "list of \{items.length()}"
      }
    Object(fields) => plural(fields.length(), "entry", many="entries")
  }
}

///|
/// A JSON value as JS's `String(v)` writes it: text without quotes.
fn plain(v : Json) -> String {
  match v {
    String(s) => s
    Number(n, ..) => n.to_string()
    True => "true"
    False => "false"
    Null => "null"
    _ => v.stringify()
  }
}

///|
/// "list of whole number", "one of grey, red", "TodoTask component".
pub fn type_words(t : @tutuca.FieldType) -> String {
  match t {
    Optional(inner) => "\{type_words(inner)} or nothing"
    Text => "text"
    Boolean => "true or false"
    Number => "number"
    Whole => "whole number"
    OneOf(members) => "one of \{members.map(plain).join(", ")}"
    ListOf(inner) => "list of \{type_words(inner)}"
    MapOf(inner) => "map of \{type_words(inner)}"
    RecordOf(shape) => "record of \{shape.map(e => e.0).join(", ")}"
    Either(types) => "either \{types.map(type_words).join(" or ")}"
    KeyOf(field) => "a key of \{field}"
    ComponentOf([]) => "any component"
    ComponentOf(names) => "\{names.join(" or ")} component"
    Anything => "anything"
  }
}

///|
fn constraint_words(c : @tutuca.Constraint) -> String {
  match c {
    AtLeast(n) => "at least \{n}"
    AtMost(n) => "at most \{n}"
    MinLength(0) => ""
    MinLength(n) => "at least \{n} long"
    MaxLength(n) => "at most \{n} long"
    Matching(re) => "matching \{re}"
    Where(name) => "where \{name} holds"
  }
}

///|
/// A field's constraints and the value it starts with: "at least 1, default 1".
pub fn field_detail(f : @tutuca.FieldInfo) -> String {
  let parts = f.constraints.map(constraint_words).filter(s => s != "")
  match f.initial {
    Some(Null) | None => ()
    Some(v) => parts.push("default \{brief(v)}")
  }
  parts.join(", ")
}

///|
/// The words of a path's frames: "items → 1", or "the root".
pub fn path_words(path : @tutuca.DispatchPath) -> String {
  let words = path.frames.map(frame_words).flatten()
  if words.is_empty() {
    "the root"
  } else {
    words.join(" → ")
  }
}

///|
fn frame_words(f : @tutuca.Frame) -> Array[String] {
  let out = []
  if f.provider is Some(p) {
    out.push("provided \{p}")
  }
  out.push(f.name)
  if f.item is Some(k) {
    out.append(slot_words(k))
  }
  out
}

///|
fn slot_words(k : @tutuca.SlotKey) -> Array[String] {
  match k {
    Index(i) => [i.to_string()]
    Name(n) => [n]
    Pair(a, b) => [..slot_words(a), ..slot_words(b)]
  }
}

///|
/// What a view node is, in words, as JS's for its AST nodes.
fn ir_title(ir : @tutuca.Ir) -> String {
  match ir {
    IText(s) => quote(s)
    _ => ir.words()
  }
}

///|
fn ir_detail(ir : @tutuca.Ir) -> String {
  match ir {
    IElem(e) => {
      let parts = []
      let attrs = e.statics.length() + e.dyns.length()
      if attrs > 0 {
        parts.push(plural(attrs, "attribute"))
      }
      if e.childs.length() > 0 {
        parts.push(plural(e.childs.length(), "child", many="children"))
      }
      if e.events.length() > 0 {
        parts.push("handles \{e.events.map(ev => ev.dom_name()).join(", ")}")
      }
      parts.join(" · ")
    }
    _ => ""
  }
}

///|
/// A message's name as JS spells it: the variant with its first letter lowered.
pub fn js_name(variant : String) -> String {
  match variant.get_char(0) {
    Some(c) if c >= 'A' && c <= 'Z' =>
      c.to_string().to_lower() + variant.view(start_offset=1).to_owned()
    _ => variant
  }
}

///|
/// A message, from its JSON (`"Toggle"`, `["SetTitle", "x"]`), as JS labels a call:
/// `toggle()`, `setTitle("x")`.
pub fn message_call(msg : Json) -> String {
  match msg {
    String(name) => "\{js_name(name)}()"
    Array([String(name), .. rest]) => {
      let args = rest.iter().map(a => a.stringify()).collect().join(", ")
      let args = if args.length() > 80 {
        args.view(end_offset=80).to_owned() + "…"
      } else {
        args
      }
      "\{js_name(name)}(\{args})"
    }
    other => other.stringify()
  }
}

///|
/// A message as its Debug text says it (`Toggle`, `SetTitle("x")`), as JS labels a call.
pub fn debug_call(text : String) -> String {
  match text.find("(") {
    Some(i) =>
      js_name(text.view(end_offset=i).to_owned()) +
      text.view(start_offset=i).to_owned()
    None => "\{js_name(text)}()"
  }
}
