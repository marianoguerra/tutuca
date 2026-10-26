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
  /// Whether err is a terminal that takes color.
  color : Bool
}

///|
let usage : String =
  #|tcd: a WIT-style component definition language for tutuca-wax.
  #|
  #|  tcd check FILE.tcd [--short | --json]
  #|      Parse and check; report what's wrong (exit 1 on errors): with the
  #|      source lines it's about, one line each with --short, or as JSON.
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
    } else if a == "--json" || a == "--short" {
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
fn report(io : Io, a : Args, diags : Array[@diag.Diagnostic]) -> Unit {
  let sorted = @diag.sorted(diags)
  if a.flags.contains("--json") {
    for d in sorted {
      (io.out)(d.to_json().stringify() + "\n")
    }
  } else if sorted.length() > 0 {
    let format : @render.Format = if a.flags.contains("--short") {
      Short
    } else {
      Rich
    }
    (io.err)(render_diags(sorted, io.read, format, io.color))
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
  guard @api.load(io.read, file) is Some((pkg, diags)) else {
    (io.err)("tcd: can't read \{file}\n")
    return 1
  }
  match cmd {
    "check" => {
      report(io, a, diags)
      if @diag.has_errors(diags) {
        1
      } else {
        0
      }
    }
    "explain" => {
      report(io, a, diags.filter(d => d.severity is Error))
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
      report(io, a, diags)
      if @diag.has_errors(diags) {
        return 1
      }
      match cmd {
        "stub" => {
          let impls = []
          for impl_path in a.rest {
            match (io.read)(impl_path) {
              Some(text) =>
                impls.push(@compose.Source::{ path: impl_path, text, })
              None => ()
            }
          }
          let text = @api.stub(pkg, file, impls)
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
          let dir = a.options.get("-o").unwrap_or(@api.dir_of(file))
          let ok1 = (io.write)(
            @api.join_path(dir, "\{pkg.name}.contract.wax"),
            out.contract,
          )
          let ok2 = (io.write)(
            @api.join_path(dir, "\{pkg.name}.glue.wax"),
            out.glue,
          )
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
  let runtime = match @api.read_runtime(p => (io.read)(@api.join_path(rt, p))) {
    Ok(r) => r
    Err(missing) => {
      (io.err)("tcd: can't read \{@api.join_path(rt, missing)}\n")
      return 1
    }
  }
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
  let gen_dir = a.options.get("--gen").unwrap_or(@api.dir_of(out_path))
  let built = @api.build(pkg, file, runtime, impls, gen_dir)
  ignore((io.write)(built.contract_path, built.generated.contract))
  ignore((io.write)(built.glue_path, built.generated.glue))
  ignore((io.write)(built.abi_path, built.abi_imports))
  report(io, a, built.diags)
  match built.wasm {
    Some(bytes) => if (io.write_bytes)(out_path, bytes) { 0 } else { 1 }
    None => 1
  }
}
