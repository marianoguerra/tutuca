// Lowering: a view becomes a plan the vdom can render cheaply. Each element gets one Shape
// (tag, namespace, static attrs, dynamic names), adjacent literal texts merge, fully constant
// subtrees are prebuilt once and shared by identity, and handler sites get an eid.

///|
pub enum Plan[X, S, M] {
  PConst(@vdom.VNode)
  PText((X) -> String)
  PElem(ElemPlan[X, S, M])
  PIf((X) -> Bool, Plan[X, S, M], Plan[X, S, M])
  PFrag(Array[Plan[X, S, M]])
  // What it reads, how to read that again from the current state (for handlers, which run
  // later), the context, and where its vnodes go.
  PDyn((X, () -> X?, Rctx[S, M], Array[@vdom.VNode]) -> Unit)
}

///|
pub struct ElemPlan[X, S, M] {
  shape : @vdom.Shape
  dyns : Array[(X) -> @vdom.AttrValue] // Aligned with shape.names, before data-h.
  key : ((X) -> String)?
  eid : Int32
  handlers : Array[(String, (X, Event) -> M?)]
  childs : Array[Plan[X, S, M]]
}

///|
/// The attribute an element with handlers carries: the id of its bound handlers.
pub let handler_attr : String = "data-h"

///|
/// The state of one lowering: eids number handler sites from 1 within it.
pub struct Lowerer {
  mut next_eid : Int32
}

///|
pub fn Lowerer::new() -> Lowerer {
  { next_eid: 0, }
}

///|
/// Lowers a view, raising when it fails the check pass. Lower once and keep the plan.
pub fn[X, S, M] ViewAt::compile(
  self : ViewAt[X, S, M],
) -> Plan[X, S, M] raise ViewError {
  let issues = check(self.ir())
  if issues.length() > 0 {
    raise ViewError(issues)
  }
  self.lower(Lowerer::new())
}

///|
/// Lowers without checking: a shape error is an abort here, check reports it first.
fn[X, S, M] ViewAt::lower(
  self : ViewAt[X, S, M],
  lw : Lowerer,
) -> Plan[X, S, M] {
  match self {
    Text(s) => PConst(Text(s))
    Show(f) => PText(f)
    Elem(tag, props, childs) => lower_elem(tag, props, childs, lw)
    If(c, a, b) => PIf(c, a.lower(lw), b.lower(lw))
    Frag(childs) => {
      let plans = lower_childs(childs, lw)
      if plans.length() == 1 {
        plans[0]
      } else {
        PFrag(plans)
      }
    }
    Ext(_, lower) => lower(lw)
  }
}

///|
/// Lowers children, splicing fragments and merging adjacent literal texts.
fn[X, S, M] lower_childs(
  childs : Array[ViewAt[X, S, M]],
  lw : Lowerer,
) -> Array[Plan[X, S, M]] {
  let out : Array[Plan[X, S, M]] = []
  fn add(plan : Plan[X, S, M]) {
    match (plan, out.last()) {
      (PFrag(ps), _) =>
        for p in ps {
          add(p)
        }
      (PConst(Text(b)), Some(PConst(Text(a)))) =>
        out[out.length() - 1] = PConst(Text(a + b))
      _ => out.push(plan)
    }
  }

  for c in childs {
    add(c.lower(lw))
  }
  out
}

///|
fn[X, S, M] lower_elem(
  tag : String,
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
  lw : Lowerer,
) -> Plan[X, S, M] {
  let statics = []
  let names = []
  let dyns = []
  let handlers = []
  let mut ns = None
  let mut key = None
  // Constant values of these still go in a slot: they are applied after the element's
  // children, so they never fold into the shape.
  let const_values = []
  for prop in props {
    match prop {
      Static(name, v) if dynamic_only.contains(name) => {
        names.push(name)
        dyns.push(_ => v)
        const_values.push(v)
      }
      Static(name, v) => statics.push((name, v))
      Dyn(name, f) => {
        names.push(name)
        dyns.push(f)
      }
      Key(f) => key = Some(f)
      Ns(uri) => ns = Some(uri)
      On(event, f) => handlers.push((event.dom_name(), f))
    }
  }
  let eid = if handlers.length() > 0 {
    names.push(handler_attr)
    lw.next_eid += 1
    lw.next_eid
  } else {
    -1
  }
  let shape = @vdom.Shape::new(tag, ns?, static_attrs=statics, names~) catch {
    ShapeError(msg) => abort(msg)
  }
  let plans = lower_childs(childs, lw)
  let consts = []
  for p in plans {
    if p is PConst(v) {
      consts.push(v)
    }
  }
  if names.length() == const_values.length() &&
    key is None &&
    consts.length() == plans.length() {
    PConst(@vdom.VNode::elem(shape, const_values, consts))
  } else {
    PElem({ shape, dyns, key, eid, handlers, childs: plans, })
  }
}

///|
pub fn[X, S, M] Plan::eval(
  self : Plan[X, S, M],
  x : X,
  now : () -> X?,
  r : Rctx[S, M],
  out : Array[@vdom.VNode],
) -> Unit {
  match self {
    PConst(v) => out.push(v)
    PText(f) => out.push(Text(f(x)))
    PElem(e) => {
      let values = e.dyns.map(f => f(x))
      if e.handlers.length() > 0 {
        let id = r.handler_id(e.eid)
        r.env.bind(
          id,
          e.handlers.map(h => {
            // As JS evaluates `send` arguments, the message is made again when its task runs,
            // from what the view reads then, not from what it read when it rendered.
            (
              h.0,
              (ev : Event) => {
                (h.1)(now().unwrap_or(x), ev).map(m => {
                  (r.send)(m, () => now().bind(x => (h.1)(x, ev)), ev)
                })
              },
            )
          }),
        )
        values.push(Str(id))
      }
      let childs = []
      for c in e.childs {
        c.eval(x, now, r, childs)
      }
      out.push(
        @vdom.VNode::elem(e.shape, values, childs, key?=e.key.map(f => f(x))),
      )
    }
    PIf(c, a, b) => {
      // The branch sits in a fragment of its own, which holds its place among its siblings
      // even when empty: a `when` turning off doesn't shift what follows onto other nodes.
      let branch = []
      if c(x) {
        a.eval(x, now, r, branch)
      } else {
        b.eval(x, now, r, branch)
      }
      out.push(@vdom.VNode::fragment(branch))
    }
    PFrag(ps) =>
      for p in ps {
        p.eval(x, now, r, out)
      }
    PDyn(f) => f(x, now, r, out)
  }
}

///|
pub fn[X, S, M] Plan::render(
  self : Plan[X, S, M],
  x : X,
  r : Rctx[S, M],
) -> Array[@vdom.VNode] {
  let out = []
  self.eval(x, () => Some(x), r, out)
  out
}
