// What a built component module says about itself, in a custom section named
// "tutuca" (JSON), so a page given only the .wasm can tell what it is without
// running it: its sources (the TCD file, the ones it uses and the
// implementation, to build it again or use it from another), the types it
// registers and the interfaces it declares, what it makes or implements that
// a scope must give, and the host asks it declares. The runtime ignores it.

///|
/// The custom section's name.
pub let meta_section : String = "tutuca"

///|
fn base_name(path : String) -> String {
  match path.rev_find("/") {
    Some(i) => path.unsafe_substring(start=i + 1, end=path.length())
    None => path
  }
}

///|
fn push_new(out : Array[String], name : String) -> Unit {
  if !out.contains(name) {
    out.push(name)
  }
}

///|
fn comp_names(ty : @check.Ty, out : Array[String]) -> Unit {
  match ty {
    Comp(names) =>
      for n in names {
        push_new(out, n)
      }
    Option(t) | List(t) | Map(t) => comp_names(t, out)
    Record(fields) =>
      for f in fields {
        comp_names(f.1, out)
      }
    OneOf(ts) =>
      for t in ts {
        comp_names(t, out)
      }
    Result(a, b) => {
      comp_names(a, out)
      comp_names(b, out)
    }
    _ => ()
  }
}

///|
fn made_names(emits : Array[@check.EmitM]?, out : Array[String]) -> Unit {
  if emits is Some(es) {
    for e in es {
      if e.kind is Make {
        push_new(out, e.name)
      }
    }
  }
}

///|
/// The names pkg's components make or hold and the interfaces they
/// implement or hold that pkg doesn't give itself: (types, interfaces).
fn needs_of(pkg : @check.Package) -> (Array[String], Array[String]) {
  let made = []
  let held = []
  let implemented = []
  for c in pkg.components {
    for n in c.implements {
      push_new(implemented, n)
    }
    for f in c.fields {
      comp_names(f.ty, held)
      if f.make is Some(n) {
        push_new(made, n)
      }
    }
    for f in c.gets {
      comp_names(f.ty, held)
    }
    for m in c.messages {
      made_names(m.emits, made)
      for p in m.params {
        comp_names(p.ty, held)
      }
    }
    for s in c.asks {
      made_names(s.emits, made)
    }
  }
  for s in pkg.ask_handlers {
    made_names(s.emits, made)
  }
  let given = pkg.registers.map(r => r.as_)
  let types = []
  let interfaces = []
  for n in implemented {
    if pkg.interface_named(n) is Some(i) && !i.declared_here {
      push_new(interfaces, n)
    }
  }
  for n in held {
    match pkg.interface_named(n) {
      Some(i) => if !i.declared_here { push_new(interfaces, n) }
      None =>
        if !given.contains(n) && pkg.component(n) is None {
          push_new(types, n)
        }
    }
  }
  for n in made {
    if !given.contains(n) {
      push_new(types, n)
    }
  }
  (types, interfaces)
}

///|
/// The section's JSON for pkg built from file (read with read, as are the
/// files it uses, by the paths they're written as) and impls.
pub fn meta(
  pkg : @check.Package,
  file : String,
  read : (String) -> String?,
  impls : Array[@compose.Source],
) -> Json {
  let tcd = read(file).unwrap_or("")
  let uses : Map[String, Json] = Map([])
  for u in @syntax.parse(file, tcd).0.uses {
    if read(join_path(dir_of(file), u.path)) is Some(text) {
      uses[u.path] = Json::string(text)
    }
  }
  let (types, interfaces) = needs_of(pkg)
  let strings = (xs : Array[String]) => {
    Json::array(xs.map(s => Json::string(s)))
  }
  Json::object(
    Map::from_array([
      ("format", Json::number(1)),
      ("package", Json::string(pkg.full_name)),
      ("name", Json::string(pkg.name)),
      ("main", Json::string(base_name(file))),
      ("tcd", Json::string(tcd)),
      ("uses", Json::object(uses)),
      (
        "impls",
        Json::array(
          impls.map(s => {
            Json::object(
              Map::from_array([
                ("path", Json::string(base_name(s.path))),
                ("text", Json::string(s.text)),
              ]),
            )
          }),
        ),
      ),
      ("types", strings(pkg.registers.map(r => r.as_))),
      (
        "interfaces",
        strings(pkg.interfaces.filter(i => i.declared_here).map(i => i.name)),
      ),
      (
        "needs",
        Json::object(
          Map::from_array([
            ("types", strings(types)),
            ("interfaces", strings(interfaces)),
          ]),
        ),
      ),
      ("host_asks", strings(pkg.host_asks)),
    ]),
  )
}

///|
fn leb128(buf : Buffer, n : Int32) -> Unit {
  let mut n = n
  while true {
    let b = n & 0x7f
    n = n >> 7
    if n == 0 {
      buf.write_byte(b.to_byte())
      break
    }
    buf.write_byte((b | 0x80).to_byte())
  }
}

///|
/// wasm with a custom section named name holding text (UTF-8) at its end.
pub fn with_custom_section(wasm : Bytes, name : String, text : String) -> Bytes {
  let name_bytes = @utf8.encode(name)
  let payload = @utf8.encode(text)
  let content = Buffer()
  leb128(content, name_bytes.length())
  content.write_bytes(name_bytes)
  content.write_bytes(payload)
  let content = content.to_bytes()
  let out = Buffer(size_hint=wasm.length() + content.length() + 8)
  out.write_bytes(wasm)
  out.write_byte(b'\x00')
  leb128(out, content.length())
  out.write_bytes(content)
  out.to_bytes()
}
