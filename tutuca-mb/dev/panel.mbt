// Tutuca components that show in a page what the dev tools know about a running app, as JS's
// src/dev/panel.js: a component's fields and spec, field types, views, paths, tasks, scopes and
// lint issues, each node expanding into its rows. The main views say it in plain words
// (summary.mbt); the code views print it as tokens, the way the formatters do.

///|
using @tutuca {
  div,
  span,
  button,
  section,
  h3,
  p,
  ul,
  li,
  txt,
  show,
  when,
  if_,
  each,
  cls,
  class_,
  attr,
  aria,
  on_click,
  component,
  field,
  items,
  push_view,
  render,
  render_each,
  render_self_each,
  type View,
  type Component,
  type Vec,
  type Items,
  type Lens,
}

// --- tokens -------------------------------------------------------------------------------

///|
/// The styles of the formatters, by name.
pub(all) enum Tone {
  Plain
  Name
  Key
  Str
  Num
  Fn
  Muted
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// The tone's name, as JS's: "plain", "name", "key", "str", "num", "fn", "muted".
pub fn Tone::name(self : Tone) -> String {
  match self {
    Plain => "plain"
    Name => "name"
    Key => "key"
    Str => "str"
    Num => "num"
    Fn => "fn"
    Muted => "muted"
  }
}

///|
pub impl ToJson for Tone with fn to_json(self) {
  Json::string(self.name())
}

///|
pub impl FromJson for Tone with fn from_json(json, path) {
  for t in [Plain, Name, Key, Str, Num, Fn, Muted] {
    if json == Json::string(t.name()) {
      return t
    }
  }
  raise @json.JsonDecodeError((path, "a tone"))
}

///|
/// The classes a tone shows with.
pub fn Tone::class(self : Tone) -> String {
  match self {
    Plain => ""
    Name => "font-bold text-warning"
    Key => "text-secondary"
    Str => "text-success"
    Num => "text-info"
    Fn => "text-accent"
    Muted => "opacity-60"
  }
}

///|
/// The classes the tones and lint levels use, for a CSS compiler.
pub let dev_classes : Array[String] = [
  "font-bold", "text-warning", "text-secondary", "text-success", "text-info", "text-accent",
  "opacity-60", "badge", "badge-xs", "badge-error", "badge-warning",
]

///|
/// A piece of a code view's line.
pub(all) struct Token {
  text : String
  tone : Tone
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
fn tok(tone : Tone, text : String) -> Token {
  { text, tone, }
}

///|
/// The tokens with adjacent tokens of one tone merged, as JS's tokensOf.
fn merged(parts : Array[Token]) -> Array[Token] {
  let out : Array[Token] = []
  for t in parts {
    match out.last() {
      Some(last) if last.tone == t.tone =>
        out[out.length() - 1] = { ..last, text: last.text + t.text, }
      _ => out.push(t)
    }
  }
  out
}

///|
fn text_of(tokens : Array[Token]) -> String {
  tokens.map(t => t.text).join("")
}

///|
let max_text : Int32 = 60

///|
let token_str_max : Int32 = 30

///|
fn cut(s : String, max : Int32) -> String {
  if s.length() > max {
    s.view(end_offset=max).to_owned() + "…"
  } else {
    s
  }
}

// --- what a node shows of a value ---------------------------------------------------------

///|
/// What a node shows of a value: its tokens (the code view), its title and detail (the
/// readable view), how it shows as another value's field (`prim`, `brief`), and its rows,
/// made when it is opened. Equal keys show the same thing.
pub struct Inspected {
  key : String
  tokens : Array[Token]
  prim : Array[Token]
  brief : String
  title : String
  detail : String
  rows : () -> Array[Row]
}

///|
/// A row of an opened node: a value to expand, or tokens that read the same either way.
pub enum Row {
  Node(String, Inspected)
  Leaf(String, Array[Token])
}

///|
fn no_rows() -> Array[Row] {
  []
}

///|
/// A JSON value, as JS's dev tools show plain values.
pub fn Inspected::json(v : Json) -> Inspected {
  let key = "json:" + v.stringify()
  let title = brief(v)
  let one = (tone : Tone, text : String) => {
    key,
    tokens: [tok(tone, text)],
    prim: [tok(tone, text)],
    brief: title,
    title,
    detail: "",
    rows: no_rows,
  }
  match v {
    String(s) =>
      {
        ..one(Str, cut(Json::string(s).stringify(), max_text)),
        prim: [tok(Str, Json::string(cut(s, token_str_max)).stringify())],
      }
    Number(n, ..) => one(Num, n.to_string())
    True => one(Num, "true")
    False => one(Num, "false")
    Null => one(Muted, "null")
    Array(xs) =>
      {
        key,
        tokens: [tok(Muted, "Array(\{xs.length()})")],
        prim: [tok(Muted, "[\{xs.length()}]")],
        brief: title,
        title,
        detail: "",
        rows: () => xs.mapi((i, x) => Node(i.to_string(), Inspected::json(x))),
      }
    Object(fields) if fields.get("$") is Some(String(name)) => {
      let rest = fields.to_array().filter(e => e.0 != "$")
      {
        ..Inspected::instance(
          {
            name,
            fields: [],
            views: [],
            messages: [],
            methods: [],
            events: [],
            listens: [],
            provides: [],
            invariants: [],
            has_contract: false,
            issues: [],
            lint: [],
          },
          rest.map(e => (e.0, Inspected::json(e.1))),
        ),
        key,
      }
    }
    Object(fields) =>
      {
        key,
        tokens: [tok(Muted, "Object")],
        prim: [tok(Muted, "{…}")],
        brief: title,
        title,
        detail: "",
        rows: () => fields.to_array().map(e => Node(e.0, Inspected::json(e.1))),
      }
  }
}

///|
/// A set of values: its items by position.
pub fn Inspected::set(xs : Array[Json]) -> Inspected {
  {
    key: "set:" + Json::array(xs).stringify(),
    tokens: [tok(Muted, "Set(\{xs.length()})")],
    prim: [tok(Muted, "{…}")],
    brief: plural(xs.length(), "item"),
    title: plural(xs.length(), "item"),
    detail: "",
    rows: () => xs.mapi((i, x) => Node(i.to_string(), Inspected::json(x))),
  }
}

///|
/// Names a list of values: "list of 2", with each value a row.
pub fn Inspected::list(xs : Array[Inspected]) -> Inspected {
  let title = if xs.is_empty() {
    "empty list"
  } else {
    "list of \{xs.length()}"
  }
  {
    key: "list:[" + xs.map(x => x.key).join(",") + "]",
    tokens: [tok(Muted, "Array(\{xs.length()})")],
    prim: [tok(Muted, "[\{xs.length()}]")],
    brief: title,
    title,
    detail: "",
    rows: () => xs.mapi((i, x) => Node(i.to_string(), x)),
  }
}

///|
fn slot_parts(k : @tutuca.SlotKey) -> Array[Token] {
  match k {
    Index(i) => [tok(Plain, "["), tok(Num, i.to_string()), tok(Plain, "]")]
    Name(n) =>
      [tok(Plain, "["), tok(Str, Json::string(n).stringify()), tok(Plain, "]")]
    Pair(a, b) => [..slot_parts(a), ..slot_parts(b)]
  }
}

///|
fn frame_parts(f : @tutuca.Frame) -> Array[Token] {
  let out = []
  if f.provider is Some(p) {
    out.push(tok(Key, "@\{p}"))
  }
  out.push(tok(Plain, "."))
  out.push(tok(Key, f.name))
  if f.item is Some(k) {
    out.append(slot_parts(k))
  }
  out
}

///|
fn path_parts(path : @tutuca.DispatchPath) -> Array[Token] {
  let parts = path.frames.map(frame_parts).flatten()
  if parts.is_empty() {
    [tok(Muted, "·")]
  } else {
    parts
  }
}

///|
/// A frame of a path: the key it reads and the item it picks.
pub fn Inspected::frame(f : @tutuca.Frame) -> Inspected {
  let detail = frame_words(f).join(" → ")
  {
    key: "frame:" + f.to_string(),
    tokens: merged([tok(Muted, "Frame "), ..frame_parts(f)]),
    prim: [tok(Muted, "{…}")],
    brief: "frame",
    title: "frame",
    detail: if detail == "" {
      "nothing"
    } else {
      detail
    },
    rows: no_rows,
  }
}

///|
/// A dispatch path: its frames from the root.
pub fn Inspected::path(path : @tutuca.DispatchPath) -> Inspected {
  {
    key: "path:" + path.to_string(),
    tokens: merged([tok(Muted, "DispatchPath "), ..path_parts(path)]),
    prim: [tok(Muted, "{…}")],
    brief: "path",
    title: "path",
    detail: path_words(path),
    rows: () => path.frames.map(f => Node("", Inspected::frame(f))),
  }
}

///|
fn target(path : @tutuca.DispatchPath) -> Inspected {
  {
    ..Inspected::path(path),
    key: "target:" + path.to_string(),
    tokens: merged([tok(Muted, "Target "), ..path_parts(path)]),
    title: "target",
    brief: "target",
    rows: () => [Node("base", Inspected::path(path))],
  }
}

///|
fn kind_word(kind : @tutuca.TaskKind) -> String {
  match kind {
    Send => "send"
    Event => "event"
    Notify => "notify"
    Ask => "ask"
    Reply => "reply"
  }
}

///|
fn kind_title(kind : @tutuca.TaskKind) -> String {
  match kind {
    Event => "event"
    Ask => "ask"
    Notify => "notification"
    Send | Reply => "message"
  }
}

///|
/// A message of `kind` named `name` with `args`, from `source` to `to` (`source` by default).
pub fn Inspected::message(
  kind : @tutuca.TaskKind,
  name : String,
  args : Array[Json],
  source : @tutuca.DispatchPath,
  to? : @tutuca.DispatchPath,
) -> Inspected {
  let to = to.unwrap_or(source)
  let arg_parts = []
  for i, a in args {
    if i > 0 {
      arg_parts.push(tok(Plain, ", "))
    }
    arg_parts.append(Inspected::json(a).prim)
  }
  let from_words = path_words(source)
  let to_words = path_words(to)
  {
    key: "task:\{kind_word(kind)}:\{name}:\{Json::array(args).stringify()}:\{source.to_string()}:\{to.to_string()}",
    tokens: merged(
      [
        tok(Muted, "\{kind_word(kind)} "),
        tok(Name, name),
        tok(Plain, "("),
        ..arg_parts,
        tok(Plain, ") "),
        ..path_parts(source),
        tok(Muted, " → "),
        ..path_parts(to),
      ],
    ),
    prim: [tok(Muted, "{…}")],
    brief: "\{kind_title(kind)} \{quote(name)}",
    title: "\{kind_title(kind)} \{quote(name)}",
    detail: if from_words == to_words {
      "to \{to_words}"
    } else {
      "from \{from_words} to \{to_words}"
    },
    rows: () => {
      [
        Node("args", Inspected::json(Json::array(args))),
        Node("sourcePath", Inspected::path(source)),
        Node("target", target(to)),
      ]
    },
  }
}

///|
/// The message a task's label names: "JsonBool.Toggle(…)" → "Toggle".
fn label_name(label : String) -> String {
  let rest = match label.find(".") {
    Some(i) => label.view(start_offset=i + 1).to_owned()
    None => label
  }
  match rest.find("(") {
    Some(i) => rest.view(end_offset=i).to_owned()
    None => rest
  }
}

///|
/// A task that ran.
pub fn Inspected::task(t : @tutuca.Task) -> Inspected {
  Inspected::message(t.kind, label_name(t.label), [], t.path)
}

///|
/// A task known by its label only, as a storybook entry keeps it.
pub fn Inspected::task_label(label : String) -> Inspected {
  let name = label_name(label)
  {
    key: "label:" + label,
    tokens: [tok(Muted, "send "), tok(Name, label)],
    prim: [tok(Muted, "{…}")],
    brief: "message \{quote(name)}",
    title: "message \{quote(name)}",
    detail: "",
    rows: () => [Leaf("label", [tok(Str, Json::string(label).stringify())])],
  }
}

// --- types, views and specs -----------------------------------------------------------------

///|
fn type_name(t : @tutuca.FieldType) -> String {
  match t {
    Text => "string"
    Boolean => "boolean"
    Number | Whole => "number"
    OneOf(_) => "enum"
    ListOf(_) => "array"
    MapOf(_) => "map"
    RecordOf(_) => "record"
    Either(_) => "union"
    KeyOf(_) => "index"
    ComponentOf(_) => "component"
    Optional(_) => "option"
    Anything => "any"
  }
}

///|
fn joined(items : Array[Array[Token]]) -> Array[Token] {
  let out = []
  for i, item in items {
    if i > 0 {
      out.push(tok(Plain, ", "))
    }
    out.append(item)
  }
  out
}

///|
fn type_parts(t : @tutuca.FieldType) -> Array[Token] {
  if t is Optional(inner) {
    return [..type_parts(inner), tok(Plain, "?")]
  }
  let args = match t {
    OneOf(members) => joined(members.map(m => Inspected::json(m).prim))
    KeyOf(f) => [tok(Str, Json::string(f).stringify())]
    ComponentOf(names) =>
      joined(names.map(n => [tok(Str, Json::string(n).stringify())]))
    RecordOf(shape) =>
      joined(
        shape.map(e => [tok(Key, e.0), tok(Plain, ": "), ..type_parts(e.1)]),
      )
    ListOf(inner) | MapOf(inner) =>
      if inner is Anything {
        []
      } else {
        [..type_parts(inner), ..default_parts(inner)]
      }
    Either(types) => joined(types.map(type_parts))
    _ => []
  }
  let out = [tok(Fn, type_name(t))]
  if args.length() > 0 {
    out.push(tok(Plain, "("))
    out.append(args)
    out.push(tok(Plain, ")"))
  }
  if t is Whole {
    out.push(tok(Plain, ".int()"))
  }
  out
}

///|
/// The value a type starts with when nothing says otherwise, as JS's types show it.
fn default_parts(t : @tutuca.FieldType) -> Array[Token] {
  match t {
    Text => [tok(Plain, " = "), tok(Str, "\"\"")]
    Boolean => [tok(Plain, " = "), tok(Num, "false")]
    Number | Whole => [tok(Plain, " = "), tok(Num, "0")]
    ListOf(_) => [tok(Plain, " = "), tok(Muted, "[0]")]
    _ => []
  }
}

///|
fn constraint_parts(c : @tutuca.Constraint) -> Array[Token] {
  let call = (name : String, v : Json) => {
    [tok(Plain, ".\{name}("), ..Inspected::json(v).prim, tok(Plain, ")")]
  }
  match c {
    AtLeast(n) => call("min", Json::number(n))
    AtMost(n) => call("max", Json::number(n))
    MinLength(n) => call("minLength", Json::number(n.to_double()))
    MaxLength(n) => call("maxLength", Json::number(n.to_double()))
    Matching(re) => call("pattern", Json::string(re))
    Where(name) => [tok(Plain, ".where(\{name})")]
  }
}

///|
/// A field's type: its words, constraints and starting value.
pub fn Inspected::field(f : @tutuca.FieldInfo) -> Inspected {
  let parts = type_parts(f.ty)
  for c in f.constraints {
    parts.append(constraint_parts(c))
  }
  if f.initial is Some(v) && v != Json::null() {
    parts.push(tok(Plain, " = "))
    parts.append(Inspected::json(v).prim)
  }
  if f.computed_initial {
    parts.append([tok(Plain, " = "), tok(Fn, "ƒ ")])
  }
  {
    key: "field:" + ToJson::to_json(f).stringify(),
    tokens: merged(parts),
    prim: [tok(Muted, "{…}")],
    brief: type_words(f.ty),
    title: type_words(f.ty),
    detail: field_detail(f),
    rows: no_rows,
  }
}

///|
let max_ir_depth : Int32 = 2

///|
let max_ir_childs : Int32 = 3

///|
/// A view node as the code that builds it, as JS's Printer: two levels deep.
fn ir_parts(ir : @tutuca.Ir) -> Array[Token] {
  let out = []
  ir_go(out, ir, 0)
  merged(out)
}

///|
fn ir_arg(out : Array[Token], ir : @tutuca.Ir, depth : Int32) -> Unit {
  if depth >= max_ir_depth {
    out.push(tok(Muted, "…"))
  } else {
    ir_go(out, ir, depth + 1)
  }
}

///|
fn ir_call(
  out : Array[Token],
  name : String,
  args : Array[@tutuca.Ir],
  depth : Int32,
) -> Unit {
  out.push(tok(Fn, name))
  out.push(tok(Plain, "("))
  for i, a in args {
    if i > 0 {
      out.push(tok(Plain, ", "))
    }
    ir_arg(out, a, depth)
  }
  out.push(tok(Plain, ")"))
}

///|
fn ir_go(out : Array[Token], ir : @tutuca.Ir, depth : Int32) -> Unit {
  match ir {
    IText(s) =>
      out.push(tok(Str, Json::string(cut(s, token_str_max)).stringify()))
    IShow =>
      out.append([
        tok(Fn, "show"),
        tok(Plain, "("),
        tok(Muted, "ƒ"),
        tok(Plain, ")"),
      ])
    IElem(e) => {
      out.append([
        tok(Fn, "h"),
        tok(Plain, "("),
        tok(Str, Json::string(e.tag).stringify()),
      ])
      let attrs : Array[(String, Token)] = []
      for a in e.statics {
        attrs.push(
          (
            a.0,
            tok(
              Str,
              Json::string(cut(a.1.to_attr_string(), token_str_max)).stringify(),
            ),
          ),
        )
      }
      for d in e.dyns {
        attrs.push((d, tok(Muted, "ƒ")))
      }
      for ev in e.events {
        attrs.push(("on:\{ev.dom_name()}", tok(Fn, "send")))
      }
      if attrs.length() > 0 {
        out.push(tok(Plain, ", {"))
        for i, a in attrs {
          if i > 0 {
            out.push(tok(Plain, ", "))
          }
          out.append([tok(Key, a.0), tok(Plain, ": ")])
          if depth >= max_ir_depth {
            out.push(tok(Muted, "…"))
          } else {
            out.push(a.1)
          }
        }
        out.push(tok(Plain, "}"))
      }
      for i, c in e.childs {
        if i >= max_ir_childs {
          break
        }
        out.push(tok(Plain, ", "))
        ir_arg(out, c, depth)
      }
      if e.childs.length() > max_ir_childs {
        out.append([
          tok(Plain, ", "),
          tok(Muted, "…+\{e.childs.length() - max_ir_childs}"),
        ])
      }
      out.push(tok(Plain, ")"))
    }
    IIf(a, b) => ir_call(out, "if_", [a, b], depth)
    IFrag(cs) => ir_call(out, "frag", cs, depth)
    IEach(b) => ir_call(out, "each", [b], depth)
    IScope(b) => ir_call(out, "scope", [b], depth)
    IPushView(name, b) => {
      out.append([tok(Fn, "push_view"), tok(Plain, "(")])
      match name {
        Some(n) => out.push(tok(Str, Json::string(n).stringify()))
        None => out.push(tok(Muted, "ƒ"))
      }
      out.push(tok(Plain, ", "))
      ir_arg(out, b, depth)
      out.push(tok(Plain, ")"))
    }
    IProvided(_, b) => ir_go(out, b, depth)
    IRender(r) =>
      out.append([
        tok(Fn, r.kind),
        tok(Plain, "("),
        tok(Name, (r.component)()),
        tok(Plain, ")"),
      ])
  }
}

///|
/// A view node: what it is, in words and as code, with its attributes, handlers and
/// children as rows.
pub fn Inspected::view(ir : @tutuca.Ir) -> Inspected {
  let tokens = ir_parts(ir)
  {
    key: "view:" + text_of(tokens) + ":" + ir.to_code(),
    tokens,
    prim: [tok(Muted, "{…}")],
    brief: ir_title(ir),
    title: ir_title(ir),
    detail: ir_detail(ir),
    rows: () => {
      match ir {
        IElem(e) => {
          let rows = []
          for a in e.statics {
            rows.push(
              Leaf(a.0, [
                tok(
                  Str,
                  Json::string(cut(a.1.to_attr_string(), max_text)).stringify(),
                ),
              ]),
            )
          }
          for d in e.dyns {
            rows.push(Leaf(d, [tok(Muted, "computed")]))
          }
          for ev in e.events {
            rows.push(Leaf("on:\{ev.dom_name()}", [tok(Fn, "send")]))
          }
          for c in e.childs {
            rows.push(Node("", Inspected::view(c)))
          }
          rows
        }
        IIf(a, b) =>
          [Node("", Inspected::view(a)), Node("", Inspected::view(b))]
        IFrag(cs) => cs.map(c => Node("", Inspected::view(c)))
        IEach(b) | IScope(b) | IPushView(_, b) | IProvided(_, b) =>
          [Node("", Inspected::view(b))]
        IText(_) | IShow | IRender(_) => []
      }
    },
  }
}

///|
/// What a component is, as the dev panel describes it: its fields, views (in words, as the
/// builder calls that make them, and their structure), messages, the events it handles, the
/// signals it hears, what it provides, its invariants and what its check found.
pub(all) struct SpecInfo {
  name : String
  fields : Array[@tutuca.FieldInfo]
  views : Array[ViewInfo]
  messages : Array[String]
  methods : Array[String] // The values it computes from its state, as JS's methods.
  events : Array[String]
  listens : Array[String]
  provides : Array[String]
  invariants : Array[String]
  has_contract : Bool
  issues : Array[String]
  lint : Array[LintRecord] // The same issues, as lint records.
} derive(Eq, Debug, ToJson)

///|
pub(all) struct ViewInfo {
  name : String
  words : String
  code : String
} derive(Eq, Debug, ToJson)

///|
/// The views of the components SpecInfo::of saw, by component name and view, for the rows of
/// their view nodes (an Ir holds closures, so SpecInfo keeps their text only).
let view_irs : Map[String, @tutuca.Ir] = Map([])

///|
pub fn[S, M] SpecInfo::of(comp : @tutuca.Component[S, M]) -> SpecInfo {
  let irs = comp.irs()
  let events = []
  for v in irs {
    for e in v.1.event_names() {
      if !events.contains(e) {
        events.push(e)
      }
    }
  }
  for v in irs {
    view_irs["\{comp.name}/\{v.0}"] = v.1
  }
  let checked = comp.check()
  {
    name: comp.name,
    fields: comp.fields(),
    views: irs.map(v => { name: v.0, words: v.1.words(), code: v.1.to_code(), }),
    messages: comp.message_names(),
    methods: comp.computed_names(),
    events,
    listens: comp.listens(),
    provides: comp.provided_names(),
    // The invariants that check a field's constraints count as the field's, as JS's
    // field schemas hold them.
    invariants: comp
    .invariant_names()
    .filter(i => !comp.fields().iter().any(f => f.checks.contains(i))),
    has_contract: comp.has_contract(),
    issues: checked.map(i => i.to_string()),
    lint: lint_records(checked),
  }
}

///|
fn names_object(names : Array[String], what : String) -> Inspected {
  let title = plural(names.length(), "entry", many="entries")
  {
    key: "\{what}:" + names.join(","),
    tokens: [tok(Muted, "Object")],
    prim: [tok(Muted, "{…}")],
    brief: title,
    title,
    detail: "",
    rows: () => names.map(n => Leaf(n, [tok(Fn, what)])),
  }
}

///|
/// A component's spec: its fields, views, the messages it handles (its own and the signals
/// it hears), what it provides and the events it listens for.
pub fn Inspected::spec(s : SpecInfo) -> Inspected {
  // The messages it declares, the signals it hears and the ask replies it takes among them,
  // as JS's `on`; else the signals it hears.
  let messages = if s.messages.is_empty() { s.listens } else { s.messages }
  let parts = [
    plural(s.fields.length(), "field"),
    plural(s.views.length(), "view"),
    plural(messages.length(), "message"),
  ]
  if s.invariants.length() > 0 {
    parts.push(plural(s.invariants.length(), "invariant"))
  }
  {
    key: "spec:" + ToJson::to_json(s).stringify(),
    tokens: [tok(Muted, "ComponentSpec "), tok(Name, s.name)],
    prim: [tok(Muted, "{…}")],
    brief: "\{s.name} component",
    title: "\{s.name} component",
    detail: parts.join(" · "),
    rows: () => {
      let rows = s.fields.map(f => Node(f.name, Inspected::field(f)))
      for v in s.views {
        match view_irs.get("\{s.name}/\{v.name}") {
          Some(ir) => rows.push(Node("view \{v.name}", Inspected::view(ir)))
          None => rows.push(Leaf("view \{v.name}", [tok(Fn, v.words)]))
        }
      }
      if s.methods.length() > 0 {
        rows.push(Leaf("methods", [tok(Fn, s.methods.join(", "))]))
      }
      if messages.length() > 0 {
        rows.push(Node("on", names_object(messages, "message")))
      }
      if s.provides.length() > 0 {
        rows.push(Node("provides", names_object(s.provides, "provide")))
      }
      if s.events.length() > 0 {
        rows.push(
          Node("eventNames", Inspected::set(s.events.map(Json::string))),
        )
      }
      rows
    },
  }
}

///|
/// The components an app's scope knows.
pub fn Inspected::scope(specs : Array[SpecInfo]) -> Inspected {
  let names = []
  for i, s in specs {
    if i > 0 {
      names.push(tok(Plain, ", "))
    }
    names.push(tok(Name, s.name))
  }
  {
    key: "scope:" + specs.map(s => s.name).join(","),
    tokens: merged(
      [tok(Muted, "Scope "), tok(Plain, "["), ..names, tok(Plain, "]")],
    ),
    prim: [tok(Muted, "{…}")],
    brief: "scope",
    title: "scope",
    detail: plural(specs.length(), "component"),
    rows: () => specs.map(s => Node(s.name, Inspected::spec(s))),
  }
}

///|
let inline_fields_max : Int32 = 3

///|
/// A component instance: its fields' values (the first ones inline), its spec and, when
/// known, the scope it lives in.
pub fn Inspected::instance(
  spec : SpecInfo,
  fields : Array[(String, Inspected)],
  scope? : Array[SpecInfo],
) -> Inspected {
  let parts = [tok(Name, "‹\{spec.name}")]
  let shown = []
  for i, f in fields {
    if i >= inline_fields_max {
      break
    }
    parts.append([tok(Plain, " "), tok(Key, f.0), tok(Plain, "="), ..f.1.prim])
    shown.push("\{f.0} \{f.1.brief}")
  }
  if fields.length() > inline_fields_max {
    parts.push(tok(Muted, " …"))
    shown.push("…")
  }
  parts.push(tok(Name, "›"))
  {
    key: "instance:\{spec.name}(" +
    fields.map(f => "\{f.0}=\{f.1.key}").join(",") +
    ")",
    tokens: merged(parts),
    prim: [tok(Name, "‹\{spec.name}›")],
    brief: spec.name,
    title: spec.name,
    detail: shown.join(" · "),
    rows: () => {
      let rows = fields.map(f => Node(f.0, f.1))
      rows.push(Node("[[spec]]", Inspected::spec(spec)))
      if scope is Some(specs) {
        rows.push(Node("[[scope]]", Inspected::scope(specs)))
      }
      rows
    },
  }
}

///|
/// A component's state from its JSON: an object's entries are the instance's fields.
pub fn Inspected::state(
  spec : SpecInfo,
  state : Json,
  specs~ : Array[SpecInfo] = [],
) -> Inspected {
  let fields = match snapshot(spec, state, specs) {
    Object(m) =>
      m.to_array().filter(e => e.0 != "$").map(e => (e.0, Inspected::json(e.1)))
    Null => []
    other => [("state", Inspected::json(other))]
  }
  Inspected::instance(spec, fields)
}

///|
/// A component's state as JS's snapshot shows it: its name as `$`, then its fields in the
/// order it declares them (an absent option as null), through the components they hold,
/// whose specs are among `specs`.
pub fn snapshot(spec : SpecInfo, state : Json, specs : Array[SpecInfo]) -> Json {
  // A component with no fields (a Unit state) is just its name.
  if state is Null && spec.fields.is_empty() {
    return { "$": Json::string(spec.name) }
  }
  guard state is Object(m) else { return state }
  let spec = match m.get("$") {
    Some(String(name)) =>
      specs.iter().find_first(s => s.name == name).unwrap_or(spec)
    _ => spec
  }
  let out : Map[String, Json] = { "$": Json::string(spec.name) }
  for f in spec.fields {
    out[f.name] = held(m.get(f.name).unwrap_or(Json::null()), f.ty, specs)
  }
  for k, v in m {
    if !out.contains(k) {
      out[k] = v
    }
  }
  Json::object(out)
}

///|
/// A field's value, through the components its type says it holds.
fn held(v : Json, ty : @tutuca.FieldType, specs : Array[SpecInfo]) -> Json {
  match (ty, v) {
    (Optional(_), Null) => Json::null()
    (Optional(t), _) => held(v, t, specs)
    (ListOf(t), Array(xs)) => Json::array(xs.map(x => held(x, t, specs)))
    (MapOf(t), Object(m)) => {
      let out : Map[String, Json] = Map([])
      for k, x in m {
        out[k] = held(x, t, specs)
      }
      Json::object(out)
    }
    (ComponentOf(names), Object(_) | Null) => {
      let name = match v {
        Object(m) =>
          match m.get("$") {
            Some(String(n)) => n
            _ => names.get(0).unwrap_or("")
          }
        _ => names.get(0).unwrap_or("")
      }
      match specs.iter().find_first(s => s.name == name) {
        Some(spec) => snapshot(spec, v, specs)
        None => v
      }
    }
    _ => v
  }
}

// --- nodes ------------------------------------------------------------------------------------

///|
/// The values of the nodes made so far, by ref, so a node holds plain data and makes its
/// rows when opened; values with equal keys share a ref.
let refs : Map[Int32, Inspected] = Map([])

///|
/// The refs by their values' keys, hashed: JS keeps them in a WeakMap, so they go with their
/// values; these are dropped all at once past a bound, after which nodes made before can't
/// open (as a JS node whose value was collected).
let ref_ids : Map[Int32, Int32] = Map([])

///|
let next_ref : Ref[Int32] = Ref(0)

///|
let max_refs : Int32 = 20000

///|
fn ref_of(v : Inspected) -> Int32 {
  let hash = v.key.hash()
  let id = match ref_ids.get(hash) {
    Some(id) => id
    None => {
      if ref_ids.length() >= max_refs {
        ref_ids.clear()
        refs.clear()
      }
      next_ref.val += 1
      ref_ids[hash] = next_ref.val
      next_ref.val
    }
  }
  refs[id] = v
  id
}

///|
/// A labelled value, expanding into its rows.
pub(all) struct DevNode {
  label : String
  title : String
  detail : String
  tokens : Array[Token]
  ref_ : Int32 // 0 for rows with nothing to expand.
  can_open : Bool
  is_open : Bool
  rows : Vec[DevNode]
} derive(Eq, Debug, ToJson, @quickcheck.Arbitrary)

///|
pub(all) enum DevNodeMsg {
  Toggle
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// A node for `v`, labelled `label`; it makes its rows only when opened.
pub fn DevNode::of(label : String, v : Inspected) -> DevNode {
  {
    label,
    title: v.title,
    detail: v.detail,
    tokens: v.tokens,
    ref_: ref_of(v),
    can_open: (v.rows)().length() > 0,
    is_open: false,
    rows: Vec::new(),
  }
}

///|
/// A row with nothing to expand reads the same either way.
fn DevNode::leaf(label : String, tokens : Array[Token]) -> DevNode {
  {
    label,
    title: text_of(tokens),
    detail: "",
    tokens,
    ref_: 0,
    can_open: false,
    is_open: false,
    rows: Vec::new(),
  }
}

///|
let node_rows : Items[DevNode, Int32, DevNode] = items("rows", n => n.rows, (
  n,
  rows,
) => { ..n, rows, })

///|
/// The rows of the node: its open state's lens for stories and tests.
pub fn DevNode::row(i : Int32) -> Lens[DevNode, DevNode] {
  node_rows.at(i)
}

///|
fn expander() -> View[DevNode, DevNodeMsg] {
  if_(
    n => n.can_open,
    button(
      [
        attr("type", "button"),
        cls("w-3 shrink-0 cursor-pointer opacity-60 hover:opacity-100"),
        aria("label", "Expand"),
        on_click(Toggle),
      ],
      [show(n => if n.is_open { "▾" } else { "▸" })],
    ),
    span([cls("w-3 shrink-0")], []),
  )
}

///|
fn shown_rows() -> View[DevNode, DevNodeMsg] {
  when(
    n => n.is_open && n.rows.length() > 0,
    div([cls("ml-1.5 border-l border-base-300 pl-3")], [
      render_self_each(node_rows),
    ]),
  )
}

///|
fn DevNode::view() -> View[DevNode, DevNodeMsg] {
  div([cls("text-sm leading-6")], [
    div([cls("flex items-baseline gap-1.5")], [
      expander(),
      when(
        n => n.label != "",
        span([cls("text-base-content/60")], [show(n => n.label)]),
      ),
      span([cls("min-w-0 font-medium break-words")], [show(n => n.title)]),
      when(
        n => n.detail != "",
        span([cls("min-w-0 text-xs text-base-content/60 break-words")], [
          show(n => n.detail),
        ]),
      ),
    ]),
    shown_rows(),
  ])
}

///|
fn DevNode::code_view() -> View[DevNode, DevNodeMsg] {
  div([cls("font-mono text-xs leading-5")], [
    div([cls("flex items-baseline gap-1")], [
      expander(),
      when(
        n => n.label != "",
        span([cls("text-secondary")], [show(n => n.label), txt(":")]),
      ),
      span([cls("min-w-0 break-all")], [
        each(
          n => n.tokens.iter(),
          span([class_(it => it.value.tone.class())], [
            show(it => it.value.text),
          ]),
        ),
      ]),
    ]),
    shown_rows(),
  ])
}

///|
fn DevNode::opened(self : DevNode) -> DevNode {
  let is_open = !self.is_open
  if !is_open || self.rows.length() > 0 {
    return { ..self, is_open, }
  }
  match refs.get(self.ref_) {
    Some(v) => {
      let rows = (v.rows)().map(row => {
        match row {
          Node(label, x) => DevNode::of(label, x)
          Leaf(label, tokens) => DevNode::leaf(label, tokens)
        }
      })
      { ..self, is_open, rows: Vec::of(rows), }
    }
    None => { ..self, is_open, }
  }
}

///|
pub let dev_node : Component[DevNode, DevNodeMsg] = component(
  "DevNode",
  view=DevNode::view,
  views=() => [("code", DevNode::code_view())],
  update=(n, msg, _) => {
    match msg {
      Toggle => n.opened()
    }
  },
  post=(_, prev, next) => next.is_open != prev.is_open,
  children=() => [@tutuca.each_self(node_rows)],
  fields=[
    @tutuca.field_info("label", Text),
    @tutuca.field_info("title", Text),
    @tutuca.field_info("detail", Text),
    @tutuca.field_info(
      "tokens",
      ListOf(RecordOf([("text", Text), ("tone", Text)])),
    ),
    @tutuca.field_info("ref_", Whole, constraints=[AtLeast(0)]),
    @tutuca.field_info("can_open", Boolean),
    @tutuca.field_info("is_open", Boolean),
    @tutuca.field_info("rows", ListOf(ComponentOf(["DevNode"]))),
  ],
  messages=@tutuca.json_messages(["Toggle"]),
)

// --- sections, lint and the panel -------------------------------------------------------------

///|
let section_title : String = "text-xs font-semibold uppercase tracking-wider text-base-content/60"

///|
/// A titled list of nodes.
pub(all) struct DevSection {
  title : String
  empty_text : String
  nodes : Vec[DevNode]
} derive(Eq, Debug, ToJson, @quickcheck.Arbitrary)

///|
pub fn DevSection::new(
  title : String,
  empty_text~ : String = "Nothing to show.",
  nodes~ : Array[DevNode] = [],
) -> DevSection {
  { title, empty_text, nodes: Vec::of(nodes), }
}

///|
let section_nodes : Items[DevSection, Int32, DevNode] = items(
  "nodes",
  s => s.nodes,
  (s, nodes) => { ..s, nodes, },
)

///|
/// The section's nodes, for stories and tests.
pub fn DevSection::node(i : Int32) -> Lens[DevSection, DevNode] {
  section_nodes.at(i)
}

///|
pub let dev_section : Component[DevSection, Unit] = component(
  "DevSection",
  fields=[
    @tutuca.field_info("title", Text),
    @tutuca.field_info("empty_text", Text, initial="Nothing to show."),
    @tutuca.field_info("nodes", ListOf(ComponentOf(["DevNode"]))),
  ],
  view=() => {
    section([cls("flex flex-col gap-1")], [
      h3([cls(section_title)], [show(s => s.title)]),
      if_(
        s => s.nodes.is_empty(),
        p([cls("text-xs text-base-content/50")], [show(s => s.empty_text)]),
        div([cls("flex flex-col")], [render_each(section_nodes, dev_node)]),
      ),
    ])
  },
)

///|
pub(all) enum LintLevel {
  Error
  Warning
} derive(Eq, Debug, ToJson, @quickcheck.Arbitrary)

///|
/// A lint issue as plain data.
pub(all) struct LintRecord {
  level : LintLevel
  code : String
  path : String
  message : String
} derive(Eq, Debug, ToJson, @quickcheck.Arbitrary)

///|
/// What a component's check found, as lint records: each an error, coded "check".
pub fn lint_records(issues : Array[@tutuca.Issue]) -> Array[LintRecord] {
  issues.map(i => {
    level: Error,
    code: "check",
    path: i.path,
    message: i.message,
  })
}

///|
/// The issues of components' checks.
pub(all) struct DevLint {
  issues : Array[LintRecord]
} derive(Eq, Debug, ToJson, @quickcheck.Arbitrary)

///|
fn LintLevel::badge(self : LintLevel) -> String {
  match self {
    Error => "badge badge-xs badge-error"
    Warning => "badge badge-xs badge-warning"
  }
}

///|
pub let dev_lint : Component[DevLint, Unit] = component(
  "DevLint",
  fields=[
    @tutuca.field_info(
      "issues",
      ListOf(
        RecordOf([
          ("level", OneOf(["error", "warning"])),
          ("code", Text),
          ("path", Text),
          ("message", Text),
        ]),
      ),
    ),
  ],
  view=() => {
    section([cls("flex flex-col gap-1")], [
      h3([cls(section_title)], [txt("Lint")]),
      if_(
        l => l.issues.is_empty(),
        p([cls("text-xs text-success")], [txt("Clean")]),
        ul([cls("flex flex-col gap-1")], [
          each(
            l => l.issues.iter(),
            li([cls("flex items-baseline gap-2 text-xs")], [
              span([class_(it => it.value.level.badge())], [
                show(it => it.value.code),
              ]),
              span([cls("font-mono opacity-70")], [show(it => it.value.path)]),
              span([], [show(it => it.value.message)]),
            ]),
          ),
        ]),
      ),
    ])
  },
)

///|
/// How the panel's nodes read: in words, or as code.
pub(all) enum DevView {
  Main
  Code
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS names the views: "main", "code".
pub impl ToJson for DevView with fn to_json(self) {
  Json::string(if self is Code { "code" } else { "main" })
}

///|
pub impl FromJson for DevView with fn from_json(json, path) {
  match json {
    String("main") => Main
    String("code") => Code
    _ => raise @json.JsonDecodeError((path, "a view: \"main\" or \"code\""))
  }
}

///|
/// Dev information about a running app: its state, the tasks that made it, its components
/// and their issues. `updated` keeps the nodes whose values didn't change, so what is open
/// stays open.
pub(all) struct DevPanel {
  view : DevView
  state : DevSection
  tasks : DevSection
  specs : DevSection
  lint : DevLint
} derive(Eq, Debug, ToJson, @quickcheck.Arbitrary)

///|
pub(all) enum DevPanelMsg {
  SetView(DevView)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// An empty panel.
pub fn DevPanel::new() -> DevPanel {
  {
    view: Main,
    state: DevSection::new("State"),
    tasks: DevSection::new("Tasks", empty_text="No tasks made this state."),
    specs: DevSection::new("Components"),
    lint: { issues: [], },
  }
}

///|
fn same_refs(nodes : Vec[DevNode], items : Array[(String, Inspected)]) -> Bool {
  if nodes.length() != items.length() {
    return false
  }
  for i, item in items {
    if nodes.at(i).ref_ != ref_of(item.1) {
      return false
    }
  }
  true
}

///|
/// The section with nodes for `items`, unless it shows the same values already.
fn DevSection::with_items(
  self : DevSection,
  items : Array[(String, Inspected)],
) -> DevSection {
  if same_refs(self.nodes, items) {
    self
  } else {
    { ..self, nodes: Vec::of(items.map(e => DevNode::of(e.0, e.1))), }
  }
}

///|
/// The panel showing `state`, the `tasks` that made it, the `specs` of its components and
/// their `issues`.
pub fn DevPanel::updated(
  self : DevPanel,
  state? : Inspected,
  tasks~ : Array[(String, Inspected)] = [],
  specs~ : Array[SpecInfo] = [],
  issues~ : Array[LintRecord] = [],
) -> DevPanel {
  let states = match state {
    Some(s) => [("", s)]
    None => []
  }
  {
    ..self,
    state: self.state.with_items(states),
    tasks: self.tasks.with_items(tasks),
    specs: self.specs.with_items(specs.map(s => ("", Inspected::spec(s)))),
    lint: { issues, },
  }
}

///|
let panel_state : Lens[DevPanel, DevSection] = field("state", p => p.state, (
  p,
  state,
) => { ..p, state, })

///|
let panel_tasks : Lens[DevPanel, DevSection] = field("tasks", p => p.tasks, (
  p,
  tasks,
) => { ..p, tasks, })

///|
let panel_specs : Lens[DevPanel, DevSection] = field("specs", p => p.specs, (
  p,
  specs,
) => { ..p, specs, })

///|
let panel_lint : Lens[DevPanel, DevLint] = field("lint", p => p.lint, (p, lint) => {
  ..p,
  lint,
})

///|
let view_button : String = "btn btn-xs join-item"

///|
fn card(v : View[DevPanel, DevPanelMsg]) -> View[DevPanel, DevPanelMsg] {
  div([cls("card border border-base-300 bg-base-100 p-4")], [v])
}

///|
fn DevPanel::view() -> View[DevPanel, DevPanelMsg] {
  div([cls("flex flex-col gap-3")], [
    div(
      [cls("join self-start"), attr("role", "group"), aria("label", "Show as")],
      [
        button(
          [
            attr("type", "button"),
            class_(p => {
              if p.view is Code {
                view_button
              } else {
                "\{view_button} btn-primary"
              }
            }),
            on_click(SetView(Main)),
          ],
          [txt("Readable")],
        ),
        button(
          [
            attr("type", "button"),
            class_(p => {
              if p.view is Code {
                "\{view_button} btn-primary"
              } else {
                view_button
              }
            }),
            on_click(SetView(Code)),
          ],
          [txt("Code")],
        ),
      ],
    ),
    // Every node below shows the view picked here.
    push_view(
      p => if p.view is Code { "code" } else { "main" },
      div([cls("grid gap-4 xl:grid-cols-2")], [
        div([cls("flex min-w-0 flex-col gap-4")], [
          card(render(panel_state, dev_section)),
          card(render(panel_tasks, dev_section)),
        ]),
        div([cls("flex min-w-0 flex-col gap-4")], [
          card(render(panel_specs, dev_section)),
          card(render(panel_lint, dev_lint)),
        ]),
      ]),
    ),
  ])
}

///|
pub let dev_panel : Component[DevPanel, DevPanelMsg] = component(
  "DevPanel",
  view=DevPanel::view,
  update=(p, msg, _) => {
    match msg {
      SetView(view) => { ..p, view, }
    }
  },
  fields=[
    @tutuca.field_info("view", OneOf(["main", "code"])),
    @tutuca.field_info("state", ComponentOf(["DevSection"])),
    @tutuca.field_info("tasks", ComponentOf(["DevSection"])),
    @tutuca.field_info("specs", ComponentOf(["DevSection"])),
    @tutuca.field_info("lint", ComponentOf(["DevLint"])),
  ],
  messages=@tutuca.json_messages(["SetView"]),
)
