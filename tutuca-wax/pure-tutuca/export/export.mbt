// The model as JSON, its names as the module writes them: what a test runner generates states and messages from (types,
// constraints in normal form, which fields depend on which), and checks
// them by (guards, frames, relations, emits, invariants, examples).

///|
fn ty_json(t : @check.Ty) -> Json {
  match t {
    Bool => { "kind": "bool" }
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
            ({ "name": Json::string(f.0), "type": ty_json(f.1) } : Json)
          }),
        ),
      }
    OneOf(ts) => { "kind": "one_of", "types": Json::array(ts.map(ty_json)) }
    Comp(ns) =>
      {
        "kind": "component",
        "names": Json::array(ns.map(n => Json::string(n))),
      }
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
        m[e.0] = val_json(e.1)
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
  let out : Map[String, Json] = {
    "lo": bound_json(n.lo),
    "hi": bound_json(n.hi),
    "lenLo": opt_int(n.len_lo),
    "lenHi": opt_int(n.len_hi),
    "patterns": Json::array(n.patterns.map(Json::string)),
    "keyOf": Json::array(n.key_of.map(f => Json::string(f))),
  }
  if n.int {
    out["int"] = Json::boolean(true)
  }
  Json::object(out)
}

///|
fn doc_json(doc : String?) -> Json {
  match doc {
    Some(d) => Json::string(d)
    None => Json::null()
  }
}

///|
fn field_json(f : @check.FieldM) -> Json {
  let default = match f.default {
    Some(e) => val_json(e)
    None =>
      match @check.field_default(f.ty, f.norm) {
        Some(v) if !f.required => val_json(v)
        _ => Json::null()
      }
  }
  {
    "name": Json::string(f.name),
    "type": ty_json(f.ty),
    "norm": norm_json(f.norm),
    "required": Json::boolean(f.required),
    "default": default,
    "make": match f.make {
      Some(m) => Json::string(m)
      None => Json::null()
    },
    "doc": doc_json(f.doc),
  }
}

///|
fn emit_json(e : @check.EmitM) -> Json {
  let kind = match e.kind {
    Notify => "notify"
    Ask => "ask"
    SendAt => "sendAt"
    Reply => "reply"
    Make => "make"
  }
  {
    "kind": Json::string(kind),
    "name": Json::string(if e.kind is Make { e.name } else { e.name }),
  }
}

///|
fn message_json(m : @check.MessageM) -> Json {
  {
    "name": Json::string(m.name),
    "params": Json::array(m.params.map(field_json)),
    "swap": Json::boolean(m.swap),
    "sourceKey": match m.source_key {
      Some(k) => field_json(k)
      None => Json::null()
    },
    "pre": Json::boolean(m.pre_entry),
    "changes": match m.changes {
      Some(ch) => Json::array(ch.map(c => Json::string(c)))
      None => Json::null()
    },
    "post": Json::boolean(m.post_entry),
    "emits": match m.emits {
      Some(es) => Json::array(es.map(emit_json))
      None => Json::null()
    },
    "doc": doc_json(m.doc),
  }
}

///|
fn query_json(q : @check.SignalM) -> Json {
  {
    "name": Json::string(q.name),
    "params": Json::array(q.params.map(field_json)),
    "result": match q.result {
      Some(t) => ty_json(t)
      None => Json::null()
    },
    "doc": doc_json(q.doc),
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
      Some(f) =>
        for d in f.norm.key_of {
          visit(d)
        }
      None => ()
    }
    out.push(name)
  }
  for f in c.fields {
    visit(f.name)
  }
  out
}

///|
fn component_json(c : @check.ComponentM) -> Json {
  {
    "name": Json::string(c.name),
    "fields": Json::array(c.fields.map(field_json)),
    "fieldOrder": Json::array(field_order(c).map(Json::string)),
    "gets": Json::array(c.gets.map(field_json)),
    "messages": Json::array(c.messages.map(message_json)),
    "queries": Json::array(c.queries.map(query_json)),
    "invariants": Json::array(
      c.invariants.map(i => ({ "name": Json::string(i.name) } : Json)),
    ),
    "implements": Json::array(c.implements.map(i => Json::string(i))),
  }
}

///|
fn example_json(ex : @check.ExampleM) -> Json {
  let start : Map[String, Json] = Map([])
  for s in ex.start {
    start[s.0] = val_json(s.1)
  }
  {
    "name": Json::string(ex.name),
    "component": Json::string(ex.component),
    "start": Json::object(start),
    "steps": Json::array(
      ex.steps.map(s => {
        match s {
          Send(m, args, ..) =>
            (
              {
                "send": Json::string(m),
                "args": Json::array(args.map(val_json)),
              } : Json)
          Expect(fields, ..) => {
            let m : Map[String, Json] = Map([])
            for f in fields {
              m[f.0] = val_json(f.1)
            }
            { "expect": Json::object(m) }
          }
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
            "name": Json::string(i.name),
            "fields": Json::array(i.fields.map(field_json)),
            "gets": Json::array(i.gets.map(field_json)),
            "messages": Json::array(i.messages.map(message_json)),
          } : Json)
      }),
    ),
    "registers": Json::array(
      pkg.registers.map(r => {
        (
          { "component": Json::string(r.component), "as": Json::string(r.as_) } :
          Json)
      }),
    ),
    "examples": Json::array(pkg.examples.map(example_json)),
  }
}
