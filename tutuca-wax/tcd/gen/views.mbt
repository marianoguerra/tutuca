// Views: each view expression becomes the view data the runtime's view_*
// constructors build (prelude/view.wax), statement by statement, in the
// order written, so templates are numbered as a hand-written view would be.

///|
fn name_of(v : @syntax.ViewExpr) -> String {
  match v {
    Name(n) => n.text
    Lit(Str(s), ..) => s
    _ => ""
  }
}

///|
fn opt_attr(attrs : Array[@syntax.Attr], key : String) -> @syntax.ViewExpr? {
  attrs.iter().find_first(a => a.key.text == key).map(a => a.value)
}

///|
fn Gen::opt_name(self : Gen, v : @syntax.ViewExpr?) -> String {
  match v {
    Some(x) => self.s(name_of(x))
    None => "null"
  }
}

///|
/// A view's name, which the runtime gets as the .tcd writes it.
fn Gen::opt_view_name(self : Gen, v : @syntax.ViewExpr?) -> String {
  match v {
    Some(x) => self.s(name_of(x))
    None => "null"
  }
}

///|
/// A view expression's view; may write statements to b first.
fn Gen::view(self : Gen, b : Block, v : @syntax.ViewExpr) -> String {
  match v {
    Lit(l, ..) => "view_const(\{self.lit(l)})"
    Name(_) => "view_const(value_null())"
    Call(n, attrs, args, ..) =>
      match n.text {
        "field" => "view_field(\{self.s(name_of(args[0]))})"
        "seq_item" =>
          "view_seq_item(\{self.s(name_of(args[0]))}, \{self.s(name_of(args[1]))})"
        "provided" => "view_provided(\{self.s(name_of(args[0]))})"
        "bind" => "view_lookup_bind(\{self.s(name_of(args[0]))})"
        "==" | "!=" => {
          let left = self.view(b, args[0])
          let right = match args[1] {
            Lit(l, ..) => self.lit(l)
            _ => "value_null()"
          }
          let negate = if n.text == "!=" { "1" } else { "0" }
          b.bind("view_eq(\{left}, \{right}, \{negate})")
        }
        "if" => {
          let cond_v = self.view(b, args[0])
          let then_v = self.view(b, args[1])
          let otherwise = if args.length() > 2 {
            self.view(b, args[2])
          } else {
            "view_const(value_null())"
          }
          b.bind("view_if(\{cond_v}, \{then_v}, \{otherwise})")
        }
        "frag" => {
          let childs = self.views(b, args)
          b.bind("view_frag(\{childs})")
        }
        "render" => {
          let src = self.view(b, args[0])
          b.bind(
            "view_render(\{src}, \{self.opt_view_name(opt_attr(attrs, "view"))})",
          )
        }
        "render_each" => {
          let src = self.view(b, args[0])
          b.bind(
            "view_render_each(\{src}, \{self.opt_name(opt_attr(attrs, "loop"))})",
          )
        }
        "each" => {
          let src = self.view(b, args[0])
          self.each_seqs.push(
            match args[0] {
              Call({ text: "field", .. }, _, [seq], ..) => name_of(seq)
              _ => ""
            },
          )
          let body = self.view(b, args[1])
          ignore(self.each_seqs.pop())
          b.bind(
            "view_each(\{src}, \{body}, \{self.opt_name(opt_attr(attrs, "loop"))})",
          )
        }
        "render_it" =>
          b.bind(
            "view_render_it(\{self.opt_view_name(opt_attr(attrs, "view"))})",
          )
        "scope" => {
          let body = self.view(b, args[1])
          b.bind("view_scope(\{self.s(name_of(args[0]))}, \{body})")
        }
        "push_view" => {
          let name = match args[0] {
            Lit(Str(s), ..) => "view_const(value_string(\{self.s(s)}))"
            other => self.view(b, other)
          }
          let body = self.view(b, args[1])
          b.bind("view_push_view(\{name}, \{body})")
        }
        "el" => self.element(b, name_of(args[0]), attrs, args[1:].to_owned())
        tag => self.element(b, tag, attrs, args)
      }
  }
}

///|
fn Gen::views(self : Gen, b : Block, vs : Array[@syntax.ViewExpr]) -> String {
  let items = vs.map(v => self.view(b, v))
  b.array("view_array", items)
}

///|
/// A send argument, as the handler table keeps it (the check allows only
/// these: tcd.view.send_arg).
fn Gen::send_arg(self : Gen, b : Block, v : @syntax.ViewExpr) -> String {
  match v {
    Call({ text: "target_value", .. }, _, _, ..) => "arg_target_value()"
    Call({ text: "source_key", .. }, _, _, ..) => "arg_source_key()"
    Call({ text: "drag_key", .. }, _, _, ..) => "arg_drag_key()"
    Call({ text: "event", .. }, _, [arg], ..) =>
      "arg_event(\{self.s(name_of(arg))})"
    // The receiver's field, or in an each body its item's.
    Call({ text: "field", .. }, _, [arg], ..) =>
      match self.each_seqs.last() {
        Some(seq) => "arg_item_field(\{self.s(seq)}, \{self.s(name_of(arg))})"
        None => "arg_field(\{self.s(name_of(arg))})"
      }
    Call({ text: "if", .. }, _, args, ..) => {
      let cond_v = self.send_arg(b, args[0])
      let then_v = self.send_arg(b, args[1])
      let otherwise = if args.length() > 2 {
        self.send_arg(b, args[2])
      } else {
        "arg_value(value_null())"
      }
      b.bind("arg_if(\{cond_v}, \{then_v}, \{otherwise})")
    }
    Lit(l, ..) => "arg_value(\{self.lit(l)})"
    _ => abort("tcd.view.send_arg lets only send arguments through")
  }
}

///|
fn Gen::element(
  self : Gen,
  b : Block,
  tag : String,
  attrs : Array[@syntax.Attr],
  childs : Array[@syntax.ViewExpr],
) -> String {
  let names = []
  let values = []
  let ons = []
  let mut key = "null"
  let mut ns = "null"
  for a in attrs {
    let k = a.key.text
    if k == "key" {
      key = self.view(b, a.value)
    } else if k == "namespace" {
      // The element's own namespace, a constant (tcd.view.namespace).
      guard a.value is Lit(Str(uri), ..) else { continue }
      ns = self.s(uri)
    } else if @check.event_of_key(k) is Some((event, mods)) {
      guard a.value is Call(_, _, sargs, ..) else { continue }
      let msg = name_of(sargs[0])
      let args = b.array(
        "arg_array",
        sargs[1:].to_owned().map(x => self.send_arg(b, x)),
      )
      let spec = if mods.is_empty() {
        event
      } else {
        event + "+" + mods.join("+")
      }
      ons.push("view_on(\{self.s(spec)}, view_action(\{self.s(msg)}, \{args}))")
    } else {
      names.push(self.s(k))
      values.push(self.view(b, a.value))
    }
  }
  let name_arr = b.array("str_array", names)
  let value_arr = b.array("view_array", values)
  let child_arr = self.views(b, childs)
  let on_arr = b.array("view_on_array", ons)
  b.bind(
    "view_el(\{self.s(tag)}, \{ns}, \{name_arr}, \{value_arr}, \{key}, \{child_arr}, \{on_arr})",
  )
}
