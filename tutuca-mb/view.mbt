// Views: the typed AST view builders make. X is what the view reads (a component's state, or
// an Item inside each), S the state of the component the view belongs to, M the messages its
// handlers send.

///|
/// An attribute, key, namespace or handler of an element.
pub enum Prop[X, M] {
  Static(String, @vdom.AttrValue)
  Dyn(String, (X) -> @vdom.AttrValue)
  Key((X) -> String)
  Ns(String)
  On(EventName, (X, Event) -> M?)
}

///|
/// A view node. Builders that change what the body reads (each, scope) hide the body's type
/// in `Ext`, with its static IR beside the thunk that lowers it.
pub enum ViewAt[X, S, M] {
  Text(String)
  Show((X) -> String)
  Elem(String, Array[Prop[X, M]], Array[ViewAt[X, S, M]])
  If((X) -> Bool, ViewAt[X, S, M], ViewAt[X, S, M])
  Frag(Array[ViewAt[X, S, M]])
  Ext(Ir, (Lowerer) -> Plan[X, S, M])
}

///|
/// A component's view: it reads the component's own state.
pub type View[S, M] = ViewAt[S, S, M]

// --- children ---------------------------------------------------------------------------

///|
/// Literal text.
pub fn[X, S, M] txt(text : String) -> ViewAt[X, S, M] {
  Text(text)
}

///|
/// An HTML comment, constant.
pub fn[X, S, M] comment(text : String) -> ViewAt[X, S, M] {
  Ext(IFrag([]), _ => PConst(@vdom.Comment(text)))
}

///|
/// Text computed from what the view reads.
pub fn[X, S, M] show(f : (X) -> String) -> ViewAt[X, S, M] {
  Show(f)
}

///|
pub fn[X, S, M] h(
  tag : String,
  props : Array[Prop[X, M]],
  childs : Array[ViewAt[X, S, M]],
) -> ViewAt[X, S, M] {
  Elem(tag, props, childs)
}

///|
/// Several nodes in place of one; they splice into the parent.
pub fn[X, S, M] frag(childs : Array[ViewAt[X, S, M]]) -> ViewAt[X, S, M] {
  Frag(childs)
}

///|
/// Renders nothing.
pub fn[X, S, M] empty() -> ViewAt[X, S, M] {
  Frag([])
}

///|
pub fn[X, S, M] if_(
  cond : (X) -> Bool,
  then_ : ViewAt[X, S, M],
  else_ : ViewAt[X, S, M],
) -> ViewAt[X, S, M] {
  If(cond, then_, else_)
}

///|
pub fn[X, S, M] when(
  cond : (X) -> Bool,
  then_ : ViewAt[X, S, M],
) -> ViewAt[X, S, M] {
  If(cond, then_, Frag([]))
}

///|
/// What an each body reads: the enclosing context, the item and its position.
pub struct Item[X, T] {
  up : X
  value : T
  index : Int32
}

///|
/// The body once per item, each in a fragment keyed by `key` (the index by default).
pub fn[X, S, T, M] each(
  src : (X) -> Iter[T],
  body : ViewAt[Item[X, T], S, M],
  key? : (T, Int32) -> String,
) -> ViewAt[X, S, M] {
  Ext(IEach(body.ir()), lw => {
    let plan = body.lower(lw)
    PDyn((x, now, r, out) => {
      let items = []
      let mut index = 0
      for value in src(x) {
        let k = match key {
          Some(f) => f(value, index)
          None => index.to_string()
        }
        let childs = []
        let at = index
        // The same item, read again from the current state: by its key, or where it was.
        let item_now = () => {
          now().bind(p => {
            let mut i = 0
            let mut found = None
            for v in src(p) {
              let same = match key {
                Some(f) => f(v, i) == k
                None => i == at
              }
              if same {
                found = Some({ up: p, value: v, index: i, })
                break
              }
              i += 1
            }
            found
          })
        }
        plan.eval({ up: x, value, index, }, item_now, r.enter_key(k), childs)
        items.push(@vdom.VNode::fragment(childs, key=k))
        index += 1
      }
      out.push(@vdom.VNode::fragment(items))
    })
  })
}

///|
/// What a scope body reads: the enclosing context and the value computed for it.
pub struct With[X, Y] {
  up : X
  value : Y
}

///|
/// Computes a value once for the body: JS `scope` with its `bind`.
pub fn[X, S, Y, M] scope(
  bind : (X) -> Y,
  body : ViewAt[With[X, Y], S, M],
) -> ViewAt[X, S, M] {
  Ext(IScope(body.ir()), lw => {
    let plan = body.lower(lw)
    PDyn((x, now, r, out) => {
      plan.eval(
        { up: x, value: bind(x), },
        () => now().map(p => { up: p, value: bind(p), }),
        r,
        out,
      )
    })
  })
}

// --- props --------------------------------------------------------------------------------

///|
/// A static attribute, set when the element is created.
pub fn[X, M] attr(name : String, value : String) -> Prop[X, M] {
  Static(name, Str(value))
}

///|
pub fn[X, M] cls(classes : String) -> Prop[X, M] {
  Static("class", Str(classes))
}

///|
pub fn[X, M] aria(name : String, value : String) -> Prop[X, M] {
  Static("aria-\{name}", Str(value))
}

///|
/// A dynamic attribute or property.
pub fn[X, M] bind(name : String, f : (X) -> @vdom.AttrValue) -> Prop[X, M] {
  Dyn(name, f)
}

///|
pub fn[X, M] bind_str(name : String, f : (X) -> String) -> Prop[X, M] {
  Dyn(name, x => Str(f(x)))
}

///|
/// A dynamic class.
pub fn[X, M] class_(f : (X) -> String) -> Prop[X, M] {
  Dyn("class", x => Str(f(x)))
}

///|
pub fn[X, M] value(f : (X) -> String) -> Prop[X, M] {
  Dyn("value", x => Str(f(x)))
}

///|
pub fn[X, M] checked(f : (X) -> Bool) -> Prop[X, M] {
  Dyn("checked", x => Bool(f(x)))
}

///|
pub fn[X, M] key(f : (X) -> String) -> Prop[X, M] {
  Key(f)
}

///|
pub fn[X, M] ns(uri : String) -> Prop[X, M] {
  Ns(uri)
}

///|
/// Sends `msg` on `event`.
pub fn[X, M] on(event : EventName, msg : M) -> Prop[X, M] {
  On(event, (_, _) => Some(msg))
}

///|
/// Sends what `f` makes of the target's value (`checked` for a checkbox).
pub fn[X, M] on_value(event : EventName, f : (String) -> M) -> Prop[X, M] {
  On(event, (_, e) => Some(f(e.value())))
}

///|
/// The general form: `f` sees what the view read and the event, and may send nothing.
pub fn[X, M] on_event(event : EventName, f : (X, Event) -> M?) -> Prop[X, M] {
  On(event, f)
}

///|
pub fn[X, M] on_click(msg : M) -> Prop[X, M] {
  on(Click, msg)
}

///|
pub fn[X, M] on_dblclick(msg : M) -> Prop[X, M] {
  on(DblClick, msg)
}

///|
pub fn[X, M] on_input(f : (String) -> M) -> Prop[X, M] {
  on_value(Input, f)
}

///|
pub fn[X, M] on_change(f : (String) -> M) -> Prop[X, M] {
  on_value(Change, f)
}

///|
pub fn[X, M] on_check(f : (Bool) -> M) -> Prop[X, M] {
  On(Change, (_, e) => Some(f(e.target_checked)))
}

///|
/// Sends `msg` on submit and prevents the browser's default submit.
pub fn[X, M] on_submit(msg : M) -> Prop[X, M] {
  On(Submit, (_, e) => {
    e.prevent_default()
    Some(msg)
  })
}
