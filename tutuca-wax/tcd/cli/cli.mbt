// The tcd command: parsing its arguments and running the pipeline over an
// Io the caller provides (cmd/tcd's is the file system), so the same code
// can run anywhere the core does.

///|
/// What the command reads, writes and prints through.
pub(all) struct Io {
  read : (String) -> String?
  write : (String, String) -> Bool
  write_bytes : (String, Bytes) -> Bool
  out : (String) -> Unit
  err : (String) -> Unit
}

///|
let usage : String =
  #|tcd: a WIT-style component definition language for tutuca-wax.
  #|
  #|  tcd check FILE.tcd [--json]
  #|      Parse and check; report what's wrong (exit 1 on errors).
  #|  tcd explain FILE.tcd COMPONENT.FIELD | COMPONENT.MESSAGE.ARG
  #|      Say in words what a field or an argument may be.
  #|  tcd stub FILE.tcd [--missing IMPL.wax...] [-o OUT.wax]
  #|      Write the implementation's functions: all, or the ones IMPL lacks.
  #|  tcd contract FILE.tcd [-o DIR]
  #|      Write <package>.contract.wax and <package>.glue.wax.
  #|  tcd build FILE.tcd IMPL.wax... --runtime DIR -o OUT.wasm [--gen DIR]
  #|      Generate, check the implementation against the convention, and
  #|      compile the component module with the runtime's prelude in DIR.
  #|  tcd model FILE.tcd [-o OUT.json]
  #|      Write the model a test runner generates states and messages from.
  #|

///|
fn dir_of(path : String) -> String {
  match path.rev_find("/") {
    Some(i) => path.unsafe_substring(start=0, end=i + 1)
    None => ""
  }
}

///|
fn join_path(dir : String, file : String) -> String {
  if dir.is_empty() || file.has_prefix("/") {
    file
  } else if dir.has_suffix("/") {
    dir + file
  } else {
    dir + "/" + file
  }
}

///|
priv struct Args {
  positional : Array[String]
  options : Map[String, String]
  flags : Array[String]
  /// The values after --missing.
  rest : Array[String]
}

///|
fn parse_args(args : Array[String]) -> Args {
  let positional = []
  let options : Map[String, String] = Map([])
  let flags = []
  let rest = []
  let mut i = 0
  let mut in_rest = false
  while i < args.length() {
    let a = args[i]
    if a == "--missing" {
      in_rest = true
    } else if a == "--json" {
      flags.push(a)
    } else if (a == "-o" || a == "--runtime" || a == "--gen") &&
      i + 1 < args.length() {
      options[a] = args[i + 1]
      i += 1
      in_rest = false
    } else if in_rest {
      rest.push(a)
    } else {
      positional.push(a)
    }
    i += 1
  }
  { positional, options, flags, rest, }
}

///|
/// A TCD file, checked, with the files it uses; None when it can't be read.
fn load(io : Io, path : String) -> (@check.Package, Array[@diag.Diagnostic])? {
  guard (io.read)(path) is Some(src) else {
    (io.err)("tcd: can't read \{path}\n")
    return None
  }
  let (file, diags) = @syntax.parse(path, src)
  let used : Map[String, @syntax.File] = Map([])
  for u in file.uses {
    let p = join_path(dir_of(path), u.path)
    match (io.read)(p) {
      Some(text) => {
        let (f, ds) = @syntax.parse(p, text)
        diags.append(ds)
        used[u.path] = f
      }
      None => ()
    }
  }
  let (pkg, check_diags) = @check.check(file, used)
  diags.append(check_diags)
  Some((pkg, diags))
}

///|
fn report(io : Io, diags : Array[@diag.Diagnostic], json : Bool) -> Unit {
  let sorted = @diag.sorted(diags)
  if json {
    for d in sorted {
      (io.out)(d.to_json().stringify() + "\n")
    }
  } else {
    for d in sorted {
      (io.err)(@diag.render(d))
    }
  }
}

///|
fn explain(pkg : @check.Package, what : String) -> String? {
  let parts = what.split(".").map(s => s.to_owned()).collect()
  guard pkg.component(parts[0]) is Some(c) else { return None }
  let field = match parts {
    [_, f] => c.property(f)
    [_, m, a] =>
      c.message(m).bind(msg => msg.params.iter().find_first(p => p.name == a))
    _ => None
  }
  field.map(f => {
    let req = if f.required {
      "; making a \{c.name} needs it (no default meets its constraints)"
    } else {
      ""
    }
    "\{what}: \{@check.ty_text(f.ty)}, \{@check.norm_text(f.norm)}\{req}"
  })
}

///|
/// Runs tcd with args (without the program name); the exit code.
pub fn run(args : Array[String], io : Io) -> Int32 {
  let a = parse_args(args)
  guard a.positional is [cmd, file, ..] else {
    (io.err)(usage)
    return 2
  }
  guard load(io, file) is Some((pkg, diags)) else { return 1 }
  let json = a.flags.contains("--json")
  match cmd {
    "check" => {
      report(io, diags, json)
      if @diag.has_errors(diags) {
        1
      } else {
        0
      }
    }
    "explain" => {
      report(io, diags.filter(d => d.severity is Error), json)
      guard a.positional is [_, _, what, ..] else {
        (io.err)("tcd explain FILE.tcd COMPONENT.FIELD\n")
        return 2
      }
      match explain(pkg, what) {
        Some(text) => {
          (io.out)(text + "\n")
          0
        }
        None => {
          (io.err)("tcd: no field, property or argument \{what}\n")
          1
        }
      }
    }
    _ => {
      report(io, diags, json)
      if @diag.has_errors(diags) {
        return 1
      }
      match cmd {
        "stub" => {
          let have = []
          for impl_path in a.rest {
            match (io.read)(impl_path) {
              Some(text) => {
                let r = @wax.parse_string(text, fname=impl_path)
                for f in r.module_.unwrap_or([]) {
                  if f.desc is Func(name~, ..) {
                    have.push(name.name)
                  }
                }
              }
              None => ()
            }
          }
          let text = @gen.stub(pkg, file, have~)
          match a.options.get("-o") {
            Some(out) => if (io.write)(out, text) { 0 } else { 1 }
            None => {
              (io.out)(text)
              0
            }
          }
        }
        "contract" => {
          let out = @gen.generate(pkg, file)
          let dir = a.options.get("-o").unwrap_or(dir_of(file))
          let ok1 = (io.write)(
            join_path(dir, "\{pkg.name}.contract.wax"),
            out.contract,
          )
          let ok2 = (io.write)(join_path(dir, "\{pkg.name}.glue.wax"), out.glue)
          if ok1 && ok2 {
            0
          } else {
            1
          }
        }
        "model" => {
          let text = @export.model(pkg).stringify(indent=2) + "\n"
          match a.options.get("-o") {
            Some(out) => if (io.write)(out, text) { 0 } else { 1 }
            None => {
              (io.out)(text)
              0
            }
          }
        }
        "build" => build(io, a, pkg, file)
        _ => {
          (io.err)(usage)
          2
        }
      }
    }
  }
}

///|
fn build(io : Io, a : Args, pkg : @check.Package, file : String) -> Int32 {
  guard a.options.get("--runtime") is Some(rt) else {
    (io.err)("tcd build needs --runtime DIR, tutuca-wax's directory\n")
    return 2
  }
  guard a.options.get("-o") is Some(out_path) else {
    (io.err)("tcd build needs -o OUT.wasm\n")
    return 2
  }
  let read_rt = (p : String) => {
    let full = join_path(rt, p)
    match (io.read)(full) {
      Some(text) => Some(@compose.Source::{ path: p, text, })
      None => {
        (io.err)("tcd: can't read \{full}\n")
        None
      }
    }
  }
  let prelude = []
  let files = ["prelude/js_string.wax"]
  files.append(@compose.prelude_files)
  for p in files {
    guard read_rt(p) is Some(s) else { return 1 }
    prelude.push(s)
  }
  let collections = []
  for p in @compose.collection_files {
    guard read_rt(p) is Some(s) else { return 1 }
    collections.push(s)
  }
  guard read_rt("src/abi.wax") is Some(abi) else { return 1 }
  let impls = []
  for p in a.positional[2:] {
    match (io.read)(p) {
      Some(text) => impls.push(@compose.Source::{ path: p, text, })
      None => {
        (io.err)("tcd: can't read \{p}\n")
        return 1
      }
    }
  }
  // The functions the implementation defines: the optional ones it lacks
  // aren't called.
  let have = []
  for f in impls {
    let r = @wax.parse_string(f.text, fname=f.path)
    for item in r.module_.unwrap_or([]) {
      if item.desc is Func(name~, ..) {
        have.push(name.name)
      }
    }
  }
  let generated = @gen.generate(pkg, file, have~)
  let gen_dir = a.options.get("--gen").unwrap_or(dir_of(out_path))
  let contract_path = join_path(gen_dir, "\{pkg.name}.contract.wax")
  let glue_path = join_path(gen_dir, "\{pkg.name}.glue.wax")
  let abi_path = join_path(gen_dir, "\{pkg.name}.abi.wax")
  ignore((io.write)(contract_path, generated.contract))
  ignore((io.write)(glue_path, generated.glue))
  let built = @compose.build(
    { prelude, collections, abi, },
    pkg,
    generated,
    contract_path,
    glue_path,
    impls,
    abi_path,
  )
  ignore((io.write)(abi_path, built.abi_imports))
  report(io, built.diags, a.flags.contains("--json"))
  match built.wasm {
    Some(bytes) => if (io.write_bytes)(out_path, bytes) { 0 } else { 1 }
    None => 1
  }
}
