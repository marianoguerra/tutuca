// Putting a component module together: the runtime's prelude, the ABI
// imports the module uses, the generated contract and glue, and the
// hand-written implementation, each parsed with its own file name and
// checked as one module by wax-mb, so a diagnostic points at the file it's
// about. Before that, the implementation is held to the naming convention:
// every function the TCD file asks for, with the signature the glue calls
// it with.

///|
/// A source file: its name, as diagnostics show it, and its text.
pub(all) struct Source {
  path : String
  text : String
}

///|
/// What the runtime gives every component module (tutuca-wax's
/// scripts/build.mjs builds them the same way).
pub(all) struct Runtime {
  /// prelude/js_string.wax, then the prelude's files in order.
  prelude : Array[Source]
  /// The vendored collections, whose types (only) the prelude shares.
  collections : Array[Source]
  /// src/abi.wax: the functions a component module imports.
  abi : Source
}

///|
/// The order the prelude's files go in, after js_string.wax and the
/// collections' types (scripts/build.mjs's PRELUDE).
pub let prelude_files : Array[String] = [
  "prelude/value.wax", "prelude/path.wax", "prelude/sem.wax", "prelude/view.wax",
  "prelude/schema.wax", "prelude/component.wax",
]

///|
pub let collection_files : Array[String] = [
  "vendor/wax-mb/persistent_hash_map.wax", "vendor/wax-mb/persistent_vector.wax",
]

///|
/// The ABI: each `#[export = "x"]` wrapper `fn abi_x(params) -> result {`
/// of src/abi.wax as the import declaration `fn x(params) -> result;`.
pub fn abi_decls(abi : String) -> Array[(String, String)] {
  let out = []
  let lines = abi.split("\n").map(l => l.to_owned()).collect()
  let mut i = 0
  while i < lines.length() {
    let line = lines[i].trim(chars=" ").to_owned()
    if line.has_prefix("#[export = \"") {
      let name = line
      .unsafe_substring(start=12, end=line.length())
      .split("\"")
      .collect()[0].to_owned()
      // The signature runs from `fn abi_` to the `{` that opens the body.
      let sig = StringBuilder()
      let mut j = i + 1
      while j < lines.length() {
        let l = lines[j]
        match l.find("{") {
          Some(k) => {
            sig.write_string(l.unsafe_substring(start=0, end=k))
            break
          }
          None => {
            sig.write_string(l)
            sig.write_char(' ')
          }
        }
        j += 1
      }
      let text = sig.to_string().trim(chars=" ").to_owned()
      let prefix = "fn abi_\{name}"
      if text.has_prefix(prefix) && name != "tutuca_abi_version" {
        let rest = text.unsafe_substring(
          start=prefix.length(),
          end=text.length(),
        )
        let compact = collapse_spaces(rest)
          .replace_all(old="( ", new="(")
          .replace_all(old=", )", new=")")
        out.push((name, "fn \{name}\{compact};"))
      }
      i = j
    }
    i += 1
  }
  out
}

///|
fn collapse_spaces(s : String) -> String {
  let sb = StringBuilder()
  let mut space = false
  for c in s {
    if c == ' ' || c == '\t' {
      space = true
    } else {
      if space {
        sb.write_char(' ')
        space = false
      }
      sb.write_char(c)
    }
  }
  sb.to_string()
}

///|
/// The identifiers in texts, for knowing which ABI functions they call.
fn identifiers(texts : Array[String]) -> Map[String, Bool] {
  let out : Map[String, Bool] = Map([])
  for t in texts {
    let sb = StringBuilder()
    let mut in_comment = false
    let mut prev = ' '
    for c in t {
      if in_comment {
        if c == '\n' {
          in_comment = false
        }
        prev = c
        continue
      }
      if c == '/' && prev == '/' {
        in_comment = true
        let s = sb.to_string()
        if !s.is_empty() {
          out[s] = true
        }
        sb.reset()
        prev = c
        continue
      }
      if (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '_' {
        sb.write_char(c)
      } else {
        let s = sb.to_string()
        if !s.is_empty() {
          out[s] = true
        }
        sb.reset()
      }
      prev = c
    }
    let s = sb.to_string()
    if !s.is_empty() {
      out[s] = true
    }
  }
  out
}

///|
/// The import block of the ABI functions texts call.
pub fn abi_imports(abi : String, texts : Array[String]) -> String {
  let used = identifiers(texts)
  let sb = StringBuilder()
  sb.write_string(
    "// The runtime's functions this module calls, imported as module \"tutuca\".\n\n",
  )
  sb.write_string("import \"tutuca\" {\n")
  for d in abi_decls(abi) {
    if used.contains(d.0) {
      sb.write_string("    #[import = \"\{d.0}\"]\n    \{d.1}\n")
    }
  }
  sb.write_string("}\n")
  sb.to_string()
}

// ---- Parsing and diagnostics --------------------------------------------------------

///|
fn pos_of(p : @basic.Position) -> @diag.Pos {
  { line: p.lnum, col: p.column1(), offset: p.cnum, }
}

///|
fn span_of(loc : @basic.Location) -> @diag.Span {
  { file: loc.start.fname, start: pos_of(loc.start), end: pos_of(loc.end), }
}

///|
fn from_wax(d : @diagnostic.Diagnostic) -> @diag.Diagnostic {
  let severity : @diag.Severity = match d.severity {
    Error => Error
    Warning => Warning
    Suggestion => Note
  }
  {
    code: "wax",
    severity,
    span: span_of(d.loc),
    message: @message.to_plain_string(d.message),
    hint: d.hint.map(@message.to_plain_string),
    related: d.related.map(r => {
      span: span_of(r.loc),
      message: @message.to_plain_string(r.message),
    }),
  }
}

///|
fn from_report(r : @basic.Report) -> @diag.Diagnostic {
  {
    code: "wax.syntax",
    severity: Error,
    span: span_of(r.loc),
    message: r.message,
    hint: r.hint,
    related: [],
  }
}

///|
/// The fields of a parsed Wax source, and its syntax errors.
fn parse(src : Source, diags : Array[@diag.Diagnostic]) -> @ast.LocModule {
  let r = @wax.parse_string(src.text, fname=src.path)
  for e in r.errors {
    diags.push(from_report(e))
  }
  r.module_.unwrap_or([])
}

///|
/// Only the type declarations of a module (the collections share their types,
/// not their code).
fn types_only(m : @ast.LocModule) -> @ast.LocModule {
  m.filter(f => f.desc is (Type(_) | TypeAlias(..)))
}

// ---- The naming convention -------------------------------------------------------------

///|
priv struct FuncSig {
  name : String
  loc : @basic.Location
  sign : @ast.FuncType?
  typ : String?
}

///|
fn funcs_of(m : @ast.LocModule) -> Array[FuncSig] {
  let out = []
  for f in m {
    if f.desc is Func(name~, typ~, sign~, ..) {
      out.push({
        name: name.name,
        loc: name.loc,
        sign,
        typ: typ.map(t => t.name),
      })
    }
  }
  out
}

///|
fn vt_json(t : @ast.ValType) -> String {
  @ast.valtype_json(t).stringify()
}

///|
/// The expected signatures, parsed: an import block of them.
fn expected_signs(reqs : Array[@gen.Required]) -> Map[String, @ast.FuncType] {
  let sb = StringBuilder()
  sb.write_string("import \"tcd\" {\n")
  for r in reqs {
    sb.write_string("    \{r.signature()};\n")
  }
  sb.write_string("}\n")
  let out : Map[String, @ast.FuncType] = Map([])
  let parsed = @wax.parse_string(sb.to_string(), fname="<convention>")
  for f in parsed.module_.unwrap_or([]) {
    if f.desc is ImportGroup(decls~, ..) {
      for d in decls {
        if d.desc.kind is Func(sign=Some(s), ..) {
          out[d.desc.id.name] = s
        }
      }
    }
  }
  out
}

///|
fn sign_text(params : Array[(String, String)], result : String) -> String {
  "(\{params.map(p => "\{p.0}: \{p.1}").join(", ")}) -> \{result}"
}

///|
/// Holds the implementation to the convention: what's missing, what has the
/// wrong signature, what looks like a handler for something undeclared, and
/// what the generated code defines already.
pub fn check_convention(
  pkg : @check.Package,
  reqs : Array[@gen.Required],
  impl_modules : Array[@ast.LocModule],
  generated : Array[@ast.LocModule],
) -> Array[@diag.Diagnostic] {
  let diags = []
  let funcs = []
  for m in impl_modules {
    funcs.append(funcs_of(m))
  }
  let gen_names : Map[String, Bool] = Map([])
  for m in generated {
    for f in funcs_of(m) {
      gen_names[f.name] = true
    }
  }
  let expected = expected_signs(reqs)
  for r in reqs {
    match funcs.iter().find_first(f => f.name == r.name) {
      None if r.optional => ()
      None =>
        diags.push(
          @diag.error(
            "tcd.impl.missing",
            r.span,
            "the implementation has no \{r.name}, which \{r.what}",
            hint="add it: \{r.signature()} { ... } (tcd stub --missing writes it)",
          ),
        )
      Some(f) => {
        guard expected.get(r.name) is Some(want) else { continue }
        guard f.sign is Some(have) else {
          if f.typ is Some(t) {
            diags.push(
              @diag.error(
                "tcd.impl.signature",
                span_of(f.loc),
                "\{r.name} is declared with the function type \{t}; the convention calls it as \{r.signature()}",
              ),
            )
          }
          continue
        }
        if have.params.length() != want.params.length() {
          diags.push(
            @diag.error(
              "tcd.impl.signature",
              span_of(f.loc),
              "\{r.name} takes \{have.params.length()} parameters, but \{r.what} with \{want.params.length()}: \{sign_text(r.params, r.result)}",
            ),
          )
          continue
        }
        for i, p in have.params {
          let (_, have_t) = p.desc
          let (_, want_t) = want.params[i].desc
          if vt_json(have_t) != vt_json(want_t) {
            diags.push(
              @diag.error(
                "tcd.impl.signature",
                span_of(p.info),
                "parameter \{i + 1} of \{r.name} (\{r.params[i].0}) must be \{r.params[i].1}: the convention calls it as \{r.signature()}",
              ),
            )
          }
        }
        let have_r = have.results.map(vt_json)
        let want_r = want.results.map(vt_json)
        if have_r != want_r {
          diags.push(
            @diag.error(
              "tcd.impl.signature",
              span_of(f.loc),
              "\{r.name} must return \{r.result}: the convention calls it as \{r.signature()}",
            ),
          )
        }
      }
    }
  }
  // Handlers and properties for things the TCD file doesn't declare.
  let req_names = reqs.map(r => r.name)
  for c in pkg.components {
    let cw = @check.wax(c.name)
    for kind in ["_on_", "_get_", "_reply_", "_check_"] {
      let prefix = cw + kind
      for f in funcs {
        if f.name.has_prefix(prefix) && !req_names.contains(f.name) {
          let what = f.name.unsafe_substring(
            start=prefix.length(),
            end=f.name.length(),
          )
          let candidates = req_names
            .filter(n => n.has_prefix(prefix))
            .map(n => n.unsafe_substring(start=prefix.length(), end=n.length()))
          diags.push(
            @diag.warning(
              "tcd.impl.undeclared",
              span_of(f.loc),
              "\{f.name} looks like \{if kind == "_on_" { "a handler" } else { "an implementation" }} for \{what}, which \{c.name} doesn't declare\{@check.did_you_mean(what, candidates)}",
            ),
          )
        }
      }
    }
  }
  for f in funcs {
    if gen_names.contains(f.name) {
      diags.push(
        @diag.error(
          "tcd.impl.generated",
          span_of(f.loc),
          "\{f.name} is generated by tcd; the implementation can't define it too",
        ),
      )
    }
  }
  diags
}

// ---- Building ----------------------------------------------------------------------------

///|
pub(all) struct Built {
  /// The module, when it built.
  wasm : Bytes?
  /// The ABI import block it was built with.
  abi_imports : String
  diags : Array[@diag.Diagnostic]
}

///|
/// Builds the component module of pkg: the runtime's prelude, the ABI it
/// imports, the generated contract and glue, and the implementation.
pub fn build(
  runtime : Runtime,
  pkg : @check.Package,
  out : @gen.Output,
  contract_path : String,
  glue_path : String,
  impl_files : Array[Source],
  abi_path : String,
) -> Built {
  let diags = []
  let texts = [out.contract, out.glue]
  texts.append(impl_files.map(f => f.text))
  let imports = abi_imports(runtime.abi.text, texts)
  let module_ : @ast.LocModule = []
  for p in runtime.prelude[0:1] {
    module_.append(parse(p, diags))
  }
  for c in runtime.collections {
    module_.append(types_only(parse(c, diags)))
  }
  for p in runtime.prelude[1:] {
    module_.append(parse(p, diags))
  }
  module_.append(parse({ path: abi_path, text: imports, }, diags))
  let contract = parse({ path: contract_path, text: out.contract, }, diags)
  let glue = parse({ path: glue_path, text: out.glue, }, diags)
  let impls = impl_files.map(f => parse(f, diags))
  if @diag.has_errors(diags) {
    return { wasm: None, abi_imports: imports, diags, }
  }
  let conv = check_convention(pkg, out.required, impls, [contract, glue])
  diags.append(conv)
  if @diag.has_errors(conv) {
    return { wasm: None, abi_imports: imports, diags, }
  }
  module_.append(contract)
  module_.append(glue)
  for m in impls {
    module_.append(m)
  }
  let session = @wax.Session::new()
  let checked = session.check(module_, lowering=true)
  let reports = session.reports(policy=@warning.default_policy)
  diags.append(reports.map(from_wax))
  if @wax.rejected(reports) {
    return { wasm: None, abi_imports: imports, diags, }
  }
  let wasm = checked.to_bytes(label_names=false) catch {
    e => {
      let msg = match e.diagnostic() {
        Some(d) => @message.to_plain_string(d.message)
        None => "the module didn't lower to wasm"
      }
      diags.push(@diag.error("wax.lower", @diag.Span::none(glue_path), msg))
      return { wasm: None, abi_imports: imports, diags, }
    }
  }
  { wasm: Some(wasm), abi_imports: imports, diags, }
}
