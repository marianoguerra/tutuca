// Writing types and values back as text, for messages and the exported
// model.

///|
/// t as a module writes it, in TypeScript.
pub fn ty_text(t : Ty) -> String {
  match t {
    Bool => "boolean"
    F64 => "number"
    Str => "string"
    Any => "unknown"
    Null => "null"
    Enum(ms) => ms.map(m => m.escape()).join(" | ")
    Option(i) => "\{member_text(i)} | null"
    List(i) => "\{member_text(i)}[]"
    Map(i) => "{ [key: string]: \{ty_text(i)} }"
    Record(fs) => "{ \{fs.map(f => "\{f.0}: \{ty_text(f.1)}").join("; ")} }"
    OneOf(ts) => ts.map(member_text).join(" | ")
    Comp([]) => "Component"
    Comp(ns) => ns.join(" | ")
  }
}

///|
/// t where it's part of a union or a list: in parentheses when it is a
/// union itself.
fn member_text(t : Ty) -> String {
  match t {
    Option(_) | OneOf(_) | Enum([_, _, ..]) | Comp([_, _, ..]) =>
      "(\{ty_text(t)})"
    _ => ty_text(t)
  }
}

///|
/// A value as JSON writes it.
pub fn val_text(v : Val) -> String {
  match v {
    Unknown => "?"
    _ => v.json().stringify()
  }
}

///|
/// Whether t is a number type, through options.
pub fn is_numeric(t : Ty) -> Bool {
  match t {
    F64 => true
    Option(i) => is_numeric(i)
    _ => false
  }
}

///|
/// Whether a value of type t has a length.
pub fn has_length(t : Ty) -> Bool {
  match t {
    Str | List(_) | Map(_) => true
    Option(i) => has_length(i)
    _ => false
  }
}

///|
/// t without its options.
pub fn unoption(t : Ty) -> Ty {
  match t {
    Option(i) => unoption(i)
    _ => t
  }
}
