// pure-tutuca's reader: a component module written as a pure-js module, in
// the shape of tutuca's component({...}) (spec/pure-tutuca/README.md), checked
// with pure-js as tutuca JS's componentModule checks it (the same host, the
// same signatures by path), then read into the model the rest of the compiler
// resolves, checks and generates from. What the module's functions do is
// lower.mbt's: the Wax the tree's naming convention asks for.

///|
let tags : Array[String] = [
  "a", "abbr", "article", "aside", "b", "blockquote", "br", "canvas", "caption",
  "code", "dd", "details", "dialog", "div", "dl", "dt", "em", "fieldset", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img",
  "input", "kbd", "label", "legend", "li", "main", "nav", "ol", "option", "p", "pre",
  "progress", "section", "select", "small", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "tr", "u", "ul",
  // SVG and MathML: what's under svg and math is in their namespaces.
   "svg", "g", "circle", "ellipse", "rect", "line", "path", "polyline", "polygon",
  "text", "tspan", "defs", "title", "math", "mi", "mn", "mo", "ms", "mtext", "mrow",
  "mfrac", "msqrt", "mroot", "msub", "msup", "msubsup", "munder", "mover", "munderover",
  "mspace", "mtable", "mtr", "mtd",
]

///|
/// The view module's other members: (name, signature).
let view_fns : Array[(String, String)] = [
  ("button", "(...args: unknown[]) => unknown"),
  ("h", "(name: string, ...args: unknown[]) => unknown"),
  ("field", "(name: string) => unknown"),
  ("send", "(name: string, ...args: unknown[]) => unknown"),
  ("targetValue", "() => unknown"),
  ("sourceKey", "() => unknown"),
  ("dragKey", "() => unknown"),
  ("eventKey", "() => unknown"),
  ("eventProperty", "(name: string) => unknown"),
  ("when", "(test: unknown, then: unknown, otherwise?: unknown) => unknown"),
  ("query", "(name: string, ...args: unknown[]) => unknown"),
  ("each", "(...args: unknown[]) => unknown"),
  ("render", "(...args: unknown[]) => unknown"),
  ("renderEach", "(...args: unknown[]) => unknown"),
  ("renderIt", "(...args: unknown[]) => unknown"),
  ("pushView", "(...args: unknown[]) => unknown"),
  ("withBinds", "(...args: unknown[]) => unknown"),
  ("lookupBind", "(name: string) => unknown"),
  ("provided", "(name: string) => unknown"),
  ("seqItem", "(...args: unknown[]) => unknown"),
]

///|
/// A component of the module: a const object with a state type of its name.
pub(all) struct Comp {
  name : String
  literal : @ast.Expr
  state : @ast.TypeNode
  /// The module's constants, which its data may name.
  consts : Map[String, @ast.Expr]
}

///|
/// The module's declarations: its type nodes, its consts' values, and the
/// names it declares with `interface` (not `type`).
pub(all) struct Decls {
  types : Map[String, @ast.TypeNode]
  consts : Map[String, @ast.Expr]
  interfaces : Array[String]
}

///|
pub fn decls_of(m : @ast.Module) -> Decls {
  let types : Map[String, @ast.TypeNode] = Map([])
  let consts : Map[String, @ast.Expr] = Map([])
  let interfaces = []
  for item in m.items {
    match item.declaration() {
      TypeAlias(id~, value~, ..) => types[id.name] = value
      Interface(id~, body~, ..) => {
        types[id.name] = body
        interfaces.push(id.name)
      }
      Const(VarDecl(decls~, ..)) =>
        for d in decls {
          match (d.id, d.init) {
            (PIdent(id), Some(init)) => consts[id.name] = init
            _ => ()
          }
        }
      _ => ()
    }
  }
  { types, consts, interfaces, }
}

///|
/// The URI a const object says it's the meta schema of (`metaSchema: "uri"`).
fn meta_schema_uri(init : @ast.Expr) -> String? {
  match value_of(init, "metaSchema") {
    Some(Lit(LStr(uri), ..)) => Some(uri)
    _ => None
  }
}

///|
/// The module's meta schemas: a const object with a type of its name that
/// says `metaSchema: "uri"`, its fields the type's (with defaults and
/// constraints as a component's), and the URI.
pub fn meta_schemas_of(d : Decls) -> Array[(Comp, String)] {
  let out = []
  for name, init in d.consts {
    match (init, d.types.get(name), meta_schema_uri(init)) {
      (ObjectLit(_, ..), Some(state), Some(uri)) =>
        out.push(({ name, literal: init, state, consts: d.consts, }, uri))
      _ => ()
    }
  }
  out
}

///|
/// The module's components: a const object with a type of its name, but a
/// meta schema.
pub fn components_of(d : Decls) -> Array[Comp] {
  let out = []
  for name, init in d.consts {
    if init is ObjectLit(_, ..) && meta_schema_uri(init) is None {
      match d.types.get(name) {
        Some(state) =>
          out.push({ name, literal: init, state, consts: d.consts, })
        None => ()
      }
    }
  }
  out
}

///|
fn key_name(k : @ast.PropKey) -> String {
  match k {
    KIdent(id) => id.name
    KLit(LStr(s), ..) => s
    KLit(_, raw~, ..) => raw
    KComputed(_) => ""
  }
}

///|
/// The member of an object literal named name: its value, or the function of
/// a method or getter.
pub(all) enum Got {
  Value(@ast.Expr)
  Function(@ast.Func, Bool)
}

///|
pub fn member_of(e : @ast.Expr, name : String) -> Got? {
  guard e is ObjectLit(members, ..) else { return None }
  for m in members {
    match m {
      Prop(key~, value~, ..) if key_name(key) == name =>
        return Some(Value(value))
      Method(key~, func~, getter~, ..) if key_name(key) == name =>
        return Some(Function(func, getter))
      _ => ()
    }
  }
  None
}

///|
pub fn value_of(e : @ast.Expr, name : String) -> @ast.Expr? {
  match member_of(e, name) {
    Some(Value(v)) => Some(v)
    _ => None
  }
}

///|
/// An object literal's members by name, in order: data and functions.
pub fn members_in(e : @ast.Expr?) -> Array[(String, Got)] {
  let out = []
  guard e is Some(ObjectLit(members, ..)) else { return out }
  for m in members {
    match m {
      Prop(key~, value~, ..) => out.push((key_name(key), Value(value)))
      Method(key~, func~, getter~, ..) =>
        out.push((key_name(key), Function(func, getter)))
      SpreadMember(_, ..) => ()
    }
  }
  out
}

///|
/// A literal's value, as JSON: what a namespace's data says before anything
/// runs; None when it isn't a literal.
/// A literal of the module as JSON: data written out, or names of the
/// module's constants (consts) holding it, and templates of them; None for
/// what isn't data.
pub fn literal_json(
  e : @ast.Expr,
  consts~ : Map[String, @ast.Expr] = Map([]),
  depth~ : Int32 = 0,
) -> Json? {
  if depth > 16 {
    return None
  }
  let literal_json = (x : @ast.Expr) => {
    literal_json(x, consts~, depth=depth + 1)
  }
  match e {
    Ident(id) =>
      match consts.get(id.name) {
        Some(init) => literal_json(init)
        None => None
      }
    Template(quasis~, exprs~, ..) => {
      let sb = StringBuilder()
      for i, q in quasis {
        sb.write_string(q.cooked)
        if exprs.get(i) is Some(x) {
          match literal_json(x) {
            Some(String(t)) => sb.write_string(t)
            Some(Number(n, ..)) => sb.write_string(n.to_string())
            _ => return None
          }
        }
      }
      Some(Json::string(sb.to_string()))
    }
    Lit(LNull, ..) => Some(Json::null())
    Lit(LBool(b), ..) => Some(Json::boolean(b))
    Lit(LNum(n), ..) => Some(Json::number(n))
    Lit(LStr(s), ..) => Some(Json::string(s))
    Unary(op="-", arg=Lit(LNum(n), ..), ..) => Some(Json::number(-n))
    ArrayLit(es, ..) => {
      let out = []
      for x in es {
        match x {
          Some(y) =>
            match literal_json(y) {
              Some(j) => out.push(j)
              None => return None
            }
          None => return None
        }
      }
      Some(Json::array(out))
    }
    ObjectLit(ms, ..) => {
      let out : Map[String, Json] = Map([])
      for m in ms {
        match m {
          Prop(key~, value~, ..) =>
            match literal_json(value) {
              Some(j) => out[key_name(key)] = j
              None => return None
            }
          _ => ()
        }
      }
      Some(Json::object(out))
    }
    _ => None
  }
}

///|
fn type_members(t : @ast.TypeNode?) -> Array[@ast.TypeMember] {
  match t {
    Some(TObject(ms, _)) => ms
    _ => []
  }
}

///|
fn marked(m : @ast.TypeMember, marker : String) -> Bool {
  m is TMMethod(result=TRef(name, _, _), ..) && name == marker
}

///|
/// The names of a component's queries.
pub fn query_names(c : Comp) -> Array[String] {
  members_in(value_of(c.literal, "queries")).map(x => x.0)
}

///|
/// A group's handlers (on, answers): their name and their entry object.
pub fn handlers_of(c : Comp, group : String) -> Array[(String, @ast.Expr)] {
  members_in(value_of(c.literal, group)).filter_map(x => {
    match x.1 {
      Value(v) => Some((x.0, v))
      _ => None
    }
  })
}

///|
fn handler_run(h : @ast.Expr) -> @ast.Func? {
  match member_of(h, "run") {
    Some(Function(f, _)) => Some(f)
    _ => None
  }
}

///|
/// A handler's args type, as TypeScript: what its run's second parameter is
/// annotated with ([] for an empty pattern, unknown[] for none).
pub fn args_text(h : @ast.Expr) -> String {
  match handler_run(h) {
    Some(f) => fn_args_text(f)
    None => "unknown[]"
  }
}

///|
/// A handler function's args type, as TypeScript: its second parameter's
/// annotation ([] for an empty pattern, unknown[] for none).
pub fn fn_args_text(f : @ast.Func) -> String {
  guard f.params.get(1) is Some(p) else { return "unknown[]" }
  match p.ann() {
    Some(t) => @purejs.print_type(t)
    None => if p is PArray(elements=[], ..) { "[]" } else { "unknown[]" }
  }
}

///|
pub fn is_pure_handler(h : @ast.Expr) -> Bool {
  value_of(h, "pure") is Some(Lit(LBool(true), ..))
}

///|
fn ctx_name(component : String, message : String) -> String {
  "Ctx_\{component}_\{message}"
}

///|
fn quoted(names : Array[String]) -> String {
  if names.is_empty() {
    "string"
  } else {
    names.map(n => Json::string(n).stringify()).join(" | ")
  }
}

///|
fn method_names(t : @ast.TypeNode?) -> Array[String] {
  type_members(t).filter_map(m => {
    match m {
      TMMethod(name~, ..) => Some(name)
      _ => None
    }
  })
}

///|
/// The pure-js host of a module's components, as componentModule's: the
/// standard host, the markers, the view module (tutuca/view), the tutuca
/// module, and a ctx handle for each handler.
pub fn host_of(
  d : Decls,
  pages~ : Array[HostModule] = [],
  imported~ : Array[(String, String, @ast.TypeNode)] = [],
  imported_interfaces~ : Array[String] = [],
) -> @purejs.Host raise Failure {
  let comps = components_of(d)
  // (name made by, type) of what ctx.make makes: the components, the
  // interfaces, the imported interfaces (by their local names).
  let makes : Array[(String, String)] = []
  for c in comps {
    makes.push((c.name, c.name))
  }
  for name, _ in d.types {
    if is_interface(d, name) && !makes.iter().any(x => x.0 == name) {
      makes.push((name, name))
    }
  }
  for t in imported {
    if imported_interfaces.contains(t.1) && !makes.iter().any(x => x.0 == t.1) {
      makes.push((t.1, t.0))
    }
  }
  let make_text = makes
    .map(n => {
      "make(name: \{Json::string(n.0).stringify()}, fields?: { [key: string]: unknown }): \{n.1}"
    })
    .join("; ")
  // An ask handler's last parameter, the asker's context: what it reads of
  // the asker's scope.
  let handles = [
    (
      "AskCtx", "{ componentNames(walk?: boolean): string[]; metaOf(name: string, uri: string): unknown; log(value: unknown): void; now(): number; uuid(): string }",
    ),
  ]
  let nondeterministic = ["AskCtx.uuid", "AskCtx.now"]
  for c in comps {
    for group in ["on", "answers"] {
      for h in handlers_of(c, group) {
        let sk = match value_of(h.1, "sourceKey") {
          Some(v) if value_of(v, "keyOf") is Some(_) => "number | undefined"
          _ => "unknown"
        }
        // An answer's handle is its own: a message and an answer may share a
        // name.
        let name = ctx_name(
          c.name,
          if group == "answers" {
            "\{h.0}Answer"
          } else {
            h.0
          },
        )
        let notifies = quoted(method_names(d.types.get("\{c.name}Notifies")))
        let asks = quoted(method_names(d.types.get("\{c.name}Asks")))
        handles.push(
          (
            name,
            "{ readonly sourceKey: \{sk}; readonly drag: { type: string | null; value: unknown; key: number | string | null } | null; notify(name: \{notifies}, args?: unknown[]): void; ask(name: \{asks}, args?: unknown[], options?: { detached?: boolean }): number; reply(name: string, args?: unknown[]): void; cancel(id: number): void; readonly request: number | null; stopNext(): void; uuid(): string; now(): number; log(value: unknown): void; tryMake(name: string, fields?: unknown): { ok: unknown; err?: undefined } | { ok?: undefined; err: { error: string; issues: unknown[] } }; componentNames(walk?: boolean): string[]; metaOf(name: string, uri: string): unknown; sendAt(name: string, args: unknown[], path: string | number | { item: string; key: number | string } | { seqItem: string; keyField: string } | (string | number | { item: string; key: number | string } | { seqItem: string; keyField: string })[], watch?: { settled?: string; progress?: string; timeout?: number; detached?: boolean }): number | undefined; \{make_text} }",
          ),
        )
        nondeterministic.push("\{name}.uuid")
        nondeterministic.push("\{name}.now")
      }
    }
    // init's ctx makes components, and nothing else.
    if member_of(c.literal, "init") is Some(Function(_, _)) {
      handles.push((ctx_name(c.name, "init"), "{ \{make_text} }"))
    }
  }
  let applies = []
  let typed = []
  for name, node in d.types {
    typed.push((name, node))
  }
  for t in imported {
    typed.push((t.0, t.2))
  }
  for t in typed {
    let (name, node) = t
    for m in type_members(Some(node)) {
      if marked(m, "Pure") && m is TMMethod(name=mname, params~, ..) {
        let ps = params.map(p => ", \{p.name}: \{@purejs.print_type(p.value)}")
        applies.push(
          "(component: \{name}, message: \{Json::string(mname).stringify()}\{ps.join("")}) => \{name}",
        )
      }
    }
  }
  for c in comps {
    for h in handlers_of(c, "on") {
      if is_pure_handler(h.1) {
        let args = args_text(h.1)
        let params = match @purejs.parse_module("type A = \{args};") {
          Ok(m) =>
            match m.items.get(0) {
              Some(TypeAlias(value=TTuple(es, _), ..)) =>
                es.mapi((i, e) => ", a\{i}: \{@purejs.print_type(e)}")
              _ => []
            }
          Err(_) => []
        }
        applies.push(
          "(component: \{c.name}, message: \{Json::string(h.0).stringify()}\{params.join("")}) => \{c.name}",
        )
      }
    }
  }
  let view_members = tags.map(t => (t, ["(...args: unknown[]) => unknown"]))
  for f in view_fns {
    view_members.push((f.0, [f.1]))
  }
  let tutuca = [("errorMessage", ["(error: unknown) => string"])]
  if !applies.is_empty() {
    tutuca.push(("apply", applies))
  }
  @purejs.std_host().with_declaration({
    types: [
      ("Pure", "{ readonly pure: true }"),
      ("Notify", "{ readonly notify: true }"),
      // Any component: every one fits it, and nothing of it can be read.
      ("Component", "{}"),
      ..imported.map(t => (t.0, @purejs.print_type(t.2))),
    ],
    handles,
    modules: [
      ("View", view_members),
      ("tutuca", tutuca),
      (data_host.module_, data_host.members),
      ..pages.map(p => (p.module_, p.members)),
    ],
    functions: [],
    nondeterministic,
    fresh: [..data_host.fresh, ..pages.map(p => p.fresh).flatten()],
    imports: [
      ("tutuca/view", "View"),
      (data_host.specifier, data_host.module_),
      ..pages.map(p => (p.specifier, p.module_)),
    ],
  })
}

///|
fn query_set(c : Comp) -> Array[String] {
  query_names(c)
}

///|
/// What each entry is, by path, as componentModule's signatures.
pub fn signature_of(d : Decls) -> (Array[String]) -> @purejs.Signature? {
  let comps = components_of(d)
  path => {
    let name = path[0]
    guard comps.search_by(c => c.name == name) is Some(ci) else { return None }
    let c = comps[ci]
    match path.get(1) {
      Some("queries") =>
        Some({ this_: Some(@purejs.read(name)), params: None, result: None, })
      Some("invariants") | Some("checks") =>
        Some({
          this_: Some(@purejs.read(name)),
          params: None,
          result: Some(@purejs.plain("boolean")),
        })
      // init(next, ctx): next the component made from its fields, ctx what
      // makes the components it holds.
      Some("init") =>
        Some({
          this_: Some(@purejs.read(name)),
          params: Some([
            @purejs.draft(name),
            @purejs.plain(ctx_name(name, "init")),
          ]),
          result: Some(@purejs.plain("void")),
        })
      Some("on") | Some("answers") as group => {
        let group = group.unwrap()
        guard path.get(2) is Some(member_) &&
          handlers_of(c, group).search_by(h => h.0 == member_) is Some(hi) else {
          return None
        }
        let h = handlers_of(c, group)[hi].1
        // An answer's outcome (answers.a.ok) is its handler, as run is.
        let outcome = if group == "answers" && path.length() == 4 {
          match member_of(h, path[3]) {
            Some(Function(f, _)) => Some(f)
            _ => None
          }
        } else {
          None
        }
        let args = match outcome {
          Some(f) => fn_args_text(f)
          None => args_text(h)
        }
        let pure_ = is_pure_handler(h)
        // A swap's run gives what the component becomes (or nothing: it stays).
        let result = if value_of(h, "swap") is Some(Lit(LBool(true), ..)) {
          "unknown"
        } else {
          "void"
        }
        match path.get(3) {
          Some("run") | Some(_) if outcome is Some(_) ||
            path.get(3) == Some("run") =>
            Some({
              this_: Some(@purejs.read(name)),
              params: Some(
                if pure_ {
                  [@purejs.draft(name), @purejs.plain(args)]
                } else {
                  [
                    @purejs.draft(name),
                    @purejs.plain(args),
                    @purejs.plain(
                      ctx_name(
                        name,
                        if group == "answers" {
                          "\{member_}Answer"
                        } else {
                          member_
                        },
                      ),
                    ),
                  ]
                },
              ),
              result: Some(@purejs.plain(result)),
            })
          Some("pre") =>
            Some({
              this_: Some(@purejs.read(name)),
              params: Some([
                @purejs.read(name),
                @purejs.plain(args),
                @purejs.plain("unknown"),
              ]),
              result: Some(@purejs.plain("boolean")),
            })
          Some("post") =>
            Some({
              this_: Some(@purejs.read(name)),
              params: Some([
                @purejs.read(name),
                @purejs.read(name),
                @purejs.plain(args),
                @purejs.plain("unknown"),
              ]),
              result: Some(@purejs.plain("boolean")),
            })
          _ => None
        }
      }
      _ =>
        Some({ this_: Some(@purejs.read(name)), params: None, result: None, })
    }
  }
}

///|
/// What a namespace's data members are: C.defaults is the state's fields,
/// each optional; C.examples start from such fields and expect fields and
/// queries;
/// C.on.m.changes and C.implements are names.
pub fn data_type_of(d : Decls) -> (Array[String]) -> String? {
  let comps = [..components_of(d), ..meta_schemas_of(d).map(m => m.0)]
  path => {
    // Names: what a message changes, what a component implements.
    match path {
      [_, "on", _, "changes"] | [_, "implements"] => return Some("string[]")
      _ => ()
    }
    guard path.length() == 2 && (path[1] == "defaults" || path[1] == "examples") else {
      return None
    }
    guard comps.search_by(c => c.name == path[0]) is Some(ci) else {
      return None
    }
    let c = comps[ci]
    let queries = query_set(c)
    let fields = type_members(Some(c.state)).filter_map(m => {
      match m {
        TMProperty(name~, value~, ..) if !queries.contains(name) =>
          Some("\{name}?: \{@purejs.print_type(value)}")
        _ => None
      }
    })
    let partial = if fields.is_empty() {
      "{}"
    } else {
      "{ \{fields.join("; ")} }"
    }
    // What an expect names: the fields and the queries.
    let readable = type_members(Some(c.state)).filter_map(m => {
      match m {
        TMProperty(name~, value~, ..) =>
          Some("\{name}?: \{@purejs.print_type(value)}")
        _ => None
      }
    })
    let expected = if readable.is_empty() {
      "{}"
    } else {
      "{ \{readable.join("; ")} }"
    }
    // An example: a start state, then messages to send and fields and queries
    // to expect.
    Some(
      if path[1] == "defaults" {
        partial
      } else {
        "{ [name: string]: { start?: \{partial}; steps: { send?: string; args?: unknown[]; expect?: \{expected} }[] } }"
      },
    )
  }
}

///|
/// A checked module: its tree, what pure-js found, and its declarations.
pub(all) struct Checked {
  m : @ast.Module
  checked : @purejs.ModuleChecked
  decls : Decls
  host : @purejs.Host
  /// The page's host modules it was checked with.
  pages : Array[HostModule]
  /// What it imports from other component modules.
  imports : Array[TutucaImport]
}

///|
/// An import of another component module (a specifier ending in .tutuca):
/// tutuca's, not pure-js's, whose modules share one namespace of types. It
/// names the module's interfaces and meta schemas for pure-tutuca (a use), and each
/// type it names is a type of the importer's code by its local name.
pub(all) struct TutucaImport {
  /// The module's path, relative to the importer's (with .ts).
  path : String
  /// (imported, local) names.
  names : Array[(String, String)]
  span : @ast.Span
  source_span : @ast.Span
  type_only : Bool
}

///|
pub fn is_tutuca_specifier(spec : String) -> Bool {
  spec.has_suffix(".tutuca") || spec.has_suffix(".tutuca.ts")
}

///|
/// The module's imports of other component modules.
pub fn tutuca_imports(m : @ast.Module) -> Array[TutucaImport] {
  let out = []
  for item in m.items {
    if item is Import(type_only~, specs~, source~, source_span~, span~, ..) &&
      is_tutuca_specifier(source) {
      out.push({
        path: if source.has_suffix(".ts") {
          source
        } else {
          "\{source}.ts"
        },
        names: specs.map(sp => (sp.imported.name, sp.local_.name)),
        span,
        source_span,
        type_only,
      })
    }
  }
  out
}

///|
/// The paths of the component modules a module's source imports (none when
/// it doesn't parse).
pub fn imported_paths(src : String) -> Array[String] {
  match @purejs.parse_module(src) {
    Ok(m) => tutuca_imports(m).map(im => im.path)
    Err(_) => []
  }
}

///|
/// src with the spans blanked (each char a space, newlines kept), so what's
/// left has the same offsets.
fn blank(src : String, spans : Array[@ast.Span]) -> String {
  let sb = StringBuilder()
  let mut at = 0
  for sp in spans {
    sb.write_view(src.exact_view(start=at, end=sp.start))
    for c in src.exact_view(start=sp.start, end=sp.end) {
      match c {
        '\n' => sb.write_char('\n')
        // Two code units: two spaces.
        _ if c.to_int() > 0xFFFF => sb.write_string("  ")
        _ => sb.write_char(' ')
      }
    }
    at = sp.end
  }
  sb.write_view(src.exact_view(start=at))
  sb.to_string()
}

///|
/// Checks a pure-tutuca module's source: Ok, or pure-js's diagnostics (as
/// pure-tutuca's, at path).
pub fn check_source(
  path : String,
  src : String,
  resolve? : (String) -> String?,
  pages~ : Array[HostModule] = [],
) -> Result[Checked, Array[@diag.Diagnostic]] {
  guard @purejs.parse_module(src) is Ok(m) else {
    return Err(
      match @purejs.parse_module(src) {
        Err(d) => [diagnostic_of(path, src, d)]
        Ok(_) => []
      },
    )
  }
  let d = decls_of(m)
  // The types the component modules it imports give it, by local name.
  let imports = tutuca_imports(m)
  let imported_types = []
  // The imported names another module declares as its interfaces.
  let imported_interfaces = []
  let import_diags = []
  for im in imports {
    let span = span_of(path, src, im.source_span)
    if !im.type_only {
      import_diags.push(
        @diag.error(
          "pure-tutuca.import",
          span,
          "a component module is imported for its types: import type { ... } from \"\{im.path}\"",
        ),
      )
      continue
    }
    let text = match resolve {
      Some(r) => r(im.path)
      None => None
    }
    guard text is Some(t) && @purejs.parse_module(t) is Ok(other) else {
      import_diags.push(
        @diag.error("pure-tutuca.import", span, "can't read \{im.path}"),
      )
      continue
    }
    let od = decls_of(other)
    for n in im.names {
      match od.types.get(n.0) {
        Some(node) => {
          imported_types.push((n.1, n.0, node))
          if is_interface(od, n.0) {
            imported_interfaces.push(n.0)
          }
        }
        None =>
          import_diags.push(
            @diag.error(
              "pure-tutuca.import",
              span,
              "\{im.path} declares no type \{n.0}",
            ),
          )
      }
    }
  }
  if !import_diags.is_empty() {
    return Err(import_diags)
  }
  let host = host_of(d, pages~, imported=imported_types, imported_interfaces~) catch {
    Failure(msg) =>
      return Err([@diag.error("pure.host", @diag.Span::none(path), msg)])
  }
  let v = @purejs.verify_module(
    blank(src, imports.map(im => im.span)),
    host,
    resolve?,
    signature_of=signature_of(d),
    data_type_of=data_type_of(d),
  ) catch {
    Failure(msg) =>
      return Err([@diag.error("pure.profile", @diag.Span::none(path), msg)])
  }
  match v.checked {
    Some(checked) if v.diagnostics.is_empty() =>
      Ok({ m, checked, decls: d, host, pages, imports, })
    _ => Err(v.diagnostics.map(x => diagnostic_of(path, src, x)))
  }
}

///|
/// Where an offset of src is, as pure-tutuca's positions are.
pub fn pos_of(src : String, offset : Int32) -> @diag.Pos {
  let mut line = 1
  let mut col = 1
  let end = offset.min(src.length())
  for i in 0..<end {
    if src.code_unit_at(i) == 10 {
      line += 1
      col = 1
    } else {
      col += 1
    }
  }
  { line, col, offset: end, }
}

///|
pub fn span_of(path : String, src : String, s : @ast.Span) -> @diag.Span {
  { file: path, start: pos_of(src, s.start), end: pos_of(src, s.end), }
}

///|
/// A pure-js diagnostic as pure-tutuca's: its code under pure-js's prefix.
pub fn diagnostic_of(
  path : String,
  src : String,
  d : @purejs.Diagnostic,
) -> @diag.Diagnostic {
  @diag.error(
    "purejs.\{d.code.name()}",
    span_of(path, src, { start: d.start, end: d.end, }),
    d.message,
    hint?=d.help,
  )
}
