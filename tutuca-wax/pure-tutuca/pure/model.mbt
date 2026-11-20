// A pure-tutuca module's model, format 2 (spec/pure-tutuca/README.md): what
// tutuca's componentModule says of it (src/pure/module.js modelOf), from the
// module as written, so pure-tutuca and tutuca give the same JSON for the same text
// (spec/pure-tutuca/golden holds tutuca's).

///|
/// A data member's value as JSON, as tutuca reads it (its literal): what
/// isn't a literal is left out of an object and null in a list, as
/// JSON.stringify leaves undefined.
fn loose_json(
  e : @ast.Expr,
  consts~ : Map[String, @ast.Expr] = Map([]),
  depth~ : Int32 = 0,
) -> Json? {
  if depth > 16 {
    return None
  }
  let loose_json = (x : @ast.Expr) => loose_json(x, consts~, depth=depth + 1)
  match e {
    // A module constant named, and a template of them: their value.
    Ident(id) =>
      match consts.get(id.name) {
        Some(init) => loose_json(init)
        None => None
      }
    Template(quasis~, exprs~, ..) => {
      let sb = StringBuilder()
      for i, q in quasis {
        sb.write_string(q.cooked)
        if exprs.get(i) is Some(x) {
          match loose_json(x) {
            Some(String(t)) => sb.write_string(t)
            Some(Number(n, ..)) => sb.write_string(n.to_string())
            _ => return None
          }
        }
      }
      Some(Json::string(sb.to_string()))
    }
    Lit(LNull, ..) => Some(Json::null())
    Lit(LBool(b), ..) => Some(Json::boolean(b))
    Lit(LNum(n), ..) => Some(Json::number(n))
    Lit(LStr(s), ..) => Some(Json::string(s))
    Unary(op="-", arg~, ..) =>
      match loose_json(arg) {
        Some(Number(n, ..)) => Some(Json::number(-n))
        _ => None
      }
    ArrayLit(es, ..) =>
      Some(
        Json::array(
          es.map(x => {
            match x {
              Some(y) => loose_json(y).unwrap_or(Json::null())
              None => Json::null()
            }
          }),
        ),
      )
    ObjectLit(ms, ..) => {
      let out : Map[String, Json] = Map([])
      for m in ms {
        if m is Prop(key~, value~, ..) && !(key is KComputed(_)) {
          match loose_json(value) {
            Some(j) => out[key_name(key)] = j
            None => ()
          }
        }
      }
      Some(Json::object(out))
    }
    _ => None
  }
}

///|
fn member_json(j : Json?, name : String) -> Json? {
  match j {
    Some(Object(m)) => m.get(name)
    _ => None
  }
}

///|
fn or_null(j : Json?) -> Json {
  j.unwrap_or(Json::null())
}

///|
/// Whether an object literal has a method or getter, at any depth: a
/// namespace, which tutuca lists before the plain const objects.
fn has_methods(e : @ast.Expr) -> Bool {
  match e {
    ObjectLit(ms, ..) =>
      ms
      .iter()
      .any(m => {
        match m {
          Method(..) => true
          Prop(value~, ..) => has_methods(value)
          _ => false
        }
      })
    _ => false
  }
}

///|
/// The module's model, format 2.
pub fn model_of(checked : Checked) -> Json {
  let decls = checked.decls
  let comps = components_of(decls)
  let ordered = [
    ..comps.filter(c => has_methods(c.literal)),
    ..comps.filter(c => !has_methods(c.literal)),
  ]
  let entries : Map[String, Json] = Map([])
  for e in checked.checked.entries {
    entries[e.path.join(".")] = Json::string(e.return_type)
  }
  let components = ordered.map(c => {
    let data = loose_json(c.literal, consts=c.consts)
    let queries = query_names(c)
    let defaults = member_json(data, "defaults")
    let fields = []
    for m in type_members(Some(c.state)) {
      guard m is TMProperty(name~, value~, ..) else { continue }
      if queries.contains(name) || @tables.reserved_names.contains(name) {
        continue
      }
      let public_ = match member_json(data, "public") {
        Some(Array(names)) => names.contains(Json::string(name))
        _ => false
      }
      fields.push(
        Json::object({
          "name": Json::string(name),
          "type": Json::string(@purejs.print_type(value)),
          "constraints": or_null(
            member_json(member_json(data, "constraints"), name),
          ),
          "default": or_null(member_json(defaults, name)),
          "sync": or_null(member_json(member_json(data, "sync"), name)),
          "public": Json::boolean(public_),
        }),
      )
    }
    let messages = handlers_of(c, "on").map(h => {
      let info = loose_json(h.1, consts=c.consts)
      Json::object({
        "name": Json::string(h.0),
        "args": Json::string(args_text(h.1)),
        "pure": Json::boolean(member_json(info, "pure") is Some(True)),
        "changes": or_null(member_json(info, "changes")),
        "constraints": or_null(member_json(info, "constraints")),
        "sourceKey": or_null(member_json(info, "sourceKey")),
        "pre": Json::boolean(member_of(h.1, "pre") is Some(_)),
        "post": Json::boolean(member_of(h.1, "post") is Some(_)),
        "why": or_null(member_json(info, "why")),
      })
    })
    let views = []
    if member_of(c.literal, "view") is Some(_) {
      views.push(Json::string("main"))
    }
    for v in members_in(value_of(c.literal, "views")) {
      views.push(Json::string(v.0))
    }
    Json::object({
      "name": Json::string(c.name),
      "fields": Json::array(fields),
      "queries": Json::array(
        queries.map(q => {
          Json::object({
            "name": Json::string(q),
            "type": or_null(entries.get("\{c.name}.queries.\{q}")),
          })
        }),
      ),
      "messages": Json::array(messages),
      "invariants": Json::array(
        members_in(value_of(c.literal, "invariants")).map(x => Json::string(x.0)),
      ),
      "views": Json::array(views),
      "meta": or_null(member_json(data, "meta")),
      "implements": member_json(data, "implements").unwrap_or(Json::array([])),
    })
  })
  let interfaces = []
  for name, node in decls.types {
    let ms = type_members(Some(node))
    if !is_interface(decls, name) {
      continue
    }
    let fields = ms.filter_map(m => {
      match m {
        TMProperty(name~, value~, ..) =>
          Some(
            Json::object({
              "name": Json::string(name),
              "type": Json::string(@purejs.print_type(value)),
            }),
          )
        _ => None
      }
    })
    let messages = ms.filter_map(m => {
      match m {
        TMMethod(name~, params~, ..) if marked(m, "Pure") =>
          Some(
            Json::object({
              "name": Json::string(name),
              "args": Json::string(
                "[\{params.map(p => @purejs.print_type(p.value)).join(", ")}]",
              ),
              "pure": Json::boolean(true),
            }),
          )
        _ => None
      }
    })
    let notifies = ms.filter_map(m => {
      match m {
        TMMethod(name~, ..) if marked(m, "Notify") => Some(Json::string(name))
        _ => None
      }
    })
    interfaces.push(
      Json::object({
        "name": Json::string(name),
        "fields": Json::array(fields),
        "messages": Json::array(messages),
        "notifies": Json::array(notifies),
      }),
    )
  }
  let meta_schemas = meta_schemas_of(decls).map(m => {
    let (c, uri) = m
    let data = loose_json(c.literal, consts=c.consts)
    let fields = []
    for mem in type_members(Some(c.state)) {
      guard mem is TMProperty(name~, value~, ..) else { continue }
      if @tables.reserved_names.contains(name) {
        continue
      }
      fields.push(
        Json::object({
          "name": Json::string(name),
          "type": Json::string(@purejs.print_type(value)),
          "constraints": or_null(
            member_json(member_json(data, "constraints"), name),
          ),
          "default": or_null(member_json(member_json(data, "defaults"), name)),
        }),
      )
    }
    Json::object({
      "name": Json::string(c.name),
      "uri": Json::string(uri),
      "fields": Json::array(fields),
    })
  })
  Json::object({
    "format": Json::number(2),
    "components": Json::array(components),
    "interfaces": Json::array(interfaces),
    "metaSchemas": Json::array(meta_schemas),
    "register": match decls.consts.get("register") {
      Some(e) => or_null(loose_json(e))
      None => Json::null()
    },
    "entries": Json::object(entries),
  })
}
