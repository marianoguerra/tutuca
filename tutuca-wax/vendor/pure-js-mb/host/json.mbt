///|
/// A declaration from JSON, the shape the reference's host.describe() gives:
/// { types: { Name: "..." }, handles: {...}, modules: { M: { member: "sig" or
/// ["sig", ...] } }, functions: {...}, nondeterministic: [...], fresh: [...] }.
pub fn Declaration::from_json(j : Json) -> Declaration raise Failure {
  guard j is Object(m) else { fail("a host declaration is a JSON object") }
  let pairs = (key : String) => {
    let out = []
    match m.get(key) {
      Some(Object(o)) =>
        for k, v in o {
          guard v is String(s) else { fail("\{key}.\{k} must be a string") }
          out.push((k, s))
        }
      None => ()
      _ => fail("\{key} must be an object")
    }
    out
  }
  let sigs = (what : String, v : Json) => {
    match v {
      String(s) => [s]
      Array(xs) =>
        xs.map(x => {
          match x {
            String(s) => s
            _ => fail("\{what}'s overloads must be strings")
          }
        })
      _ => fail("\{what} must be a signature or a list of them")
    }
  }
  let names = (key : String) => {
    match m.get(key) {
      Some(Array(xs)) =>
        xs.map(x => {
          match x {
            String(s) => s
            _ => fail("\{key} must list names")
          }
        })
      None => []
      _ => fail("\{key} must be a list")
    }
  }
  let modules = []
  match m.get("modules") {
    Some(Object(o)) =>
      for name, members in o {
        guard members is Object(ms) else {
          fail("modules.\{name} must be an object")
        }
        let list = []
        for k, v in ms {
          list.push((k, sigs("\{name}.\{k}", v)))
        }
        modules.push((name, list))
      }
    None => ()
    _ => fail("modules must be an object")
  }
  let functions = []
  match m.get("functions") {
    Some(Object(o)) =>
      for k, v in o {
        functions.push((k, sigs(k, v)))
      }
    None => ()
    _ => fail("functions must be an object")
  }
  {
    types: pairs("types"),
    handles: pairs("handles"),
    modules,
    functions,
    nondeterministic: names("nondeterministic"),
    fresh: names("fresh"),
    imports: pairs("imports"),
  }
}
