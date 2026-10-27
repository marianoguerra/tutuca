// The model as JSON, in the runtime's names (types PascalCase, members
// camelCase): what a test runner generates states and messages from (types,
// constraints in normal form, which fields depend on which), and checks
// them by (guards, frames, relations, emits, invariants, examples).

///|
fn ty_json(t : @check.Ty) -> Json {
  match t {
    Bool => { "kind": "bool" }
    S32 => { "kind": "s32" }
    F64 => { "kind": "f64" }
    Str => { "kind": "string" }
    Any => { "kind": "any" }
    Null => { "kind": "null" }
    Enum(ms) => { "kind": "enum", "members": Json::array(ms.map(Json::string)) }
    Option(i) => { "kind": "option", "item": ty_json(i) }
    List(i) => { "kind": "list", "item": ty_json(i) }
    Map(i) => { "kind": "map", "item": ty_json(i) }
    Record(fs) =>
      {
        "kind": "record",
        "fields": Json::array(
          fs.map(f => {
            (
              { "name": Json::string(@check.camel(f.0)), "type": ty_json(f.1) } :
              Json)
          }),
        ),
      }
    OneOf(ts) => { "kind": "one_of", "types": Json::array(ts.map(ty_json)) }
    Comp(ns) =>
      {
        "kind": "component",
        "names": Json::array(ns.map(n => Json::string(@check.pascal(n)))),
      }
    Result(o, e) => { "kind": "result", "ok": ty_json(o), "err": ty_json(e) }
  }
}

///|
fn lit_json(l : @syntax.Lit) -> Json {
  match l {
    Int(n) => Json::number(n.to_double())
    Float(f) => Json::number(f)
    Str(s) => Json::string(s)
    Bool(b) => Json::boolean(b)
    Null => Json::null()
  }
}

///|
fn val_json(v : @check.Val) -> Json {
  match v {
    VNull | Unknown => Json::null()
    VBool(b) => Json::boolean(b)
    VNum(n) => Json::number(n)
    VStr(s) => Json::string(s)
    VList(xs) => Json::array(xs.map(val_json))
    VMap(entries) => {
      let m : Map[String, Json] = Map([])
      for e in entries {
        m[@check.camel(e.0)] = val_json(e.1)
      }
      Json::object(m)
    }
  }
}

///|
fn bound_json(b : @check.Bound?) -> Json {
  match b {
    Some(b) =>
      {
        "value": Json::number(b.value),
        "exclusive": Json::boolean(b.exclusive),
      }
    None => Json::null()
  }
}

///|
fn opt_int(i : Int32?) -> Json {
  match i {
    Some(v) => Json::number(v.to_double())
    None => Json::null()
  }
}

///|
fn norm_json(n : @check.Norm) -> Json {
  {
    "lo": bound_json(n.lo),
    "hi": bound_json(n.hi),
    "lenLo": opt_int(n.len_lo),
    "lenHi": opt_int(n.len_hi),
    "oneOf": match n.one_of {
      Some(ls) => Json::array(ls.map(lit_json))
      None => Json::null()
    },
    "noneOf": Json::array(n.none_of.map(lit_json)),
    "patterns": Json::array(n.patterns.map(Json::string)),
    "keyOf": Json::array(n.key_of.map(f => Json::string(@check.camel(f)))),
    "memberOf": Json::array(n.member_of.map(f => Json::string(@check.camel(f)))),
    "checks": Json::array(n.checks.map(Json::string)),
  }
}

///|
fn op_name(op : @syntax.BinOp) -> String {
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
/// A condition, its names in runtime spelling (next and it as they are).
pub fn cond_json(e : @syntax.Expr) -> Json {
  match e {
    Lit(l, ..) => { "lit": lit_json(l) }
    Path(parts, ..) =>
      {
        "path": Json::array(
          parts.map(p => {
            Json::string(
              if p.text == "next" || p.text == "it" {
                p.text
              } else {
                @check.camel(p.text)
              },
            )
          }),
        ),
      }
    Call(n, args, ..) =>
      {
        "call": Json::string(n.text),
        "args": Json::array(
          args.map(a => {
            match (n.text, a) {
              ("check", Path([p], ..)) =>
                ({ "name": Json::string(p.text) } : Json)
              _ => cond_json(a)
            }
          }),
        ),
      }
    List(items, ..) => { "list": Json::array(items.map(cond_json)) }
    Record(entries, ..) => {
      let m : Map[String, Json] = Map([])
      for en in entries {
        m[@check.camel(en.0.text)] = cond_json(en.1)
      }
      { "record": Json::object(m) }
    }
    Not(inner, ..) => { "not": cond_json(inner) }
    Bin(op, l, r, ..) =>
      { "op": Json::string(op_name(op)), "l": cond_json(l), "r": cond_json(r) }
    Matches(inner, p, ..) =>
      { "matches": cond_json(inner), "pattern": Json::string(p) }
  }
}

///|
fn opt_cond(e : @syntax.Expr?) -> Json {
  match e {
    Some(c) => cond_json(c)
    None => Json::null()
  }
}

///|
fn field_json(f : @check.FieldM) -> Json {
  let default = match f.default {
    Some(e) => val_json(@check.literal_val(e))
    None =>
      match @check.type_default(f.ty) {
        Some(v) if !f.required => val_json(v)
        _ => Json::null()
      }
  }
  {
    "name": Json::string(@check.camel(f.name)),
    "type": ty_json(f.ty),
    "norm": norm_json(f.norm),
    "required": Json::boolean(f.required),
    "default": default,
    "make": match f.make {
      Some(m) => Json::string(@check.pascal(m))
      None => Json::null()
    },
  }
}

///|
fn emit_json(e : @check.EmitM) -> Json {
  let kind = match e.kind {
    Notify => "notify"
    Ask => "ask"
    SendAt => "sendAt"
    Make => "make"
  }
  {
    "kind": Json::string(kind),
    "name": Json::string(
      if e.kind is Make {
        @check.pascal(e.name)
      } else {
        @check.camel(e.name)
      },
    ),
  }
}

///|
fn message_json(m : @check.MessageM) -> Json {
  {
    "name": Json::string(@check.camel(m.name)),
    "params": Json::array(m.params.map(field_json)),
    "swap": Json::boolean(m.swap),
    "sourceKey": match m.source_key {
      Some(k) => field_json(k)
      None => Json::null()
    },
    "when": opt_cond(m.when_),
    "changes": match m.changes {
      Some(ch) => Json::array(ch.map(c => Json::string(@check.camel(c))))
      None => Json::null()
    },
    "ensures": opt_cond(m.ensures),
    "emits": match m.emits {
      Some(es) => Json::array(es.map(emit_json))
      None => Json::null()
    },
  }
}

///|
/// The order fields can be generated in: one a constraint reads (keys(f),
/// values(f)) before the one it constrains.
fn field_order(c : @check.ComponentM) -> Array[String] {
  let out : Array[String] = []
  let visiting : Array[String] = []
  fn visit(name : String) -> Unit {
    if out.contains(name) || visiting.contains(name) {
      return
    }
    visiting.push(name)
    match c.field(name) {
      Some(f) => {
        for d in f.norm.key_of {
          visit(d)
        }
        for d in f.norm.member_of {
          visit(d)
        }
      }
      None => ()
    }
    out.push(name)
  }
  for f in c.fields {
    visit(f.name)
  }
  out.map(@check.camel)
}

///|
fn component_json(c : @check.ComponentM) -> Json {
  {
    "name": Json::string(@check.pascal(c.name)),
    "fields": Json::array(c.fields.map(field_json)),
    "fieldOrder": Json::array(field_order(c).map(Json::string)),
    "gets": Json::array(c.gets.map(field_json)),
    "messages": Json::array(c.messages.map(message_json)),
    "invariants": Json::array(
      c.invariants.map(i => {
        (
          {
            "name": Json::string(@check.camel(i.name)),
            "cond": cond_json(i.cond),
          } : Json)
      }),
    ),
    "implements": Json::array(
      c.implements.map(i => Json::string(@check.pascal(i))),
    ),
  }
}

///|
fn example_json(ex : @check.ExampleM) -> Json {
  let start : Map[String, Json] = Map([])
  for s in ex.start {
    start[@check.camel(s.0)] = val_json(@check.literal_val(s.1))
  }
  {
    "name": Json::string(ex.name),
    "component": Json::string(@check.pascal(ex.component)),
    "start": Json::object(start),
    "steps": Json::array(
      ex.steps.map(s => {
        match s {
          Send(m, args) =>
            (
              {
                "send": Json::string(@check.camel(m)),
                "args": Json::array(
                  args.map(a => val_json(@check.literal_val(a))),
                ),
              } : Json)
          Expect(cond) => { "expect": cond_json(cond) }
        }
      }),
    ),
  }
}

///|
/// The package's model.
pub fn model(pkg : @check.Package) -> Json {
  {
    "package": Json::string(pkg.full_name),
    "components": Json::array(pkg.components.map(component_json)),
    "interfaces": Json::array(
      pkg.interfaces.map(i => {
        (
          {
            "name": Json::string(@check.pascal(i.name)),
            "fields": Json::array(i.fields.map(field_json)),
            "gets": Json::array(i.gets.map(field_json)),
            "messages": Json::array(i.messages.map(message_json)),
          } : Json)
      }),
    ),
    "registers": Json::array(
      pkg.registers.map(r => {
        (
          {
            "component": Json::string(@check.pascal(r.component)),
            "as": Json::string(@check.pascal(r.as_)),
          } : Json)
      }),
    ),
    "examples": Json::array(pkg.examples.map(example_json)),
  }
}
