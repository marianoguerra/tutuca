// Checking views: every construct used where it means something, names that
// resolve, send arguments that fit the message they go to.

///|
let constructs : Array[String] = [
  "field", "seq_item", "provided", "bind", "if", "frag", "render", "render_each",
  "render_it", "each", "scope", "push_view", "send", "target_value", "source_key",
  "drag_key", "event", "el",
]

///|
/// The modifiers an on_<event>+... key may add (src/sem.wax in tutuca-wax).
pub let event_modifiers : Array[String] = [
  "ctrl", "alt", "shift", "meta", "prevent", "stop", "enter", "escape", "esc", "tab",
  "space", "up", "down", "left", "right", "delete", "backspace",
]

///|
priv struct ViewCtx {
  pkg : Package
  comp : ComponentM
  diags : Array[@diag.Diagnostic]
  /// The binds visible here: a loop's value, key and enrich binds, a scope's.
  binds : Array[String]
  in_each : Bool
  /// What field(x) reads inside an each body: the item, of this type.
  it : Ty?
}

///|
fn ViewCtx::err(
  self : ViewCtx,
  code : String,
  span : @diag.Span,
  msg : String,
  hint? : String,
) -> Unit {
  self.diags.push(@diag.error(code, span, msg, hint?))
}

///|
fn ViewCtx::name_arg(
  self : ViewCtx,
  v : @syntax.ViewExpr,
  what : String,
) -> @syntax.Name? {
  match v {
    Name(n) => Some(n)
    other => {
      self.err(
        "tcd.view.name",
        other.span(),
        "\{what} is a bare name here, like field(count)",
      )
      None
    }
  }
}

///|
fn ViewCtx::attr(
  _ : ViewCtx,
  attrs : Array[@syntax.Attr],
  key : String,
) -> @syntax.ViewExpr? {
  attrs.iter().find_first(a => a.key.text == key).map(a => a.value)
}

///|
fn ViewCtx::only_attrs(
  self : ViewCtx,
  name : @syntax.Name,
  attrs : Array[@syntax.Attr],
  allowed : Array[String],
) -> Unit {
  for a in attrs {
    if !allowed.contains(a.key.text) {
      self.err(
        "tcd.view.option",
        a.key.span,
        if allowed.is_empty() {
          "\{name.text} takes no options"
        } else {
          "\{name.text} takes \{allowed.join(" and ")}, not \{a.key.text}"
        },
      )
    }
  }
}

///|
fn ViewCtx::arity(
  self : ViewCtx,
  name : @syntax.Name,
  args : Array[@syntax.ViewExpr],
  min : Int32,
  max : Int32,
  span : @diag.Span,
) -> Bool {
  if args.length() < min || args.length() > max {
    let want = if min == max { "\{min}" } else { "\{min} to \{max}" }
    self.err(
      "tcd.view.arity",
      span,
      "\{name.text} takes \{want} argument\{if max == 1 { "" } else { "s" }}, not \{args.length()}",
    )
    false
  } else {
    true
  }
}

///|
/// The type of a value-reading view (field, seq_item, provided, bind), or
/// None when it isn't one.
fn ViewCtx::value_ty(self : ViewCtx, v : @syntax.ViewExpr) -> Ty? {
  guard v is Call(n, attrs, args, span~) else { return None }
  match n.text {
    "field" => {
      self.only_attrs(n, attrs, [])
      guard self.arity(n, args, 1, 1, span) else { return Some(Any) }
      guard self.name_arg(args[0], "the field") is Some(f) else {
        return Some(Any)
      }
      if self.it is Some(item) {
        return self.item_member(item, f)
      }
      match self.comp.property(f.text) {
        Some(p) => Some(p.ty)
        None => {
          let names = self.comp.fields.map(x => x.name)
          names.append(self.comp.gets.map(x => x.name))
          self.err(
            "tcd.view.field",
            f.span,
            "\{self.comp.name} has no field or property \{f.text}\{did_you_mean(f.text, names)}",
          )
          Some(Any)
        }
      }
    }
    "seq_item" => {
      self.only_attrs(n, attrs, [])
      guard self.arity(n, args, 2, 2, span) else { return Some(Any) }
      let seq = self.name_arg(args[0], "the list or map field")
      let key = self.name_arg(args[1], "the field holding the key")
      let mut item : Ty = Any
      if seq is Some(s) {
        match self.comp.field(s.text).map(f => unoption(f.ty)) {
          Some(List(i)) | Some(Map(i)) => item = i
          Some(t) =>
            self.err(
              "tcd.view.seq_item",
              s.span,
              "seq_item reads an item of a list or a map, but \{s.text} is \{ty_text(t)}",
            )
          None =>
            self.err(
              "tcd.view.field",
              s.span,
              "\{self.comp.name} has no field \{s.text}",
            )
        }
      }
      if key is Some(k) && self.comp.property(k.text) is None {
        self.err(
          "tcd.view.field",
          k.span,
          "\{self.comp.name} has no field \{k.text}",
        )
      }
      Some(item)
    }
    "provided" => {
      self.only_attrs(n, attrs, [])
      guard self.arity(n, args, 1, 1, span) else { return Some(Any) }
      if self.name_arg(args[0], "the provided name") is Some(p) {
        let provided = self.pkg.components
          .iter()
          .flat_map(c => c.provides.iter())
          .find_first(x => x.name == p.text)
        match provided {
          Some(pv) => {
            let owner = self.pkg.components
              .iter()
              .find_first(c => c.provides.iter().any(x => x.name == pv.name))
            match owner.bind(o => o.field(pv.field)) {
              Some(f) => return Some(f.ty)
              None => ()
            }
          }
          None =>
            self.diags.push(
              @diag.warning(
                "tcd.view.provided",
                p.span,
                "no component in this package provides \{p.text}; one rendering this one from elsewhere must",
              ),
            )
        }
      }
      Some(Any)
    }
    "bind" => {
      self.only_attrs(n, attrs, [])
      guard self.arity(n, args, 1, 1, span) else { return Some(Any) }
      if self.name_arg(args[0], "the bind") is Some(b) &&
        !self.binds.contains(b.text) {
        self.err(
          "tcd.view.bind",
          b.span,
          if self.binds.is_empty() {
            "no binds here: bind(\{b.text}) reads a loop's or a scope's"
          } else {
            "no bind \{b.text} here\{did_you_mean(b.text, self.binds)}; there are \{self.binds.join(", ")}"
          },
        )
      }
      Some(Any)
    }
    _ => None
  }
}

///|
/// A member of the item an each body renders.
fn ViewCtx::item_member(self : ViewCtx, item : Ty, f : @syntax.Name) -> Ty? {
  match unoption(item) {
    Record(fs) =>
      match fs.iter().find_first(x => x.0 == f.text) {
        Some(x) => Some(x.1)
        None => {
          self.err(
            "tcd.view.field",
            f.span,
            "the items have no \{f.text}\{did_you_mean(f.text, fs.map(x => x.0))}",
          )
          Some(Any)
        }
      }
    Comp([name]) =>
      match self.pkg.members_of(name) {
        Some(members) =>
          match members.iter().find_first(x => x.name == f.text) {
            Some(x) => Some(x.ty)
            None => {
              self.err(
                "tcd.view.field",
                f.span,
                "\{name} has no field or property \{f.text}\{did_you_mean(f.text, members.map(x => x.name))}",
              )
              Some(Any)
            }
          }
        None => Some(Any)
      }
    _ => Some(Any)
  }
}

///|
/// A view as an attribute's value: a literal, a value read, or an if of them.
fn ViewCtx::attr_value(self : ViewCtx, v : @syntax.ViewExpr) -> Unit {
  match v {
    Lit(_, ..) => ()
    Call({ text: "if", .. } as n, attrs, args, span~) => {
      self.only_attrs(n, attrs, [])
      if self.arity(n, args, 2, 3, span) {
        self.attr_value(args[0])
        for a in args[1:] {
          self.attr_value(a)
        }
      }
    }
    _ =>
      if self.value_ty(v) is None {
        self.err(
          "tcd.view.attr_value",
          v.span(),
          "an attribute's value is a literal, field(x), seq_item(s, k), provided(x), bind(x) or an if of them",
        )
      }
  }
}

///|
/// Whether a view is a constant, or an if of constants: what the CSS compiler
/// sees of a class.
fn is_constant_class(v : @syntax.ViewExpr) -> Bool {
  match v {
    Lit(Str(_), ..) => true
    Call({ text: "if", .. }, _, [_, .. rest], ..) =>
      rest.iter().all(is_constant_class)
    _ => false
  }
}

///|
/// The event type and modifiers of an on_<event>[+modifier...] key.
pub fn event_of_key(key : String) -> (String, Array[String])? {
  guard key.has_prefix("on_") else { return None }
  let rest = key.unsafe_substring(start=3, end=key.length())
  let parts = rest.split("+").map(s => s.to_owned()).collect()
  Some((parts[0], parts[1:].to_owned()))
}

///|
fn ViewCtx::send_arg(
  self : ViewCtx,
  v : @syntax.ViewExpr,
  param : FieldM?,
) -> Unit {
  let ty = param.map(p => p.ty).unwrap_or(Any)
  let pname = param.map(p => p.name).unwrap_or("it")
  match v {
    Lit(l, span~) => {
      let val = lit_val(l)
      if !val_fits(val, ty) {
        self.err(
          "tcd.view.send_arg",
          span,
          "\{lit_text(l)} isn't a value of \{pname}'s type, \{ty_text(ty)}",
        )
      } else if param is Some(p) &&
        p.norm.key_of.is_empty() &&
        !val_meets(val, p.norm) {
        self.err(
          "tcd.view.send_arg",
          span,
          "\{lit_text(l)} doesn't meet \{pname}'s constraints: it must be \{norm_text(p.norm)}",
        )
      }
    }
    Call(n, attrs, args, span~) =>
      match n.text {
        "target_value" => {
          self.only_attrs(n, attrs, [])
          ignore(self.arity(n, args, 0, 0, span))
          match unoption(ty) {
            Str | Bool | Any => ()
            t =>
              self.err(
                "tcd.view.send_arg",
                span,
                "target_value() is a string (a checkbox's: a bool), but \{pname} is \{ty_text(t)}",
              )
          }
        }
        "source_key" => {
          self.only_attrs(n, attrs, [])
          ignore(self.arity(n, args, 0, 0, span))
          match unoption(ty) {
            S32 | Str | Any => ()
            t =>
              self.err(
                "tcd.view.send_arg",
                span,
                "source_key() is an item's key, an s32 or a string, but \{pname} is \{ty_text(t)}",
              )
          }
        }
        "drag_key" => {
          self.only_attrs(n, attrs, [])
          ignore(self.arity(n, args, 0, 0, span))
          if !(ty is Option(_) || ty == Any) {
            self.err(
              "tcd.view.send_arg",
              span,
              "drag_key() is null when what's dragged comes from elsewhere, so \{pname} must be an option, not \{ty_text(ty)}",
              hint="option<\{ty_text(ty)}>",
            )
          }
        }
        "event" => {
          self.only_attrs(n, attrs, [])
          if self.arity(n, args, 1, 1, span) {
            ignore(self.name_arg(args[0], "the event's field"))
          }
        }
        "if" => {
          self.only_attrs(n, attrs, [])
          if self.arity(n, args, 2, 3, span) {
            self.send_arg(args[0], None)
            for a in args[1:] {
              self.send_arg(a, param)
            }
          }
        }
        _ =>
          self.err(
            "tcd.view.send_arg", span, "a send argument is a literal, target_value(), source_key(), drag_key(), event(name) or an if of them: it's read from the event, not the state",
          )
      }
    Name(nm) =>
      self.err(
        "tcd.view.send_arg",
        nm.span,
        "\{nm.text} is a bare name; a send argument is a literal, target_value(), source_key(), drag_key(), event(name) or an if of them",
      )
  }
}

///|
fn ViewCtx::handler(
  self : ViewCtx,
  key : @syntax.Name,
  value : @syntax.ViewExpr,
) -> Unit {
  guard event_of_key(key.text) is Some((event, mods)) else { return }
  if event.is_empty() {
    self.err("tcd.view.event", key.span, "on_ needs an event: on_click")
  }
  for m in mods {
    if !event_modifiers.contains(m) {
      self.err(
        "tcd.view.event",
        key.span,
        "unknown event modifier \{m}\{did_you_mean(m, event_modifiers)}; the ones there are: \{event_modifiers.join(", ")}",
      )
    }
  }
  guard value is Call({ text: "send", .. } as n, attrs, args, span~) else {
    self.err(
      "tcd.view.handler",
      value.span(),
      "\{key.text} takes send(message, args...)",
    )
    return
  }
  self.only_attrs(n, attrs, [])
  guard args.length() >= 1 else {
    self.err(
      "tcd.view.handler", span, "send names the message: send(message, args...)",
    )
    return
  }
  guard self.name_arg(args[0], "the message") is Some(mname) else { return }
  guard self.comp.message(mname.text) is Some(m) else {
    self.err(
      "tcd.view.message",
      mname.span,
      "\{self.comp.name} has no message \{mname.text}\{did_you_mean(mname.text, self.comp.messages.map(x => x.name))}",
    )
    return
  }
  let sent = args[1:].to_owned()
  if sent.length() != m.params.length() {
    self.err(
      "tcd.view.send_arity",
      span,
      "\{m.name} takes \{m.params.length()} argument\{if m.params.length() == 1 { "" } else { "s" }}, this sends \{sent.length()}",
    )
    return
  }
  for i, a in sent {
    self.send_arg(a, Some(m.params[i]))
  }
}

///|
fn ViewCtx::element(
  self : ViewCtx,
  attrs : Array[@syntax.Attr],
  childs : Array[@syntax.ViewExpr],
) -> Unit {
  for a in attrs {
    let k = a.key.text
    if k.has_prefix("on_") {
      self.handler(a.key, a.value)
      continue
    }
    if (k == "value" || k == "checked") && a.value is Lit(_, ..) {
      self.err(
        "tcd.view.static_value",
        a.key.span,
        "\{k} can't be a constant: the vdom sets it as a property, from a field",
        hint="\{k}: field(name)",
      )
    }
    if k == "class" && !is_constant_class(a.value) {
      self.diags.push(
        @diag.warning(
          "tcd.view.class",
          a.value.span(),
          "this class is computed from the state, so the CSS compiler won't see it",
          hint="write classes as constants, or an if of constants",
        ),
      )
    }
    self.attr_value(a.value)
  }
  for c in childs {
    self.child(c)
  }
}

///|
fn ViewCtx::component_ty(self : ViewCtx, src : @syntax.ViewExpr) -> Unit {
  match self.value_ty(src) {
    None =>
      self.err(
        "tcd.view.source",
        src.span(),
        "what renders is read from the state: field(x), seq_item(s, k) or provided(x)",
      )
    Some(Comp(_)) | Some(Any) | Some(Option(Comp(_))) => ()
    Some(t) =>
      self.err(
        "tcd.view.render",
        src.span(),
        "render renders a component, but this is \{ty_text(t)}",
      )
  }
}

///|
fn ViewCtx::view_name(self : ViewCtx, v : @syntax.ViewExpr?) -> Unit {
  guard v is Some(v) else { return }
  guard self.name_arg(v, "the view") is Some(n) else { return }
  let known = self.pkg.components
    .iter()
    .any(c => c.views.iter().any(x => x.name == n.text))
  if !known {
    self.diags.push(
      @diag.warning(
        "tcd.view.view_name",
        n.span,
        "no component in this package has a view \{n.text}",
      ),
    )
  }
}

///|
fn ViewCtx::loop_(self : ViewCtx, v : @syntax.ViewExpr?) -> LoopM? {
  guard v is Some(v) else { return None }
  guard self.name_arg(v, "the loop") is Some(n) else { return None }
  match self.comp.loops.iter().find_first(l => l.name == n.text) {
    Some(l) => Some(l)
    None => {
      self.err(
        "tcd.view.loop",
        n.span,
        "\{self.comp.name} declares no loop \{n.text}\{did_you_mean(n.text, self.comp.loops.map(l => l.name))}",
        hint="declare it: loop \{n.text} { };",
      )
      None
    }
  }
}

///|
fn ViewCtx::collection(self : ViewCtx, src : @syntax.ViewExpr) -> Unit {
  match self.value_ty(src) {
    None =>
      self.err(
        "tcd.view.source",
        src.span(),
        "a loop goes over a list or a map read from the state: field(x), seq_item(s, k) or provided(x)",
      )
    Some(t) =>
      match unoption(t) {
        List(_) | Map(_) | Any => ()
        other =>
          self.err(
            "tcd.view.each",
            src.span(),
            "a loop goes over a list or a map, not \{ty_text(other)}",
          )
      }
  }
}

///|
fn ViewCtx::child(self : ViewCtx, v : @syntax.ViewExpr) -> Unit {
  match v {
    Lit(_, ..) => ()
    Name(n) =>
      self.err(
        "tcd.view.bare_name",
        n.span,
        "\{n.text} is a bare name; a view child is a literal or a call",
        hint="field(\{n.text})",
      )
    Call(n, attrs, args, span~) =>
      match n.text {
        "field" | "seq_item" | "provided" | "bind" => ignore(self.value_ty(v))
        "if" => {
          self.only_attrs(n, attrs, [])
          if self.arity(n, args, 2, 3, span) {
            self.attr_value(args[0])
            for a in args[1:] {
              self.child(a)
            }
          }
        }
        "frag" => {
          self.only_attrs(n, attrs, [])
          args.each(a => self.child(a))
        }
        "render" => {
          self.only_attrs(n, attrs, ["view"])
          if self.arity(n, args, 1, 1, span) {
            self.component_ty(args[0])
          }
          self.view_name(self.attr(attrs, "view"))
        }
        "render_each" => {
          self.only_attrs(n, attrs, ["loop"])
          if self.arity(n, args, 1, 1, span) {
            self.collection(args[0])
          }
          ignore(self.loop_(self.attr(attrs, "loop")))
        }
        "each" => {
          self.only_attrs(n, attrs, ["loop"])
          let l = self.loop_(self.attr(attrs, "loop"))
          if self.arity(n, args, 2, 2, span) {
            self.collection(args[0])
            let binds = self.binds.copy()
            binds.push("value")
            binds.push("key")
            if l is Some(loop_) && loop_.enrich is Some(enrich) {
              binds.append(enrich.map(b => b.name))
            }
            let item = match self.value_ty(args[0]).map(unoption) {
              Some(List(i)) | Some(Map(i)) => i
              _ => Any
            }
            { ..self, binds, in_each: true, it: Some(item), }.child(args[1])
          }
        }
        "render_it" => {
          self.only_attrs(n, attrs, ["view"])
          ignore(self.arity(n, args, 0, 0, span))
          if !self.in_each {
            self.err(
              "tcd.view.render_it", span, "render_it renders a loop's item, so it goes in an each body",
            )
          }
          self.view_name(self.attr(attrs, "view"))
        }
        "scope" => {
          self.only_attrs(n, attrs, [])
          if self.arity(n, args, 2, 2, span) &&
            self.name_arg(args[0], "the scope") is Some(s) {
            match self.comp.scopes.iter().find_first(x => x.name == s.text) {
              Some(sc) => {
                let binds = self.binds.copy()
                binds.append(sc.binds.map(b => b.name))
                { ..self, binds, }.child(args[1])
              }
              None =>
                self.err(
                  "tcd.view.scope",
                  s.span,
                  "\{self.comp.name} declares no scope \{s.text}\{did_you_mean(s.text, self.comp.scopes.map(x => x.name))}",
                )
            }
          }
        }
        "push_view" => {
          self.only_attrs(n, attrs, [])
          if self.arity(n, args, 2, 2, span) {
            match args[0] {
              Lit(Str(_), ..) => ()
              other => self.attr_value(other)
            }
            self.child(args[1])
          }
        }
        "send" | "target_value" | "source_key" | "drag_key" | "event" =>
          self.err(
            "tcd.view.not_renderable",
            span,
            "\{n.text} goes in an on_<event> attribute, it doesn't render",
          )
        "el" =>
          match args {
            [Lit(Str(_), ..), .. rest] => self.element(attrs, rest.to_owned())
            _ =>
              self.err(
                "tcd.view.el", span, "el names its tag first: el(\"my-widget\", ...)",
              )
          }
        _ => self.element(attrs, args)
      }
  }
}

///|
/// Checks c's views against c and the package.
pub fn check_views(
  pkg : Package,
  c : ComponentM,
  diags : Array[@diag.Diagnostic],
) -> Unit {
  let ctx = { pkg, comp: c, diags, binds: [], in_each: false, it: None, }
  for v in c.views {
    ctx.child(v.body)
  }
  for l in c.loops {
    if l.view is Some(name) &&
      !pkg.components.iter().any(x => x.views.iter().any(v => v.name == name)) {
      diags.push(
        @diag.warning(
          "tcd.view.view_name",
          l.span,
          "no component in this package has a view \{name}",
        ),
      )
    }
  }
  ignore(constructs)
}
