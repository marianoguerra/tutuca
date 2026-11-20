// Checking views: names that resolve, values read where they mean something,
// send arguments that fit the message they go to.

///|
/// The classes meta's URI (tutuca's CLASSES_META): a component that says
/// something under it lists the classes its views compute.
pub let classes_meta : String = "https://tutuca.dev/meta/classes"

///|
/// The modifiers an "on:<event>+..." key may add (src/sem.wax in
/// tutuca-wax).
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
/// The type of a value-reading view (field, seqItem, provided, lookupBind,
/// query), or None when it isn't one.
fn ViewCtx::value_ty(self : ViewCtx, v : ViewNode) -> Ty? {
  match v {
    Field(f, span~) => {
      if self.it is Some(item) {
        return self.item_member(item, f, span)
      }
      match self.comp.property(f) {
        Some(p) => Some(p.ty)
        None => {
          let names = self.comp.fields.map(x => x.name)
          names.append(self.comp.gets.map(x => x.name))
          self.err(
            "pure-tutuca.view.field",
            span,
            "\{self.comp.name} has no field or query \{f}\{did_you_mean(f, names)}",
          )
          Some(Any)
        }
      }
    }
    SeqItem(seq, key, span~) => {
      let mut item : Ty = Any
      match self.comp.field(seq).map(f => unoption(f.ty)) {
        Some(List(i)) | Some(Map(i)) => item = i
        Some(t) =>
          self.err(
            "pure-tutuca.view.seq_item",
            span,
            "seqItem reads an item of a list or a map, but \{seq} is \{ty_text(t)}",
          )
        None =>
          self.err(
            "pure-tutuca.view.field",
            span,
            "\{self.comp.name} has no field \{seq}",
          )
      }
      if self.comp.property(key) is None {
        self.err(
          "pure-tutuca.view.field",
          span,
          "\{self.comp.name} has no field \{key}",
        )
      }
      Some(item)
    }
    Query(q, args, span~) => {
      if self.it is Some(_) {
        self.err(
          "pure-tutuca.view.query",
          span,
          "query(\"\{q}\") runs the component's query, and in an each body what's read is the item",
        )
        return Some(Any)
      }
      guard self.comp.queries.iter().find_first(x => x.name == q) is Some(sig) else {
        self.err(
          "pure-tutuca.view.query",
          span,
          "\{self.comp.name} has no query \{q}\{did_you_mean(q, self.comp.queries.map(x => x.name))}",
        )
        return Some(Any)
      }
      if args.length() != sig.params.length() {
        self.err(
          "pure-tutuca.view.arity",
          span,
          "\{q} takes \{sig.params.length()} argument\{if sig.params.length() == 1 { "" } else { "s" }}, not \{args.length()}",
        )
      } else {
        for i, a in args {
          let p = sig.params[i]
          match a {
            Const(v, span~) =>
              if !val_fits(v, p.ty) {
                self.err(
                  "pure-tutuca.view.query",
                  span,
                  "\{val_text(v)} isn't a value of \{ty_text(p.ty)}, \{q}'s \{p.name}",
                )
              }
            _ =>
              match self.value_ty(a) {
                Some(t) =>
                  if !ty_fits_param(t, p.ty) {
                    self.err(
                      "pure-tutuca.view.query",
                      a.span(),
                      "this is \{ty_text(t)}, but \{q}'s \{p.name} is \{ty_text(p.ty)}",
                    )
                  }
                None =>
                  self.err(
                    "pure-tutuca.view.query",
                    a.span(),
                    "a query's argument is a constant or a value read: field(x), seqItem(s, k), provided(x), lookupBind(x)",
                  )
              }
          }
        }
      }
      Some(sig.result.unwrap_or(Any))
    }
    Provided(p, span~) => {
      let owner = self.pkg.components
        .iter()
        .find_first(c => c.provides.iter().any(x => x.name == p))
      match owner {
        Some(o) => {
          let pv = o.provides.iter().find_first(x => x.name == p).unwrap()
          match o.field(pv.field) {
            Some(f) =>
              match (pv.key, unoption(f.ty)) {
                (None, _) => return Some(f.ty)
                (Some(_), List(item)) | (Some(_), Map(item)) =>
                  return Some(item)
                _ => ()
              }
            None => ()
          }
        }
        None =>
          self.diags.push(
            @diag.warning(
              "pure-tutuca.view.provided",
              span,
              "no component in this package provides \{p}; one rendering this one from elsewhere must",
            ),
          )
      }
      Some(Any)
    }
    Bind(b, span~) => {
      if !self.binds.contains(b) {
        self.err(
          "pure-tutuca.view.bind",
          span,
          if self.binds.is_empty() {
            "no binds here: lookupBind(\"\{b}\") reads a loop's or a scope's"
          } else {
            "no bind \{b} here\{did_you_mean(b, self.binds)}; there are \{self.binds.join(", ")}"
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
fn ViewCtx::item_member(
  self : ViewCtx,
  item : Ty,
  f : String,
  span : @diag.Span,
) -> Ty? {
  match unoption(item) {
    Record(fs) =>
      match fs.iter().find_first(x => x.0 == f) {
        Some(x) => Some(x.1)
        None => {
          self.err(
            "pure-tutuca.view.field",
            span,
            "the items have no \{f}\{did_you_mean(f, fs.map(x => x.0))}",
          )
          Some(Any)
        }
      }
    Comp([name]) =>
      match self.pkg.members_of(name) {
        Some(members) =>
          match members.iter().find_first(x => x.name == f) {
            Some(x) => Some(x.ty)
            None => {
              self.err(
                "pure-tutuca.view.field",
                span,
                "\{name} has no field or query \{f}\{did_you_mean(f, members.map(x => x.name))}",
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
/// A view as an attribute's value: a constant, a value read, or a when of
/// them.
fn ViewCtx::attr_value(self : ViewCtx, v : ViewNode) -> Unit {
  match v {
    Const(_, ..) => ()
    If(c, t, e, ..) => {
      self.attr_value(c)
      self.attr_value(t)
      if e is Some(e) {
        self.attr_value(e)
      }
    }
    _ =>
      if self.value_ty(v) is None {
        self.err(
          "pure-tutuca.view.attr_value",
          v.span(),
          "an attribute's value is a constant, field(x), seqItem(s, k), provided(x), lookupBind(x), query(q, ...) or a when of them",
        )
      }
  }
}

///|
/// Whether a view is a constant, or a when of constants: what the CSS
/// compiler sees of a class.
fn is_constant_class(v : ViewNode) -> Bool {
  match v {
    Const(VStr(_), ..) => true
    If(_, t, e, ..) =>
      is_constant_class(t) &&
      (match e {
        Some(e) => is_constant_class(e)
        None => true
      })
    _ => false
  }
}

///|
fn ViewCtx::send_arg(self : ViewCtx, a : SendArg, param : FieldM?) -> Unit {
  let ty = param.map(p => p.ty).unwrap_or(Any)
  let pname = param.map(p => p.name).unwrap_or("it")
  match a {
    Value(v, span~) =>
      if !val_fits(v, ty) {
        self.err(
          "pure-tutuca.view.send_arg",
          span,
          "\{val_text(v)} isn't a value of \{pname}'s type, \{ty_text(ty)}",
        )
      } else if param is Some(p) &&
        p.norm.key_of.is_empty() &&
        !val_meets(v, p.norm) {
        self.err(
          "pure-tutuca.view.send_arg",
          span,
          "\{val_text(v)} doesn't meet \{pname}'s constraints: it must be \{norm_text(p.norm)}",
        )
      }
    TargetValue(span~) =>
      match unoption(ty) {
        Str | Bool | Enum(_) | Any => ()
        t =>
          self.err(
            "pure-tutuca.view.send_arg",
            span,
            "targetValue() is a string (a checkbox's: a boolean), but \{pname} is \{ty_text(t)}",
          )
      }
    SourceKey(span~) =>
      match unoption(ty) {
        F64 | Str | Any => ()
        t =>
          self.err(
            "pure-tutuca.view.send_arg",
            span,
            "sourceKey() is an item's key, a number or a string, but \{pname} is \{ty_text(t)}",
          )
      }
    DragKey(span~) =>
      if !(ty is Option(_) || ty == Any) {
        self.err(
          "pure-tutuca.view.send_arg",
          span,
          "dragKey() is null when what's dragged comes from elsewhere, so \{pname} must be nullable, not \{ty_text(ty)}",
        )
      }
    Event(_, ..) => ()
    Cond(c, t, e, ..) => {
      self.send_arg(c, None)
      self.send_arg(t, param)
      if e is Some(e) {
        self.send_arg(e, param)
      }
    }
  }
}

///|
fn ViewCtx::on(self : ViewCtx, on : OnM) -> Unit {
  if on.event.is_empty() {
    self.err(
      "pure-tutuca.view.event",
      on.span,
      "\"on:\" needs an event: \"on:click\"",
    )
  }
  for m in on.mods {
    if !event_modifiers.contains(m) {
      self.err(
        "pure-tutuca.view.event",
        on.span,
        "unknown event modifier \{m}\{did_you_mean(m, event_modifiers)}; the ones there are: \{event_modifiers.join(", ")}",
      )
    }
  }
  guard self.comp.message(on.message) is Some(m) else {
    self.err(
      "pure-tutuca.view.message",
      on.span,
      "\{self.comp.name} has no message \{on.message}\{did_you_mean(on.message, self.comp.messages.map(x => x.name))}",
    )
    return
  }
  if on.args.length() != m.params.length() {
    self.err(
      "pure-tutuca.view.send_arity",
      on.span,
      "\{m.name} takes \{m.params.length()} argument\{if m.params.length() == 1 { "" } else { "s" }}, this sends \{on.args.length()}",
    )
    return
  }
  for i, a in on.args {
    self.send_arg(a, Some(m.params[i]))
  }
}

///|
fn ViewCtx::component_ty(self : ViewCtx, src : ViewNode) -> Unit {
  match self.value_ty(src) {
    None =>
      self.err(
        "pure-tutuca.view.source",
        src.span(),
        "what renders is read from the state: field(x), seqItem(s, k) or provided(x)",
      )
    Some(Comp(_))
    | Some(Any)
    | Some(Option(Comp(_)))
    | Some(OneOf(_))
    | Some(Option(OneOf(_))) => ()
    Some(t) =>
      self.err(
        "pure-tutuca.view.render",
        src.span(),
        "render renders a component, but this is \{ty_text(t)}",
      )
  }
}

///|
fn ViewCtx::view_name(self : ViewCtx, v : String?, span : @diag.Span) -> Unit {
  guard v is Some(n) else { return }
  let known = self.pkg.components
    .iter()
    .any(c => c.views.iter().any(x => x.name == n))
  if !known {
    self.diags.push(
      @diag.warning(
        "pure-tutuca.view.view_name",
        span,
        "no component in this package has a view \{n}",
      ),
    )
  }
}

///|
fn ViewCtx::loop_(self : ViewCtx, v : String?, span : @diag.Span) -> LoopM? {
  guard v is Some(n) else { return None }
  match self.comp.loops.iter().find_first(l => l.name == n) {
    Some(l) => Some(l)
    None => {
      self.err(
        "pure-tutuca.view.loop",
        span,
        "\{self.comp.name} declares no loop \{n}\{did_you_mean(n, self.comp.loops.map(l => l.name))}",
        hint="declare it: loops: { \{n}: { } }",
      )
      None
    }
  }
}

///|
fn ViewCtx::collection(self : ViewCtx, src : ViewNode) -> Unit {
  match self.value_ty(src) {
    None =>
      self.err(
        "pure-tutuca.view.source",
        src.span(),
        "a loop goes over a list or a map read from the state: field(x), seqItem(s, k) or provided(x)",
      )
    Some(t) =>
      match unoption(t) {
        List(_) | Map(_) | Any => ()
        other =>
          self.err(
            "pure-tutuca.view.each",
            src.span(),
            "a loop goes over a list or a map, not \{ty_text(other)}",
          )
      }
  }
}

///|
fn ViewCtx::child(self : ViewCtx, v : ViewNode) -> Unit {
  match v {
    Const(_, ..) => ()
    Field(_, ..)
    | SeqItem(_, _, ..)
    | Provided(_, ..)
    | Bind(_, ..)
    | Query(_, _, ..) => ignore(self.value_ty(v))
    If(c, t, e, ..) => {
      self.attr_value(c)
      self.child(t)
      if e is Some(e) {
        self.child(e)
      }
    }
    Frag(kids, ..) => kids.each(k => self.child(k))
    Render(src, view, span~) => {
      self.component_ty(src)
      self.view_name(view, span)
    }
    RenderEach(src, l, span~) => {
      self.collection(src)
      ignore(self.loop_(l, span))
    }
    Each(src, body, l, span~) => {
      let lp = self.loop_(l, span)
      self.collection(src)
      let binds = self.binds.copy()
      binds.push("value")
      binds.push("key")
      if lp is Some(loop_) && loop_.enrich is Some(enrich) {
        binds.append(enrich.map(b => b.name))
      }
      let item = match self.value_ty(src).map(unoption) {
        Some(List(i)) | Some(Map(i)) => i
        _ => Any
      }
      { ..self, binds, in_each: true, it: Some(item), }.child(body)
    }
    RenderIt(view, span~) => {
      if !self.in_each {
        self.err(
          "pure-tutuca.view.render_it", span, "renderIt renders a loop's item, so it goes in an each body",
        )
      }
      self.view_name(view, span)
    }
    Scope(s, body, span~) =>
      match self.comp.scopes.iter().find_first(x => x.name == s) {
        Some(sc) => {
          let binds = self.binds.copy()
          binds.append(sc.binds.map(b => b.name))
          { ..self, binds, }.child(body)
        }
        None =>
          self.err(
            "pure-tutuca.view.scope",
            span,
            "\{self.comp.name} declares no scope \{s}\{did_you_mean(s, self.comp.scopes.map(x => x.name))}",
          )
      }
    PushView(name, body, ..) => {
      if !(name is Const(VStr(_), ..)) {
        self.attr_value(name)
      }
      self.child(body)
    }
    Element(attrs~, key~, children~, ons~, ..) => {
      for a in attrs {
        // A component that lists its classes under the classes meta has told
        // the CSS compiler what its computed ones can be.
        if a.name == "class" &&
          !is_constant_class(a.value) &&
          !self.comp.metas.iter().any(m => m.uri == classes_meta) {
          self.diags.push(
            @diag.warning(
              "pure-tutuca.view.class",
              a.span,
              "this class is computed from the state, so the CSS compiler won't see it",
              hint="write classes as constants, or a when of constants, or list the ones it can be: meta: { \"https://tutuca.dev/meta/classes\": { classes: \"a b\" } }",
            ),
          )
        }
        self.attr_value(a.value)
      }
      if key is Some(k) {
        self.attr_value(k)
      }
      ons.each(o => self.on(o))
      children.each(c => self.child(c))
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
}

///|
/// Whether a value of type t can be sent as a parameter of type p: the same
/// type, an option of it, an enum as a string, or Any on either side.
fn ty_fits_param(t : Ty, p : Ty) -> Bool {
  match (t, p) {
    (Any, _) | (_, Any) => true
    (_, Option(i)) => t == p || ty_fits_param(unoption(t), i)
    (Enum(_), Str) => true
    _ => t == p
  }
}
