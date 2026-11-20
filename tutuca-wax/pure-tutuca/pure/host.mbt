// The host modules a pure-tutuca module may import besides tutuca/view:
// tutuca/data (host_data.mbt, generated from tutuca's), and the page's, whose
// declarations come with the module to compile (pure-tutuca build --host, a web
// request's hostModules) and whose calls lower.mbt checks the results of.

///|
/// A host module's declaration: its specifier, module name, members (name,
/// overloads) and the members whose results the program may change.
pub(all) struct HostModule {
  specifier : String
  module_ : String
  members : Array[(String, Array[String])]
  fresh : Array[String]
}

///|
/// A host module's declaration, from its JSON (spec/pure-tutuca/host/*.json).
pub fn host_module_of(text : String) -> HostModule raise Failure {
  let j = @json.parse(text) catch {
    _ => fail("a host module's declaration isn't JSON")
  }
  guard j is Object(m) &&
    m.get("specifier") is Some(String(specifier)) &&
    m.get("module") is Some(String(module_)) &&
    m.get("members") is Some(Object(ms)) else {
    fail("a host module's declaration lacks specifier, module or members")
  }
  let members = []
  for name, sig in ms {
    match sig {
      String(s) => members.push((name, [s]))
      Array(xs) =>
        members.push(
          (
            name,
            xs.filter_map(x => if x is String(s) { Some(s) } else { None }),
          ),
        )
      _ => ()
    }
  }
  let fresh = match m.get("fresh") {
    Some(Array(xs)) =>
      xs.filter_map(x => if x is String(s) { Some(s) } else { None })
    _ => []
  }
  { specifier, module_, members, fresh, }
}

///|
let data_host : HostModule = host_module_of(data_declaration) catch {
  e => abort("tutuca/data's declaration: \{e}")
}
