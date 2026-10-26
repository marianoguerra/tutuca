// Writing types, literals and expressions back as TCD writes them, for
// messages, stubs and the exported model.

///|
pub fn ty_text(t : Ty) -> String {
  match t {
    Bool => "bool"
    S32 => "s32"
    F64 => "f64"
    Str => "string"
    Any => "any"
    Null => "null"
    Enum(ms) => "enum { \{ms.join(", ")} }"
    Option(i) => "option<\{ty_text(i)}>"
    List(i) => "list<\{ty_text(i)}>"
    Map(i) => "map<\{ty_text(i)}>"
    Record(fs) =>
      "record { \{fs.map(f => "\{f.0}: \{ty_text(f.1)}").join(", ")} }"
    OneOf(ts) => "one_of<\{ts.map(ty_text).join(", ")}>"
    Comp([]) => "component"
    Comp(ns) => ns.join(" | ")
    Result(o, e) => "result<\{ty_text(o)}, \{ty_text(e)}>"
  }
}

///|
pub fn lit_text(l : @syntax.Lit) -> String {
  match l {
    Int(n) => n.to_string()
    Float(f) => {
      let s = f.to_string()
      if s.contains(".") || s.contains("e") {
        s
      } else {
        s + ".0"
      }
    }
    Str(s) => s.escape()
    Bool(b) => b.to_string()
    Null => "null"
  }
}

///|
fn op_text(op : @syntax.BinOp) -> String {
  match op {
    Add => "+"
    Sub => "-"
    Eq => "=="
    Ne => "!="
    Lt => "<"
    Le => "<="
    Gt => ">"
    Ge => ">="
    And => "and"
    Or => "or"
    In => "in"
    NotIn => "not in"
  }
}

///|
pub fn expr_text(e : @syntax.Expr) -> String {
  match e {
    Lit(l, ..) => lit_text(l)
    Path(parts, ..) => parts.map(p => p.text).join(".")
    Call(n, args, ..) => "\{n.text}(\{args.map(expr_text).join(", ")})"
    List(items, ..) => "[\{items.map(expr_text).join(", ")}]"
    Record(entries, ..) =>
      "{ \{entries.map(e => "\{e.0.text}: \{expr_text(e.1)}").join(", ")} }"
    Not(e, ..) => "not \{wrap(e)}"
    Bin(op, l, r, ..) => "\{wrap(l)} \{op_text(op)} \{wrap(r)}"
    Matches(e, p, ..) => "\{wrap(e)} matches \{p.escape()}"
  }
}

///|
fn wrap(e : @syntax.Expr) -> String {
  match e {
    Bin(And | Or, _, _, ..) => "(\{expr_text(e)})"
    _ => expr_text(e)
  }
}

///|
/// The type of a literal.
pub fn lit_ty(l : @syntax.Lit) -> Ty {
  match l {
    Int(_) => S32
    Float(_) => F64
    Str(_) => Str
    Bool(_) => Bool
    Null => Null
  }
}

///|
/// Whether t is a number type, through options.
pub fn is_numeric(t : Ty) -> Bool {
  match t {
    S32 | F64 => true
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
