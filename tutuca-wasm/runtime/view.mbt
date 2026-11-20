// Views, as tutuca's src/core/view/view.js: a tree built once, when a module
// is loaded, by its calls of tutuca/view; evaluated against a component it
// gives virtual nodes (vdom.mbt), each child component and each loop item
// between the comments that say where in the state it came from.

///|
extern "wasm" fn has_entry(path : String) -> Bool = "tutuca" "has_entry"

///|
/// JavaScript's String(value): what a text node shows.
extern "wasm" fn text_of(v : Val) -> String = "tutuca" "text_of"

///|
priv struct Binding {
  type_ : String
  action : View
  key : String?
  held : Array[String]
  prevent : Bool
  stop : Bool
}

///|
/// An element of a view: what every render of it shares.
priv struct Elem {
  id : Int32
  tag : String
  space : String?
  /// Set when the element is created, never compared.
  statics : Array[(String, Val)]
  /// The attributes a render computes, and what computes each.
  names : Array[String]
  exprs : Array[View]
  key : View?
  children : Array[View]
  bindings : Array[Binding]
}

///|
priv enum View {
  Constant(Val)
  Field(String)
  Query(String, Array[View])
  SeqItem(String, String)
  Provided(String)
  Element(Elem)
  Cond(View, View, View)
  Render(View, String?)
  Each(View, View, String?)
  RenderEach(View, String?)
  RenderIt(String?)
  WithBinds(String, View)
  PushView(View, View)
  Send(String, Array[View])
  EventArg(String, String?)
  LookupBind(String)
}

///|
/// The views made, by the id their handles hold, and the elements with
/// event bindings, by the id their data-eid says.
priv struct Views {
  nodes : Array[View]
  bound : Map[Int32, Elem]
  mut elems : Int32
  mut eids : Int32
}

///|
let views : Views = { nodes: [], bound: Map([]), elems: 0, eids: 0, }

///|
fn keep(v : View) -> Val {
  views.nodes.push(v)
  let fields = obj_new()
  obj_put(fields, "id", v_num((views.nodes.length() - 1).to_double()))
  v_handle("View", fields)
}

///|
extern "wasm" fn v_handle_fields(v : Val) -> Val = "values" "v_handle_fields"

///|
/// A value as a view: one a call of tutuca/view made, or itself, constant.
fn to_node(v : Val) -> View {
  if kind(v) is Handle && v_handle_name(v) == "View" {
    let id = get(v_handle_fields(v), "id")
    if kind(id) is Num {
      match views.nodes.get(v_num_of(id).to_int()) {
        Some(node) => return node
        None => ()
      }
    }
  }
  Constant(v)
}

///|
let key_modifiers : Map[String, String] = {
  "enter": "Enter",
  "escape": "Escape",
  "esc": "Escape",
  "tab": "Tab",
  "space": " ",
  "up": "ArrowUp",
  "down": "ArrowDown",
  "left": "ArrowLeft",
  "right": "ArrowRight",
  "delete": "Delete",
  "backspace": "Backspace",
}

///|
let held_modifiers : Map[String, String] = {
  "ctrl": "ctrlKey",
  "alt": "altKey",
  "shift": "shiftKey",
  "meta": "metaKey",
}

///|
fn event_binding(spec : String, action : View) -> Binding raise Fault {
  let parts = spec.split("+").map(p => p.to_owned()).collect()
  let mut key = None
  let held = []
  let mut prevent = false
  let mut stop = false
  for i in 1..<parts.length() {
    let m = parts[i]
    match (key_modifiers.get(m), held_modifiers.get(m)) {
      (Some(k), _) => key = Some(k)
      (_, Some(h)) => held.push(h)
      _ =>
        if m == "prevent" {
          prevent = true
        } else if m == "stop" {
          stop = true
        } else {
          let known = [
            ..key_modifiers.keys().collect(),
            ..held_modifiers.keys().collect(),
            "prevent",
            "stop",
          ]
          raise fault(
            "Unknown event modifier \{m} in on:\{spec} (one of \{known.join(", ")})",
          )
        }
    }
  }
  { type_: parts[0], action, key, held, prevent, stop, }
}

///|
let dynamic_only : Array[String] = [
  "value", "checked", "is", "dangerouslySetInnerHTML",
]

///|
/// Children, any lists among them flattened.
fn flatten(xs : Array[Val], out : Array[View]) -> Unit {
  for x in xs {
    if kind(x) is List {
      flatten(items(x), out)
    } else {
      out.push(to_node(x))
    }
  }
}

///|
/// h(tag, attrs, ...children): an element.
fn element(
  tag : String,
  attrs : Val,
  children : Array[Val],
) -> View raise Fault {
  let statics = []
  let names = []
  let exprs = []
  let bindings = []
  let mut space : String? = None
  let mut key = None
  for name in keys(attrs) {
    let value = to_node(obj_get(attrs, name))
    if name.has_prefix("on:") {
      bindings.push(event_binding(name.exact_view(start=3).to_owned(), value))
    } else if name == "key" {
      key = Some(value)
    } else if name == "namespace" {
      guard value is Constant(ns) && kind(ns) is Str else {
        raise fault("<\{tag}> namespace must be a constant")
      }
      space = Some(v_str_of(ns))
    } else if value is Constant(v) && !dynamic_only.contains(name) {
      statics.push((name, v))
    } else {
      names.push(name)
      exprs.push(value)
    }
  }
  let mut tag = tag
  if space is None {
    let lower = tag.to_lower()
    if lower == "svg" {
      space = Some("http://www.w3.org/2000/svg")
      tag = lower
    } else if lower == "math" {
      space = Some("http://www.w3.org/1998/Math/MathML")
      tag = lower
    }
  }
  let kids = []
  flatten(children, kids)
  views.elems += 1
  let elem : Elem = {
    id: views.elems,
    tag,
    space,
    statics,
    names,
    exprs,
    key,
    children: kids,
    bindings,
  }
  // An element with event bindings says which it is, for an event to find it.
  if bindings.length() > 0 {
    statics.push(("data-eid", v_num(views.eids.to_double())))
    views.bound[views.eids] = elem
    views.eids += 1
  }
  Element(elem)
}

///|
/// An element's attributes, when the first argument is them: a record that
/// isn't a view.
fn split_args(args : Array[Val]) -> (Val, Array[Val]) {
  match args {
    [first, .. rest] if kind(first) is Obj && v_class(first) == "" =>
      (first, rest.to_owned())
    _ => (obj_new(), args)
  }
}

///|
/// What a function of tutuca/view makes.
fn view_call(name : String, args : Array[Val]) -> Val raise Fault {
  let arg = (i : Int32) => args.get(i).unwrap_or(undefined())
  let text = (i : Int32) => {
    if kind(arg(i)) is Str {
      v_str_of(arg(i))
    } else {
      ""
    }
  }
  let opt = (i : Int32) => {
    if kind(arg(i)) is Str {
      Some(v_str_of(arg(i)))
    } else {
      None
    }
  }
  let rest = (from : Int32) => {
    if from < args.length() {
      args[from:].to_owned().map(to_node)
    } else {
      []
    }
  }
  let node = match name {
    "field" => Field(text(0))
    "query" => Query(text(0), rest(1))
    "seqItem" => SeqItem(text(0), text(1))
    "provided" => Provided(text(0))
    "when" => Cond(to_node(arg(0)), to_node(arg(1)), to_node(arg(2)))
    "render" => Render(to_node(arg(0)), opt(1))
    "each" => Each(to_node(arg(0)), to_node(arg(1)), opt(2))
    "renderEach" => RenderEach(to_node(arg(0)), opt(1))
    "renderIt" => RenderIt(opt(0))
    "withBinds" => WithBinds(text(0), to_node(arg(1)))
    "pushView" => PushView(to_node(arg(0)), to_node(arg(1)))
    "send" => Send(text(0), rest(1))
    "targetValue" | "eventKey" | "sourceKey" | "dragKey" => EventArg(name, None)
    "eventProperty" => EventArg(name, opt(0))
    "lookupBind" => LookupBind(text(0))
    "h" => {
      let children = if args.length() > 2 { args[2:].to_owned() } else { [] }
      element(
        text(0),
        if kind(arg(1)) is Obj {
          arg(1)
        } else {
          obj_new()
        },
        children,
      )
    }
    "button" => {
      // A button is one that doesn't submit, unless it says otherwise.
      let (given, children) = split_args(args)
      let attrs = obj_new()
      obj_put(attrs, "type", v_str("button"))
      for k in keys(given) {
        obj_put(attrs, k, obj_get(given, k))
      }
      element("button", attrs, children)
    }
    tag => {
      let (attrs, children) = split_args(args)
      element(tag, attrs, children)
    }
  }
  keep(node)
}

///|
/// What a view evaluates to: a value, nodes, or nothing.
priv enum Out {
  Value(Val)
  Node(VNode)
  Many(Array[Out])
}

///|
/// Where a render is: what it reads (it), the component whose view it is,
/// the names loops and scopes bound, the views pushed, how deep.
priv struct Rctx {
  it : Val
  component : Val
  binds : Map[String, Val]
  /// What the components above provide, by name.
  provided : Map[String, Provided]
  view_stack : Array[String]
  depth : Int32
}

///|
/// A value a component provides to what it renders: the value, and the keys
/// to it from its provider.
priv struct Provided {
  value : Val
  keys : Array[Json]
}

///|
/// A frame of a path into the state: the keys to a value, and the item of it.
priv struct Frame {
  keys : Array[Json]
  item : Json
  /// The name of the provided value the keys start from, when they do.
  provider : String?
}

///|
fn key_json(v : Val) -> Json {
  match kind(v) {
    Num | Str => to_json(v)
    _ => Json::null()
  }
}

///|
fn Frame::for_item(self : Frame, key : Val) -> Frame {
  let keys = self.keys.copy()
  if !(self.item is Null) {
    keys.push(self.item)
  }
  { keys, item: key_json(key), provider: self.provider, }
}

///|
/// The comment that opens what a frame's value renders.
fn frame_open(frame : Frame) -> VNode {
  let marker : Map[String, Json] = {
    "t": "frame",
    "p": match frame.provider {
      Some(name) => { "v": Json::string(name) }
      None => Json::null()
    },
    "k": Json::array(frame.keys),
    "i": frame.item,
  }
  VComment("§\{Json::object(marker).stringify()}§")
}

///|
let marker_close : String = "§/§"

///|
/// What a component, or anything, has under a name: a field, or a query.
fn Scope::read(self : Scope, it : Val, name : String) -> Val {
  match kind(it) {
    Obj =>
      if has(it, name) {
        obj_get(it, name)
      } else {
        match self.spec_of(it) {
          Some(spec) if spec.queries.get(name) is Some("get") =>
            call_entry("\{spec.at}.queries.\{name}", it, []) catch {
              _ => undefined()
            }
          _ => undefined()
        }
      }
    List | Str =>
      if name == "length" {
        v_num(length_of(it).to_double())
      } else {
        undefined()
      }
    _ => undefined()
  }
}

///|
/// A value's item at a key: a list's by number, a record's by name.
fn item_at(items : Val, key : Val) -> Val {
  match (kind(items), kind(key)) {
    (List, Num) => {
      let i = v_num_of(key).to_int()
      if i >= 0 && i < v_len(items) {
        v_at(items, i)
      } else {
        undefined()
      }
    }
    (Obj, Str) => get(items, v_str_of(key))
    (Obj, Num) => get(items, text_of(key))
    _ => undefined()
  }
}

///|
/// A path, as data, as the frames it is from a value: "field", a number,
/// { item: "field", key }, { seqItem: "field", keyField: "field" }, or a
/// list of those.
fn Scope::fix_path(self : Scope, path : Json, from : Val) -> Array[PFrame] {
  let steps = match path {
    Array(xs) => xs
    x => [x]
  }
  let frames = []
  let mut value = from
  for step in steps {
    let frame : PFrame = match step {
      String(_) | Number(_, ..) =>
        { keys: [step], item: Json::null(), node: true, provider: None, }
      Object(m) =>
        match (m.get("item"), m.get("seqItem")) {
          (Some(name), _) =>
            {
              keys: [name],
              item: m.get("key").unwrap_or(Json::null()),
              node: true,
              provider: None,
            }
          (_, Some(name)) => {
            let key = match m.get("keyField") {
              Some(String(k)) => key_json(self.read(value, k))
              _ => Json::null()
            }
            { keys: [name], item: key, node: true, provider: None, }
          }
          _ => continue
        }
      _ => continue
    }
    frames.push(frame)
    value = get_in(value, frame.access_keys())
  }
  frames
}

///|
/// The context of what a value renders: one deeper, with what the value
/// provides when it is a component that does.
fn Scope::enter(
  self : Scope,
  ctx : Rctx,
  it : Val,
  binds : Map[String, Val],
) -> Rctx {
  let depth = ctx.depth + 1
  let provided = match self.spec_of(it) {
    Some(spec) if spec.provides.length() > 0 => {
      let all = ctx.provided.copy()
      for p in spec.provides {
        let keys = to_key_path(self.fix_path(p.1, it))
        all[p.0] = { value: get_in(it, keys), keys, }
      }
      all
    }
    _ => ctx.provided
  }
  { ..ctx, it, binds, provided, depth, }
}

///|
fn as_value(out : Out) -> Val {
  match out {
    Value(v) => v
    _ => undefined()
  }
}

///|
fn add_child(children : Array[VNode], out : Out) -> Unit {
  match out {
    Node(n) => children.push(n)
    Many(xs) =>
      for x in xs {
        add_child(children, x)
      }
    Value(v) =>
      match kind(v) {
        Undefined | Null => ()
        List =>
          for x in items(v) {
            add_child(children, Value(x))
          }
        _ => children.push(VText(text_of(v)))
      }
  }
}

///|
fn to_vchildren(out : Out) -> Array[VNode] {
  let children = []
  add_child(children, out)
  children
}

///|
/// The frame a view's value is at, for a view that reads one from the state.
fn Scope::frame_of(
  self : Scope,
  source : View,
  ctx : Rctx,
) -> Frame raise Fault {
  match source {
    Field(name) =>
      { keys: [Json::string(name)], item: Json::null(), provider: None, }
    SeqItem(seq, key) =>
      {
        keys: [Json::string(seq)],
        item: key_json(self.read(ctx.it, key)),
        provider: None,
      }
    Provided(name) => { keys: [], item: Json::null(), provider: Some(name), }
    _ =>
      raise fault(
        "a view renders what it reads from the state: a field or a seqItem",
      )
  }
}

///|
/// A component's data member, as its module says it: a loop's view, a name.
fn Scope::data(_self : Scope, component : String, path : Array[String]) -> Val {
  let mut v = world_consts.get(component).unwrap_or(undefined())
  for k in path {
    v = get(v, k)
  }
  v
}

///|
/// The view a component renders with: the one asked for, else the first of
/// the views pushed that it has, else main.
fn Scope::best_view(
  _self : Scope,
  spec : Spec,
  ctx : Rctx,
  name : String?,
) -> View raise Fault {
  let candidates = match name {
    Some(n) => [n, ..ctx.view_stack]
    None => ctx.view_stack
  }
  for c in candidates {
    match world_views.get("\{spec.at}/\{c}") {
      Some(v) => return v
      None => ()
    }
  }
  match world_views.get("\{spec.at}/main") {
    Some(v) => v
    None => raise fault("Component \{spec.name} has no main view")
  }
}

///|
/// A component, rendered: its view, between the comments that say a
/// component starts and ends there.
fn Scope::render_view(
  self : Scope,
  instance : Val,
  ctx : Rctx,
  name : String?,
) -> Out raise Fault {
  guard self.spec_of(instance) is Some(spec) else {
    raise fault("a view renders components, and this isn't one")
  }
  let view = self.best_view(spec, ctx, name)
  // Where each value it provides is in it, for an event to find its way back.
  let marker : Map[String, Json] = { "t": "component" }
  if spec.provides.length() > 0 {
    let keys : Map[String, Json] = Map([])
    for p in spec.provides {
      match ctx.provided.get(p.0) {
        Some(entry) => keys[p.0] = Json::array(entry.keys)
        None => ()
      }
    }
    marker["p"] = Json::object(keys)
  }
  Many([
    Node(VComment("§\{Json::object(marker).stringify()}§")),
    self.eval(view, { ..ctx, component: instance, }),
    Node(VComment(marker_close)),
  ])
}

///|
/// A loop's entries: each key and value, the names it binds, the key its
/// fragment has.
fn Scope::loop_entries(
  self : Scope,
  ctx : Rctx,
  source : View,
  name : String?,
) -> Array[(Val, Val, Map[String, Val], Val)] raise Fault {
  let this = ctx.component
  let items_ = as_value(self.eval(source, ctx))
  let hook = (what : String) => {
    match (name, self.spec_of(this)) {
      (Some(l), Some(spec)) => {
        let path = "\{spec.at}.loops.\{l}.\{what}"
        if has_entry(path) {
          Some(path)
        } else {
          None
        }
      }
      _ => None
    }
  }
  let state = match hook("prepare") {
    Some(path) => call_entry(path, this, [items_])
    None => null_()
  }
  let entries : Array[(Val, Val)] = match hook("iter") {
    Some(path) =>
      items(call_entry(path, this, [items_, state])).map(e => {
        (item_at(e, v_num(0.0)), item_at(e, v_num(1.0)))
      })
    None => {
      let all : Array[(Val, Val)] = match kind(items_) {
        List =>
          Array::makei(v_len(items_), i => {
            (v_num(i.to_double()), v_at(items_, i))
          })
        Obj => keys(items_).map(k => (v_str(k), obj_get(items_, k)))
        _ => []
      }
      match hook("filter") {
        Some(path) => {
          let kept = []
          for e in all {
            if truthy(call_entry(path, this, [e.0, e.1, state])) {
              kept.push(e)
            }
          }
          kept
        }
        None => all
      }
    }
  }
  let out = []
  for e in entries {
    let (key, value) = e
    let fragment_key = match hook("key") {
      Some(path) => call_entry(path, this, [key, value, state])
      None => key
    }
    let binds : Map[String, Val] = Map([])
    match hook("enrich") {
      Some(path) => {
        let more = call_entry(path, this, [key, value, state])
        for k in keys(more) {
          binds[k] = obj_get(more, k)
        }
      }
      None => ()
    }
    binds["value"] = value
    binds["key"] = key
    out.push((key, value, binds, fragment_key))
  }
  out
}

///|
fn key_text(v : Val) -> String? {
  match kind(v) {
    Undefined | Null => None
    _ => Some(text_of(v))
  }
}

///|
/// A loop's items, each a keyed fragment of what it renders between its
/// frame's comments.
fn Scope::loop_fragments(
  self : Scope,
  ctx : Rctx,
  source : View,
  name : String?,
  item : (Rctx) -> Out raise Fault,
) -> Out raise Fault {
  let frame = self.frame_of(source, ctx)
  let nodes = []
  for e in self.loop_entries(ctx, source, name) {
    let (key, value, binds, fragment_key) = e
    let children = [frame_open(frame.for_item(key))]
    add_child(children, item(self.enter(ctx, value, binds)))
    children.push(VComment(marker_close))
    nodes.push(VFragment(children, key_text(fragment_key)))
  }
  Node(VFragment(nodes, None))
}

///|
fn Scope::eval(self : Scope, view : View, ctx : Rctx) -> Out raise Fault {
  match view {
    Constant(v) => Value(v)
    Field(name) => Value(self.read(ctx.it, name))
    Query(name, args) => {
      guard self.spec_of(ctx.it) is Some(spec) else {
        return Value(undefined())
      }
      let given = []
      for a in args {
        given.push(as_value(self.eval(a, ctx)))
      }
      Value(call_entry("\{spec.at}.queries.\{name}", ctx.it, given))
    }
    SeqItem(seq, key) =>
      Value(item_at(self.read(ctx.it, seq), self.read(ctx.it, key)))
    Provided(name) =>
      Value(
        match ctx.provided.get(name) {
          Some(entry) => entry.value
          None => undefined()
        },
      )
    Element(e) => {
      let values = []
      for x in e.exprs {
        values.push(as_value(self.eval(x, ctx)))
      }
      let children = []
      for c in e.children {
        add_child(children, self.eval(c, ctx))
      }
      let key = match e.key {
        Some(k) => key_text(as_value(self.eval(k, ctx)))
        None => None
      }
      Node(VElem({ elem: e, values, children, key, }))
    }
    Cond(test_, then, otherwise) =>
      if truthy(as_value(self.eval(test_, ctx))) {
        self.eval(then, ctx)
      } else {
        self.eval(otherwise, ctx)
      }
    Render(source, name) => {
      let child = as_value(self.eval(source, ctx))
      if kind(child) is (Undefined | Null) {
        return Many([])
      }
      Many([
        Node(frame_open(self.frame_of(source, ctx))),
        self.render_view(child, self.enter(ctx, child, Map([])), name),
        Node(VComment(marker_close)),
      ])
    }
    Each(source, child, name) =>
      self.loop_fragments(ctx, source, name, item => self.eval(child, item))
    RenderEach(source, name) => {
      let view_name = match (name, self.spec_of(ctx.component)) {
        (Some(l), Some(spec)) => {
          let v = self.data(spec.at, ["loops", l, "view"])
          if kind(v) is Str {
            Some(v_str_of(v))
          } else {
            None
          }
        }
        _ => None
      }
      self.loop_fragments(ctx, source, name, item => {
        self.render_view(item.it, { ..item, binds: Map([]), }, view_name)
      })
    }
    RenderIt(name) => {
      let it = ctx.binds.get("value").unwrap_or(null_())
      self.render_view(it, { ..ctx, it, binds: Map([]), }, name)
    }
    WithBinds(name, child) => {
      guard self.spec_of(ctx.component) is Some(spec) else {
        return self.eval(child, ctx)
      }
      let more = call_entry("\{spec.at}.binds.\{name}", ctx.component, [])
      let binds = ctx.binds.copy()
      for k in keys(more) {
        if k != "value" {
          binds[k] = obj_get(more, k)
        }
      }
      self.eval(child, { ..ctx, binds, })
    }
    PushView(source, child) => {
      let name = text_of(as_value(self.eval(source, ctx)))
      self.eval(child, { ..ctx, view_stack: [name, ..ctx.view_stack], })
    }
    LookupBind(name) => Value(ctx.binds.get(name).unwrap_or(null_()))
    // What an event sends: read when the event happens, not when rendering.
    Send(_, _) | EventArg(_, _) => Value(undefined())
  }
}

///|
/// The root, rendered: the virtual nodes of the page.
fn Scope::render_root(self : Scope, root : Val) -> Array[VNode] raise Fault {
  let outside : Rctx = {
    it: root,
    component: root,
    binds: Map([]),
    provided: Map([]),
    view_stack: [],
    depth: -1,
  }
  to_vchildren(self.render_view(root, self.enter(outside, root, Map([])), None))
}
