// Diagnostics as text for people: code, message, where (line and column), the
// line of source underlined, the help.

///|
fn label(d : Diagnostic) -> String {
  match d.exclusion {
    Some(ByDesign) => "excluded"
    Some(Omitted) => "omitted"
    None => "error"
  }
}

///|
pub fn format(d : Diagnostic, source : String, file? : String) -> String {
  let (line, column) = line_column(source, d.start)
  let lines = source.split("\n").map(v => v.to_owned()).to_array()
  let text = lines.get(line - 1).unwrap_or("")
  let width = (d.end.min(d.start + text.length() - column + 1) - d.start).max(1)
  let gutter = line.to_string().length()
  let pad = " ".repeat(gutter)
  let where_ = match file {
    Some(f) => "\{f}, line \{line}, column \{column}"
    None => "line \{line}, column \{column}"
  }
  let out = [
    "\{label(d)}[purejs::\{d.code.name()}]: \{d.message}",
    "\{pad} --> \{where_}",
    "\{pad} |",
    "\{line} | \{text}",
    "\{pad} | \{" ".repeat(column - 1)}\{"^".repeat(width)}",
  ]
  match d.help {
    Some(h) => out.push("\{pad} = help: \{h}")
    None => ()
  }
  out.join("\n")
}

///|
pub fn format_all(
  ds : ArrayView[Diagnostic],
  source : String,
  file? : String,
) -> String {
  ds.map(d => format(d, source, file?)).join("\n\n")
}
