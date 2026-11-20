// pure-tutuca in the browser: the pipeline (@api) compiled to wasm-gc, behind
// functions that take a request and return a response as JSON strings (JS
// strings, with the js-string builtins), so nothing else crosses.
//
// A request is { main, files: { path: text }, impls: [{ path, text }],
// runtime: { path: text } }: the module and the ones it imports, the
// implementation, and the runtime's prelude, collections and src/abi.wax by
// their paths in tutuca-wax. A main named *.tutuca.ts is a pure-tutuca
// module: its imports are among files, and it has no impls (its functions
// are lowered to Wax, which pt_build answers as impl); hostModules are the
// declarations of the page's host modules it may import. A response is { ok, diags, ... } with what the
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
    [@diag.error("pure-tutuca.request", @diag.Span::none("request"), message)],
    Map([]),
  )
}

///|
/// Parses the request and loads its main module; the package, what checking
/// it reported, and the request; or the response saying why not.
fn prepare(
  req : String,
) -> Result[
  (Json, @check.Package, Array[@diag.Diagnostic], @pure.Checked?),
  String,
] {
  let j = @json.parse(req) catch {
    _ => return Err(failure("the request isn't JSON"))
  }
  let files = files_of(j, "files")
  let main = str_field(j, "main")
  let pages = []
  if j is Object(m) && m.get("hostModules") is Some(Array(decls)) {
    for d in decls {
      pages.push(
        @pure.host_module_of(d.stringify()) catch {
          Failure(msg) => return Err(failure("a host module: \{msg}"))
        },
      )
    }
  }
  match @api.load(p => files.get(p), main, pages~) {
    Some((pkg, diags, checked)) => Ok((j, pkg, diags, checked))
    None => Err(failure("the request has no file \{main}"))
  }
}

///|
fn types_of(pkg : @check.Package) -> Json {
  Json::array(pkg.registers.map(r => Json::string(r.as_)))
}

///|
/// Checks the module: { ok, diags, types }.
pub fn pt_check(req : String) -> String {
  match prepare(req) {
    Err(out) => out
    Ok((_, pkg, diags, _)) =>
      response(
        !@diag.has_errors(diags),
        diags,
        Map::from_array([("types", types_of(pkg))]),
      )
  }
}

///|
/// The model js/pbt.js tests from: { ok, diags, model }.
pub fn pt_model(req : String) -> String {
  match prepare(req) {
    Err(out) => out
    Ok((_, pkg, diags, checked)) => {
      if @diag.has_errors(diags) {
        return response(false, diags, Map([]))
      }
      response(
        true,
        diags,
        Map::from_array([("model", @api.model(pkg, checked))]),
      )
    }
  }
}

///|
/// Generates, checks the implementation and compiles: { ok, diags, contract,
/// glue, abi, model, types, wasm: [bytes] }, and impl and implPath for a
/// pure-tutuca module.
pub fn pt_build(req : String) -> String {
  match prepare(req) {
    Err(out) => out
    Ok((j, pkg, diags, checked)) => {
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
      let impls : Array[@compose.Source] = []
      let (lowered, lower_diags) = @api.lowered_impl(
        p => files.get(p),
        main,
        checked,
        pkg,
        @api.dir_of(main),
      )
      if lowered is Some(impl_) {
        impls.push(impl_)
      }
      if @diag.has_errors(lower_diags) {
        return response(false, [..diags, ..lower_diags], Map([]))
      }
      diags.append(lower_diags)
      let built = @api.build(pkg, main, runtime, impls, @api.dir_of(main), read=p => {
        files.get(p)
      })
      diags.append(built.diags)
      let extra : Map[String, Json] = Map::from_array([
        ("contract", Json::string(built.generated.contract)),
        ("glue", Json::string(built.generated.glue)),
        ("abi", Json::string(built.abi_imports)),
        ("contractPath", Json::string(built.contract_path)),
        ("gluePath", Json::string(built.glue_path)),
        ("abiPath", Json::string(built.abi_path)),
        ("model", @api.model(pkg, checked)),
        // pure-tutuca's own model, what js/pbt.js runs examples and walks from.
        ("pbtModel", @export.model(pkg)),
        ("types", types_of(pkg)),
      ])
      if lowered is Some(impl_) {
        extra["impl"] = Json::string(impl_.text)
        extra["implPath"] = Json::string(impl_.path)
      }
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
