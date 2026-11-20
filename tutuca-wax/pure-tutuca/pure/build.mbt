// A checked pure-tutuca module as the model (@check.Package): its types as
// the model's, its data (defaults, constraints, meta, examples) as values,
// its views as view nodes, and what its entries are. The module's names stay
// as written.

///|
priv struct Builder {
  path : String
  src : String
  d : Decls
  ch : @purejs.ModuleChecked
  comps : Array[Comp]
  diags : Array[@diag.Diagnostic]
}

///|
fn Builder::span(self : Builder, s : @ast.Span) -> @diag.Span {
  span_of(self.path, self.src, s)
}

///|
fn Builder::error(
  self : Builder,
  code : String,
  span : @diag.Span,
  msg : String,
) -> Unit {
  self.diags.push(@diag.error(code, span, msg))
}

///|
fn is_null_type(t : @ast.TypeNode) -> Bool {
  t is (TKeyword("null", _) | TKeyword("undefined", _))
}

///|
fn string_literals(ts : Array[@ast.TypeNode]) -> Array[String]? {
  let out = []
  for t in ts {
    match t {
      TLiteral(LStr(s), _) => out.push(s)
      _ => return None
    }
  }
  Some(out)
}

///|
/// Whether a type of the module is a component interface: one it declares
/// with `interface` (a `type` is data), but <C>Notifies and <C>Asks, which
/// list a component's signals, and a component's own state type, which an
/// interface of its name may share.
pub fn is_interface(d : Decls, name : String) -> Bool {
  d.interfaces.contains(name) &&
  !name.has_suffix("Notifies") &&
  !name.has_suffix("Asks") &&
  !components_of(d).iter().any(c => c.name == name)
}

///|
/// A pure-js type as the model's: components and interfaces by name, a type
/// alias of the module followed.
fn Builder::ty(
  self : Builder,
  t : @ast.TypeNode,
  seen~ : Array[String] = [],
) -> @check.Ty {
  match t {
    TKeyword("number", _) => F64
    TKeyword("string", _) => Str
    TKeyword("boolean", _) => Bool
    TKeyword(_, _) => Any
    TLiteral(LStr(s), _) => Enum([s])
    TLiteral(_, _) => Any
    TArray(e, _) => List(self.ty(e, seen~))
    TReadonly(e, _) => self.ty(e, seen~)
    TRef("Readonly", [e], _) => self.ty(e, seen~)
    TTuple(_, _) => List(Any)
    TObject(ms, _) => {
      if ms.iter().find_first(m => m is TMIndex(..))
        is Some(TMIndex(value~, ..)) {
        return Map(self.ty(value, seen~))
      }
      Record(
        ms.filter_map(m => {
          match m {
            TMProperty(name~, value~, optional~, ..) => {
              let t = self.ty(value, seen~)
              Some((name, if optional { Option(t) } else { t }))
            }
            _ => None
          }
        }),
      )
    }
    TUnion(ts, sp) => {
      let rest = ts.filter(u => !is_null_type(u))
      if rest.length() < ts.length() {
        return Option(
          if rest.length() == 1 {
            self.ty(rest[0], seen~)
          } else {
            self.ty(TUnion(rest, sp), seen~)
          },
        )
      }
      match string_literals(rest) {
        Some(names) => Enum(names)
        None => OneOf(rest.map(u => self.ty(u, seen~)))
      }
    }
    TRef(name, _, _) =>
      if self.comps.iter().any(c => c.name == name) ||
        is_interface(self.d, name) {
        Comp([name])
      } else {
        match self.d.types.get(name) {
          Some(aliased) if !seen.contains(name) =>
            self.ty(aliased, seen=[..seen, name])
          // The host's Component: any component.
          None if name == "Component" => Comp([])
          _ => Any
        }
      }
    TFunction(..) => Any
  }
}

///|
fn Builder::ty_of_text(self : Builder, text : String) -> @check.Ty {
  match @purejs.parse_module("type A = \{text};") {
    Ok(m) =>
      match m.items.get(0) {
        Some(TypeAlias(value~, ..)) => self.ty(value)
        _ => Any
      }
    Err(_) => Any
  }
}

///|
/// What the entry at path returns, as pure-js worked it out.
fn Builder::entry_type(self : Builder, path : String) -> @check.Ty {
  match self.ch.entries.search_by(e => e.path.join(".") == path) {
    Some(i) => self.ty_of_text(self.ch.entries[i].return_type)
    None => Any
  }
}

///|
fn data_of(c : Comp) -> Json {
  match literal_json(strip_functions(c.literal, c.consts), consts=c.consts) {
    Some(j) => j
    None => Json::object(Map([]))
  }
}

///|
/// A namespace's data, without its methods and getters (and the data that
/// isn't a literal, a view's calls).
fn strip_functions(e : @ast.Expr, consts : Map[String, @ast.Expr]) -> @ast.Expr {
  match e {
    ObjectLit(ms, span~) =>
      ObjectLit(
        ms.filter_map(m => {
          match m {
            Prop(value~, ..) if literal_json(
                strip_functions(value, consts),
                consts~,
              )
              is None => None
            Prop(key~, value~, shorthand~, span~) =>
              Some(
                @ast.ObjMember::Prop(
                  key~,
                  value=strip_functions(value, consts),
                  shorthand~,
                  span~,
                ),
              )
            _ => None
          }
        }),
        span~,
      )
    _ => e
  }
}

///|
fn get_obj(j : Json, key : String) -> Map[String, Json] {
  match j {
    Object(m) =>
      match m.get(key) {
        Some(Object(o)) => o
        _ => Map([])
      }
    _ => Map([])
  }
}

///|
fn strings_of(j : Json?) -> Array[String]? {
  match j {
    Some(Array(xs)) =>
      Some(xs.filter_map(x => if x is String(s) { Some(s) } else { None }))
    _ => None
  }
}

///|
/// A field's (or an argument's) type with its constraints: a key of a list
/// (a whole number) or of a map (a string) for keyOf.
fn Builder::constrained(
  self : Builder,
  name : String,
  value : @ast.TypeNode,
  span : @ast.Span,
  cons : Json?,
  fields : Map[String, @check.Ty],
) -> (@check.Ty, @check.Norm) {
  let norm = @check.norm_of_json(cons)
  let nullable = match value {
    TUnion(ts, _) => ts.length() > 1 && ts.iter().any(is_null_type)
    _ => false
  }
  let option = (t : @check.Ty) => {
    if nullable {
      @check.Ty::Option(t)
    } else {
      t
    }
  }
  if norm.key_of.get(0) is Some(f) {
    let key : @check.Ty = match fields.get(f).map(@check.unoption) {
      Some(List(_)) => F64
      Some(Map(_)) => Str
      Some(t) => {
        self.error(
          "pure-tutuca.type.index",
          self.span(span),
          "\{name} is a key of \{f}, a list or a map, but \{f} is \{@check.ty_text(t)}",
        )
        Any
      }
      None => {
        self.error(
          "pure-tutuca.type.index",
          self.span(span),
          "no field \{f} for \{name} to be a key of\{@check.did_you_mean(f, fields.keys().collect())}",
        )
        Any
      }
    }
    // A list's key is an index: a whole number.
    return (
      option(key),
      { ..@check.Norm::new(), int: key is F64, key_of: [f], },
    )
  }
  let base = self.ty(value)
  (base, norm)
}

///|
fn sync_of(j : Json?) -> @check.SyncLevel {
  match j {
    Some(String("local")) => Local
    Some(String("none")) => NoSync
    _ => Shared
  }
}

///|
fn plain_field(
  name : String,
  ty : @check.Ty,
  span : @diag.Span,
  norm? : @check.Norm,
) -> @check.FieldM {
  {
    name,
    ty,
    norm: norm.unwrap_or(@check.Norm::new()),
    default: None,
    required: false,
    make: None,
    sync: Shared,
    doc: None,
    span,
  }
}

///|
/// The types of a state's members, before their constraints (a key of a
/// field needs the field's).
fn Builder::field_types(
  self : Builder,
  state : @ast.TypeNode,
) -> Map[String, @check.Ty] {
  let out = Map([])
  for m in type_members(Some(state)) {
    if m is TMProperty(name~, value~, optional~, ..) {
      let t = self.ty(value)
      out[name] = if optional { @check.Ty::Option(t) } else { t }
    }
  }
  out
}

///|
/// A component's (or a meta schema's) fields: its state's members that
/// aren't queries.
fn Builder::fields(
  self : Builder,
  c : Comp,
  data : Json,
) -> Array[@check.FieldM] {
  let queries = query_names(c)
  let constraints = get_obj(data, "constraints")
  let defaults = get_obj(data, "defaults")
  let sync = get_obj(data, "sync")
  let ftys = self.field_types(c.state)
  let out : Array[@check.FieldM] = []
  for m in type_members(Some(c.state)) {
    guard m is TMProperty(name~, value~, span~, optional~, ..) &&
      !queries.contains(name) else {
      continue
    }
    let (ty, norm) = self.constrained(
      name,
      value,
      span,
      constraints.get(name),
      ftys,
    )
    let ty = if optional { @check.Ty::Option(ty) } else { ty }
    let default = defaults.get(name).map(@check.val_of_json)
    // A component isn't given as data: one not given is made, as the first
    // component its type names.
    let make = if default is None { self.made(ty) } else { None }
    out.push({
      name,
      ty,
      norm,
      default,
      required: default is None && make is None && @check.needs_value(ty, norm),
      make,
      sync: sync_of(sync.get(name)),
      doc: None,
      span: self.span(span),
    })
  }
  out
}

///|
/// The component of the module a field of type t is made as when it isn't
/// given: the first its type names (a union's first member's).
fn Builder::made(self : Builder, t : @check.Ty) -> String? {
  match t {
    Comp([n, ..]) if self.comps.iter().any(c => c.name == n) => Some(n)
    OneOf([first, ..]) => self.made(first)
    _ => None
  }
}

///|
/// A component's getters (gets) and methods (queries).
fn Builder::queries(
  self : Builder,
  c : Comp,
  ftys : Map[String, @check.Ty],
) -> (Array[@check.FieldM], Array[@check.SignalM]) {
  let gets = []
  let queries : Array[@check.SignalM] = []
  // A getter's constraints are under its name, as a field's: what it gives
  // must meet them (constraints: { share: { min: 0, max: 1 } }).
  let constraints = get_obj(data_of(c), "constraints")
  let declared = (name : String) => {
    type_members(Some(c.state)).filter_map(m => {
      match m {
        TMProperty(name=n, value~, ..) if n == name => Some(value)
        _ => None
      }
    })
  }
  for q in members_in(value_of(c.literal, "queries")) {
    let (name, got) = q
    match got {
      Function(f, true) => {
        let (ty, norm) = match (constraints.get(name), declared(name)) {
          (Some(_) as cons, [value, ..]) =>
            self.constrained(name, value, f.span, cons, ftys)
          _ =>
            (self.entry_type("\{c.name}.queries.\{name}"), @check.Norm::new())
        }
        gets.push(plain_field(name, ty, self.span(f.span), norm~))
      }
      Function(f, false) =>
        queries.push({
          name,
          params: f.params.mapi((i, p) => {
            plain_field(
              match p {
                PIdent(id) => id.name
                _ => "a\{i}"
              },
              match p.ann() {
                Some(t) => self.ty(t)
                None => Any
              },
              self.span(f.span),
            )
          }),
          result: Some(self.entry_type("\{c.name}.queries.\{name}")),
          emits: None,
          doc: None,
          span: self.span(f.span),
        })
      _ => ()
    }
  }
  (gets, queries)
}

///|
/// A handler's parameters: its args tuple's elements, named as its run's
/// pattern names them, with its constraints (by name, as a component's are
/// its fields').
fn Builder::params_of(
  self : Builder,
  h : @ast.Expr,
  ftys : Map[String, @check.Ty],
) -> Array[@check.FieldM] {
  let names = match handler_run(h) {
    Some(f) =>
      match f.params.get(1) {
        Some(PArray(elements~, ..)) =>
          elements.map(e => {
            match e {
              Some(PIdent(id)) => Some(id.name)
              _ => None
            }
          })
        _ => []
      }
    None => []
  }
  let constraints = match
    literal_json(strip_functions(h, self.d.consts), consts=self.d.consts) {
    Some(j) => get_obj(j, "constraints")
    None => Map([])
  }
  match @purejs.parse_module("type A = \{args_text(h)};") {
    Ok(m) =>
      match m.items.get(0) {
        Some(TypeAlias(value=TTuple(es, _), ..)) =>
          es.mapi((i, e) => {
            let name = match names.get(i) {
              Some(Some(n)) => n
              _ => "a\{i}"
            }
            let (ty, norm) = self.constrained(
              name,
              e,
              h.span(),
              constraints.get(name),
              ftys,
            )
            plain_field(name, ty, self.span(h.span()), norm~)
          })
        _ => []
      }
    Err(_) => []
  }
}

///|
fn Builder::messages(
  self : Builder,
  c : Comp,
  ftys : Map[String, @check.Ty],
) -> Array[@check.MessageM] {
  handlers_of(c, "on").map(h => {
    let (name, node) = h
    let info = match
      literal_json(strip_functions(node, c.consts), consts=c.consts) {
      Some(Object(m)) => m
      _ => Map([])
    }
    let source_key = match info.get("sourceKey") {
      Some(Object(_) as sk) => {
        let (ty, norm) = self.constrained(
          "sourceKey",
          TKeyword("number", node.span()),
          node.span(),
          Some(sk),
          ftys,
        )
        Some(plain_field("sourceKey", ty, self.span(node.span()), norm~))
      }
      _ => None
    }
    {
      name,
      params: self.params_of(node, ftys),
      pure_: is_pure_handler(node),
      swap: info.get("swap") is Some(True),
      source_key,
      why: match info.get("why") {
        Some(String(s)) => Some(s)
        _ => None
      },
      changes: strings_of(info.get("changes")),
      pre_entry: member_of(node, "pre") is Some(Function(_, _)),
      post_entry: member_of(node, "post") is Some(Function(_, _)),
      emits: self.emits_of(c, node),
      doc: None,
      span: self.span(node.span()),
    }
  })
}

///|
/// The field a one-step path (tutuca's: "f", { item: "f", key } or
/// { seqItem: "f", keyField }, alone or in an array) starts from, as JSON.
fn path_field(j : Json) -> String? {
  match j {
    { "type": String("Literal"), "value": String(f), .. } => Some(f)
    { "type": String("ArrayExpression"), "elements": Array([step]), .. } =>
      path_field(step)
    { "type": String("ObjectExpression"), "properties": Array(ps), .. } => {
      for p in ps {
        match p {
          {
            "key": { "name": String("item" | "seqItem"), .. }
            | { "value": String("item" | "seqItem"), .. },
            "value": { "type": String("Literal"), "value": String(f), .. },
            ..
          } => return Some(f)
          _ => ()
        }
      }
      None
    }
    _ => None
  }
}

///|
/// What a handler's run emits, read from its literal ctx calls:
/// ctx.notify("x"), ctx.ask("x"), ctx.make("T"), ctx.reply("x"), and
/// ctx.sendAt("m", args, path) a send of m to each component the field a
/// one-step path starts from holds that has it; None when it makes none.
fn Builder::emits_of(
  self : Builder,
  c : Comp,
  h : @ast.Expr,
) -> Array[@check.EmitM]? {
  guard handler_run(h) is Some(f) && f.params.get(2) is Some(PIdent(ctx)) else {
    return None
  }
  let out : Array[@check.EmitM] = []
  let seen : Array[String] = []
  let span = self.span(f.span)
  fn walk(j : Json) {
    match j {
      Object(m) => {
        match (m.get("type"), m.get("callee"), m.get("arguments")) {
          (
            Some(String("CallExpression")),
            Some(
              {
                "type": String("MemberExpression"),
                "object": {
                  "type": String("Identifier"),
                  "name": String(o),
                  ..
                },
                "property": { "name": String(p), .. },
                ..
              }
            ),
            Some(
              Array([{ "type": String("Literal"), "value": String(n), .. }, ..])
            ),
          ) if o == ctx.name => {
            let kind : @check.EmitKindM? = match p {
              "notify" => Some(Notify)
              "ask" => Some(Ask)
              "make" => Some(Make)
              "reply" => Some(Reply)
              _ => None
            }
            if kind is Some(k) && !seen.contains("\{p} \{n}") {
              seen.push("\{p} \{n}")
              out.push({ kind: k, name: n, target: None, span, })
            }
            if p == "sendAt" {
              let field = match m.get("arguments") {
                Some(Array(xs)) => xs.get(2).bind(path_field)
                _ => None
              }
              for target in self.held_with(c, field, n) {
                if !seen.contains("send \{target}.\{n}") {
                  seen.push("send \{target}.\{n}")
                  out.push({
                    kind: SendAt,
                    name: n,
                    target: Some(target),
                    span,
                  })
                }
              }
            }
          }
          _ => ()
        }
        for _, v in m {
          walk(v)
        }
      }
      Array(xs) =>
        for x in xs {
          walk(x)
        }
      _ => ()
    }
  }
  walk(@ast.func_json(f))
  if out.is_empty() {
    None
  } else {
    Some(out)
  }
}

///|
/// The components a field of c holds (its type's, through lists, options
/// and unions) that have the message m.
fn Builder::held_with(
  self : Builder,
  c : Comp,
  field : String?,
  m : String,
) -> Array[String] {
  guard field is Some(f) else { return [] }
  let out = []
  fn walk(t : @ast.TypeNode) {
    match t {
      TArray(e, _) | TReadonly(e, _) | TRef("Readonly", [e], _) => walk(e)
      TUnion(ts, _) => ts.each(walk)
      TRef(name, _, _) =>
        match self.comps.search_by(k => k.name == name) {
          Some(i) =>
            if handlers_of(self.comps[i], "on").iter().any(h => h.0 == m) &&
              !out.contains(name) {
              out.push(name)
            }
          None => ()
        }
      _ => ()
    }
  }
  for tm in type_members(Some(c.state)) {
    if tm is TMProperty(name~, value~, ..) && name == f {
      walk(value)
    }
  }
  out
}

///|
/// The signals an interface lists (<C>Notifies, <C>Asks): its methods, with
/// what each answers (void for none).
fn Builder::signals(
  self : Builder,
  t : @ast.TypeNode?,
) -> Array[@check.SignalM] {
  type_members(t).filter_map(m => {
    match m {
      TMMethod(name~, params~, result~, span~, ..) =>
        Some({
          name,
          params: params.map(p => {
            plain_field(p.name, self.ty(p.value), self.span(span))
          }),
          result: if result is TKeyword("void", _) {
            None
          } else {
            Some(self.ty(result))
          },
          emits: None,
          doc: None,
          span: self.span(span),
        })
      _ => None
    }
  })
}

///|
/// The text e is when it's made of constants only: a string, a module const
/// that is one, a template or + of them; what the module's JavaScript
/// evaluates once, as it's loaded.
fn Builder::const_text(
  self : Builder,
  e : @ast.Expr,
  seen~ : Array[String] = [],
) -> String? {
  match e {
    Lit(LStr(s), ..) => Some(s)
    Ident(id) if !seen.contains(id.name) =>
      match self.d.consts.get(id.name) {
        Some(init) => self.const_text(init, seen=[..seen, id.name])
        None => None
      }
    Template(quasis~, exprs~, ..) => {
      let sb = StringBuilder()
      for i, q in quasis {
        sb.write_string(q.cooked)
        if exprs.get(i) is Some(x) {
          match self.const_text(x, seen~) {
            Some(t) => sb.write_string(t)
            None => return None
          }
        }
      }
      Some(sb.to_string())
    }
    Binary(op="+", left~, right~, ..) =>
      match (self.const_text(left, seen~), self.const_text(right, seen~)) {
        (Some(a), Some(b)) => Some(a + b)
        _ => None
      }
    _ => None
  }
}

///|
/// A name a view call takes (a field's, a loop's, a view's): a constant
/// string.
fn Builder::name_arg(self : Builder, e : @ast.Expr?, what : String) -> String {
  match e {
    Some(x) =>
      match self.const_text(x) {
        Some(s) => s
        None => {
          self.error(
            "pure-tutuca.view.name",
            self.span(x.span()),
            "\{what} is a constant string",
          )
          ""
        }
      }
    None => ""
  }
}

///|
/// An optional name at args[at], a constant string when it's there.
fn Builder::opt_name(
  self : Builder,
  args : Array[@ast.Expr],
  at : Int32,
  what : String,
) -> String? {
  match args.get(at) {
    Some(_) as e => Some(self.name_arg(e, what))
    None => None
  }
}

///|
/// A view call of the module (tutuca/view) as a view node.
fn Builder::view(self : Builder, e : @ast.Expr) -> @check.ViewNode {
  let span = self.span(e.span())
  match e {
    Lit(LStr(s), ..) => Const(VStr(s), span~)
    Lit(LNum(n), ..) => Const(VNum(n), span~)
    Unary(op="-", arg=Lit(LNum(n), ..), ..) => Const(VNum(-n), span~)
    Lit(LBool(b), ..) => Const(VBool(b), span~)
    Lit(LNull, ..) => Const(VNull, span~)
    Template(..) | Ident(_) | Binary(op="+", ..) if self.const_text(e)
      is Some(s) => Const(VStr(s), span~)
    Call(callee=Ident(f), args~, ..) => {
      let at = (i : Int32) => {
        match args.get(i) {
          Some(a) => self.view(a)
          None => @check.ViewNode::Const(VNull, span~)
        }
      }
      match f.name {
        "field" => Field(self.name_arg(args.get(0), "a field's name"), span~)
        "seqItem" =>
          SeqItem(
            self.name_arg(args.get(0), "the list or map field"),
            self.name_arg(args.get(1), "the field holding the key"),
            span~,
          )
        "provided" =>
          Provided(self.name_arg(args.get(0), "the provided name"), span~)
        "query" =>
          Query(
            self.name_arg(args.get(0), "the query's name"),
            args[1:].to_owned().map(a => self.view(a)),
            span~,
          )
        "lookupBind" => Bind(self.name_arg(args.get(0), "the bind"), span~)
        "when" => If(at(0), at(1), args.get(2).map(a => self.view(a)), span~)
        "frag" => {
          let kids = match args.get(0) {
            Some(ObjectLit(_, ..)) => args[1:].to_owned()
            _ => args
          }
          Frag(kids.map(a => self.view(a)), span~)
        }
        "render" =>
          Render(at(0), self.opt_name(args, 1, "a view's name"), span~)
        "renderEach" =>
          RenderEach(at(0), self.opt_name(args, 1, "a loop's name"), span~)
        "each" =>
          Each(at(0), at(1), self.opt_name(args, 2, "a loop's name"), span~)
        "renderIt" => RenderIt(self.opt_name(args, 0, "a view's name"), span~)
        "withBinds" =>
          Scope(self.name_arg(args.get(0), "the scope's name"), at(1), span~)
        "pushView" => PushView(at(0), at(1), span~)
        "h" =>
          match args.get(0).bind(a => self.const_text(a)) {
            Some(tag) => self.element(tag, args[1:].to_owned(), span)
            None => {
              self.error(
                "pure-tutuca.view.el", span, "h names its tag first, a constant: h(\"my-widget\", {...})",
              )
              Const(VNull, span~)
            }
          }
        "send"
        | "targetValue"
        | "sourceKey"
        | "dragKey"
        | "eventKey"
        | "eventProperty" => {
          self.error(
            "pure-tutuca.view.not_renderable",
            span,
            "\{f.name} goes in an \"on:event\" attribute, it doesn't render",
          )
          Const(VNull, span~)
        }
        tag => self.element(tag, args, span)
      }
    }
    _ => {
      self.error(
        "pure-tutuca.view.expr", span, "a view is a constant, or a call of tutuca/view's: a tag, field(x), when(...), each(...)",
      )
      Const(VNull, span~)
    }
  }
}

///|
/// A send argument: what the event gives, a constant, or a when of them.
fn Builder::send_arg(self : Builder, e : @ast.Expr) -> @check.SendArg? {
  let span = self.span(e.span())
  match e {
    Call(callee=Ident(f), args~, ..) =>
      match f.name {
        "targetValue" => Some(TargetValue(span~))
        "sourceKey" => Some(SourceKey(span~))
        "dragKey" => Some(DragKey(span~))
        "eventKey" => Some(Event("key", span~))
        "eventProperty" =>
          Some(Event(self.name_arg(args.get(0), "the event's property"), span~))
        "when" =>
          match
            (
              args.get(0).bind(a => self.send_arg(a)),
              args.get(1).bind(a => self.send_arg(a)),
            ) {
            (Some(c), Some(t)) =>
              Some(Cond(c, t, args.get(2).bind(a => self.send_arg(a)), span~))
            _ => None
          }
        // A state reader, which view_problems reports
        // (pure-tutuca.state-in-send): it holds the argument's place.
        _ => Some(Value(Unknown, span~))
      }
    _ =>
      match literal_json(e, consts=self.d.consts) {
        Some(j) => Some(Value(@check.val_of_json(j), span~))
        None => {
          self.error(
            "pure-tutuca.view.send_arg", span, "a send argument is a constant, or what the event gives: targetValue(), sourceKey(), dragKey(), eventKey(), eventProperty(name), or a when of them",
          )
          None
        }
      }
  }
}

///|
/// An element: its attributes (an object literal first), then its children.
fn Builder::element(
  self : Builder,
  tag : String,
  args : Array[@ast.Expr],
  span : @diag.Span,
) -> @check.ViewNode {
  let (attrs, children) = match args.get(0) {
    Some(ObjectLit(_, ..) as o) => (members_in(Some(o)), args[1:].to_owned())
    _ => ([], args)
  }
  let out : Array[@check.AttrM] = []
  let ons : Array[@check.OnM] = []
  let mut key = None
  let mut ns = None
  for a in attrs {
    guard a.1 is Value(v) else { continue }
    let aspan = self.span(v.span())
    if a.0 == "key" {
      key = Some(self.view(v))
    } else if a.0 == "namespace" {
      match self.const_text(v) {
        Some(uri) => ns = Some(uri)
        None =>
          self.error(
            "pure-tutuca.view.namespace", aspan, "an element's namespace is a constant: the namespace URI it's made in",
          )
      }
    } else if a.0.has_prefix("on:") {
      let parts = a.0
        .exact_view(start=3)
        .split("+")
        .map(s => s.to_owned())
        .collect()
      match v {
        Call(callee=Ident({ name: "send", .. }), args=sargs, ..) => {
          let message = self.name_arg(sargs.get(0), "the message")
          ons.push({
            event: parts[0],
            mods: parts[1:].to_owned(),
            message,
            args: sargs[1:].to_owned().filter_map(x => self.send_arg(x)),
            span: aspan,
          })
        }
        _ =>
          self.error(
            "pure-tutuca.view.handler",
            aspan,
            "\"\{a.0}\" takes send(message, args...)",
          )
      }
    } else {
      out.push({ name: a.0, value: self.view(v), span: aspan, })
    }
  }
  Element(
    tag~,
    ns~,
    attrs=out,
    key~,
    children=children.map(c => self.view(c)),
    ons~,
    span~,
  )
}

///|
/// A component's loops: their hooks are entries (C.loops.l.key, ...), as
/// tutuca calls them: prepare(items), iter(items, prepared), key, filter and
/// enrich(key, item, prepared); a hook's type is what its entry returns, and
/// enrich's members are the binds it gives.
fn Builder::loops(self : Builder, c : Comp) -> Array[@check.LoopM] {
  members_in(value_of(c.literal, "loops")).filter_map(l => {
    guard l.1 is Value(hooks) else { return None }
    let has = (n : String) => member_of(hooks, n) is Some(_)
    let typed = (n : String) => {
      if has(n) {
        Some(self.entry_type("\{c.name}.loops.\{l.0}.\{n}"))
      } else {
        None
      }
    }
    let span = self.span(hooks.span())
    Some({
      name: l.0,
      prepare: typed("prepare"),
      iter: has("iter"),
      key: typed("key"),
      filter: has("filter"),
      enrich: typed("enrich").map(t => binds_of(t, span)),
      view: None,
      span,
    })
  })
}

///|
/// A record type's members: the binds an enrich or a scope gives.
fn binds_of(t : @check.Ty, span : @diag.Span) -> Array[@check.FieldM] {
  match t {
    Record(fields) => fields.map(f => plain_field(f.0, f.1, span))
    _ => []
  }
}

///|
/// A component's scopes: binds.s() gives the names withBinds("s", ...) puts
/// in scope.
fn Builder::scopes(self : Builder, c : Comp) -> Array[@check.ScopeM] {
  members_in(value_of(c.literal, "binds")).filter_map(s => {
    guard s.1 is Function(f, _) else { return None }
    let span = self.span(f.span)
    Some({
      name: s.0,
      binds: binds_of(self.entry_type("\{c.name}.binds.\{s.0}"), span),
      span,
    })
  })
}

///|
/// A component's provided values: provides.p is a field's name, or
/// { seqItem: "items", keyField: "current" }, the item of a list at a field's
/// key.
fn Builder::provides(
  self : Builder,
  c : Comp,
  ftys : Map[String, @check.Ty],
) -> Array[@check.ProvideM] {
  let names = ftys.keys().collect()
  let known = (f : String, span : @diag.Span) => {
    if !ftys.contains(f) {
      self.error(
        "pure-tutuca.provide.field",
        span,
        "no field \{f} to provide\{@check.did_you_mean(f, names)}",
      )
    }
  }
  members_in(value_of(c.literal, "provides")).filter_map(p => {
    guard p.1 is Value(v) else { return None }
    let span = self.span(v.span())
    match v {
      Lit(LStr(f), ..) => {
        known(f, span)
        Some({ name: p.0, field: f, key: None, span, })
      }
      ObjectLit(_, ..) as o =>
        match (value_of(o, "seqItem"), value_of(o, "keyField")) {
          (Some(Lit(LStr(seq), ..)), Some(Lit(LStr(key), ..))) => {
            known(seq, span)
            known(key, span)
            match ftys.get(seq).map(@check.unoption) {
              Some(List(_)) | Some(Map(_)) | None => ()
              Some(t) =>
                self.error(
                  "pure-tutuca.provide.field",
                  span,
                  "seqItem provides an item of a list or a map, but \{seq} is \{@check.ty_text(t)}",
                )
            }
            Some({ name: p.0, field: seq, key: Some(key), span, })
          }
          _ => None
        }
      _ => None
    }
  })
}

///|
/// A component's examples: `examples: { e: { start, steps: [{ send, args },
/// { expect: { f: v } }] } }`.
fn Builder::examples(self : Builder, c : Comp) -> Array[@check.ExampleM] {
  let out : Array[@check.ExampleM] = []
  let span = self.span(c.literal.span())
  for e in get_obj(data_of(c), "examples") {
    let (name, ex) = e
    let start = get_obj(ex, "start")
      .to_array()
      .map(kv => (kv.0, @check.val_of_json(kv.1)))
    let steps : Array[@check.StepM] = []
    if ex is Object(m) && m.get("steps") is Some(Array(xs)) {
      for x in xs {
        guard x is Object(step) else { continue }
        match (step.get("send"), step.get("expect")) {
          (Some(String(msg)), _) => {
            let args = match step.get("args") {
              Some(Array(a)) => a.map(@check.val_of_json)
              _ => []
            }
            steps.push(Send(msg, args, span~))
          }
          (_, Some(Object(fields))) =>
            steps.push(
              Expect(
                fields.to_array().map(kv => (kv.0, @check.val_of_json(kv.1))),
                span~,
              ),
            )
          _ => ()
        }
      }
    }
    out.push({ name, component: c.name, start, steps, span, })
  }
  out
}

///|
fn Builder::views(self : Builder, c : Comp) -> Array[@check.ViewM] {
  let out : Array[@check.ViewM] = []
  let push = (name : String, target : String?, e : @ast.Expr) => {
    out.push({
      name,
      target,
      body: self.view(e),
      doc: None,
      span: self.span(e.span()),
    })
  }
  if value_of(c.literal, "view") is Some(v) {
    push("main", None, v)
  }
  for v in members_in(value_of(c.literal, "views")) {
    if v.1 is Value(e) {
      push(v.0, None, e)
    }
  }
  // renders: { md: view } or { md: { main: view, brief: view } }, what it
  // renders to a render target's nodes, as tutuca's.
  for t in members_in(value_of(c.literal, "renders")) {
    guard t.1 is Value(e) else { continue }
    match e {
      ObjectLit(_, ..) =>
        for v in members_in(Some(e)) {
          if v.1 is Value(b) {
            push(v.0, Some(t.0), b)
          }
        }
      _ => push("main", Some(t.0), e)
    }
  }
  out
}

///|
fn Builder::component(self : Builder, c : Comp) -> @check.ComponentM {
  let data = data_of(c)
  let ftys = self.field_types(c.state)
  let (gets, queries) = self.queries(c, ftys)
  let fields = self.fields(c, data)
  {
    name: c.name,
    implements: match data {
      Object(m) => strings_of(m.get("implements")).unwrap_or([])
      _ => []
    },
    fields,
    gets,
    messages: self.messages(c, ftys),
    notifies: self.signals(self.d.types.get("\{c.name}Notifies")),
    asks: self.signals(self.d.types.get("\{c.name}Asks")),
    queries,
    invariants: members_in(value_of(c.literal, "invariants")).filter_map(inv => {
      guard inv.1 is Function(f, _) else { return None }
      Some({ name: inv.0, doc: None, span: self.span(f.span), })
    }),
    // init(next, ctx): what finishes a component made from its fields.
    init_hook: member_of(c.literal, "init") is Some(Function(_, _)),
    loops: self.loops(c),
    scopes: self.scopes(c),
    provides: self.provides(c, ftys),
    publics: match data {
      Object(m) =>
        strings_of(m.get("public"))
        .unwrap_or([])
        .filter(p => fields.iter().any(f => f.name == p))
      _ => []
    },
    metas: get_obj(data, "meta")
    .to_array()
    .map(m => {
      uri: m.0,
      value: @check.val_of_json(m.1),
      span: self.span(c.literal.span()),
    }),
    views: self.views(c),
    doc: None,
    span: self.span(c.literal.span()),
  }
}

///|
/// An interface of the module: its readonly members are fields, its methods
/// that return Pure messages a holder applies, those that return Notify what
/// it notifies.
fn Builder::interface_(
  self : Builder,
  name : String,
  t : @ast.TypeNode,
  here : Bool,
) -> @check.InterfaceM {
  let fields = []
  let messages : Array[@check.MessageM] = []
  let notifies : Array[@check.SignalM] = []
  let queries : Array[@check.SignalM] = []
  for m in type_members(Some(t)) {
    match m {
      TMProperty(name=n, value~, span~, ..) =>
        fields.push(plain_field(n, self.ty(value), self.span(span)))
      TMMethod(name=n, params~, span~, ..) if marked(m, "Pure") =>
        messages.push({
          name: n,
          params: params.map(p => {
            plain_field(p.name, self.ty(p.value), self.span(span))
          }),
          pure_: true,
          swap: false,
          source_key: None,
          why: None,
          changes: None,
          pre_entry: false,
          post_entry: false,
          emits: None,
          doc: None,
          span: self.span(span),
        })
      TMMethod(name=n, params~, span~, ..) if marked(m, "Notify") =>
        notifies.push({
          name: n,
          params: params.map(p => {
            plain_field(p.name, self.ty(p.value), self.span(span))
          }),
          result: None,
          emits: None,
          doc: None,
          span: self.span(span),
        })
      // Any other method is a query an implementing component answers.
      TMMethod(name=n, params~, result~, span~, ..) =>
        queries.push({
          name: n,
          params: params.map(p => {
            plain_field(p.name, self.ty(p.value), self.span(span))
          }),
          result: Some(self.ty(result)),
          emits: None,
          doc: None,
          span: self.span(span),
        })
      _ => ()
    }
  }
  {
    name,
    fields,
    gets: [],
    messages,
    notifies,
    queries,
    declared_here: here,
    doc: None,
    span: self.span(t.span()),
  }
}

///|
/// The package's name: the module's file name, without its extensions.
pub fn package_name(path : String) -> String {
  let base = match path.rev_find("/") {
    Some(i) => path.exact_view(start=i + 1).to_owned()
    None => path
  }
  match base.find(".") {
    Some(i) => base.exact_view(end=i).to_owned()
    None => base
  }
}

///|
/// The module as the model, with the interfaces and meta schemas it imports
/// from the modules used (each already built, by the path its import names),
/// and what building it found wrong (validate checks the rest).
pub fn build(
  path : String,
  src : String,
  checked : Checked,
  used~ : Map[String, @check.Package] = Map([]),
) -> (@check.Package, Array[@diag.Diagnostic]) {
  let d = checked.decls
  let b : Builder = {
    path,
    src,
    d,
    ch: checked.checked,
    comps: components_of(d),
    diags: [],
  }
  let interfaces = []
  let meta_schemas = []
  for im in checked.imports {
    guard used.get(im.path) is Some(other) else { continue }
    for n in im.names {
      match other.interface_named(n.0) {
        Some(i) => interfaces.push({ ..i, declared_here: false, })
        None => ()
      }
      match other.meta_schemas.iter().find_first(m => m.name == n.0) {
        Some(m) => meta_schemas.push({ ..m, declared_here: false, })
        None => ()
      }
    }
  }
  for name, node in d.types {
    if is_interface(d, name) {
      interfaces.push(b.interface_(name, node, true))
    }
  }
  let components = b.comps.map(c => b.component(c))
  for m in meta_schemas_of(d) {
    let (c, uri) = m
    meta_schemas.push({
      name: c.name,
      uri,
      fields: b.fields(c, data_of(c)),
      declared_here: true,
      doc: None,
      span: b.span(c.literal.span()),
    })
  }
  // The module's ask handlers (askHandlers.a(args): T answers a now; a last
  // AskCtx parameter is the asker's context, not an argument) and the asks
  // the host answers (hostAsks).
  let ask_handlers : Array[@check.SignalM] = []
  if d.consts.get("askHandlers") is Some(hs) {
    for h in members_in(Some(hs)) {
      guard h.1 is Function(f, _) else { continue }
      ask_handlers.push({
        name: h.0,
        params: f.params.filter_map(p => {
          match (p, p.ann()) {
            (PIdent(_), Some(TRef("AskCtx", _, _))) => None
            (PIdent(id), Some(ty)) =>
              Some(plain_field(id.name, b.ty(ty), b.span(f.span)))
            _ => None
          }
        }),
        result: Some(b.entry_type("askHandlers.\{h.0}")),
        emits: None,
        doc: None,
        span: b.span(f.span),
      })
    }
  }
  let host_asks = match d.consts.get("hostAsks").bind(x => literal_json(x)) {
    Some(Array(names)) =>
      names.filter_map(n => if n is String(a) { Some(a) } else { None })
    _ => []
  }
  // What it registers: register's names, or every component under its own.
  let registers : Array[@check.RegisterM] = match
    d.consts.get("register").bind(r => literal_json(r)) {
    Some(Object(m)) =>
      m
      .to_array()
      .map(kv => {
        component: kv.0,
        as_: match kv.1 {
          String(s) => s
          _ => kv.0
        },
      })
    _ => components.map(c => { component: c.name, as_: c.name, })
  }
  let examples = []
  for c in b.comps {
    examples.append(b.examples(c))
  }
  let name = package_name(path).replace_all(old="-", new="_")
  let pkg : @check.Package = {
    full_name: "tutuca:\{name.replace_all(old="_", new="-")}@0.1.0",
    name,
    components,
    interfaces,
    meta_schemas,
    registers,
    ask_handlers,
    host_asks,
    examples,
  }
  (pkg, b.diags)
}
