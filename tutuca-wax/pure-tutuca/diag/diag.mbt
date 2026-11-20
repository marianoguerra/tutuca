// Diagnostics: where something is in a source file, and what the tool says
// about it. Every package reports through these, so the CLI renders them one
// way and the web core can hand them over as data.

///|
/// A position in a file: 1-based line and column, 0-based offset in UTF-16
/// code units.
#derive(Eq, Debug, ToJson)
pub(all) struct Pos {
  line : Int32
  col : Int32
  offset : Int32
}

///|
#derive(Eq, Debug, ToJson)
pub(all) struct Span {
  file : String
  start : Pos
  end : Pos
}

///|
/// A span for things that have no source, like generated code.
pub fn Span::none(file : String) -> Span {
  let p = { line: 0, col: 0, offset: 0, }
  { file, start: p, end: p, }
}

///|
#derive(Eq, Debug)
pub(all) enum Severity {
  Error
  Warning
  Note
}

///|
pub impl ToJson for Severity with fn to_json(self) {
  match self {
    Error => "error"
    Warning => "warning"
    Note => "note"
  }
}

///|
/// A span that adds to a diagnostic, with what it says about it.
#derive(Eq, Debug, ToJson)
pub(all) struct Related {
  span : Span
  message : String
}

///|
/// One finding: a code (`pure-tutuca.where.contradiction`), how bad it is, where,
/// what in words, and optionally how to fix it and other places involved.
#derive(Eq, Debug, ToJson)
pub(all) struct Diagnostic {
  code : String
  severity : Severity
  span : Span
  message : String
  hint : String?
  related : Array[Related]
}

///|
pub fn error(
  code : String,
  span : Span,
  message : String,
  hint? : String,
  related~ : Array[Related] = [],
) -> Diagnostic {
  { code, severity: Error, span, message, hint, related, }
}

///|
pub fn warning(
  code : String,
  span : Span,
  message : String,
  hint? : String,
  related~ : Array[Related] = [],
) -> Diagnostic {
  { code, severity: Warning, span, message, hint, related, }
}

///|
/// Whether any of diags stops the build.
pub fn has_errors(diags : Array[Diagnostic]) -> Bool {
  diags.iter().any(d => d.severity is Error)
}

///|
/// Diagnostics sorted by file and position, the order a reader expects.
pub fn sorted(diags : Array[Diagnostic]) -> Array[Diagnostic] {
  let out = diags.copy()
  out.sort_by((a, b) => {
    let c = a.span.file.compare(b.span.file)
    if c != 0 {
      c
    } else {
      a.span.start.offset.compare(b.span.start.offset)
    }
  })
  out
}
