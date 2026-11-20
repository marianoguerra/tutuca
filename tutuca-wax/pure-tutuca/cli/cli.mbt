// The pure-tutuca command: parsing its arguments and running the pipeline over an
// Io the caller provides (cmd/pure-tutuca's is the file system), so the same code
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
  #|pure-tutuca: compiles pure-tutuca component modules (FILE.tutuca.ts) to
  #|tutuca-wax component modules.
  #|
  #|  pure-tutuca check FILE.tutuca.ts [--short | --json]
  #|      Check; report what's wrong (exit 1 on errors): with the source
  #|      lines it's about, one line each with --short, or as JSON.
  #|  pure-tutuca explain FILE.tutuca.ts COMPONENT.FIELD | COMPONENT.MESSAGE.ARG
  #|      Say in words what a field or an argument may be.
  #|  pure-tutuca contract FILE.tutuca.ts [-o DIR]
  #|      Write <package>.contract.wax and <package>.glue.wax.
  #|  pure-tutuca build FILE.tutuca.ts --runtime DIR -o OUT.wasm [--gen DIR]
  #|      Lower its functions to Wax, generate the rest, and compile the
  #|      component module with the runtime's prelude in DIR.
  #|  pure-tutuca model FILE.tutuca.ts [-o OUT.json] [--pbt-model]
  #|      Write the model a test runner generates states and messages from:
  #|      format 2 (tutuca's), or with --pbt-model pure-tutuca's (what js/pbt.js
  #|      reads).
  #|
  #|  --host A.json,B.json gives the page's host modules it may import
  #|  (spec/pure-tutuca/host/*.json).
  #|

///|
priv struct Args {
  positional : Array[String]
  options : Map[String, String]
  flags : Array[String]
}

///|
fn parse_args(args : Array[String]) -> Args {
  let positional = []
  let options : Map[String, String] = Map([])
  let flags = []
  let mut i = 0
  while i < args.length() {
    let a = args[i]
    if a == "--json" || a == "--short" || a == "--pbt-model" {
      flags.push(a)
    } else if (a == "-o" || a == "--runtime" || a == "--gen" || a == "--host") &&
      i + 1 < args.length() {
      options[a] = args[i + 1]
      i += 1
    } else {
      positional.push(a)
    }
    i += 1
  }
  { positional, options, flags, }
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
/// Runs pure-tutuca with args (without the program name); the exit code.
pub fn run(args : Array[String], io : Io) -> Int32 {
  let a = parse_args(args)
  guard a.positional is [cmd, file, ..] else {
    (io.err)(usage)
    return 2
  }
  let pages = []
  for
    p in a.options
    .get("--host")
    .map(h => h.split(",").map(x => x.to_owned()).collect())
    .unwrap_or([]) {
    guard (io.read)(p) is Some(text) else {
      (io.err)("pure-tutuca: can't read \{p}\n")
      return 1
    }
    pages.push(
      @pure.host_module_of(text) catch {
        Failure(msg) => {
          (io.err)("pure-tutuca: \{p}: \{msg}\n")
          return 1
        }
      },
    )
  }
  let loaded = @api.load(io.read, file, pages~)
  guard loaded is Some((pkg, diags, checked)) else {
    (io.err)("pure-tutuca: can't read \{file}\n")
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
        (io.err)("pure-tutuca explain FILE.tutuca.ts COMPONENT.FIELD\n")
        return 2
      }
      match explain(pkg, what) {
        Some(text) => {
          (io.out)(text + "\n")
          0
        }
        None => {
          (io.err)("pure-tutuca: no field, property or argument \{what}\n")
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
          let model = if a.flags.contains("--pbt-model") {
            @export.model(pkg)
          } else {
            @api.model(pkg, checked)
          }
          let text = model.stringify(indent=2) + "\n"
          match a.options.get("-o") {
            Some(out) => if (io.write)(out, text) { 0 } else { 1 }
            None => {
              (io.out)(text)
              0
            }
          }
        }
        "build" => build(io, a, pkg, file, checked)
        _ => {
          (io.err)(usage)
          2
        }
      }
    }
  }
}

///|
fn build(
  io : Io,
  a : Args,
  pkg : @check.Package,
  file : String,
  checked : @pure.Checked?,
) -> Int32 {
  guard a.options.get("--runtime") is Some(rt) else {
    (io.err)("pure-tutuca build needs --runtime DIR, tutuca-wax's directory\n")
    return 2
  }
  guard a.options.get("-o") is Some(out_path) else {
    (io.err)("pure-tutuca build needs -o OUT.wasm\n")
    return 2
  }
  let runtime = match @api.read_runtime(p => (io.read)(@api.join_path(rt, p))) {
    Ok(r) => r
    Err(missing) => {
      (io.err)("pure-tutuca: can't read \{@api.join_path(rt, missing)}\n")
      return 1
    }
  }
  let impls = []
  let gen_dir = a.options.get("--gen").unwrap_or(@api.dir_of(out_path))
  // A pure-tutuca module's implementation is its functions, lowered.
  let (lowered_impl, lowered) = @api.lowered_impl(
    io.read,
    file,
    checked,
    pkg,
    gen_dir,
  )
  if lowered_impl is Some(impl_) {
    ignore((io.write)(impl_.path, impl_.text))
    impls.push(impl_)
  }
  if @diag.has_errors(lowered) {
    report(io, a, lowered)
    return 1
  }
  let built = @api.build(pkg, file, runtime, impls, gen_dir, read=io.read)
  ignore((io.write)(built.contract_path, built.generated.contract))
  ignore((io.write)(built.glue_path, built.generated.glue))
  ignore((io.write)(built.abi_path, built.abi_imports))
  report(io, a, built.diags)
  match built.wasm {
    Some(bytes) => if (io.write_bytes)(out_path, bytes) { 0 } else { 1 }
    None => 1
  }
}
