// Resolving a TCD file into a Package, in two phases: first every
// interface's and component's members and types (so a condition can read a
// member of another type), then what refers across them: conditions,
// emits, interfaces implemented, views and examples.

///|
priv struct Resolver {
  diags : Array[@diag.Diagnostic]
  /// TCD type names: "component" or "interface".
  types : Map[String, String]
}

///|
fn Resolver::error(
  self : Resolver,
  code : String,
  span : @diag.Span,
  message : String,
  hint? : String,
) -> Unit {
  self.diags.push(@diag.error(code, span, message, hint?))
}

///|
fn Resolver::snake(self : Resolver, n : @syntax.Name, what : String) -> Unit {
  if !is_snake_case(n.text) {
    self.error(
      "tcd.name.case",
      n.span,
      "\{what} names are snake_case: lowercase letters, digits and _, starting with a letter; \{n.text} isn't",
    )
  }
}

///|
fn Resolver::unique(
  self : Resolver,
  names : Array[@syntax.Name],
  what : String,
) -> Unit {
  let seen : Map[String, @diag.Span] = Map([])
  for n in names {
    match seen.get(n.text) {
      Some(first) =>
        self.diags.push(
          @diag.error(
            "tcd.name.duplicate",
            n.span,
            "there's already \{what} named \{n.text}",
            related=[{ span: first, message: "the first one", }],
          ),
        )
      None => seen[n.text] = n.span
    }
  }
}

// ---- Types ------------------------------------------------------------------------

///|
let builtin_types : Array[String] = [
  "bool", "s32", "f64", "string", "any", "null", "component",
]

///|
/// The type te names. index<f> is f's key type, and adds `in keys(f)` to
/// extra; fields are the component's field types, for it.
fn Resolver::ty(
  self : Resolver,
  te : @syntax.TypeExpr,
  fields : Map[String, Ty],
  extra : Norm,
) -> Ty {
  match te {
    Named(n) =>
      match n.text {
        "bool" => Bool
        "s32" => S32
        "f64" => F64
        "string" => Str
        "any" => Any
        "null" => Null
        "component" => Comp([])
        name =>
          if self.types.contains(name) {
            Comp([name])
          } else {
            let known = builtin_types.copy()
            known.append(self.types.keys().collect())
            self.error(
              "tcd.type.unknown",
              n.span,
              "no type named \{name}\{did_you_mean(name, known)}",
            )
            Any
          }
      }
    Apply(n, args, span~) => {
      let want = match n.text {
        "option" | "list" | "map" | "index" => 1
        "result" => 2
        "one_of" => -1
        _ => {
          self.error(
            "tcd.type.unknown",
            n.span,
            "no generic type \{n.text}; there are option, list, map, one_of, result and index",
          )
          return Any
        }
      }
      if want > 0 && args.length() != want {
        self.error(
          "tcd.type.arity",
          span,
          "\{n.text} takes \{want} type\{if want == 1 { "" } else { "s" }}, not \{args.length()}",
        )
        return Any
      }
      match n.text {
        "option" => Option(self.ty(args[0], fields, extra))
        "list" => List(self.ty(args[0], fields, extra))
        "map" => Map(self.ty(args[0], fields, extra))
        "result" =>
          Result(
            self.ty(args[0], fields, extra),
            self.ty(args[1], fields, extra),
          )
        "one_of" => {
          if args.length() < 2 {
            self.error("tcd.type.arity", span, "one_of takes two types or more")
          }
          OneOf(args.map(a => self.ty(a, fields, extra)))
        }
        _ => {
          guard args[0] is Named(f) else {
            self.error(
              "tcd.type.index", span, "index takes a field name: index<items>",
            )
            return Any
          }
          match fields.get(f.text).map(unoption) {
            Some(List(_)) => {
              extra.key_of.push(f.text)
              S32
            }
            Some(Map(_)) => {
              extra.key_of.push(f.text)
              Str
            }
            Some(t) => {
              self.error(
                "tcd.type.index",
                f.span,
                "index<\{f.text}> is a key of a list or a map, but \{f.text} is \{ty_text(t)}",
              )
              Any
            }
            None => {
              self.error(
                "tcd.type.index",
                f.span,
                "no field \{f.text} to be an index of\{did_you_mean(f.text, fields.keys().collect())}",
              )
              Any
            }
          }
        }
      }
    }
    Enum(members, ..) => {
      self.unique(members, "an enum member")
      Enum(members.map(m => m.text))
    }
    Record(fs, ..) => {
      self.unique(fs.map(f => f.0), "a record key")
      Record(fs.map(f => (f.0.text, self.ty(f.1, fields, extra))))
    }
  }
}

// ---- Defaults -----------------------------------------------------------------------

///|
/// The value a field of type t starts with when it has no default, or None
/// when t has none (a component, a result).
pub fn type_default(t : Ty) -> Val? {
  match t {
    Bool => Some(VBool(false))
    S32 | F64 => Some(VNum(0.0))
    Str => Some(VStr(""))
    Enum(ms) => Some(VStr(ms[0]))
    Option(_) | Null | Any => Some(VNull)
    List(_) => Some(VList([]))
    Map(_) => Some(VMap([]))
    OneOf(ts) => type_default(ts[0])
    Record(fs) => {
      let out = []
      for f in fs {
        guard type_default(f.1) is Some(v) else { return None }
        out.push((f.0, v))
      }
      Some(VMap(out))
    }
    Comp(_) | Result(_, _) => None
  }
}

///|
/// The value a field of type t with constraints n starts with when it has no
/// default: its type's, with a number's 0 pulled into its bounds, as
/// tutuca's t.number().min(1) starts at 1 (an s32 to the nearest integer
/// inside; an f64 with an exclusive bound past 0 keeps 0, so it has none).
pub fn field_default(t : Ty, n : Norm) -> Val? {
  guard type_default(t) is Some(VNum(zero)) && (t is S32 || t is F64) else {
    return type_default(t)
  }
  let int = t is S32
  let mut v = zero
  if n.lo is Some(lo) && (v < lo.value || (lo.exclusive && v == lo.value)) {
    if !lo.exclusive {
      v = if int { lo.value.ceil() } else { lo.value }
    } else if int {
      v = lo.value.floor() + 1.0
    }
  }
  if n.hi is Some(hi) && (v > hi.value || (hi.exclusive && v == hi.value)) {
    if !hi.exclusive {
      v = if int { hi.value.floor() } else { hi.value }
    } else if int {
      v = hi.value.ceil() - 1.0
    }
  }
  Some(VNum(v))
}

///|
/// Whether a known value is of type t.
pub fn val_fits(v : Val, t : Ty) -> Bool {
  match (v, t) {
    (Unknown, _) | (_, Any) => true
    (VNull, Null | Option(_)) => true
    (_, Option(i)) => val_fits(v, i)
    (VBool(_), Bool) => true
    (VNum(n), S32) => n == n.floor()
    (VNum(_), F64) => true
    (VStr(_), Str) => true
    (VStr(s), Enum(ms)) => ms.contains(s)
    (VList(xs), List(i)) => xs.iter().all(x => val_fits(x, i))
    (VMap(xs), Map(i)) => xs.iter().all(x => val_fits(x.1, i))
    (VMap(xs), Record(fs)) =>
      xs.length() == fs.length() &&
      fs.iter().all(f => xs.iter().any(x => x.0 == f.0 && val_fits(x.1, f.1)))
    (_, OneOf(ts)) => ts.iter().any(t => val_fits(v, t))
    _ => false
  }
}

///|
fn val_lit(v : Val) -> @syntax.Lit? {
  match v {
    VNull => Some(Null)
    VBool(b) => Some(Bool(b))
    VNum(n) => Some(if n == n.floor() { Int(n.to_int64()) } else { Float(n) })
    VStr(s) => Some(Str(s))
    _ => None
  }
}

///|
/// Whether a known value meets n, as far as the tool can tell before running:
/// a key of another field or a pattern can't be known, and a null (an
/// option's) meets everything.
pub fn val_meets(v : Val, n : Norm) -> Bool {
  if v is VNull {
    return true
  }
  if !n.key_of.is_empty() || !n.member_of.is_empty() {
    return false
  }
  let len = match v {
    VStr(s) => Some(s.length())
    VList(xs) => Some(xs.length())
    VMap(xs) => Some(xs.length())
    _ => None
  }
  if len is Some(l) {
    if n.len_lo is Some(lo) && l < lo {
      return false
    }
    if n.len_hi is Some(hi) && l > hi {
      return false
    }
  }
  match val_lit(v) {
    Some(l) => lit_meets(l, n)
    None => true
  }
}

// ---- Fields, messages, hooks ----------------------------------------------------------

///|
fn Resolver::sync(self : Resolver, s : @syntax.Name?) -> SyncLevel {
  match s {
    None => Shared
    Some(n) =>
      match n.text {
        "shared" => Shared
        "local" => Local
        "none" => NoSync
        _ => {
          self.error(
            "tcd.field.sync",
            n.span,
            "a sync level is shared, local or none, not \{n.text}",
          )
          Shared
        }
      }
  }
}

///|
fn merge_norm(into : Norm, extra : Norm) -> Unit {
  into.key_of.append(extra.key_of)
}

///|
fn Resolver::field(
  self : Resolver,
  f : @syntax.Field,
  fields : Map[String, Ty],
  is_get : Bool,
) -> FieldM {
  self.snake(f.name, if is_get { "property" } else { "field" })
  let extra = Norm::new()
  let ty = self.ty(f.ty, fields, extra)
  let norm = normalize(f.where_, f.name.text, ty, fields, self.diags)
  merge_norm(norm, extra)
  let mut required = false
  let mut make = None
  if !is_get {
    match f.default {
      Some(Call(n, [Path([t], ..)], ..)) if n.text == "make" =>
        if !(ty is Comp(_)) {
          self.error(
            "tcd.field.make",
            n.span,
            "make(\{t.text}) makes a component, but \{f.name.text} is \{ty_text(ty)}",
          )
        } else if self.types.get(t.text) is Some("component") {
          make = Some(t.text)
        } else {
          self.error("tcd.field.make", t.span, "no component \{t.text} to make")
        }
      Some(e) => {
        let v = literal_val(e)
        if v is Unknown {
          self.error(
            "tcd.field.default",
            e.span(),
            "a default is a literal (a number, a string, true, false, null, a list or a record of them) or make(component)",
          )
        } else if !val_fits(v, ty) {
          self.error(
            "tcd.field.default",
            e.span(),
            "the default of \{f.name.text}, \{expr_text(e)}, isn't a value of its type, \{ty_text(ty)}",
          )
        } else if !val_meets(v, norm) {
          self.error(
            "tcd.field.default",
            e.span(),
            "the default of \{f.name.text}, \{expr_text(e)}, doesn't meet its constraints: it must be \{norm_text(norm)}",
          )
        }
      }
      None =>
        match field_default(ty, norm) {
          None => required = true
          Some(v) =>
            if !val_meets(v, norm) {
              required = true
              if contradiction(norm, f.name.text) is Some(_) {
                () // reported already: no value at all, let alone a default
              } else {
                self.diags.push(
                  @diag.note(
                    "tcd.field.required",
                    f.name.span,
                    "\{f.name.text} has no default that meets its constraints, so making a component needs it",
                  ),
                )
              }
            }
        }
    }
  }
  {
    name: f.name.text,
    ty,
    norm,
    default: f.default,
    required,
    make,
    sync: self.sync(f.sync),
    doc: f.doc,
    span: f.span,
  }
}

///|
fn Resolver::param(
  self : Resolver,
  p : @syntax.Param,
  fields : Map[String, Ty],
) -> FieldM {
  self.snake(p.name, "argument")
  let extra = Norm::new()
  let ty = self.ty(p.ty, fields, extra)
  let norm = normalize(p.where_, p.name.text, ty, fields, self.diags)
  merge_norm(norm, extra)
  {
    name: p.name.text,
    ty,
    norm,
    default: None,
    required: false,
    make: None,
    sync: Shared,
    doc: None,
    span: p.name.span,
  }
}

///|
fn Resolver::params(
  self : Resolver,
  ps : Array[@syntax.Param],
  fields : Map[String, Ty],
) -> Array[FieldM] {
  self.unique(ps.map(p => p.name), "an argument")
  ps.map(p => self.param(p, fields))
}

///|
fn Resolver::binds(
  self : Resolver,
  bs : Array[(@syntax.Name, @syntax.TypeExpr)],
  fields : Map[String, Ty],
) -> Array[FieldM] {
  self.unique(bs.map(b => b.0), "a bind")
  bs.map(b => {
    self.snake(b.0, "bind")
    {
      name: b.0.text,
      ty: self.ty(b.1, fields, Norm::new()),
      norm: Norm::new(),
      default: None,
      required: false,
      make: None,
      sync: Shared,
      doc: None,
      span: b.0.span,
    }
  })
}

///|
fn Resolver::message(
  self : Resolver,
  m : @syntax.Message,
  fields : Map[String, Ty],
) -> MessageM {
  self.snake(m.name, "message")
  let changes = match m.changes {
    None => None
    Some(names) => {
      for n in names {
        if !fields.contains(n.text) {
          self.error(
            "tcd.message.changes",
            n.span,
            "\{m.name.text} changes \{n.text}, but there's no field \{n.text}\{did_you_mean(n.text, fields.keys().collect())}",
          )
        }
      }
      Some(names.map(n => n.text))
    }
  }
  if m.swap && m.ensures is Some(_) {
    self.error(
      "tcd.message.swap",
      m.name.span,
      "\{m.name.text} may swap its component for another one, so there may be no next state for ensures to talk about (changes says what it may change when it keeps it)",
    )
  }
  {
    name: m.name.text,
    params: self.params(m.params, fields),
    swap: m.swap,
    source_key: m.source_key.map(p => self.param(p, fields)),
    when_: m.when_,
    changes,
    ensures: m.ensures,
    emits: None,
    doc: m.doc,
    span: m.span,
  }
}

///|
fn Resolver::signal(
  self : Resolver,
  s : @syntax.Signal,
  fields : Map[String, Ty],
) -> SignalM {
  self.snake(s.name, "message")
  {
    name: s.name.text,
    params: self.params(s.params, fields),
    result: s.result.map(t => self.ty(t, fields, Norm::new())),
    doc: s.doc,
    span: s.span,
  }
}

///|
/// The field types of members, ignoring index<f> (which needs them).
fn Resolver::field_types(
  self : Resolver,
  members : Array[@syntax.Member],
) -> Map[String, Ty] {
  let scratch = { diags: [], types: self.types, }
  let out : Map[String, Ty] = Map([])
  for m in members {
    if m is Field(f) {
      out[f.name.text] = scratch.ty(f.ty, {}, Norm::new())
    }
  }
  out
}

///|
fn member_names(
  members : Array[@syntax.Member],
) -> Array[(String, @syntax.Name)] {
  let out = []
  for m in members {
    match m {
      Field(f) => out.push(("a field or property", f.name))
      Get(f) => out.push(("a field or property", f.name))
      Message(msg) => out.push(("a message", msg.name))
      Notify(s) => out.push(("a notify", s.name))
      Ask(s) => out.push(("an ask", s.name))
      Invariant(i) => out.push(("an invariant", i.name))
      Loop(l) => out.push(("a loop", l.name))
      Scope(s) => out.push(("a scope", s.name))
      Provide(p) => out.push(("a provided value", p.name))
      View(v) => out.push(("a view", v.name))
      Init(_) => ()
    }
  }
  out
}

///|
fn Resolver::check_unique_members(
  self : Resolver,
  members : Array[@syntax.Member],
) -> Unit {
  let groups : Map[String, Array[@syntax.Name]] = Map([])
  for p in member_names(members) {
    match groups.get(p.0) {
      Some(a) => a.push(p.1)
      None => groups[p.0] = [p.1]
    }
  }
  for what, names in groups {
    self.unique(names, what)
  }
}

///|
fn Resolver::interface_decl(
  self : Resolver,
  d : @syntax.Decl,
  here : Bool,
) -> InterfaceM {
  self.snake(d.name, "interface")
  self.check_unique_members(d.members)
  let ftys = self.field_types(d.members)
  let fields = []
  let gets = []
  let messages = []
  let notifies = []
  for m in d.members {
    match m {
      Field(f) => fields.push(self.field(f, ftys, false))
      Get(f) => gets.push(self.field(f, ftys, true))
      Message(msg) => messages.push(self.message(msg, ftys))
      Notify(s) => notifies.push(self.signal(s, ftys))
      other =>
        self.error(
          "tcd.interface.member",
          member_span(other),
          "an interface declares fields, properties, messages and notifies; the rest belongs to the components implementing it",
        )
    }
  }
  {
    name: d.name.text,
    fields,
    gets,
    messages,
    notifies,
    declared_here: here,
    doc: d.doc,
    span: d.span,
  }
}

///|
fn member_span(m : @syntax.Member) -> @diag.Span {
  match m {
    Field(f) | Get(f) => f.span
    Message(msg) => msg.span
    Notify(s) | Ask(s) => s.span
    Invariant(i) => i.span
    Init(span) => span
    Loop(l) => l.span
    Scope(s) => s.span
    Provide(p) => p.span
    View(v) => v.span
  }
}

///|
fn Resolver::component_decl(self : Resolver, d : @syntax.Decl) -> ComponentM {
  self.snake(d.name, "component")
  self.check_unique_members(d.members)
  let ftys = self.field_types(d.members)
  let fields = []
  let gets = []
  let messages = []
  let notifies = []
  let asks = []
  let invariants = []
  let mut init_hook = false
  let loops = []
  let scopes = []
  let provides = []
  let views = []
  for m in d.members {
    match m {
      Field(f) => fields.push(self.field(f, ftys, false))
      Get(f) => gets.push(self.field(f, ftys, true))
      Message(msg) => messages.push(self.message(msg, ftys))
      Notify(s) => notifies.push(self.signal(s, ftys))
      Ask(s) => asks.push(self.signal(s, ftys))
      Invariant(i) => {
        self.snake(i.name, "invariant")
        invariants.push({
          name: i.name.text,
          cond: i.cond,
          doc: i.doc,
          span: i.span,
        })
      }
      Init(_) => init_hook = true
      Loop(l) => {
        self.snake(l.name, "loop")
        loops.push({
          name: l.name.text,
          prepare: l.prepare.map(t => self.ty(t, ftys, Norm::new())),
          iter: l.iter,
          key: l.key.map(t => self.ty(t, ftys, Norm::new())),
          filter: l.filter,
          enrich: l.enrich.map(bs => self.binds(bs, ftys)),
          view: l.view.map(v => v.text),
          span: l.span,
        })
      }
      Scope(s) => {
        self.snake(s.name, "scope")
        scopes.push({
          name: s.name.text,
          binds: self.binds(s.binds, ftys),
          span: s.span,
        })
      }
      Provide(p) => {
        self.snake(p.name, "provided value")
        match p.source {
          Call({ text: "field", .. }, [], [Name(f)], ..) => {
            if !ftys.contains(f.text) {
              self.error(
                "tcd.provide.field",
                f.span,
                "no field \{f.text} to provide\{did_you_mean(f.text, ftys.keys().collect())}",
              )
            }
            provides.push({ name: p.name.text, field: f.text, span: p.span, })
          }
          other =>
            self.error(
              "tcd.provide.source",
              other.span(),
              "a component provides one of its fields: provide \{p.name.text} = field(name)",
            )
        }
      }
      View(v) => {
        self.snake(v.name, "view")
        views.push({
          name: v.name.text,
          body: v.body,
          doc: v.doc,
          span: v.span,
        })
      }
    }
  }
  if !views.iter().any(v => v.name == "main") {
    self.error(
      "tcd.view.main",
      d.name.span,
      "\{d.name.text} has no main view: every component renders one",
      hint="add view main = ...;",
    )
  }
  {
    name: d.name.text,
    implements: d.implements.map(n => n.text),
    fields,
    gets,
    messages,
    notifies,
    asks,
    invariants,
    init_hook,
    loops,
    scopes,
    provides,
    views,
    checks: [],
    doc: d.doc,
    span: d.span,
  }
}

// ---- Phase 2 ------------------------------------------------------------------------------

///|
fn Resolver::emits(
  self : Resolver,
  pkg : Package,
  c : ComponentM,
  m : @syntax.Message,
) -> Array[EmitM]? {
  guard m.emits is Some(emits) else { return None }
  let out = []
  for e in emits {
    let first = e.target[0]
    match (e.kind, e.target) {
      (Notify, [n]) => {
        if !c.notifies.iter().any(s => s.name == n.text) {
          self.error(
            "tcd.emits.notify",
            n.span,
            "\{c.name} doesn't declare notify \{n.text}\{did_you_mean(n.text, c.notifies.map(s => s.name))}",
            hint="declare it: notify \{n.text}(...);",
          )
        }
        out.push({ kind: Notify, name: n.text, target: None, })
      }
      (Ask, [n]) => {
        if !c.asks.iter().any(s => s.name == n.text) {
          self.error(
            "tcd.emits.ask",
            n.span,
            "\{c.name} doesn't declare ask \{n.text}\{did_you_mean(n.text, c.asks.map(s => s.name))}",
            hint="declare it: ask \{n.text}(...) -> type;",
          )
        }
        out.push({ kind: Ask, name: n.text, target: None, })
      }
      (Send, [t, msg]) => {
        let messages = match pkg.component(t.text) {
          Some(target) => Some(target.messages.map(x => x.name))
          None =>
            pkg.interface_named(t.text).map(i => i.messages.map(x => x.name))
        }
        match messages {
          None =>
            self.error(
              "tcd.emits.send",
              t.span,
              "no component or interface \{t.text} to send to",
            )
          Some(names) =>
            if !names.contains(msg.text) {
              self.error(
                "tcd.emits.send",
                msg.span,
                "\{t.text} has no message \{msg.text}\{did_you_mean(msg.text, names)}",
              )
            }
        }
        out.push({ kind: SendAt, name: msg.text, target: Some(t.text), })
      }
      (Make, [t]) => {
        if !self.types.contains(t.text) {
          self.error(
            "tcd.emits.make",
            t.span,
            "no component or interface \{t.text} to make",
          )
        }
        out.push({ kind: Make, name: t.text, target: None, })
      }
      _ =>
        self.error(
          "tcd.emits.shape",
          first.span,
          "an emit names one thing (notify x, ask x, make type) or a message of a type (send type.message)",
        )
    }
  }
  Some(out)
}

///|
/// The `next.f` an ensures reads, and whether it only says next.f == f.
fn next_reads(e : @syntax.Expr, out : Array[(@syntax.Name, Bool)]) -> Unit {
  match e {
    Bin(Eq, Path([nx, f], ..), Path([g], ..), ..) if nx.text == "next" &&
      f.text == g.text => out.push((f, true))
    Path(parts, ..) =>
      if parts.length() >= 2 && parts[0].text == "next" {
        out.push((parts[1], false))
      }
    Call(_, args, ..) => args.each(a => next_reads(a, out))
    List(items, ..) => items.each(i => next_reads(i, out))
    Record(entries, ..) => entries.each(en => next_reads(en.1, out))
    Not(inner, ..) | Matches(inner, _, ..) => next_reads(inner, out)
    Bin(_, l, r, ..) => {
      next_reads(l, out)
      next_reads(r, out)
    }
    Lit(_, ..) => ()
  }
}

///|
/// Whether the guard can hold given the fields' constraints: the atoms of
/// when about one field alone, against what the field allows.
fn Resolver::guard_satisfiable(
  self : Resolver,
  c : ComponentM,
  m : MessageM,
) -> Unit {
  guard m.when_ is Some(w) else { return }
  let atoms = []
  split_and(w, atoms)
  let by_field : Map[String, Array[@syntax.Expr]] = Map([])
  for a in atoms {
    let names = []
    names_in(a, names)
    let distinct = []
    for n in names {
      if !distinct.contains(n) {
        distinct.push(n)
      }
    }
    if distinct is [f] &&
      c.field(f) is Some(_) &&
      !m.params.iter().any(p => p.name == f) {
      match by_field.get(f) {
        Some(xs) => xs.push(a)
        None => by_field[f] = [a]
      }
    }
  }
  let ftys : Map[String, Ty] = Map([])
  for f in c.fields {
    ftys[f.name] = f.ty
  }
  for f, xs in by_field {
    let field = c.field(f).unwrap()
    let scratch = []
    let mut cond = xs[0]
    for x in xs[1:] {
      cond = Bin(And, cond, x, span=cond.span().merge(x.span()))
    }
    let g = normalize(Some(cond), f, field.ty, ftys, scratch)
    if @diag.has_errors(scratch) {
      continue // not about this field alone in a way the tool can reason with
    }
    let both = combine(field.norm, g)
    if contradiction(both, f) is Some(why) {
      self.diags.push(
        @diag.error(
          "tcd.message.never",
          w.span(),
          "\{m.name} can never run: its when needs \{expr_text(cond)}, but \{f} must be \{norm_text(field.norm)}, so \{why}",
          related=[{ span: field.span, message: "\{f}'s constraints", }],
        ),
      )
    }
  }
}

///|
fn names_in(e : @syntax.Expr, out : Array[String]) -> Unit {
  match e {
    Path(parts, ..) => out.push(parts[0].text)
    Call({ text: "keys" | "values", .. }, _, ..) => out.push("")
    Call(_, args, ..) => args.each(a => names_in(a, out))
    List(items, ..) => items.each(i => names_in(i, out))
    Record(entries, ..) => entries.each(en => names_in(en.1, out))
    Not(inner, ..) | Matches(inner, _, ..) => names_in(inner, out)
    Bin(_, l, r, ..) => {
      names_in(l, out)
      names_in(r, out)
    }
    Lit(_, ..) => ()
  }
}

///|
/// Both normal forms at once: the tighter bounds, the common values.
fn combine(a : Norm, b : Norm) -> Norm {
  let n = Norm::new()
  n.lo = match (a.lo, b.lo) {
    (Some(x), Some(y)) => Some(if tighter_lo(x, y) { x } else { y })
    (x, None) => x
    (None, y) => y
  }
  n.hi = match (a.hi, b.hi) {
    (Some(x), Some(y)) => Some(if tighter_hi(x, y) { x } else { y })
    (x, None) => x
    (None, y) => y
  }
  n.len_lo = match (a.len_lo, b.len_lo) {
    (Some(x), Some(y)) => Some(@cmp.maximum(x, y))
    (x, None) => x
    (None, y) => y
  }
  n.len_hi = match (a.len_hi, b.len_hi) {
    (Some(x), Some(y)) => Some(@cmp.minimum(x, y))
    (x, None) => x
    (None, y) => y
  }
  n.one_of = match (a.one_of, b.one_of) {
    (Some(x), y) => Some(intersect(y, x))
    (None, y) => y
  }
  n.none_of.append(a.none_of)
  n.none_of.append(b.none_of)
  n
}

///|
/// A `make(name)` default makes a component of the field's type, and with no
/// fields, so the component it names can't need any.
fn Resolver::make_defaults(
  self : Resolver,
  pkg : Package,
  c : ComponentM,
) -> Unit {
  for f in c.fields {
    guard f.make is Some(name) && pkg.component(name) is Some(made) else {
      continue
    }
    guard f.ty is Comp(ns) else { continue }
    if !ns.is_empty() &&
      !ns.iter().any(n => n == name || made.implements.contains(n)) {
      self.error(
        "tcd.field.make",
        f.span,
        "make(\{name}) isn't a \{ty_text(f.ty)}, the type of \{f.name}",
      )
    }
    for g in made.fields {
      if g.required {
        self.error(
          "tcd.field.make",
          f.span,
          "make(\{name}) makes it with no fields, but \{name} needs \{g.name}",
        )
      }
    }
  }
}

///|
/// The values of a component's fields when it's made with no arguments.
fn initial_env(c : ComponentM) -> Map[String, Val] {
  let env : Map[String, Val] = Map([])
  for f in c.fields {
    env[f.name] = match f.default {
      Some(e) => literal_val(e)
      None =>
        if f.required {
          Unknown
        } else {
          field_default(f.ty, f.norm).unwrap_or(Unknown)
        }
    }
  }
  for g in c.gets {
    env[g.name] = Unknown
  }
  env
}

///|
fn Resolver::conditions(
  self : Resolver,
  pkg : Package,
  c : ComponentM,
  decl : @syntax.Decl,
) -> ComponentM {
  let checks : Array[String] = []
  let messages = []
  for i, m in c.messages {
    guard decl.members
      .iter()
      .find_first(x => x is Message(y) && y.name.text == m.name)
      is Some(Message(src)) else {
      messages.push(m)
      continue
    }
    let env = {
      pkg,
      comp: c,
      params: m.params,
      allow_next: false,
      it: None,
      what: "the when of \{m.name}",
      diags: self.diags,
      checks,
    }
    if m.when_ is Some(w) {
      env.condition(w)
    }
    if m.ensures is Some(e) {
      { ..env, allow_next: true, what: "the ensures of \{m.name}", }.condition(
        e,
      )
      if m.changes is Some(changes) {
        let reads = []
        next_reads(e, reads)
        for r in reads {
          if !changes.contains(r.0.text) && !r.1 {
            self.error(
              "tcd.message.ensures_changes",
              r.0.span,
              "the ensures of \{m.name} says how next.\{r.0.text} relates to the state, but \{m.name} doesn't change \{r.0.text}",
              hint="add \{r.0.text} to its changes, or say next.\{r.0.text} == \{r.0.text}",
            )
          }
        }
      }
    }
    self.guard_satisfiable(c, m)
    messages.push({ ..m, emits: self.emits(pkg, c, src), })
    ignore(i)
  }
  let init = initial_env(c)
  for inv in c.invariants {
    let env = {
      pkg,
      comp: c,
      params: [],
      allow_next: false,
      it: None,
      what: "the invariant \{inv.name}",
      diags: self.diags,
      checks,
    }
    env.condition(inv.cond)
    if eval(inv.cond, init) is VBool(false) {
      self.error(
        "tcd.invariant.initial",
        inv.span,
        "the invariant \{inv.name} doesn't hold for a \{c.name} made with its defaults",
      )
    }
  }
  // check(p) in where clauses: a predicate over the value constrained.
  let all_checks : Array[(String, Ty?)] = []
  let add = (name : String, t : Ty?) => {
    if !all_checks.iter().any(x => x.0 == name) {
      all_checks.push((name, t))
    }
  }
  for f in c.fields {
    for p in f.norm.checks {
      add(p, Some(f.ty))
    }
  }
  for g in c.gets {
    for p in g.norm.checks {
      add(p, Some(g.ty))
    }
  }
  for m in c.messages {
    for a in m.params {
      for p in a.norm.checks {
        add(p, Some(a.ty))
      }
    }
  }
  for p in checks {
    add(p, None)
  }
  { ..c, messages, checks: all_checks, }
}

///|
fn ty_eq_for_interface(a : Ty, b : Ty) -> Bool {
  a == b
}

///|
fn Resolver::implements(
  self : Resolver,
  pkg : Package,
  c : ComponentM,
  decl : @syntax.Decl,
) -> Unit {
  for n in decl.implements {
    guard pkg.interface_named(n.text) is Some(iface) else {
      self.error(
        "tcd.interface.unknown",
        n.span,
        "no interface \{n.text}\{did_you_mean(n.text, pkg.interfaces.map(i => i.name))}",
        hint="declare it, or use it from the file that does: use \"file.tcd\".{ \{n.text} };",
      )
      continue
    }
    let want = iface.fields.copy()
    want.append(iface.gets)
    for f in want {
      match c.property(f.name) {
        None =>
          self.error(
            "tcd.interface.missing",
            decl.name.span,
            "\{c.name} implements \{iface.name}, but has no field or property \{f.name}",
            hint="add it: field \{f.name}: \{ty_text(f.ty)};",
          )
        Some(have) =>
          if !ty_eq_for_interface(have.ty, f.ty) {
            self.diags.push(
              @diag.error(
                "tcd.interface.type",
                have.span,
                "\{c.name}'s \{f.name} is \{ty_text(have.ty)}, but \{iface.name}'s is \{ty_text(f.ty)}",
                related=[
                  { span: f.span, message: "\{iface.name}'s \{f.name}", },
                ],
              ),
            )
          }
      }
    }
    for m in iface.messages {
      match c.message(m.name) {
        None =>
          self.error(
            "tcd.interface.missing",
            decl.name.span,
            "\{c.name} implements \{iface.name}, but has no message \{m.name}",
          )
        Some(have) =>
          if have.params.map(p => p.ty) != m.params.map(p => p.ty) {
            self.diags.push(
              @diag.error(
                "tcd.interface.type",
                have.span,
                "\{c.name}'s \{m.name} takes (\{have.params.map(p => ty_text(p.ty)).join(", ")}), but \{iface.name}'s takes (\{m.params.map(p => ty_text(p.ty)).join(", ")})",
                related=[
                  { span: m.span, message: "\{iface.name}'s \{m.name}", },
                ],
              ),
            )
          }
      }
    }
    for s in iface.notifies {
      if !c.notifies.iter().any(x => x.name == s.name) {
        self.error(
          "tcd.interface.missing",
          decl.name.span,
          "\{c.name} implements \{iface.name}, but doesn't declare notify \{s.name}",
        )
      }
    }
  }
}

///|
fn Resolver::example(
  self : Resolver,
  pkg : Package,
  ex : @syntax.Example,
) -> ExampleM? {
  guard pkg.component(ex.component.text) is Some(c) else {
    self.error(
      "tcd.example.component",
      ex.component.span,
      "no component \{ex.component.text}\{did_you_mean(ex.component.text, pkg.components.map(c => c.name))}",
    )
    return None
  }
  for s in ex.start {
    match c.field(s.0.text) {
      None =>
        self.error(
          "tcd.example.field",
          s.0.span,
          "\{c.name} has no field \{s.0.text}\{did_you_mean(s.0.text, c.fields.map(f => f.name))}",
        )
      Some(f) => {
        let v = literal_val(s.1)
        if !val_fits(v, f.ty) {
          self.error(
            "tcd.example.value",
            s.1.span(),
            "\{expr_text(s.1)} isn't a value of \{f.name}'s type, \{ty_text(f.ty)}",
          )
        }
      }
    }
  }
  let steps = []
  for step in ex.steps {
    match step {
      Send(m, args, span~) => {
        match c.message(m.text) {
          None =>
            self.error(
              "tcd.example.message",
              m.span,
              "\{c.name} has no message \{m.text}\{did_you_mean(m.text, c.messages.map(x => x.name))}",
            )
          Some(msg) =>
            if msg.params.length() != args.length() {
              self.error(
                "tcd.example.arity",
                span,
                "\{m.text} takes \{msg.params.length()} arguments, not \{args.length()}",
              )
            } else {
              for i, a in args {
                let v = literal_val(a)
                if v is Unknown || !val_fits(v, msg.params[i].ty) {
                  self.error(
                    "tcd.example.value",
                    a.span(),
                    "\{expr_text(a)} isn't a literal of \{msg.params[i].name}'s type, \{ty_text(msg.params[i].ty)}",
                  )
                }
              }
            }
        }
        steps.push(StepM::Send(m.text, args))
      }
      Expect(cond, ..) => {
        let env = {
          pkg,
          comp: c,
          params: [],
          allow_next: false,
          it: None,
          what: "the example \{ex.name.text}",
          diags: self.diags,
          checks: [],
        }
        env.condition(cond)
        steps.push(Expect(cond))
      }
    }
  }
  Some({
    name: ex.name.text,
    component: c.name,
    start: ex.start.map(s => (s.0.text, s.1)),
    steps,
    span: ex.span,
  })
}

///|
/// The package's name, snake_case: the segment between `:` and `@` of
/// `ns:name@version`, or the file's name.
fn package_name(f : @syntax.File) -> (String, String) {
  match f.package_decl {
    Some((full, _)) => {
      let after = match full.find(":") {
        Some(i) => full.unsafe_substring(start=i + 1, end=full.length())
        None => full
      }
      let name = match after.find("@") {
        Some(i) => after.unsafe_substring(start=0, end=i)
        None => after
      }
      (full, name.replace_all(old="-", new="_"))
    }
    None => {
      let base = match f.path.rev_find("/") {
        Some(i) => f.path.unsafe_substring(start=i + 1, end=f.path.length())
        None => f.path
      }
      let name = match base.find(".") {
        Some(i) => base.unsafe_substring(start=0, end=i)
        None => base
      }
      (name, name)
    }
  }
}

///|
/// Resolves and checks a TCD file; used are the files its `use` items name,
/// parsed, by path as written.
pub fn check(
  file : @syntax.File,
  used : Map[String, @syntax.File],
) -> (Package, Array[@diag.Diagnostic]) {
  let r = { diags: [], types: {}, }
  let (full_name, name) = package_name(file)
  // The interfaces used from other files.
  let used_ifaces : Array[@syntax.Decl] = []
  for u in file.uses {
    guard used.get(u.path) is Some(other) else {
      r.error("tcd.use.file", u.span, "can't read \{u.path}")
      continue
    }
    for n in u.names {
      let found = other.items
        .iter()
        .find_first(i => i is Interface(d) && d.name.text == n.text)
      match found {
        Some(Interface(d)) => used_ifaces.push(d)
        _ =>
          r.error(
            "tcd.use.name",
            n.span,
            "\{u.path} declares no interface \{n.text}",
          )
      }
    }
  }
  let comp_decls = []
  let iface_decls = []
  for item in file.items {
    match item {
      Component(d) => comp_decls.push(d)
      Interface(d) => iface_decls.push(d)
      _ => ()
    }
  }
  let all_names = comp_decls.map(d => d.name)
  r.unique(all_names, "a component")
  let iface_names = iface_decls.map(d => d.name)
  iface_names.append(used_ifaces.map(d => d.name))
  r.unique(iface_names, "an interface")
  for d in used_ifaces {
    r.types[d.name.text] = "interface"
  }
  for d in iface_decls {
    r.types[d.name.text] = "interface"
  }
  for d in comp_decls {
    r.types[d.name.text] = "component"
  }
  // Phase 1.
  let interfaces = used_ifaces.map(d => r.interface_decl(d, false))
  interfaces.append(iface_decls.map(d => r.interface_decl(d, true)))
  let components = comp_decls.map(d => r.component_decl(d))
  let registers = []
  let ask_handlers = []
  let host_asks = []
  let mut registered = false
  for item in file.items {
    match item {
      Register(regs, ..) => {
        registered = true
        for reg in regs {
          if !comp_decls.iter().any(d => d.name.text == reg.name.text) {
            r.error(
              "tcd.register.unknown",
              reg.name.span,
              "no component \{reg.name.text} to register\{did_you_mean(reg.name.text, comp_decls.map(d => d.name.text))}",
            )
          }
          registers.push({
            component: reg.name.text,
            as_: reg.as_.map(a => a.text).unwrap_or(reg.name.text),
          })
        }
      }
      AskHandler(s) => ask_handlers.push(r.signal(s, {}))
      HostAsk(n) => {
        r.snake(n, "ask")
        host_asks.push(n.text)
      }
      _ => ()
    }
  }
  if !registered {
    for d in comp_decls {
      registers.push({ component: d.name.text, as_: d.name.text, })
    }
  }
  let seen_as : Map[String, Bool] = Map([])
  for reg in registers {
    if seen_as.contains(reg.as_) {
      r.error(
        "tcd.register.duplicate",
        file.package_decl.map(p => p.1).unwrap_or(@diag.Span::none(file.path)),
        "two components are registered as \{reg.as_}",
      )
    }
    seen_as[reg.as_] = true
  }
  let pkg = {
    full_name,
    name,
    components,
    interfaces,
    registers,
    ask_handlers,
    host_asks,
    examples: [],
  }
  // Phase 2.
  let components = components.mapi((i, c) => r.conditions(pkg, c, comp_decls[i]))
  let pkg = { ..pkg, components, }
  for i, c in pkg.components {
    r.make_defaults(pkg, c)
    r.implements(pkg, c, comp_decls[i])
    check_views(pkg, c, r.diags)
  }
  let examples = []
  for item in file.items {
    if item is Example(ex) && r.example(pkg, ex) is Some(e) {
      examples.push(e)
    }
  }
  ({ ..pkg, examples, }, r.diags)
}
