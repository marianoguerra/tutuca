// What DevTools custom formatters show for tutuca values, as JS's formatters.js and
// vdom-formatters.js do: a header and expandable rows of styled parts. Built here so any
// target can test it; @browser turns it into JsonML and installs the formatter.

///|
/// A styled part: text, a span of parts, or a value that expands on its own.
pub enum Ml {
  Text(String)
  Span(String, Array[Ml]) // A style and its parts.
  Ref(Described)
}

///|
/// A value as the console shows it: its header, and its rows when expanded (made only then).
pub struct Described {
  header : Array[Ml]
  rows : () -> Array[(String?, Ml)] // A label, if any, and the part.
}

///|
let style_name : String = "color:#d97706;font-weight:bold"

///|
let style_key : String = "color:#8b5cf6"

///|
let style_str : String = "color:#16a34a"

///|
let style_num : String = "color:#3b82f6"

///|
let style_fn : String = "color:#0891b2"

///|
let style_muted : String = "opacity:0.6"

///|
let style_tag : String = "color:#9333ea"

///|
let style_attr : String = "color:#d97706"

///|
let style_removed : String = "opacity:0.6;text-decoration:line-through"

///|
fn word(style : String, text : String) -> Ml {
  Span(style, [Text(text)])
}

///|
fn truncate(s : String, max : Int32) -> String {
  if s.length() > max {
    s.view(end_offset=max).to_owned() + "…"
  } else {
    s
  }
}

///|
fn quoted(s : String, max : Int32) -> Ml {
  word(style_str, Json::string(truncate(s, max)).stringify())
}

///|
/// The text DevTools would show: parts flattened, each expandable value as `<ref>`.
pub fn Ml::text(self : Ml) -> String {
  match self {
    Text(s) => s
    Span(_, parts) => parts.map(p => p.text()).join("")
    Ref(_) => "<ref>"
  }
}

///|
pub fn Described::header_text(self : Described) -> String {
  self.header.map(p => p.text()).join("")
}

///|
/// The rows' text, as the expanded body shows it.
pub fn Described::body_text(self : Described) -> String {
  (self.rows)()
  .map(r => {
    match r.0 {
      Some(label) => "\{label}: \{r.1.text()}"
      None => r.1.text()
    }
  })
  .join("")
}

///|
pub fn Described::has_body(self : Described) -> Bool {
  (self.rows)().length() > 0
}

///|
fn leaf(header : Array[Ml]) -> Described {
  { header, rows: () => [], }
}

// --- vdom ---------------------------------------------------------------------------------

///|
let max_vdom_str : Int32 = 40

///|
let max_inline_attrs : Int32 = 4

///|
fn tag_name(shape : @vdom.Shape) -> String {
  match shape.ns {
    None => shape.tag
    Some(_) if shape.tag == "svg" || shape.tag == "math" => shape.tag
    Some(ns) =>
      match ns.rev_find("/") {
        Some(i) =>
          "\{ns.view(start_offset=i + 1).to_owned().to_lower()}:\{shape.tag}"
        None => "\{ns}:\{shape.tag}"
      }
  }
}

///|
fn attr_parts(name : String, value : @vdom.AttrValue) -> Array[Ml] {
  match value {
    Bool(true) => [Text(" "), word(style_attr, name)]
    Bool(false) => [Text(" "), word(style_removed, "\{name}=false")]
    Absent => [Text(" "), word(style_removed, "\{name}=null")]
    Str(s) =>
      [Text(" "), word(style_attr, name), Text("="), quoted(s, max_vdom_str)]
    Num(n) =>
      [
        Text(" "),
        word(style_attr, name),
        Text("="),
        quoted(n.to_string(), max_vdom_str),
      ]
    Html(h) =>
      [
        Text(" "),
        word(style_attr, name),
        Text("="),
        Ref(
          leaf([
            word(style_muted, "{__html: "),
            quoted(h, max_vdom_str),
            word(style_muted, "}"),
          ]),
        ),
      ]
  }
}

///|
fn key_parts(key : String?) -> Array[Ml] {
  match key {
    Some(k) => [Text(" "), word(style_muted, "key=\"\{k}\"")]
    None => []
  }
}

///|
fn open_tag(e : @vdom.VElem) -> Array[Ml] {
  let attrs : Array[(String, @vdom.AttrValue)] = [..e.shape.static_attrs]
  for i, name in e.shape.names {
    attrs.push((name, e.values[i]))
  }
  let parts = [word(style_tag, "<\{tag_name(e.shape)}"), ..key_parts(e.key)]
  for i, a in attrs {
    if i >= max_inline_attrs {
      break
    }
    parts.append(attr_parts(a.0, a.1))
  }
  if attrs.length() > max_inline_attrs {
    parts.push(Text(" "))
    parts.push(word(style_muted, "…+\{attrs.length() - max_inline_attrs}"))
  }
  parts.push(word(style_tag, ">"))
  parts
}

///|
fn close_tag(e : @vdom.VElem) -> Ml {
  word(style_tag, "</\{tag_name(e.shape)}>")
}

///|
/// How a comment shows: a metadata comment as the component it opens, or `⟨/⟩`.
fn comment_parts(text : String) -> Array[Ml] {
  if text == @tutuca.meta_close {
    return [word(style_muted, "⟨/⟩")]
  }
  match @tutuca.parse_meta(text) {
    Some((name, path)) =>
      [
        word(style_muted, "⟨"),
        word(style_name, name),
        Text(" "),
        word(style_key, path),
        word(style_muted, "⟩"),
      ]
    None => [word(style_muted, "<!--\{text}-->")]
  }
}

///|
fn child_rows(
  childs : Array[@vdom.VNode],
  close : Ml?,
) -> () -> Array[(String?, Ml)] {
  () => {
    let rows : Array[(String?, Ml)] = childs.map(c => {
      (None, Ref(describe_vnode(c)))
    })
    if close is Some(c) {
      rows.push((None, c))
    }
    rows
  }
}

///|
/// A vnode as the Elements panel shows it: a lone short text inline, children expanding.
pub fn describe_vnode(v : @vdom.VNode) -> Described {
  match v {
    Text(t) => leaf([quoted(t, max_vdom_str)])
    Comment(t) => leaf(comment_parts(t))
    Elem(e) =>
      match e.childs {
        [] => leaf([..open_tag(e), close_tag(e)])
        [Text(t)] if t.length() <= max_vdom_str =>
          leaf([..open_tag(e), Text(t), close_tag(e)])
        _ =>
          {
            header: [..open_tag(e), word(style_muted, "…"), close_tag(e)],
            rows: child_rows(e.childs, Some(close_tag(e))),
          }
      }
    Fragment(f) =>
      {
        header: [
          word(style_tag, "<>"),
          ..key_parts(f.key),
          word(style_muted, " (\{f.childs.length()})"),
        ],
        rows: child_rows(f.childs, Some(word(style_tag, "</>"))),
      }
  }
}

///|
/// What a render returns and a host holds.
pub fn describe_vnodes(vs : Array[@vdom.VNode]) -> Described {
  let noun = if vs.length() == 1 { "vnode" } else { "vnodes" }
  {
    header: [word(style_muted, "[\{vs.length()} \{noun}]")],
    rows: child_rows(vs, None),
  }
}

// --- values, paths, tasks and components ----------------------------------------------------

///|
let max_str : Int32 = 30

///|
let max_inline_fields : Int32 = 3

///|
fn prim(v : Json) -> Ml {
  match v {
    String(s) => quoted(s, max_str)
    Number(n, ..) => word(style_num, n.to_string())
    True => word(style_num, "true")
    False => word(style_num, "false")
    Null => word(style_muted, "null")
    Array(a) => word(style_muted, "[\{a.length()}]")
    Object(_) => word(style_muted, "{…}")
  }
}

///|
fn json_ref(v : Json) -> Ml {
  match v {
    Array(_) | Object(_) => Ref(describe_json(v))
    _ => prim(v)
  }
}

///|
/// A state as JSON: its first fields inline, each field a row.
pub fn describe_json(v : Json) -> Described {
  match v {
    Object(fields) => {
      let parts = [word(style_name, "{")]
      let mut n = 0
      for k, x in fields {
        if n >= max_inline_fields {
          parts.push(word(style_muted, " …"))
          break
        }
        parts.append([Text(" "), word(style_key, k), Text("="), prim(x)])
        n += 1
      }
      parts.push(word(style_name, " }"))
      {
        header: parts,
        rows: () => fields.to_array().map(e => (Some(e.0), json_ref(e.1))),
      }
    }
    Array(items) =>
      {
        header: [word(style_muted, "[\{items.length()}]")],
        rows: () => items.mapi((i, x) => (Some(i.to_string()), json_ref(x))),
      }
    _ => leaf([prim(v)])
  }
}

///|
fn path_text(path : @tutuca.DispatchPath) -> Ml {
  word(style_key, path.to_string())
}

///|
pub fn describe_path(path : @tutuca.DispatchPath) -> Described {
  {
    header: [word(style_muted, "DispatchPath "), path_text(path)],
    rows: () => path.frames.map(f => (None, Ref(describe_frame(f)))),
  }
}

///|
pub fn describe_frame(frame : @tutuca.Frame) -> Described {
  leaf([word(style_muted, "Frame "), word(style_key, frame.to_string())])
}

///|
fn kind_name(kind : @tutuca.TaskKind) -> String {
  match kind {
    Send => "send"
    Event => "event"
    Notify => "notify"
    Ask => "ask"
    Reply => "reply"
  }
}

///|
pub fn describe_task(task : @tutuca.Task) -> Described {
  {
    header: [
      word(style_muted, "\{kind_name(task.kind)} "),
      word(style_name, task.label),
      Text(" "),
      path_text(task.path),
    ],
    rows: () => [(Some("path"), Ref(describe_path(task.path)))],
  }
}

///|
/// A component as its spec: views as the code that builds them, and what it handles, hears,
/// provides and checks.
pub fn[S, M] describe_component(comp : @tutuca.Component[S, M]) -> Described {
  {
    header: [word(style_muted, "Component "), word(style_name, comp.name)],
    rows: () => {
      let spec = SpecInfo::of(comp)
      let rows : Array[(String?, Ml)] = spec.views.map(v => {
        (
          Some("view \{v.name}"),
          Ref(leaf([word(style_fn, truncate(v.code, 80))])),
        )
      })
      let line = (label : String, items : Array[String]) => {
        if items.length() > 0 {
          rows.push((Some(label), word(style_fn, items.join(", "))))
        }
      }
      line("events", spec.events)
      line("listens", spec.listens)
      line("provides", spec.provides)
      line("invariants", spec.invariants)
      line("issues", spec.issues)
      rows
    },
  }
}

///|
pub fn describe_report(r : @tutuca.Report) -> Described {
  match r {
    Rendered => leaf([word(style_muted, "rendered")])
    TaskHandled(t) =>
      {
        header: [word(style_muted, "handled "), ..describe_task(t).header],
        rows: describe_task(t).rows,
      }
    TaskFailed(t, e) =>
      {
        header: [
          word(style_removed, "failed "),
          ..describe_task(t).header,
          Text(": "),
          quoted(e, 80),
        ],
        rows: describe_task(t).rows,
      }
    StateInvalid(issues) =>
      {
        header: [
          word(style_removed, "state invalid "),
          word(style_muted, "(\{issues.length()})"),
        ],
        rows: () => issues.map(i => (None, Text(i.to_string()))),
      }
    MessageInvalid(t, which) =>
      {
        header: [
          word(style_removed, "message invalid "),
          ..describe_task(t).header,
          Text(" " + which.join(", ")),
        ],
        rows: describe_task(t).rows,
      }
    RenderFailed(e) =>
      leaf([word(style_removed, "render failed: "), quoted(e, 80)])
  }
}
