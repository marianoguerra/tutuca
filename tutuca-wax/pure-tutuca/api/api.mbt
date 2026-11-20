// The pure-tutuca pipeline over files given by a read function: what the command
// (cli, over the file system) and the browser build (web, over files a page
// sends) both run. Nothing here touches a file system.

///|
/// The directory part of a path, with its trailing slash; "" for none.
pub fn dir_of(path : String) -> String {
  match path.rev_find("/") {
    Some(i) => path.unsafe_substring(start=0, end=i + 1)
    None => ""
  }
}

///|
/// file relative to dir, with `.` and `..` segments resolved, so a file a
/// `use` names has one path however it's reached (a page's file map has no
/// file system to resolve them).
pub fn join_path(dir : String, file : String) -> String {
  let joined = if dir.is_empty() || file.has_prefix("/") {
    file
  } else if dir.has_suffix("/") {
    dir + file
  } else {
    dir + "/" + file
  }
  normalize_path(joined)
}

///|
pub fn normalize_path(path : String) -> String {
  let absolute = path.has_prefix("/")
  let out : Array[String] = []
  for seg in path.split("/") {
    let seg = seg.to_owned()
    if seg == "" || seg == "." {
      continue
    }
    if seg == ".." && !out.is_empty() && out[out.length() - 1] != ".." {
      ignore(out.pop())
    } else {
      out.push(seg)
    }
  }
  let joined = out.join("/")
  if absolute {
    "/" + joined
  } else {
    joined
  }
}

///|
/// How a pure-tutuca module at path reads the modules it imports: relative
/// to it, .ts added when the specifier has none.
fn pure_resolve(
  read : (String) -> String?,
  path : String,
) -> (String) -> String? {
  spec => {
    read(
      join_path(
        dir_of(path),
        if spec.has_suffix(".ts") {
          spec
        } else {
          "\{spec}.ts"
        },
      ),
    )
  }
}

///|
/// The component modules a module imports (relative to path), each checked
/// and built, by the path its import names; what they report goes to diags.
fn used_packages(
  read : (String) -> String?,
  path : String,
  checked : @pure.Checked,
  diags : Array[@diag.Diagnostic],
) -> Map[String, @check.Package] {
  let used : Map[String, @check.Package] = Map([])
  for im in checked.imports {
    let p = join_path(dir_of(path), im.path)
    guard read(p) is Some(text) else { continue }
    match @pure.check_source(p, text, resolve=pure_resolve(read, p)) {
      Ok(other) => used[im.path] = @pure.build(p, text, other).0
      Err(ds) => diags.append(ds)
    }
  }
  used
}

///|
/// A pure-tutuca module (a .tutuca.ts file) at path, checked with pure-js,
/// built as the model and validated; None when it can't be read. The checked
/// module comes back too, for the Wax its functions lower to.
pub fn load(
  read : (String) -> String?,
  path : String,
  pages~ : Array[@pure.HostModule] = [],
) -> (@check.Package, Array[@diag.Diagnostic], @pure.Checked?)? {
  guard read(path) is Some(src) else { return None }
  match
    @pure.check_source(path, src, resolve=pure_resolve(read, path), pages~) {
    Err(diags) => {
      let empty : @check.Package = {
        full_name: @pure.package_name(path),
        name: @pure.package_name(path),
        components: [],
        interfaces: [],
        meta_schemas: [],
        registers: [],
        ask_handlers: [],
        host_asks: [],
        examples: [],
      }
      Some((empty, diags, None))
    }
    Ok(checked) => {
      let diags = @pure.view_problems(path, src, checked)
      let used = used_packages(read, path, checked, diags)
      let (pkg, build_diags) = @pure.build(path, src, checked, used~)
      diags.append(build_diags)
      diags.append(@check.validate(pkg))
      Some((pkg, diags, Some(checked)))
    }
  }
}

///|
/// The implementation a checked pure-tutuca module lowers to (named as if in
/// gen_dir), and what couldn't be lowered.
fn lower_pure(
  path : String,
  src : String,
  checked : @pure.Checked,
  pkg : @check.Package,
  gen_dir : String,
) -> (@compose.Source, Array[@diag.Diagnostic]) {
  let (text, diags) = @pure.lower(path, src, checked, pkg)
  ({ path: join_path(gen_dir, "\{pkg.name}.impl.wax"), text, }, diags)
}

///|
/// The implementation a pure-tutuca module lowers to (none when it didn't
/// check), and what couldn't be lowered.
pub fn lowered_impl(
  read : (String) -> String?,
  path : String,
  checked : @pure.Checked?,
  pkg : @check.Package,
  gen_dir : String,
) -> (@compose.Source?, Array[@diag.Diagnostic]) {
  match (checked, read(path)) {
    (Some(c), Some(src)) => {
      let (impl_, diags) = lower_pure(path, src, c, pkg, gen_dir)
      (Some(impl_), diags)
    }
    _ => (None, [])
  }
}

///|
/// The model of what load loaded: format 2 (tutuca's), or pure-tutuca's when the
/// module didn't check.
pub fn model(pkg : @check.Package, checked : @pure.Checked?) -> Json {
  match checked {
    Some(c) => @pure.model_of(c)
    None => @export.model(pkg)
  }
}

///|
/// Whether a path is a pure-tutuca module's.
pub fn is_pure_path(path : String) -> Bool {
  path.has_suffix(".tutuca.ts")
}

///|
/// The functions the implementation's files define.
pub fn defined_functions(impls : Array[@compose.Source]) -> Array[String] {
  let out = []
  for f in impls {
    let r = @wax.parse_string(f.text, fname=f.path)
    for item in r.module_.unwrap_or([]) {
      if item.desc is Func(name~, ..) {
        out.push(name.name)
      }
    }
  }
  out
}

///|
/// The runtime's files a component module is built with, read relative to
/// the runtime's directory; the first one missing when one is.
pub fn read_runtime(
  read : (String) -> String?,
) -> Result[@compose.Runtime, String] {
  let get = (p : String) => {
    match read(p) {
      Some(text) => Ok(@compose.Source::{ path: p, text, })
      None => Err(p)
    }
  }
  let prelude = []
  let files = ["prelude/js_string.wax"]
  files.append(@compose.prelude_files)
  for p in files {
    match get(p) {
      Ok(s) => prelude.push(s)
      Err(e) => return Err(e)
    }
  }
  let collections = []
  for p in @compose.collection_files {
    match get(p) {
      Ok(s) => collections.push(s)
      Err(e) => return Err(e)
    }
  }
  match get("src/abi.wax") {
    Ok(abi) => Ok({ prelude, collections, abi, })
    Err(e) => Err(e)
  }
}

///|
/// A built component module: what was generated, the paths it was generated
/// at, the ABI imports, the module (when it built) and what was reported.
pub(all) struct Built {
  generated : @gen.Output
  contract_path : String
  glue_path : String
  abi_path : String
  abi_imports : String
  wasm : Bytes?
  diags : Array[@diag.Diagnostic]
}

///|
/// Generates pkg's contract and glue (named as if in gen_dir), checks the
/// implementation against the convention, and compiles the module.
pub fn build(
  pkg : @check.Package,
  file : String,
  runtime : @compose.Runtime,
  impls : Array[@compose.Source],
  gen_dir : String,
  read~ : (String) -> String?,
) -> Built {
  // The optional functions the implementation lacks aren't called.
  let generated = @gen.generate(pkg, file, have=defined_functions(impls))
  let contract_path = join_path(gen_dir, "\{pkg.name}.contract.wax")
  let glue_path = join_path(gen_dir, "\{pkg.name}.glue.wax")
  let abi_path = join_path(gen_dir, "\{pkg.name}.abi.wax")
  let built = @compose.build(
    runtime, pkg, generated, contract_path, glue_path, impls, abi_path,
  )
  {
    generated,
    contract_path,
    glue_path,
    abi_path,
    abi_imports: built.abi_imports,
    wasm: built.wasm.map(w => {
      with_custom_section(w, meta_section, meta(pkg, file, read).stringify())
    }),
    diags: built.diags,
  }
}
