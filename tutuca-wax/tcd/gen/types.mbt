// TCD types in Wax: the type a field or argument has in the state struct
// and in handlers, turning values into it and back, and the runtime's schema
// data (vtypes, constraints) for them.

///|
/// The package being generated: its model, its strings and its enums.
pub(all) struct Gen {
  pkg : @check.Package
  strings : Strings
  /// Each distinct enum's members, by index: tcd_enum_<i>_name / _index.
  enums : Array[Array[String]]
  /// The functions the implementation defines, when known: the optional ones
  /// it lacks aren't called.
  have : Array[String]?
}

///|
pub fn Gen::new(pkg : @check.Package, have? : Array[String]) -> Gen {
  { pkg, strings: names_first(pkg), enums: [], have, }
}

///|
/// The strings, with the package's names claimed first, in the order they're
/// declared: an implementation's gs_<name> is that name's, whatever text a
/// view has that reads the same (a "Notes" label takes gs_notes_2, not the
/// field notes's gs_notes).
fn names_first(pkg : @check.Package) -> Strings {
  let strings = Strings::new()
  let members = (fields : Array[@check.FieldM]) => {
    for f in fields {
      ignore(strings.get(f.name))
    }
  }
  for c in pkg.components {
    ignore(strings.get(c.name))
  }
  for i in pkg.interfaces {
    ignore(strings.get(i.name))
  }
  for c in pkg.components {
    members(c.fields)
    members(c.gets)
    for m in c.messages {
      ignore(strings.get(m.name))
    }
    for n in c.notifies {
      ignore(strings.get(n.name))
    }
    for a in c.asks {
      ignore(strings.get(a.name))
    }
    for l in c.loops {
      ignore(strings.get(l.name))
    }
    for sc in c.scopes {
      ignore(strings.get(sc.name))
    }
    for pr in c.provides {
      ignore(strings.get(pr.name))
    }
  }
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
fn Gen::enum_id(self : Gen, members : Array[String]) -> Int32 {
  for i, e in self.enums {
    if e == members {
      return i
    }
  }
  self.enums.push(members)
  self.enums.length() - 1
}

///|
/// The Wax type a value of t is held in.
pub fn wax_ty(t : @check.Ty) -> String {
  match t {
    Bool | S32 | Enum(_) => "i32"
    F64 => "f64"
    Str => "&extern"
    _ => "&value"
  }
}

///|
/// expr, of t's Wax type, as a value.
fn Gen::encode(self : Gen, t : @check.Ty, expr : String) -> String {
  match t {
    Bool => "value_bool(\{expr})"
    S32 => "value_int(\{expr})"
    F64 => "value_float(\{expr})"
    Str => "value_string(\{expr})"
    Enum(ms) => "value_string(tcd_enum_\{self.enum_id(ms)}_name(\{expr}))"
    _ => expr
  }
}

///|
/// A value known to be of type t (the schema checked it), in t's Wax type.
fn Gen::decode(self : Gen, t : @check.Ty, expr : String) -> String {
  match t {
    Bool => "value_truthy(\{expr})"
    S32 => "(\{expr} as &value_int).value"
    F64 => "value_to_f64(\{expr})"
    Str => "value_string_of(\{expr})!"
    Enum(ms) => "tcd_enum_\{self.enum_id(ms)}_index(value_string_of(\{expr})!)"
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
    VNum(n) =>
      if n == n.floor() && n.abs() < 2147483648.0 {
        "value_int(\{n.to_int()})"
      } else {
        "value_float(\{float_text(n)})"
      }
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
/// A literal as a runtime value.
fn Gen::lit(self : Gen, l : @syntax.Lit) -> String {
  self.val(@check.lit_val(l))
}

///|
/// A known value in t's Wax type: a default.
fn Gen::wax_val(self : Gen, t : @check.Ty, v : @check.Val) -> String {
  match (t, v) {
    (Bool, VBool(b)) => if b { "1" } else { "0" }
    (S32, VNum(n)) => n.to_int().to_string()
    (F64, VNum(n)) => float_text(n)
    (Str, VStr(s)) => self.s(s)
    (Enum(ms), VStr(s)) => {
      let mut i = 0
      for j, m in ms {
        if m == s {
          i = j
        }
      }
      i.to_string()
    }
    (Bool | S32 | Enum(_), _) => "0"
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
    Some(e) => @check.literal_val(e)
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
    S32 => "vtype_int()"
    F64 => "vtype_float()"
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
    Result(o, e) => "vtype_result(\{self.vtype(b, o)}, \{self.vtype(b, e)})"
  }
}

///|
/// A list value of literals.
fn Gen::lits(self : Gen, ls : Array[@syntax.Lit]) -> String {
  self.val(VList(ls.map(@check.lit_val)))
}

///|
/// The runtime constraints of a normal form. owner names the component's
/// trampolines for check(p) and values(f) (`c_check_p_t`, `c_member_of_f`).
fn Gen::constraints(
  self : Gen,
  b : Block,
  n : @check.Norm,
  owner : String,
  subject : String,
) -> String {
  let cs = []
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
  if n.one_of is Some(ls) {
    cs.push("constraint_one_of(\{self.lits(ls)})")
  }
  if !n.none_of.is_empty() {
    cs.push("constraint_none_of(\{self.lits(n.none_of)})")
  }
  for p in n.patterns {
    cs.push("constraint_pattern(\{self.s(p)})")
  }
  for f in n.key_of {
    cs.push("constraint_key_of(\{self.s(f)})")
  }
  for f in n.member_of {
    cs.push(
      "constraint_check(\{self.s("in values(" + f + ")")}, \{owner}_member_of_\{@check.wax(f)})",
    )
  }
  for p in n.checks {
    cs.push(
      "constraint_check(\{self.s(p)}, \{owner}_check_\{p}_\{@check.wax(subject)}_t)",
    )
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
fn Gen::field_schema(
  self : Gen,
  b : Block,
  f : @check.FieldM,
  owner : String,
) -> String {
  let vt = self.vtype(b, f.ty)
  let cs = self.constraints(b, f.norm, owner, f.name)
  "field_schema_new(\{self.s(f.name)}, \{vt}, \{cs}, \{sync_const(f.sync)})"
}

///|
fn Gen::field_schemas(
  self : Gen,
  b : Block,
  fs : Array[@check.FieldM],
  owner : String,
) -> String {
  b.array("field_schema_array", fs.map(f => self.field_schema(b, f, owner)))
}

///|
/// The enum helpers: an index's member name, a name's index (-1 for none).
fn Gen::enum_helpers(self : Gen) -> String {
  let out = Out::new()
  for i, ms in self.enums {
    out.line("fn tcd_enum_\{i}_name(i: i32) -> &extern {")
    for j, m in ms {
      out.line("    if i == \{j} {")
      out.line("        return \{self.s(m)};")
      out.line("    }")
    }
    out.line("    \{self.s(ms[0])};")
    out.line("}")
    out.line("")
    out.line("fn tcd_enum_\{i}_index(s: &extern) -> i32 {")
    for j, m in ms {
      out.line("    if str_eq(s, \{self.s(m)}) {")
      out.line("        return \{j};")
      out.line("    }")
    }
    out.line("    -1;")
    out.line("}")
    out.line("")
  }
  out.to_string()
}
