// tcd in the browser: the pipeline (@api) compiled to wasm-gc, behind
// functions that take a request and return a response as JSON strings (JS
// strings, with the js-string builtins), so nothing else crosses.
//
// A request is { main, files: { path: text }, impls: [{ path, text }],
// runtime: { path: text } }: the TCD file and the ones it uses, the
// implementation, and the runtime's prelude, collections and src/abi.wax by
// their paths in tutuca-wax. A response is { ok, diags, ... } with what the
// action made.

///|
fn str_field(j : Json, key : String) -> String {
  match j {
    Object(m) =>
      match m.get(key) {
        Some(String(s)) => s
        _ => ""
      }
    _ => ""
  }
}

///|
fn files_of(j : Json, key : String) -> Map[String, String] {
  let out : Map[String, String] = Map([])
  if j is Object(m) && m.get(key) is Some(Object(files)) {
    for path, v in files {
      if v is String(text) {
        out[path] = text
      }
    }
  }
  out
}

///|
fn impls_of(j : Json) -> Array[@compose.Source] {
  let out = []
  if j is Object(m) && m.get("impls") is Some(Array(items)) {
    for item in items {
      out.push(@compose.Source::{
        path: str_field(item, "path"),
        text: str_field(item, "text"),
      })
    }
  }
  out
}

///|
fn response(
  ok : Bool,
  diags : Array[@diag.Diagnostic],
  extra : Map[String, Json],
) -> String {
  let m : Map[String, Json] = Map([])
  m["ok"] = Json::boolean(ok)
  m["diags"] = Json::array(@diag.sorted(diags).map(d => d.to_json()))
  for k, v in extra {
    m[k] = v
  }
  Json::object(m).stringify()
}

///|
fn failure(message : String) -> String {
  response(
    false,
    [@diag.error("tcd.request", @diag.Span::none("request"), message)],
    Map([]),
  )
}

///|
/// Parses the request and loads its main TCD file; the package, what checking
/// it reported, and the request; or the response saying why not.
fn prepare(
  req : String,
) -> Result[(Json, @check.Package, Array[@diag.Diagnostic]), String] {
  let j = @json.parse(req) catch {
    _ => return Err(failure("the request isn't JSON"))
  }
  let files = files_of(j, "files")
  let main = str_field(j, "main")
  match @api.load(p => files.get(p), main) {
    Some((pkg, diags)) => Ok((j, pkg, diags))
    None => Err(failure("the request has no file \{main}"))
  }
}

///|
fn types_of(pkg : @check.Package) -> Json {
  Json::array(pkg.registers.map(r => Json::string(r.as_)))
}

///|
/// Checks the TCD file: { ok, diags, types }.
pub fn tcd_check(req : String) -> String {
  match prepare(req) {
    Err(out) => out
    Ok((_, pkg, diags)) =>
      response(
        !@diag.has_errors(diags),
        diags,
        Map::from_array([("types", types_of(pkg))]),
      )
  }
}

///|
/// The functions the implementation lacks: { ok, diags, stub }.
pub fn tcd_stub(req : String) -> String {
  match prepare(req) {
    Err(out) => out
    Ok((j, pkg, diags)) => {
      if @diag.has_errors(diags) {
        return response(false, diags, Map([]))
      }
      let stub = @api.stub(pkg, str_field(j, "main"), impls_of(j))
      response(true, diags, Map::from_array([("stub", Json::string(stub))]))
    }
  }
}

///|
/// The model js/pbt.js tests from: { ok, diags, model }.
pub fn tcd_model(req : String) -> String {
  match prepare(req) {
    Err(out) => out
    Ok((_, pkg, diags)) => {
      if @diag.has_errors(diags) {
        return response(false, diags, Map([]))
      }
      response(true, diags, Map::from_array([("model", @export.model(pkg))]))
    }
  }
}

///|
/// Generates, checks the implementation and compiles: { ok, diags, contract,
/// glue, abi, model, types, wasm: [bytes] }.
pub fn tcd_build(req : String) -> String {
  match prepare(req) {
    Err(out) => out
    Ok((j, pkg, diags)) => {
      if @diag.has_errors(diags) {
        return response(
          false,
          diags,
          Map::from_array([("types", types_of(pkg))]),
        )
      }
      let runtime_files = files_of(j, "runtime")
      let runtime = match @api.read_runtime(p => runtime_files.get(p)) {
        Ok(r) => r
        Err(missing) =>
          return failure("the request's runtime has no \{missing}")
      }
      let main = str_field(j, "main")
      let files = files_of(j, "files")
      let built = @api.build(
        pkg,
        main,
        runtime,
        impls_of(j),
        @api.dir_of(main),
        read=p => files.get(p),
      )
      diags.append(built.diags)
      let extra : Map[String, Json] = Map::from_array([
        ("contract", Json::string(built.generated.contract)),
        ("glue", Json::string(built.generated.glue)),
        ("abi", Json::string(built.abi_imports)),
        ("contractPath", Json::string(built.contract_path)),
        ("gluePath", Json::string(built.glue_path)),
        ("abiPath", Json::string(built.abi_path)),
        ("model", @export.model(pkg)),
        ("types", types_of(pkg)),
      ])
      match built.wasm {
        Some(bytes) => {
          extra["wasm"] = Json::array(
            bytes.to_array().map(b => Json::number(b.to_int().to_double())),
          )
          response(true, diags, extra)
        }
        None => response(false, diags, extra)
      }
    }
  }
}

///|
fn main {

}
