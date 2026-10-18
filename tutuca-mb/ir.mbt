// The untyped static IR of a view: its structure without the closures, for the check pass,
// event and class collection, and tools. Built without a component instance.

///|
pub(all) enum Ir {
  IText(String)
  IShow
  IElem(IrElem)
  IIf(Ir, Ir)
  IFrag(Array[Ir])
  IEach(Ir)
  IScope(Ir)
  IRender(IrRender)
  IPushView(String?, Ir) // The view name, when it is a constant.
  IProvided(String, Ir) // A body that reads what an ancestor provides under that name.
}

///|
pub(all) struct IrElem {
  tag : String
  ns : Array[String] // Every namespace prop given; more than one is an issue.
  statics : Array[(String, @vdom.AttrValue)]
  dyns : Array[String]
  events : Array[EventName]
  has_key : Bool
  childs : Array[Ir]
}

///|
/// A component render site: which component and view it asks for, resolved lazily so a
/// view may render its own component.
pub(all) struct IrRender {
  kind : String // "render", "render_key", "render_each", "render_provided"
  provided : String? // The provided name a render_provided reads.
  component : () -> String
  view_name : String?
  view_names : () -> Array[String]
}

///|
pub fn[X, S, M] ViewAt::ir(self : ViewAt[X, S, M]) -> Ir {
  match self {
    Text(s) => IText(s)
    Show(_) => IShow
    Elem(tag, props, childs) => {
      let ns = []
      let statics = []
      let dyns = []
      let events = []
      let mut has_key = false
      for prop in props {
        match prop {
          Static(name, v) => statics.push((name, v))
          Dyn(name, _) => dyns.push(name)
          Key(_) => has_key = true
          Ns(uri) => ns.push(uri)
          On(event, _) => events.push(event)
        }
      }
      IElem({
        tag,
        ns,
        statics,
        dyns,
        events,
        has_key,
        childs: childs.map(c => c.ir()),
      })
    }
    If(_, a, b) => IIf(a.ir(), b.ir())
    Frag(childs) => IFrag(childs.map(c => c.ir()))
    Ext(ir, _) => ir
  }
}

///|
/// Calls `f` on every node, parents before children.
pub fn Ir::walk(self : Ir, f : (Ir) -> Unit) -> Unit {
  f(self)
  match self {
    IText(_) | IShow | IRender(_) => ()
    IElem(e) =>
      for c in e.childs {
        c.walk(f)
      }
    IIf(a, b) => {
      a.walk(f)
      b.walk(f)
    }
    IFrag(cs) =>
      for c in cs {
        c.walk(f)
      }
    IEach(b) | IScope(b) | IPushView(_, b) | IProvided(_, b) => b.walk(f)
  }
}

///|
/// The DOM event names the view handles, each once: what the host listens for.
pub fn Ir::event_names(self : Ir) -> Array[String] {
  let out = []
  self.walk(node => {
    if node is IElem(e) {
      for ev in e.events {
        let name = ev.dom_name()
        if !out.contains(name) {
          out.push(name)
        }
      }
    }
  })
  out
}

///|
/// The static class names the view uses, for a CSS compiler. Dynamic classes escape it, as in
/// JS, and are collected from the rendered DOM instead.
pub fn Ir::class_names(self : Ir) -> Array[String] {
  let out = []
  self.walk(node => {
    if node is IElem(e) {
      for attr in e.statics {
        if attr.0 == "class" {
          for c in attr.1.to_attr_string().split(" ") {
            let c = c.to_owned()
            if c != "" && !out.contains(c) {
              out.push(c)
            }
          }
        }
      }
    }
  })
  out
}

///|
/// The view as the builder calls that make it, one node per line.
pub fn Ir::to_code(self : Ir) -> String {
  let lines = []
  fn go(ir : Ir, depth : Int32) {
    let pad = " ".repeat(depth * 2)
    match ir {
      IText(s) => lines.push("\{pad}txt(\{@debug.to_string(s)})")
      IShow => lines.push("\{pad}show(…)")
      IElem(e) => {
        let props = []
        for a in e.statics {
          let v = @debug.to_string(a.1.to_attr_string())
          props.push(
            if a.0 == "class" {
              "cls(\{v})"
            } else {
              "attr(\{@debug.to_string(a.0)}, \{v})"
            },
          )
        }
        for d in e.dyns {
          props.push("bind(\{@debug.to_string(d)}, …)")
        }
        for ev in e.events {
          props.push("on(\{ev.dom_name()}, …)")
        }
        if e.has_key {
          props.push("key(…)")
        }
        lines.push("\{pad}h(\{@debug.to_string(e.tag)}, [\{props.join(", ")}])")
        for c in e.childs {
          go(c, depth + 1)
        }
      }
      IIf(a, b) => {
        lines.push("\{pad}if_(…)")
        go(a, depth + 1)
        go(b, depth + 1)
      }
      IFrag(cs) =>
        for c in cs {
          go(c, depth)
        }
      IEach(b) => {
        lines.push("\{pad}each(…)")
        go(b, depth + 1)
      }
      IScope(b) => {
        lines.push("\{pad}scope(…)")
        go(b, depth + 1)
      }
      IPushView(name, b) => {
        let arg = match name {
          Some(n) => @debug.to_string(n)
          None => "…"
        }
        lines.push("\{pad}push_view(\{arg})")
        go(b, depth + 1)
      }
      IProvided(_, b) => go(b, depth)
      IRender(r) => {
        let view = match r.view_name {
          Some(v) => ", view=\{@debug.to_string(v)}"
          None => ""
        }
        lines.push("\{pad}\{r.kind}(\{(r.component)()}\{view})")
      }
    }
  }

  go(self, 0)
  lines.join("\n")
}

///|
/// What the view's root is, in a few words: "<div> element", "2 nodes", "text".
pub fn Ir::words(self : Ir) -> String {
  match self {
    IText(_) => "text"
    IShow => "computed text"
    IElem(e) => "<\{e.tag}> element"
    IIf(_, _) => "a choice of two views"
    IFrag(cs) =>
      if cs.length() == 1 {
        cs[0].words()
      } else {
        "\{cs.length()} nodes"
      }
    IEach(_) => "a loop"
    IScope(_) => "a scope"
    IPushView(_, _) => "a view pushed below"
    IProvided(_, b) => b.words()
    IRender(r) => "\{(r.component)()} rendered"
  }
}
