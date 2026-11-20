// What a built model must meet across its parts: defaults of their types and
// constraints, what a message changes and emits, the interfaces a component
// implements, metas against their schemas, views, registers and examples.

// ---- Defaults ---------------------------------------------------------------------

///|
/// The value a field of type t starts with when it has no default, or None
/// when t has none (a component).
pub fn type_default(t : Ty) -> Val? {
  match t {
    Bool => Some(VBool(false))
    F64 => Some(VNum(0.0))
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
    Comp(_) => None
  }
}

///|
/// The value a field of type t with constraints n starts with when it has no
/// default: its type's, with a number's 0 pulled into its bounds, as
/// tutuca's t.number({ min: 1 }) starts at 1 (a whole number to the nearest
/// one inside).
pub fn field_default(t : Ty, n : Norm) -> Val? {
  guard type_default(t) is Some(VNum(zero)) && t is F64 else {
    return type_default(t)
  }
  let int = n.int
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
    (VNum(_), F64) => true
    (VStr(_), Str) => true
    (VStr(s), Enum(ms)) => ms.contains(s)
    (VList(xs), List(i)) => xs.iter().all(x => val_fits(x, i))
    (VMap(xs), Map(i)) => xs.iter().all(x => val_fits(x.1, i))
    (VMap(xs), Record(fs)) =>
      xs.iter().all(x => fs.iter().any(f => f.0 == x.0 && val_fits(x.1, f.1))) &&
      fs.iter().all(f => f.1 is Option(_) || xs.iter().any(x => x.0 == f.0))
    (_, OneOf(ts)) => ts.iter().any(t => val_fits(v, t))
    _ => false
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
  if !n.key_of.is_empty() {
    return false
  }
  if v is VNum(x) {
    if n.int && x != x.floor() {
      return false
    }
    if n.lo is Some(b) && (x < b.value || (b.exclusive && x == b.value)) {
      return false
    }
    if n.hi is Some(b) && (x > b.value || (b.exclusive && x == b.value)) {
      return false
    }
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
  true
}

///|
/// Whether a field with no default needs one: no value of its type meets its
/// constraints (a component is made, when its type names one).
pub fn needs_value(ty : Ty, norm : Norm) -> Bool {
  match field_default(ty, norm) {
    None => true
    Some(v) => !val_meets(v, norm)
  }
}

// ---- The checks --------------------------------------------------------------------

///|
priv struct Validator {
  pkg : Package
  diags : Array[@diag.Diagnostic]
}

///|
fn Validator::error(
  self : Validator,
  code : String,
  span : @diag.Span,
  msg : String,
  hint? : String,
) -> Unit {
  self.diags.push(@diag.error(code, span, msg, hint?))
}

///|
/// Whether uri is absolute: a scheme (a letter, then letters, digits, +, -
/// or .), a colon and something after it.
fn is_absolute_uri(uri : String) -> Bool {
  guard uri.find(":") is Some(colon) && colon > 0 && colon < uri.length() - 1 else {
    return false
  }
  for i in 0..<colon {
    let c = uri.unsafe_get(i).to_int()
    let letter = (c >= 'a'.to_int() && c <= 'z'.to_int()) ||
      (c >= 'A'.to_int() && c <= 'Z'.to_int())
    let other = (c >= '0'.to_int() && c <= '9'.to_int()) ||
      c == '+'.to_int() ||
      c == '-'.to_int() ||
      c == '.'.to_int()
    if !(letter || (i > 0 && other)) {
      return false
    }
  }
  true
}

///|
fn Validator::field(self : Validator, owner : String, f : FieldM) -> Unit {
  if contradiction(f.norm) is Some(why) {
    self.error(
      "pure-tutuca.field.never",
      f.span,
      "\{owner}.\{f.name} can never be valid: \{why}",
    )
    return
  }
  match f.default {
    Some(v) =>
      if !val_fits(v, f.ty) {
        self.error(
          "pure-tutuca.field.default",
          f.span,
          "the default of \{f.name}, \{val_text(v)}, isn't a value of its type, \{ty_text(f.ty)}",
        )
      } else if !val_meets(v, f.norm) {
        self.error(
          "pure-tutuca.field.default",
          f.span,
          "the default of \{f.name}, \{val_text(v)}, doesn't meet its constraints: it must be \{norm_text(f.norm)}",
        )
      }
    None => ()
  }
}

///|
/// A field made as the component its type names, when it isn't given, is
/// made with no fields: that component can't need any.
fn Validator::make_defaults(self : Validator, c : ComponentM) -> Unit {
  for f in c.fields {
    guard f.make is Some(name) && self.pkg.component(name) is Some(made) else {
      continue
    }
    for g in made.fields {
      if g.required && g.make is None {
        self.error(
          "pure-tutuca.field.make",
          f.span,
          "\{c.name}.\{f.name} is made as a \{name} when it isn't given, with no fields, but \{name} needs \{g.name}",
        )
      }
    }
  }
}

///|
fn Validator::emits(
  self : Validator,
  c : ComponentM,
  what : String,
  emits : Array[EmitM]?,
) -> Unit {
  guard emits is Some(emits) else { return }
  for e in emits {
    match e.kind {
      Notify =>
        if !c.notifies.iter().any(s => s.name == e.name) {
          self.error(
            "pure-tutuca.emits.notify",
            e.span,
            "\{what} notifies \{e.name}, but \{c.name}Notifies has no \{e.name}\{did_you_mean(e.name, c.notifies.map(s => s.name))}",
            hint="declare it: export interface \{c.name}Notifies { \{e.name}(...): void }",
          )
        }
      Ask =>
        if !c.asks.iter().any(s => s.name == e.name) {
          self.error(
            "pure-tutuca.emits.ask",
            e.span,
            "\{what} asks \{e.name}, but \{c.name}Asks has no \{e.name}\{did_you_mean(e.name, c.asks.map(s => s.name))}",
            hint="declare it: export interface \{c.name}Asks { \{e.name}(...): T }",
          )
        }
      SendAt => {
        let target = e.target.unwrap_or("")
        let messages = match self.pkg.component(target) {
          Some(t) => Some(t.messages.map(x => x.name))
          None =>
            self.pkg
            .interface_named(target)
            .map(i => i.messages.map(x => x.name))
        }
        match messages {
          None =>
            self.error(
              "pure-tutuca.emits.send",
              e.span,
              "no component or interface \{target} to send to",
            )
          Some(names) =>
            if !names.contains(e.name) {
              self.error(
                "pure-tutuca.emits.send",
                e.span,
                "\{target} has no message \{e.name}\{did_you_mean(e.name, names)}",
              )
            }
        }
      }
      Make =>
        if self.pkg.component(e.name) is None &&
          self.pkg.interface_named(e.name) is None {
          self.error(
            "pure-tutuca.emits.make",
            e.span,
            "no component or interface \{e.name} to make",
          )
        }
      Reply => ()
    }
  }
}

///|
fn Validator::message(self : Validator, c : ComponentM, m : MessageM) -> Unit {
  let fields = c.fields.map(f => f.name)
  for n in m.changes.unwrap_or([]) {
    if !fields.contains(n) {
      self.error(
        "pure-tutuca.message.changes",
        m.span,
        "\{m.name} changes \{n}, but there's no field \{n}\{did_you_mean(n, fields)}",
      )
    }
  }
  if m.pure_ && m.source_key is Some(_) {
    self.error(
      "pure-tutuca.pure.source_key",
      m.span,
      "\{m.name} is pure, so it's applied without a context, where no child key arrives",
    )
  }
  if m.pure_ && m.emits is Some(es) && !es.is_empty() {
    self.error(
      "pure-tutuca.pure.emits",
      m.span,
      "\{m.name} is pure: it changes its own state and emits nothing",
      hint="drop pure, or what it emits",
    )
  }
  for p in m.params {
    for f in p.norm.key_of {
      if !fields.contains(f) {
        self.error(
          "pure-tutuca.type.index",
          p.span,
          "\{m.name}'s \{p.name} is a key of \{f}, but there's no field \{f}\{did_you_mean(f, fields)}",
        )
      }
    }
  }
  self.emits(c, m.name, m.emits)
}

///|
fn Validator::metas(self : Validator, c : ComponentM) -> Unit {
  for i, m in c.metas {
    if !is_absolute_uri(m.uri) {
      self.error(
        "pure-tutuca.meta.uri",
        m.span,
        "a meta's key is an absolute URI, so conventions don't clash, not \"\{m.uri}\"",
        hint="like meta: { \"https://tutuca.dev/meta/canvas\": { ... } }",
      )
    }
    if c.metas[:i].iter().any(o => o.uri == m.uri) {
      self.error(
        "pure-tutuca.meta.duplicate",
        m.span,
        "\"\{m.uri}\" is given twice: one meta per URI",
      )
    }
    guard m.value is VMap(entries) else {
      self.error(
        "pure-tutuca.meta.record",
        m.span,
        "a meta is a record of what it says: { key: value, ... }",
      )
      continue
    }
    guard self.pkg.meta_schema_for(m.uri) is Some(schema) else { continue }
    for kv in entries {
      let (key, v) = kv
      match schema.fields.iter().find_first(f => f.name == key) {
        None =>
          self.error(
            "pure-tutuca.meta.key",
            m.span,
            "\{schema.name} (\{m.uri}) has no key \{key}\{did_you_mean(key, schema.fields.map(f => f.name))}",
          )
        Some(f) =>
          if !val_fits(v, f.ty) {
            self.error(
              "pure-tutuca.meta.value",
              m.span,
              "\{key} is \{ty_text(f.ty)} in \{schema.name}, not \{val_text(v)}",
            )
          } else if !val_meets(v, f.norm) {
            self.error(
              "pure-tutuca.meta.value",
              m.span,
              "\{key}, \{val_text(v)}, must be \{norm_text(f.norm)} in \{schema.name}",
            )
          }
      }
    }
    for f in schema.fields {
      if f.required && !entries.iter().any(kv => kv.0 == f.name) {
        self.error(
          "pure-tutuca.meta.required",
          m.span,
          "\{schema.name} (\{m.uri}) needs \{f.name}, which has no default",
        )
      }
    }
  }
}

///|
/// Each render target's views (the page's too) have a main one.
fn Validator::views(self : Validator, c : ComponentM) -> Unit {
  let targets : Array[String?] = []
  for v in c.views {
    if !targets.contains(v.target) {
      targets.push(v.target)
    }
  }
  for t in targets {
    if !c.views.iter().any(v => v.target == t && v.name == "main") {
      match t {
        None =>
          self.error(
            "pure-tutuca.view.main",
            c.span,
            "\{c.name} has views but no main one, which renders it where no view is asked for",
            hint="add view: ...",
          )
        Some(target) =>
          self.error(
            "pure-tutuca.view.main",
            c.span,
            "\{c.name} renders \{target} but has no main view for it",
            hint="renders: { \{target}: { main: ... } }",
          )
      }
    }
  }
  check_views(self.pkg, c, self.diags)
}

///|
fn Validator::implements(self : Validator, c : ComponentM) -> Unit {
  for name in c.implements {
    guard self.pkg.interface_named(name) is Some(iface) else {
      self.error(
        "pure-tutuca.interface.unknown",
        c.span,
        "no interface \{name}\{did_you_mean(name, self.pkg.interfaces.map(i => i.name))}",
        hint="declare it, or import it from the module that does: import type { \{name} } from \"./module.tutuca\";",
      )
      continue
    }
    let want = iface.fields.copy()
    want.append(iface.gets)
    for f in want {
      match c.property(f.name) {
        None =>
          self.error(
            "pure-tutuca.interface.missing",
            c.span,
            "\{c.name} implements \{iface.name}, but has no field or query \{f.name}",
          )
        Some(have) =>
          if have.ty != f.ty {
            self.diags.push(
              @diag.error(
                "pure-tutuca.interface.type",
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
            "pure-tutuca.interface.missing",
            c.span,
            "\{c.name} implements \{iface.name}, but has no message \{m.name}",
          )
        Some(have) =>
          if m.pure_ && !have.pure_ {
            self.diags.push(
              @diag.error(
                "pure-tutuca.interface.pure",
                have.span,
                "\{c.name}'s \{m.name} isn't pure, but \{iface.name}'s is: a holder may apply it",
                hint="pure: true",
                related=[
                  { span: m.span, message: "\{iface.name}'s \{m.name}", },
                ],
              ),
            )
          } else if have.params.map(p => p.ty) != m.params.map(p => p.ty) {
            self.diags.push(
              @diag.error(
                "pure-tutuca.interface.type",
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
    for q in iface.queries {
      // A public field is a query that takes nothing and gives the field.
      if q.params.is_empty() &&
        c.publics.contains(q.name) &&
        c.field(q.name) is Some(f) {
        if q.result is Some(want) && want != f.ty {
          self.error(
            "pure-tutuca.interface.type",
            f.span,
            "\{c.name}'s public field \{q.name} is \{ty_text(f.ty)}, but \{iface.name}'s query \{q.name} gives \{ty_text(want)}",
          )
        }
        continue
      }
      match c.queries.iter().find_first(x => x.name == q.name) {
        None =>
          self.error(
            "pure-tutuca.interface.missing",
            c.span,
            "\{c.name} implements \{iface.name}, but has no query \{q.name}",
          )
        Some(have) =>
          if have.params.map(p => p.ty) != q.params.map(p => p.ty) ||
            have.result != q.result {
            self.diags.push(
              @diag.error(
                "pure-tutuca.interface.type",
                have.span,
                "\{c.name}'s query \{q.name} isn't \{iface.name}'s: (\{q.params.map(p => ty_text(p.ty)).join(", ")}) -> \{q.result.map(ty_text).unwrap_or("any")}",
                related=[
                  { span: q.span, message: "\{iface.name}'s \{q.name}", },
                ],
              ),
            )
          }
      }
    }
    for s in iface.notifies {
      if !c.notifies.iter().any(x => x.name == s.name) {
        self.error(
          "pure-tutuca.interface.missing",
          c.span,
          "\{c.name} implements \{iface.name}, but its notifies have no \{s.name}",
        )
      }
    }
  }
}

///|
fn Validator::example(self : Validator, ex : ExampleM) -> Unit {
  guard self.pkg.component(ex.component) is Some(c) else {
    self.error(
      "pure-tutuca.example.component",
      ex.span,
      "no component \{ex.component}\{did_you_mean(ex.component, self.pkg.components.map(c => c.name))}",
    )
    return
  }
  for s in ex.start {
    match c.field(s.0) {
      None =>
        self.error(
          "pure-tutuca.example.field",
          ex.span,
          "\{c.name} has no field \{s.0}\{did_you_mean(s.0, c.fields.map(f => f.name))}",
        )
      Some(f) =>
        if !val_fits(s.1, f.ty) {
          self.error(
            "pure-tutuca.example.value",
            ex.span,
            "\{val_text(s.1)} isn't a value of \{f.name}'s type, \{ty_text(f.ty)}",
          )
        }
    }
  }
  for step in ex.steps {
    match step {
      Send(m, args, span~) =>
        match c.message(m) {
          None =>
            self.error(
              "pure-tutuca.example.message",
              span,
              "\{c.name} has no message \{m}\{did_you_mean(m, c.messages.map(x => x.name))}",
            )
          Some(msg) =>
            if msg.params.length() != args.length() {
              self.error(
                "pure-tutuca.example.arity",
                span,
                "\{m} takes \{msg.params.length()} arguments, not \{args.length()}",
              )
            } else {
              for i, a in args {
                if !val_fits(a, msg.params[i].ty) {
                  self.error(
                    "pure-tutuca.example.value",
                    span,
                    "\{val_text(a)} isn't a value of \{msg.params[i].name}'s type, \{ty_text(msg.params[i].ty)}",
                  )
                }
              }
            }
        }
      Expect(fields, span~) =>
        for f in fields {
          if c.property(f.0) is None {
            self.error(
              "pure-tutuca.example.field",
              span,
              "\{c.name} has no field or query \{f.0}",
            )
          }
        }
    }
  }
}

///|
/// What pkg doesn't meet, as diagnostics.
pub fn validate(pkg : Package) -> Array[@diag.Diagnostic] {
  let v : Validator = { pkg, diags: [], }
  for c in pkg.components {
    for f in c.fields {
      v.field(c.name, f)
    }
    for m in c.messages {
      v.message(c, m)
    }
    for a in c.asks {
      v.emits(c, "the answers of \{a.name}", a.emits)
    }
    v.make_defaults(c)
    v.metas(c)
    v.implements(c)
    v.views(c)
  }
  for i, m in pkg.meta_schemas {
    if !is_absolute_uri(m.uri) {
      v.error(
        "pure-tutuca.meta.uri",
        m.span,
        "a meta schema's URI is absolute, so conventions don't clash, not \"\{m.uri}\"",
      )
    }
    for o in pkg.meta_schemas[:i] {
      if o.uri == m.uri {
        v.error(
          "pure-tutuca.meta.duplicate",
          m.span,
          "\{m.name} and \{o.name} are both for \{m.uri}: one meta schema per URI",
        )
      }
    }
    for f in m.fields {
      v.field(m.name, f)
    }
  }
  let seen_as : Array[String] = []
  for reg in pkg.registers {
    if pkg.component(reg.component) is None {
      v.error(
        "pure-tutuca.register.unknown",
        @diag.Span::none(pkg.full_name),
        "no component \{reg.component} to register\{did_you_mean(reg.component, pkg.components.map(c => c.name))}",
      )
    }
    if seen_as.contains(reg.as_) {
      v.error(
        "pure-tutuca.register.duplicate",
        @diag.Span::none(pkg.full_name),
        "two components are registered as \{reg.as_}",
      )
    }
    seen_as.push(reg.as_)
  }
  for ex in pkg.examples {
    v.example(ex)
  }
  v.diags
}
