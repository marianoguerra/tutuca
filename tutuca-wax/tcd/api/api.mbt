// The tcd pipeline over files given by a read function: what the command
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
/// The TCD file at path, parsed and checked with the files it uses (read
/// relative to it), or None when it can't be read.
pub fn load(
  read : (String) -> String?,
  path : String,
) -> (@check.Package, Array[@diag.Diagnostic])? {
  guard read(path) is Some(src) else { return None }
  let (file, diags) = @syntax.parse(path, src)
  let used : Map[String, @syntax.File] = Map([])
  for u in file.uses {
    let p = join_path(dir_of(path), u.path)
    match read(p) {
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
/// The stub of what the implementation lacks (all of it when impls is empty).
pub fn stub(
  pkg : @check.Package,
  file : String,
  impls : Array[@compose.Source],
) -> String {
  @gen.stub(pkg, file, have=defined_functions(impls))
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
    wasm: built.wasm,
    diags: built.diags,
  }
}
