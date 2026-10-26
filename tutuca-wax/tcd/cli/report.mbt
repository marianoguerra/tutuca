// Diagnostics as error-report's reports, for a person at a terminal: the
// source lines they point at, underlined, with the related spans as
// secondary labels and the hint as help. The core keeps @diag's data (the
// web core hands it over as JSON); only the CLI renders it this way.

///|
/// The files diagnostics point at, read through io once each.
priv struct Files {
  read : (String) -> String?
  sources : @report.Sources
  ids : Map[String, @report.SourceId?]
}

///|
fn Files::new(read : (String) -> String?) -> Files {
  { read, sources: @report.Sources::new(), ids: Map([]), }
}

///|
fn Files::id(self : Files, path : String) -> @report.SourceId? {
  match self.ids.get(path) {
    Some(id) => id
    None => {
      let id = (self.read)(path).map(text => self.sources.add(path, text))
      self.ids[path] = id
      id
    }
  }
}

///|
/// Offset of a 1-based line and column in source, from the line and column
/// rather than the span's offset: the playground places spans the same way.
fn offset_in(source : @report.Source, pos : @diag.Pos) -> Int32 {
  let line = pos.line.clamp(min=1, max=source.line_count()) - 1
  source.line_starts[line] +
  (pos.col - 1).clamp(min=0, max=source.line_text(line).length())
}

///|
/// A label on span, or None when it has no position or its file can't be read.
fn Files::label(
  self : Files,
  span : @diag.Span,
  primary : Bool,
  message? : String,
) -> @report.Label? {
  guard span.start.line >= 1 else { return None }
  guard self.id(span.file) is Some(id) else { return None }
  guard self.sources.fetch(id) is Some(source) else { return None }
  let start = offset_in(source, span.start)
  let end = if span.end.line >= 1 {
    offset_in(source, span.end).max(start)
  } else {
    start
  }
  let range = @report.Span::of_range(start, end)
  Some(
    if primary {
      @report.Label::primary(id, range, message?)
    } else {
      @report.Label::secondary(id, range, message?)
    },
  )
}

///|
fn where_text(span : @diag.Span) -> String {
  if span.start.line >= 1 {
    "\{span.file}:\{span.start.line}:\{span.start.col}"
  } else {
    span.file
  }
}

///|
fn Files::report(self : Files, d : @diag.Diagnostic) -> @report.Report {
  let severity : @report.Severity = match d.severity {
    Error => Error
    Warning => Warning
    Note => Advice
  }
  let mut r = @report.Report::new(severity, d.message).with_code(d.code)
  match self.label(d.span, true) {
    Some(l) => r = r.with_label(l)
    // Nothing to draw: say where, at least.
    None => r = r.with_note("in \{where_text(d.span)}")
  }
  for rel in d.related {
    match self.label(rel.span, false, message=rel.message) {
      Some(l) => r = r.with_label(l)
      None => r = r.with_note("\{where_text(rel.span)}: \{rel.message}")
    }
  }
  match d.hint {
    Some(h) => r.with_help(h)
    None => r
  }
}

///|
/// diags as text, in format (Rich or Short), colored when color is true.
fn render_diags(
  diags : Array[@diag.Diagnostic],
  read : (String) -> String?,
  format : @render.Format,
  color : Bool,
) -> String {
  let files = Files::new(read)
  let config : @render.Config = {
    ..@render.default_config,
    format,
    color: if color {
      Always
    } else {
      Never
    },
    theme: if color {
      @style.default_theme
    } else {
      @style.mono_theme
    },
  }
  let buf = StringBuilder()
  for d in diags {
    @render.render(files.report(d), files.sources, config, buf, is_tty=color)
  }
  buf.to_string()
}
