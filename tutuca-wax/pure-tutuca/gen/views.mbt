// Views: each view node becomes the view data the runtime's view_*
// constructors build (prelude/view.wax), statement by statement, in the
// order written, so templates are numbered as a hand-written view would be.

///|
fn Gen::opt_name(self : Gen, v : String?) -> String {
  match v {
    Some(x) => self.s(x)
    None => "null"
  }
}

///|
/// A view node's view; may write statements to b first.
fn Gen::view(self : Gen, b : Block, v : @check.ViewNode) -> String {
  match v {
    Const(c, ..) => "view_const(\{self.val(c)})"
    Field(f, ..) => "view_field(\{self.s(f)})"
    SeqItem(seq, key, ..) => "view_seq_item(\{self.s(seq)}, \{self.s(key)})"
    Provided(p, ..) => "view_provided(\{self.s(p)})"
    Query(q, args, ..) => {
      let qargs = b.array("view_array", args.map(a => self.view(b, a)))
      b.bind("view_query(\{self.s(q)}, \{qargs})")
    }
    Bind(n, ..) => "view_lookup_bind(\{self.s(n)})"
    If(c, t, e, ..) => {
      let cond_v = self.view(b, c)
      let then_v = self.view(b, t)
      let otherwise = match e {
        Some(e) => self.view(b, e)
        None => "view_const(value_null())"
      }
      b.bind("view_if(\{cond_v}, \{then_v}, \{otherwise})")
    }
    Frag(kids, ..) => {
      let childs = self.views(b, kids)
      b.bind("view_frag(\{childs})")
    }
    Render(src, view, ..) => {
      let src = self.view(b, src)
      b.bind("view_render(\{src}, \{self.opt_name(view)})")
    }
    RenderEach(src, l, ..) => {
      let src = self.view(b, src)
      b.bind("view_render_each(\{src}, \{self.opt_name(l)})")
    }
    Each(src, body, l, ..) => {
      let src = self.view(b, src)
      let body = self.view(b, body)
      b.bind("view_each(\{src}, \{body}, \{self.opt_name(l)})")
    }
    RenderIt(view, ..) => b.bind("view_render_it(\{self.opt_name(view)})")
    Scope(s, body, ..) => {
      let body = self.view(b, body)
      b.bind("view_scope(\{self.s(s)}, \{body})")
    }
    PushView(name, body, ..) => {
      let name = self.view(b, name)
      let body = self.view(b, body)
      b.bind("view_push_view(\{name}, \{body})")
    }
    Element(tag~, ns~, attrs~, key~, children~, ons~, ..) =>
      self.element(b, tag, ns, attrs, key, children, ons)
  }
}

///|
fn Gen::views(self : Gen, b : Block, vs : Array[@check.ViewNode]) -> String {
  let items = vs.map(v => self.view(b, v))
  b.array("view_array", items)
}

///|
/// A send argument, as the handler table keeps it.
fn Gen::send_arg(self : Gen, b : Block, a : @check.SendArg) -> String {
  match a {
    TargetValue(..) => "arg_target_value()"
    SourceKey(..) => "arg_source_key()"
    DragKey(..) => "arg_drag_key()"
    Event(name, ..) => "arg_event(\{self.s(name)})"
    Value(v, ..) => "arg_value(\{self.val(v)})"
    Cond(c, t, e, ..) => {
      let cond_v = self.send_arg(b, c)
      let then_v = self.send_arg(b, t)
      let otherwise = match e {
        Some(e) => self.send_arg(b, e)
        None => "arg_value(value_null())"
      }
      b.bind("arg_if(\{cond_v}, \{then_v}, \{otherwise})")
    }
  }
}

///|
fn Gen::element(
  self : Gen,
  b : Block,
  tag : String,
  ns : String?,
  attrs : Array[@check.AttrM],
  key : @check.ViewNode?,
  childs : Array[@check.ViewNode],
  ons : Array[@check.OnM],
) -> String {
  let names = []
  let values = []
  let key = match key {
    Some(k) => self.view(b, k)
    None => "null"
  }
  let ns = match ns {
    Some(uri) => self.s(uri)
    None => "null"
  }
  let on_items = ons.map(on => {
    let args = b.array("arg_array", on.args.map(x => self.send_arg(b, x)))
    let spec = if on.mods.is_empty() {
      on.event
    } else {
      on.event + "+" + on.mods.join("+")
    }
    "view_on(\{self.s(spec)}, view_action(\{self.s(on.message)}, \{args}))"
  })
  for a in attrs {
    names.push(self.s(a.name))
    values.push(self.view(b, a.value))
  }
  // A button doesn't submit its form unless it says type, as tutuca's
  // tag.button.
  if tag == "button" && !attrs.iter().any(a => a.name == "type") {
    names.push(self.s("type"))
    values.push("view_const(value_string(\{self.s("button")}))")
  }
  let name_arr = b.array("str_array", names)
  let value_arr = b.array("view_array", values)
  let child_arr = self.views(b, childs)
  let on_arr = b.array("view_on_array", on_items)
  b.bind(
    "view_el(\{self.s(tag)}, \{ns}, \{name_arr}, \{value_arr}, \{key}, \{child_arr}, \{on_arr})",
  )
}
