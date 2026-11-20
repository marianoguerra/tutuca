// The model's types in Wax: the type a field or argument has in the state struct
// and in handlers, turning values into it and back, and the runtime's schema
// data (vtypes, constraints) for them.

///|
/// The package being generated: its model and its strings.
pub(all) struct Gen {
  pkg : @check.Package
  strings : Strings
  /// The functions the implementation defines, when known: the optional ones
  /// it lacks aren't called.
  have : Array[String]?
  /// The list or map fields of the each bodies being generated, innermost
  /// last ("" for one whose source isn't a field): what a send's field(x)
  /// reads the item of.
}

///|
pub fn Gen::new(pkg : @check.Package, have? : Array[String]) -> Gen {
  { pkg, strings: names_first(pkg), have, }
}

///|
/// The strings, with the package's names claimed first (Strings): its
/// types, the members of each and their arguments, the binds of loops and
/// scopes, its views, the names inside types (a record's fields, an enum's
/// members, the types they hold), its ask handlers and host asks, and the
/// names it registers types under.
fn names_first(pkg : @check.Package) -> Strings {
  let strings = Strings::new()
  let claim = (name : String) => strings.name(name)
  fn claim_ty(ty : @check.Ty) -> Unit {
    match ty {
      Enum(members) => members.each(claim)
      Option(t) | List(t) | Map(t) => claim_ty(t)
      Record(entries) =>
        for entry in entries {
          claim(entry.0)
          claim_ty(entry.1)
        }
      OneOf(ts) => ts.each(claim_ty)
      Comp(names) => names.each(claim)
      Bool | F64 | Str | Any | Null => ()
    }
  }
  let members = (fields : Array[@check.FieldM]) => {
    for f in fields {
      claim(f.name)
      claim_ty(f.ty)
    }
  }
  let signals = (ss : Array[@check.SignalM]) => {
    for s in ss {
      claim(s.name)
      members(s.params)
      if s.result is Some(t) {
        claim_ty(t)
      }
    }
  }
  let messages = (ms : Array[@check.MessageM]) => {
    for m in ms {
      claim(m.name)
      members(m.params)
      if m.source_key is Some(k) {
        members([k])
      }
      // A reply's message is the sender's, which this package may not
      // declare: its name is claimed here, for ctx_reply.
      for e in m.emits.unwrap_or([]) {
        if e.kind is Reply {
          claim(e.name)
        }
      }
    }
  }
  for c in pkg.components {
    claim(c.name)
  }
  for i in pkg.interfaces {
    claim(i.name)
  }
  for r in pkg.registers {
    claim(r.as_)
  }
  for c in pkg.components {
    members(c.fields)
    members(c.gets)
    messages(c.messages)
    signals(c.notifies)
    signals(c.asks)
    signals(c.queries)
    for l in c.loops {
      claim(l.name)
      if l.enrich is Some(binds) {
        members(binds)
      }
    }
    for sc in c.scopes {
      claim(sc.name)
      members(sc.binds)
    }
    for pr in c.provides {
      claim(pr.name)
      if pr.key is Some(k) {
        claim(k)
      }
    }
    for v in c.views {
      claim(v.name)
      if v.target is Some(t) {
        claim(t)
      }
    }
  }
  for i in pkg.interfaces {
    members(i.fields)
    members(i.gets)
    messages(i.messages)
    signals(i.notifies)
  }
  signals(pkg.ask_handlers)
  pkg.host_asks.each(claim)
  strings
}

///|
/// Whether the implementation defines name (assumed when unknown).
fn Gen::has(self : Gen, name : String) -> Bool {
  match self.have {
    Some(names) => names.contains(name)
    None => true
  }
}

///|
fn Gen::s(self : Gen, text : String) -> String {
  self.strings.get(text)
}

///|
/// The Wax type a value of t is held in.
pub fn wax_ty(t : @check.Ty) -> String {
  match t {
    Bool => "i32"
    F64 => "f64"
    Str | Enum(_) => "js_string"
    _ => "&value"
  }
}

///|
/// expr, of t's Wax type, as a value.
fn Gen::encode(_ : Gen, t : @check.Ty, expr : String) -> String {
  match t {
    Bool => "value_bool(\{expr})"
    F64 => "value_number(\{expr})"
    Str | Enum(_) => "value_string(\{expr})"
    _ => expr
  }
}

///|
/// A value known to be of type t (the schema checked it), in t's Wax type.
fn Gen::decode(_ : Gen, t : @check.Ty, expr : String) -> String {
  match t {
    Bool => "value_truthy(\{expr})"
    F64 => "value_to_f64(\{expr})"
    Str | Enum(_) => "value_string_of(\{expr})!"
    _ => expr
  }
}

///|
/// A float literal Wax reads as one.
fn float_text(d : Double) -> String {
  let s = d.to_string()
  if s.contains(".") || s.contains("e") || s.contains("N") || s.contains("I") {
    s
  } else {
    s + ".0"
  }
}

///|
/// A known value as a runtime value.
fn Gen::val(self : Gen, v : @check.Val) -> String {
  match v {
    VNull | Unknown => "value_null()"
    VBool(b) => "value_bool(\{if b { 1 } else { 0 }})"
    VNum(n) => "value_number(\{float_text(n)})"
    VStr(s) => "value_string(\{self.s(s)})"
    VList(items) => {
      let mut e = "list_empty()"
      for i in items {
        e = "list_push(\{e}, \{self.val(i)})"
      }
      e
    }
    VMap(entries) => {
      let mut e = "map_empty()"
      for en in entries {
        e = "map_assoc(\{e}, \{self.s(en.0)}, \{self.val(en.1)})"
      }
      e
    }
  }
}

///|
/// A known value in t's Wax type: a default.
fn Gen::wax_val(self : Gen, t : @check.Ty, v : @check.Val) -> String {
  match (t, v) {
    (Bool, VBool(b)) => if b { "1" } else { "0" }
    (F64, VNum(n)) => float_text(n)
    (Str, VStr(s)) | (Enum(_), VStr(s)) => self.s(s)
    (Enum(ms), _) => self.s(ms.get(0).unwrap_or(""))
    (Bool, _) => "0"
    (F64, _) => "0.0"
    (Str, _) => self.s("")
    _ => self.val(v)
  }
}

///|
/// The value a field starts with when init gets none: its default, its
/// type's, or (required) a placeholder init never keeps.
fn Gen::start_value(self : Gen, f : @check.FieldM) -> String {
  let v = match f.default {
    Some(v) => v
    None => @check.field_default(f.ty, f.norm).unwrap_or(Unknown)
  }
  self.wax_val(f.ty, v)
}

///|
/// The runtime vtype of t.
fn Gen::vtype(self : Gen, b : Block, t : @check.Ty) -> String {
  match t {
    Any => "vtype_any()"
    Null => "vtype_null()"
    Bool => "vtype_bool()"
    F64 => "vtype_number()"
    Str => "vtype_string()"
    Enum(ms) => "vtype_enum(\{b.array("str_array", ms.map(m => self.s(m)))})"
    Option(i) => "vtype_option(\{self.vtype(b, i)})"
    List(i) => "vtype_list(\{self.vtype(b, i)})"
    Map(i) => "vtype_map(\{self.vtype(b, i)})"
    Record(fs) => {
      let names = b.array("str_array", fs.map(f => self.s(f.0)))
      let types = b.array("vtype_array", fs.map(f => self.vtype(b, f.1)))
      "vtype_record(\{names}, \{types})"
    }
    OneOf(ts) =>
      "vtype_one_of(\{b.array("vtype_array", ts.map(t => self.vtype(b, t)))})"
    Comp(ns) =>
      "vtype_component(\{b.array("str_array", ns.map(n => self.s(n)))})"
  }
}

///|
/// The runtime constraints of a normal form.
fn Gen::constraints(self : Gen, b : Block, n : @check.Norm) -> String {
  let cs = []
  if n.int {
    cs.push("constraint_int()")
  }
  if n.lo is Some(lo) {
    cs.push(
      "constraint_min(\{float_text(lo.value)}, \{if lo.exclusive { 1 } else { 0 }})",
    )
  }
  if n.hi is Some(hi) {
    cs.push(
      "constraint_max(\{float_text(hi.value)}, \{if hi.exclusive { 1 } else { 0 }})",
    )
  }
  if n.len_lo is Some(v) {
    cs.push("constraint_min_len(\{v})")
  }
  if n.len_hi is Some(v) {
    cs.push("constraint_max_len(\{v})")
  }
  for p in n.patterns {
    cs.push("constraint_pattern(\{self.s(p)})")
  }
  for f in n.key_of {
    cs.push("constraint_key_of(\{self.s(f)})")
  }
  b.array("constraint_array", cs)
}

///|
fn sync_const(s : @check.SyncLevel) -> String {
  match s {
    Shared => "sync_shared"
    Local => "sync_local"
    NoSync => "sync_none"
  }
}

///|
/// A field's schema.
fn Gen::field_schema(self : Gen, b : Block, f : @check.FieldM) -> String {
  let vt = self.vtype(b, f.ty)
  let cs = self.constraints(b, f.norm)
  let fs = "field_schema_new(\{self.s(f.name)}, \{vt}, \{cs}, \{sync_const(f.sync)})"
  // The default runtime.schema says: the written one, or the type's, when
  // it's a value (not a made component).
  if f.make is Some(_) {
    return fs
  }
  let v = match f.default {
    Some(v) => v
    None => @check.field_default(f.ty, f.norm).unwrap_or(Unknown)
  }
  match v {
    Unknown => fs
    known => "field_schema_set_default(\{fs}, \{self.val(known)})"
  }
}

///|
fn Gen::field_schemas(
  self : Gen,
  b : Block,
  fs : Array[@check.FieldM],
) -> String {
  b.array("field_schema_array", fs.map(f => self.field_schema(b, f)))
}
