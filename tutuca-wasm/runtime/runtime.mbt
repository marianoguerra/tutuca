// The runtime: components by name, the root they make, and what a message
// does to it. As tutuca's own (src/core, src/tree), with pure-js's values for
// state: a handler reads its component frozen and changes a copy of it, and a
// commit keeps of the old state what didn't change.

///|
/// Runs an entry of a loaded module: this, and its arguments as a list.
extern "wasm" fn entry_ffi(path : String, this : Val, args : Val) -> Val = "tutuca" "entry"

///|
/// How the last entry failed, "" when it finished.
extern "wasm" fn entry_error() -> String = "tutuca" "entry_error"

///|
/// Ends the entry that called the runtime, as an error of a kind.
extern "wasm" fn throw_ffi(kind : String, message : String) = "tutuca" "throw"

///|
extern "wasm" fn env_now() -> Double = "tutuca" "now"

///|
extern "wasm" fn env_uuid() -> String = "tutuca" "uuid"

///|
priv struct Handler {
  name : String
  args : Array[Type]?
  pure : Bool
  swap : Bool
  pre : Bool
  post : Bool
}

///|
priv struct Spec {
  /// Which of the components loaded it is: what a component's class says.
  n : Int32
  /// Where its module's entries and its space are: its module's tag and its
  /// name there.
  at : String
  name : String
  fields : Array[(String, Type)]
  /// The fields that sync at no level: state of the moment, not kept.
  unsynced : Array[String]
  /// get or call, by name.
  queries : Map[String, String]
  on : Map[String, Handler]
  invariants : Array[String]
  /// The outcomes it handles of each ask's answer.
  answers : Map[String, Array[String]]
  init : Bool
  implements : Array[String]
  /// The values it gives what it renders: each name and the path to it.
  provides : Array[(String, Json)]
  /// What it says of itself to hosts, by a namespace's URI.
  meta : Map[String, Json]
}

///|
/// Names, nested into a tree: what is registered in a scope is found from it
/// and from the scopes below it.
priv struct Scope {
  n : Int32
  parent : Scope?
  children : Map[String, Scope]
  /// The components a scope makes, by the name each is registered as.
  specs : Map[String, Spec]
  interfaces : Array[String]
  /// The functions that answer its components' asks: each one's entry.
  asks : Map[String, String]
  /// Each meta namespace's keys and their types, by its URI.
  meta_schemas : Map[String, Array[(String, Type)]]
}

///|
fn Scope::lookup_spec(self : Scope, name : String) -> Spec? {
  match self.specs.get(name) {
    Some(spec) => Some(spec)
    None =>
      match self.parent {
        Some(p) => p.lookup_spec(name)
        None => None
      }
  }
}

///|
fn Scope::has_interface(self : Scope, name : String) -> Bool {
  self.interfaces.contains(name) ||
  (match self.parent {
    Some(p) => p.has_interface(name)
    None => false
  })
}

///|
fn Scope::lookup_ask(self : Scope, name : String) -> String? {
  match self.asks.get(name) {
    Some(path) => Some(path)
    None =>
      match self.parent {
        Some(p) => p.lookup_ask(name)
        None => None
      }
  }
}

///|
fn Scope::lookup_meta_schema(
  self : Scope,
  uri : String,
) -> Array[(String, Type)]? {
  match self.meta_schemas.get(uri) {
    Some(shape) => Some(shape)
    None =>
      match self.parent {
        Some(p) => p.lookup_meta_schema(uri)
        None => None
      }
  }
}

///|
/// The names of the components registered here, and with walk the parents'
/// too, each once, sorted.
fn Scope::names(self : Scope, walk : Bool) -> Array[String] {
  let names : Array[String] = []
  let mut at : Scope? = Some(self)
  while at is Some(s) {
    for name, _ in s.specs {
      if !names.contains(name) {
        names.push(name)
      }
    }
    at = if walk { s.parent } else { None }
  }
  names.sort_by(compare_units)
  names
}

///|
/// Strings by their code units, as JavaScript sorts them.
fn compare_units(a : String, b : String) -> Int32 {
  let n = if a.length() < b.length() { a.length() } else { b.length() }
  for i in 0..<n {
    let d = a.unsafe_get(i).to_int() - b.unsafe_get(i).to_int()
    if d != 0 {
      return d
    }
  }
  a.length() - b.length()
}

///|
fn new_scope(parent : Scope?) -> Scope {
  let scope : Scope = {
    n: world_scopes.length(),
    parent,
    children: Map([]),
    specs: Map([]),
    interfaces: [],
    asks: Map([]),
    meta_schemas: Map([]),
  }
  world_scopes.push(scope)
  scope
}

///|
/// The scopes components are being made in, the innermost last: where an
/// init's ctx makes from.
let making : Array[Scope] = []

///|
/// Every scope and every component loaded, by its number: a component's
/// class is "scope:component", the scope it was made in and what it is.
let world_scopes : Array[Scope] = []

///|
let world_specs : Array[Spec] = []

///|
/// Each component's space, as its module made it: its data. By Spec.at.
let world_consts : Map[String, Val] = Map([])

///|
/// Views by "at/name".
let world_views : Map[String, View] = Map([])

///|
/// The scope a path of names from the base names, made when it isn't there.
fn scope_at(path : Json) -> Scope {
  let mut scope = world.scope
  if path is Array(names) {
    for name in names {
      guard name is String(name) else { continue }
      scope = match scope.children.get(name) {
        Some(child) => child
        None => {
          let child = new_scope(Some(scope))
          scope.children[name] = child
          child
        }
      }
    }
  }
  scope
}

///|
fn class_numbers(v : Val) -> (Int32, Int32)? {
  if !(kind(v) is Obj) {
    return None
  }
  // "scope:component", two numbers.
  let cls = v_class(v)
  let mut a = 0
  let mut b = 0
  let mut colon = false
  for i in 0..<cls.length() {
    let c = cls.unsafe_get(i).to_int()
    if c == 58 {
      colon = true
    } else if c >= 48 && c <= 57 {
      if colon {
        b = b * 10 + (c - 48)
      } else {
        a = a * 10 + (c - 48)
      }
    } else {
      return None
    }
  }
  if colon {
    Some((a, b))
  } else {
    None
  }
}

///|
/// The scope a component was made in; the base for what isn't one.
fn scope_of(v : Val) -> Scope {
  match class_numbers(v) {
    Some((s, _)) => world_scopes.get(s).unwrap_or(world.scope)
    None => world.scope
  }
}

///|
priv struct World {
  scope : Scope
  mut root : Val?
  mut settled : Val?
  reports : Array[Json]
  /// The handlers running, the innermost last.
  ctxs : Array[Ctx]
  queue : Array[Task]
  /// The asks the page answers later, by request.
  asked : Map[Int32, Task]
  /// What is being dragged, while something is.
  mut drag : Drag?
  mut ids : Int32
  /// What the page shows: the last render, None before the first.
  mut rendered : Array[VNode]?
  mut mounted : Bool
}

///|
let world : World = {
  scope: new_scope(None),
  root: None,
  settled: None,
  reports: [],
  ctxs: [],
  queue: [],
  asked: Map([]),
  drag: None,
  ids: 0,
  rendered: None,
  mounted: false,
}

///|
/// The component a value is: the spec of its class.
fn Scope::spec_of(_self : Scope, v : Val) -> Spec? {
  match class_numbers(v) {
    Some((_, n)) => world_specs.get(n)
    None => None
  }
}

///|
fn fault(message : String) -> Fault {
  Fault(message, no_default=false)
}

///|
fn call_entry(path : String, this : Val, args : Array[Val]) -> Val raise Fault {
  let result = entry_ffi(path, this, list_of(args))
  let error = entry_error()
  if error != "" {
    raise fault(error)
  }
  result
}

///|
/// A component made from fields: each its value when valid, its default
/// otherwise, then init on a draft of it.
fn Scope::make(self : Scope, name : String, args : Val) -> Val raise Fault {
  guard self.lookup_spec(name) is Some(spec) else {
    raise fault("Component \{name} is not registered")
  }
  let state = obj_new()
  v_set_class(state, "\{self.n}:\{spec.n}")
  for f in spec.fields {
    let made = f.1.make(get(args, f.0), self, Some(state)) catch {
      e => raise prefixed("\{spec.name}.\{f.0}", e)
    }
    obj_put(state, f.0, made)
  }
  if !spec.init {
    return state
  }
  let draft = v_copy(state)
  let ctx = v_handle("Ctx_\{spec.name}_init", obj_new())
  // What init makes, it makes from the scope its component is made in.
  making.push(self)
  let result : Result[Val, Fault] = Ok(
    call_entry("\{spec.at}.init", v_freeze(state), [draft, ctx]),
  ) catch {
    e => Err(e)
  }
  ignore(making.pop())
  match result {
    Ok(_) => draft
    Err(e) => raise prefixed("\{spec.name}.init", e)
  }
}

///|
fn truthy(v : Val) -> Bool {
  match kind(v) {
    Undefined | Null => false
    Bool(b) => b
    Num => {
      let n = v_num_of(v)
      n == n && n != 0.0
    }
    Str => v_str_of(v) != ""
    _ => true
  }
}

///|
/// Whether an entry that answers yes or no says yes: one that fails says no.
fn holds(path : String, this : Val, args : Array[Val]) -> Bool {
  let v = call_entry(path, this, args) catch { _ => return false }
  truthy(v)
}

///|
fn Scope::broken_invariants(self : Scope, instance : Val) -> Array[String] {
  guard self.spec_of(instance) is Some(spec) else { return [] }
  spec.invariants.filter(n => !holds("\{spec.at}.invariants.\{n}", instance, []))
}

///|
fn Scope::arg_issues(
  _self : Scope,
  types : Array[Type]?,
  args : Array[Val],
  owner : Val,
) -> Array[String] {
  guard types is Some(types) else { return [] }
  if args.length() != types.length() {
    return ["args"]
  }
  let issues = []
  for i, t in types {
    if !t.is_valid(args[i], scope_of(owner), Some(owner)) {
      issues.push("arg:\{i}")
    }
  }
  issues
}

///|
/// What a handled message broke: its arguments' types, its pre, its post.
fn Scope::message_issues(
  self : Scope,
  spec : Spec,
  handler : Handler,
  prev : Val,
  next : Val,
  args : Val,
) -> Array[String] {
  let issues = self.arg_issues(handler.args, items(args), prev)
  let info = obj_new()
  let at = "\{spec.at}.on.\{handler.name}"
  if handler.pre && !holds("\{at}.pre", prev, [prev, args, info]) {
    issues.push("pre")
  }
  if handler.post && !holds("\{at}.post", prev, [prev, next, args, info]) {
    issues.push("post")
  }
  issues
}

///|
/// What of a state isn't valid, skipping what is the previous state's own:
/// a field that isn't of its type or isn't declared, an invariant that
/// doesn't hold.
fn Scope::collect_invalid(
  self : Scope,
  value : Val,
  prev : Val?,
  fields : Bool,
  invariants : Bool,
  issues : Array[Json],
) -> Unit {
  if prev is Some(p) && v_same(value, p) {
    return
  }
  let prev_at = (key : String, index : Int32) => {
    match prev {
      Some(p) =>
        match kind(p) {
          Obj => if has(p, key) { Some(obj_get(p, key)) } else { None }
          List =>
            if index >= 0 && index < v_len(p) {
              Some(v_at(p, index))
            } else {
              None
            }
          _ => None
        }
      None => None
    }
  }
  match kind(value) {
    List =>
      for i in 0..<v_len(value) {
        self.collect_invalid(
          v_at(value, i),
          prev_at("", i),
          fields,
          invariants,
          issues,
        )
      }
    Obj =>
      match self.spec_of(value) {
        None =>
          for k in keys(value) {
            self.collect_invalid(
              obj_get(value, k),
              prev_at(k, -1),
              fields,
              invariants,
              issues,
            )
          }
        Some(spec) => {
          let report = (field : String, reason : String) => {
            issues.push({
              "check": "state",
              "component": Json::string(spec.name),
              "field": Json::string(field),
              "reason": Json::string(reason),
            })
          }
          if fields {
            for k in keys(value) {
              if !spec.fields.iter().any(f => f.0 == k) {
                report(k, "undeclared")
              }
            }
          }
          for f in spec.fields {
            let at = get(value, f.0)
            if fields && !f.1.is_valid(at, scope_of(value), Some(value)) {
              report(f.0, "invalid")
            }
            self.collect_invalid(
              at,
              prev_at(f.0, -1),
              fields,
              invariants,
              issues,
            )
          }
          if invariants {
            for name in self.broken_invariants(value) {
              issues.push({
                "check": "state",
                "component": Json::string(spec.name),
                "field": Json::null(),
                "reason": Json::string("invariant:\{name}"),
              })
            }
          }
        }
      }
    _ => ()
  }
}

///|
fn message_issue(reason : String) -> Json {
  { "check": "message", "reason": Json::string(reason) }
}

///|
/// What a run returned, as its component's next state: the draft, or, for a
/// swap, the component it becomes.
fn Scope::result_of(
  self : Scope,
  handler : Handler,
  result : Val,
  draft : Val,
) -> Val raise Fault {
  if is_undefined(result) || v_same(result, draft) {
    return draft
  }
  if !handler.swap {
    raise fault(
      "\{handler.name} returned a value: a message that replaces its component says swap: true",
    )
  }
  if self.spec_of(result) is None {
    raise fault(
      "\{handler.name} is a swap: it returns the component its own becomes, or nothing",
    )
  }
  result
}

///|
/// Nothing left to run: the invariants of what changed since the last time.
fn World::settle(self : World) -> Unit {
  guard self.root is Some(root) else { return }
  if self.settled is Some(s) && v_same(root, s) {
    return
  }
  let issues = []
  self.scope.collect_invalid(root, self.settled, false, true, issues)
  self.settled = Some(root)
  self.reports.push({ "type": "settled", "issues": Json::array(issues) })
}

///|
/// tutuca.apply: a pure message on a component, in the caller's own
/// transaction. What it gives is the component after it.
fn Scope::apply(self : Scope, c : Val, name : String, args : Array[Val]) -> Val {
  let fail = (component : String, issues : Array[String]) => {
    throw_ffi("ContractError", "\{component}.\{name}: \{issues.join(", ")}")
  }
  guard self.spec_of(c) is Some(spec) else {
    throw_ffi("ContractError", "not a component: not-component")
    return undefined()
  }
  guard spec.on.get(name) is Some(handler) else {
    fail(spec.name, ["unknown"])
    return undefined()
  }
  if !handler.pure {
    fail(spec.name, ["not-pure"])
  }
  let is_draft = !v_frozen(c)
  let prev = if is_draft { v_freeze(v_copy(c)) } else { c }
  let at = "\{spec.at}.on.\{name}"
  let arg_list = list_of(args)
  let issues = self.arg_issues(handler.args, args, prev)
  if issues.length() > 0 {
    fail(spec.name, issues)
  }
  if handler.pre && !holds("\{at}.pre", prev, [prev, arg_list, obj_new()]) {
    fail(spec.name, ["pre"])
  }
  let run = (draft : Val) => {
    let result = call_entry("\{at}.run", prev, [draft, arg_list]) catch {
      Fault(message, ..) => {
        throw_ffi("Error", message)
        return draft
      }
    }
    if is_undefined(result) || v_same(result, draft) {
      return draft
    }
    if !handler.swap || self.spec_of(result) is None {
      fail(spec.name, ["returned"])
    }
    result
  }
  let next = if is_draft {
    run(c)
  } else {
    v_freeze(v_share(c, run(v_copy(c))))
  }
  if handler.post &&
    !holds("\{at}.post", prev, [prev, next, arg_list, obj_new()]) {
    fail(spec.name, ["post"])
  }
  if v_frozen(next) && !v_same(next, c) {
    let broken = self.broken_invariants(next)
    if broken.length() > 0 {
      fail(spec.name, broken.map(n => "invariant:\{n}"))
    }
  }
  next
}

///|
/// What a handler's ctx does, by the what's name.
fn World::ctx_call(self : World, what : String, args : Array[Val]) -> Val {
  let arg = (i : Int32) => args.get(i).unwrap_or(undefined())
  let text = (i : Int32) => {
    if kind(arg(i)) is Str {
      v_str_of(arg(i))
    } else {
      ""
    }
  }
  let scope = match (making.last(), self.ctxs.last()) {
    (Some(scope), _) => scope
    (None, Some(ctx)) => ctx.scope
    (None, None) => self.scope
  }
  match what {
    "notify" => {
      match self.ctxs.last() {
        Some(ctx) =>
          // At the root there is nobody above to hear it.
          if ctx.path.length() == 0 {
            ctx.unhandled.push(text(0))
          } else {
            ctx.tasks.push({
              name: text(0),
              args: if kind(arg(1)) is List {
                arg(1)
              } else {
                list_new()
              },
              to: [],
              kind: Notify(from=ctx.path, hops=None, handled=false),
              from: Some(ctx.path),
              event: false,
            })
          }
        None => ()
      }
      undefined()
    }
    "make" =>
      scope.make(text(0), arg(1)) catch {
        Fault(message, ..) => {
          throw_ffi("Error", message)
          undefined()
        }
      }
    "tryMake" => {
      let out = obj_new()
      obj_put(out, "ok", scope.make(text(0), arg(1))) catch {
        Fault(message, ..) => {
          let err = obj_new()
          obj_put(err, "error", v_str(message))
          obj_put(err, "issues", list_new())
          obj_put(out, "err", err)
        }
      }
      out
    }
    "componentNames" => list_of(scope.names(truthy(arg(0))).map(v_str))
    "metaOf" => {
      // What a component says of itself under a URI, over its schema's
      // defaults when the scope has one; null for what isn't a component.
      guard scope.lookup_spec(text(0)) is Some(spec) else { return null_() }
      let out = obj_new()
      match scope.lookup_meta_schema(text(1)) {
        Some(shape) =>
          for f in shape {
            obj_put(out, f.0, f.1.make(undefined(), scope, None)) catch {
              _ => ()
            }
          }
        None => ()
      }
      if spec.meta.get(text(1)) is Some(Object(given)) {
        for k, v in given {
          obj_put(out, k, from_json(v))
        }
      }
      v_freeze(out)
    }
    "now" => v_num(env_now())
    "uuid" => v_str(env_uuid())
    "log" => {
      match self.ctxs.last() {
        Some(ctx) => ctx.logs.push(to_json(arg(0)))
        None => ()
      }
      undefined()
    }
    "stopNext" => {
      match self.ctxs.last() {
        Some(ctx) => ctx.stop_next = true
        None => ()
      }
      undefined()
    }
    "ask" => {
      self.ids += 1
      match self.ctxs.last() {
        Some(ctx) =>
          ctx.tasks.push({
            name: text(0),
            args: if kind(arg(1)) is List {
              arg(1)
            } else {
              list_new()
            },
            to: ctx.path,
            kind: Ask(self.ids),
            from: Some(ctx.path),
            event: false,
          })
        None => ()
      }
      v_num(self.ids.to_double())
    }
    "sendAt" => {
      match self.ctxs.last() {
        Some(ctx) =>
          ctx.tasks.push({
            name: text(0),
            args: if kind(arg(1)) is List {
              arg(1)
            } else {
              list_new()
            },
            to: ctx.path,
            kind: Select(to_json(arg(2))),
            from: Some(ctx.path),
            event: false,
          })
        None => ()
      }
      undefined()
    }
    "reply" => {
      // Back to whoever sent the message being handled; the page hears nothing.
      match self.ctxs.last() {
        Some(ctx) =>
          match ctx.from {
            Some(to) =>
              ctx.tasks.push({
                name: text(0),
                args: if kind(arg(1)) is List {
                  arg(1)
                } else {
                  list_new()
                },
                to,
                kind: Message,
                from: Some(ctx.path),
                event: false,
              })
            None => ctx.unhandled.push(text(0))
          }
        None => ()
      }
      undefined()
    }
    "cancel" => undefined()
    _ => {
      throw_ffi("Error", "ctx.\{what} isn't in tutuca-wasm yet")
      undefined()
    }
  }
}

///|
/// A component's part its record doesn't hold: a query, computed.
fn query(spec : Spec, part : String, this : Val, args : Array[Val]) -> Val {
  guard spec.queries.get(part) is Some(how) else { return undefined() }
  call_entry(
    "\{spec.at}.queries.\{part}",
    this,
    if how == "get" {
      []
    } else {
      args
    },
  ) catch {
    Fault(message, ..) => {
      throw_ffi("Error", message)
      undefined()
    }
  }
}

///|
fn part_of(name : String) -> (String, String) {
  match name.rev_find(".") {
    Some(i) =>
      (
        name.exact_view(end=i).to_owned(),
        name.exact_view(start=i + 1).to_owned(),
      )
    None => ("", name)
  }
}

///|
/// Whether a call a component's code makes of its host is the runtime's to
/// answer: tutuca.apply, a ctx's what, a component's query.
pub fn tw_owns(name : String, this : Val) -> Bool {
  if name == "tutuca.apply" || name.has_prefix("View.") {
    return true
  }
  match kind(this) {
    Handle => {
      let name = v_handle_name(this)
      name.has_prefix("Ctx_") || name == "AskCtx"
    }
    Obj => class_numbers(this) is Some(_)
    _ => false
  }
}

///|
/// Answers such a call.
pub fn tw_host(name : String, this : Val, args : Val) -> Val {
  let xs = items(args)
  if name.has_prefix("View.") {
    return view_call(name.exact_view(start=5).to_owned(), xs) catch {
      Fault(message, ..) => {
        throw_ffi("Error", message)
        undefined()
      }
    }
  }
  if name == "tutuca.apply" {
    let message = match xs.get(1) {
      Some(m) if kind(m) is Str => v_str_of(m)
      _ => ""
    }
    return world.scope.apply(
      xs.get(0).unwrap_or(undefined()),
      message,
      xs[2:].to_owned(),
    )
  }
  let (_, part) = part_of(name)
  match kind(this) {
    Handle => world.ctx_call(part, xs)
    _ =>
      match world.scope.spec_of(this) {
        Some(spec) => query(spec, part, this, xs)
        None => undefined()
      }
  }
}

///|
fn compile_spec(d : Map[String, Json], tag : String) -> Spec raise Fault {
  let name = match d.get("name") {
    Some(String(n)) => n
    _ => raise fault("a component has a name")
  }
  let fields = []
  let unsynced = []
  match d.get("fields") {
    Some(Object(m)) =>
      for k, t in m {
        let ty = compile_type(t) catch {
          e => raise prefixed("\{name}.\{k}", e)
        }
        fields.push((k, ty))
        if t is Object(data) && data.get("sync") is Some(String("none")) {
          unsynced.push(k)
        }
      }
    _ => ()
  }
  let queries : Map[String, String] = Map([])
  match d.get("queries") {
    Some(Object(m)) =>
      for k, v in m {
        if v is String(how) {
          queries[k] = how
        }
      }
    _ => ()
  }
  let on : Map[String, Handler] = Map([])
  match d.get("on") {
    Some(Object(m)) =>
      for k, v in m {
        guard v is Object(h) else { continue }
        let args = match h.get("args") {
          Some(Array(ts)) => {
            let out = []
            for t in ts {
              out.push(compile_type(t))
            }
            Some(out)
          }
          _ => None
        }
        on[k] = {
          name: k,
          args,
          pure: h.get("pure") is Some(True),
          swap: h.get("swap") is Some(True),
          pre: h.get("pre") is Some(True),
          post: h.get("post") is Some(True),
        }
      }
    _ => ()
  }
  let names = (key : String) => {
    match d.get(key) {
      Some(Array(xs)) =>
        xs.filter_map(x => {
          match x {
            String(s) => Some(s)
            _ => None
          }
        })
      _ => []
    }
  }
  {
    n: world_specs.length(),
    at: "\{tag}\{name}",
    name,
    fields,
    unsynced,
    queries,
    on,
    invariants: names("invariants"),
    answers: match d.get("answers") {
      Some(Object(m)) => {
        let out : Map[String, Array[String]] = Map([])
        for k, v in m {
          if v is Array(xs) {
            out[k] = xs.filter_map(x => {
              match x {
                String(o) => Some(o)
                _ => None
              }
            })
          }
        }
        out
      }
      _ => Map([])
    },
    init: d.get("init") is Some(True),
    implements: names("implements"),
    provides: match d.get("provides") {
      Some(Object(m)) => m.to_array()
      _ => []
    },
    meta: match d.get("meta") {
      Some(Object(m)) => m
      _ => Map([])
    },
  }
}

///|
/// Registers a module's components, interfaces, meta schemas and ask
/// handlers in a scope: { scope: [name], tag, definitions: { name:
/// definition }, interfaces: [name], metaSchemas, asks: [name], register:
/// { name: registered as } }. tag is what its entries' paths start with.
/// "" when it did, or why not.
pub fn tw_define(text : String) -> String {
  let parsed = @json.parse(text) catch { e => return "\{e}" }
  guard parsed is Object(m) else {
    return "a module's definitions are an object"
  }
  let scope = scope_at(m.get("scope").unwrap_or(Json::null()))
  let tag = match m.get("tag") {
    Some(String(t)) => t
    _ => ""
  }
  match m.get("interfaces") {
    Some(Array(xs)) =>
      for x in xs {
        if x is String(n) && !scope.interfaces.contains(n) {
          scope.interfaces.push(n)
        }
      }
    _ => ()
  }
  match m.get("asks") {
    Some(Array(xs)) =>
      for x in xs {
        if x is String(n) {
          scope.asks[n] = "\{tag}askHandlers.\{n}"
        }
      }
    _ => ()
  }
  match m.get("metaSchemas") {
    Some(Object(schemas)) =>
      for uri, fields in schemas {
        guard fields is Object(fs) else { continue }
        let shape = []
        for k, t in fs {
          let ty = compile_type(t) catch {
            Fault(message, ..) => return message
          }
          shape.push((k, ty))
        }
        scope.meta_schemas[uri] = shape
      }
    _ => ()
  }
  match m.get("definitions") {
    Some(Object(defs)) =>
      for _, d in defs {
        guard d is Object(def) else { continue }
        let spec = compile_spec(def, tag) catch {
          Fault(message, ..) => return message
        }
        world_specs.push(spec)
        // Registered under its own name, unless the module (or the page)
        // says another: one component may stand in for another's name.
        let registered = match m.get("register") {
          Some(Object(names)) =>
            match names.get(spec.name) {
              Some(String(n)) => n
              _ => spec.name
            }
          _ => spec.name
        }
        scope.specs[registered] = spec
      }
    _ => ()
  }
  ""
}

///|
/// Forgets a scope and what is below it: what was registered there can't be
/// made any more. Components made there stay what they are.
pub fn tw_leave(path : String) -> Unit {
  guard (@json.parse(path) catch { _ => Json::null() }) is Array(names) else {
    return
  }
  guard names.last() is Some(String(last)) else { return }
  let parent = scope_at(Json::array(names[:names.length() - 1].to_owned()))
  parent.children.remove(last)
}

///|
/// Plain data, with the components it says to make made: { "$make": name,
/// "fields": {...} } is a component of the type registered as name.
fn Scope::hydrate(self : Scope, j : Json) -> Val raise Fault {
  match j {
    Array(xs) => {
      let l = list_new()
      for x in xs {
        list_add(l, self.hydrate(x))
      }
      l
    }
    Object(m) =>
      match m.get("$make") {
        Some(String(name)) => {
          // Made in the scope it says (a path from the base), or in this one.
          let scope = match m.get("scope") {
            Some(Array(_) as path) => scope_at(path)
            _ => self
          }
          scope.make(
            name,
            scope.hydrate(m.get("fields").unwrap_or(Json::object(Map([])))),
          )
        }
        _ => {
          let o = obj_new()
          for k, x in m {
            obj_put(o, k, self.hydrate(x))
          }
          o
        }
      }
    _ => from_json(j)
  }
}

///|
/// Makes the root, a component of a type from fields (JSON, hydrated). "" when it did,
/// or why not.
pub fn tw_start(name : String, fields : String, scope : String) -> String {
  let given = @json.parse(fields) catch { e => return "\{e}" }
  let scope = scope_at(@json.parse(scope) catch { _ => Json::null() })
  let root = try scope.make(name, scope.hydrate(given)) catch {
    Fault(message, ..) => return message
  } noraise {
    made => made
  }
  let root = v_freeze(root)
  world.root = Some(root)
  world.settled = Some(root)
  let issues = []
  world.scope.collect_invalid(root, None, true, true, issues)
  world.reports.push({ "type": "started", "issues": Json::array(issues) })
  ""
}

///|
/// Sends a message, with its arguments (a JSON array), to the component a
/// path from the root selects (JSON; [] for the root), and runs what it
/// starts.
pub fn tw_send(name : String, args : String, to : String) -> Unit {
  guard world.root is Some(root) else { return }
  let given = @json.parse(args) catch { _ => Json::array([]) }
  // Where it goes: a path from the root, as data; the root for none.
  let path = @json.parse(to) catch { _ => Json::array([]) }
  // Arguments are data, and the components they say to make.
  let args = scope_of(root).hydrate(given) catch { _ => from_json(given) }
  world.send(name, args, world.scope.fix_path(path, root))
}

///|
/// An event of the page, as the page describes it (JSON): see World::event.
pub fn tw_event(event : String) -> Unit {
  guard (@json.parse(event) catch { _ => Json::null() }) is Object(e) else {
    return
  }
  world.event(e)
}

///|
/// The root's state, as JSON.
pub fn tw_state() -> String {
  match world.root {
    Some(root) => to_json(root).stringify()
    None => "null"
  }
}

///|
/// What happened since the start, as JSON: each transition and what it
/// broke, each time the tree settled.
pub fn tw_reports() -> String {
  Json::array(world.reports).stringify()
}

///|
/// A component's space, once its module has made it: its views, and the
/// data its loops and binds read.
pub fn tw_component(at : String, space : Val) -> Unit {
  world_consts[at] = space
  let view = get(space, "view")
  if !is_undefined(view) {
    world_views["\{at}/main"] = to_node(view)
  }
  let named = get(space, "views")
  for k in keys(named) {
    world_views["\{at}/\{k}"] = to_node(obj_get(named, k))
  }
}

///|
/// Shows the root in the page from now on: renders it, and after every
/// change. "" when it did, or why not.
pub fn tw_mount() -> String {
  world.mounted = true
  world.render()
}

///|
/// Renders the root and changes the page's nodes into it.
fn World::render(self : World) -> String {
  guard self.mounted && self.root is Some(root) else { return "" }
  let next = self.scope.render_root(root) catch {
    Fault(message, ..) => return message
  }
  ignore(
    morph_children(
      dom_root(),
      self.rendered.unwrap_or([]),
      next,
      None,
      None,
      None,
    ),
  )
  self.rendered = Some(next)
  ""
}

///|
/// The types of event the views loaded listen to, as a JSON array: what
/// the page listens for on the root's node.
pub fn tw_event_types() -> String {
  let types : Array[String] = []
  for _, elem in views.bound {
    for b in elem.bindings {
      if !types.contains(b.type_) {
        types.push(b.type_)
      }
    }
  }
  Json::array(types.map(Json::string)).stringify()
}

///|
/// The page's answer to an ask it took for later: the request, whether it
/// went well, and the value (or the error's text) as JSON.
pub fn tw_answer(request : Int32, ok : Bool, value : String) -> Unit {
  let given = @json.parse(value) catch { _ => Json::null() }
  let scope = match world.root {
    Some(root) => scope_of(root)
    None => world.scope
  }
  // An answer that can't be made (a component it says to make) is an error.
  let made : Result[Val, Fault] = Ok(scope.hydrate(given)) catch { e => Err(e) }
  match made {
    Ok(v) => world.answer(request, ok, v)
    Err(Fault(message, ..)) => world.answer(request, false, v_str(message))
  }
}

///|
/// What the page gives (JSON) as a value: data, and the components it says to
/// make ({ "$make", "fields", "scope" }), made from the root's scope.
pub fn tw_value(value : String) -> Val {
  let given = @json.parse(value) catch { _ => Json::null() }
  let scope = match world.root {
    Some(root) => scope_of(root)
    None => world.scope
  }
  scope.hydrate(given) catch {
    Fault(message, ..) => {
      throw_ffi("Error", message)
      undefined()
    }
  }
}

///|
/// A drag starts: the markers around what is dragged (JSON), and the type
/// its element says ("" for none).
pub fn tw_drag_start(markers : String, type_ : String) -> Unit {
  guard world.root is Some(root) else { return }
  guard (@json.parse(markers) catch { _ => Json::null() }) is Array(ms) else {
    return
  }
  let path = path_of_markers(ms)
  world.drag = Some({
    path,
    type_: if type_ == "" {
      null_()
    } else {
      v_str(type_)
    },
    value: get_in(root, to_key_path(path)),
  })
}

///|
pub fn tw_drag_end() -> Unit {
  world.drag = None
}

///|
/// Which of the elements an event found has a binding for drops, as its
/// place among them (JSON, as tw_event takes it); -1 for none.
pub fn tw_drop_target(event : String) -> Int32 {
  guard (@json.parse(event) catch { _ => Json::null() }) is Object(e) else {
    return -1
  }
  guard e.get("eids") is Some(Array(eids)) else { return -1 }
  match world.binding_for(e, b => b.type_ == "drop") {
    Some((_, _, found)) => {
      for i, x in eids {
        if x is Object(f) && physical_equal(f, found) {
          return i
        }
      }
      -1
    }
    None => -1
  }
}

///|
/// What a component says of itself: a query's result (or a field's value),
/// for the component a path from the root selects, as JSON: { "ok": value },
/// or { "err": why }.
pub fn tw_query(name : String, args : String, to : String) -> String {
  let err = (why : String) => {
    let out : Json = { "err": Json::string(why) }
    out.stringify()
  }
  guard world.root is Some(root) else { return err("there is no root") }
  let given = @json.parse(args) catch { _ => Json::array([]) }
  let path = @json.parse(to) catch { _ => Json::array([]) }
  let instance = get_in(root, to_key_path(world.scope.fix_path(path, root)))
  guard world.scope.spec_of(instance) is Some(spec) else {
    return err("there is no component there")
  }
  let value = match spec.queries.get(name) {
    Some(how) =>
      call_entry(
        "\{spec.at}.queries.\{name}",
        instance,
        if how == "get" {
          []
        } else {
          items(from_json(given))
        },
      ) catch {
        Fault(message, ..) => return err(message)
      }
    None =>
      if has(instance, name) {
        obj_get(instance, name)
      } else {
        return err("\{spec.name} has no query \{name}")
      }
  }
  let out : Json = { "ok": to_json(value) }
  out.stringify()
}

///|
fn instance_at(to : String) -> (Val, Array[Json])? {
  guard world.root is Some(root) else { return None }
  let path = @json.parse(to) catch { _ => Json::array([]) }
  let keys = to_key_path(world.scope.fix_path(path, root))
  Some((get_in(root, keys), keys))
}

///|
/// Whether a component of a type makes from fields (JSON) as they are, in a
/// scope, changing nothing: { "error": why it can't be made, or "",
/// "issues": [{ "field", "problem" }] } with a field's value that isn't of
/// its type ("invalid"), a key that isn't a field ("undeclared") and an
/// invariant the made component breaks ("invariant:name").
pub fn tw_fits(name : String, fields : String, scope : String) -> String {
  let scope = scope_at(@json.parse(scope) catch { _ => Json::null() })
  let issues : Array[Json] = []
  let answer = (error : String) => {
    let out : Json = {
      "error": Json::string(error),
      "issues": Json::array(issues),
    }
    out.stringify()
  }
  let issue = (field : String, problem : String) => {
    issues.push({
      "field": Json::string(field),
      "problem": Json::string(problem),
    })
  }
  guard scope.lookup_spec(name) is Some(spec) else {
    return answer("Component \{name} is not registered")
  }
  let given = @json.parse(fields) catch { e => return answer("\{e}") }
  guard given is Object(_) else { return answer("the fields aren't an object") }
  let args = scope.hydrate(given) catch {
    Fault(message, ..) => return answer(message)
  }
  for k in keys(args) {
    match spec.fields.iter().find_first(f => f.0 == k) {
      None => issue(k, "undeclared")
      Some(f) =>
        if !f.1.is_valid(obj_get(args, k), scope, Some(args)) {
          issue(k, "invalid")
        }
    }
  }
  let made = scope.make(name, args) catch {
    Fault(message, ..) => return answer(message)
  }
  for n in scope.broken_invariants(v_freeze(made)) {
    issue("", "invariant:\{n}")
  }
  answer("")
}

///|
/// Why a message can't be handled now by the component a path selects, with
/// these arguments (JSON), running nothing: "" when it can, "unknown",
/// "args", "arg:N" for the argument that isn't of its type, "pre" for its
/// condition.
pub fn tw_message_problem(name : String, args : String, to : String) -> String {
  guard instance_at(to) is Some((instance, _)) else { return "no root" }
  guard world.scope.spec_of(instance) is Some(spec) else {
    return "not-component"
  }
  guard spec.on.get(name) is Some(handler) else { return "unknown" }
  let given = @json.parse(args) catch { _ => Json::array([]) }
  let list = scope_of(instance).hydrate(given) catch { _ => from_json(given) }
  let issues = world.scope.arg_issues(handler.args, items(list), instance)
  if issues.length() > 0 {
    return issues[0]
  }
  if handler.pre &&
    !holds("\{spec.at}.on.\{name}.pre", instance, [instance, list, obj_new()]) {
    return "pre"
  }
  ""
}

///|
/// What a path from the root selects, as it is now: a value for tw_put.
pub fn tw_hold(to : String) -> Val {
  match instance_at(to) {
    Some((v, _)) => v
    None => undefined()
  }
}

///|
/// Puts a value held before back where a path selects, and shows it.
pub fn tw_put(to : String, value : Val) -> Unit {
  guard world.root is Some(root) else { return }
  guard instance_at(to) is Some((_, keys)) else { return }
  world.root = Some(v_freeze(v_share(root, set_in(v_copy(root), keys, value))))
  let problem = world.render()
  if problem != "" {
    world.reports.push({
      "type": "renderFailed",
      "error": Json::string(problem),
      "issues": Json::array([]),
    })
  }
  world.settle()
}

///|
/// The name of the component a path selects; "" for what isn't one.
pub fn tw_type(to : String) -> String {
  match instance_at(to) {
    Some((v, _)) =>
      match world.scope.spec_of(v) {
        Some(spec) => spec.name
        None => ""
      }
    None => ""
  }
}

///|
/// The names a scope makes components by, with walk its parents' too, as
/// JSON.
pub fn tw_names(scope : String, walk : Bool) -> String {
  let scope = scope_at(@json.parse(scope) catch { _ => Json::null() })
  Json::array(scope.names(walk).map(Json::string)).stringify()
}

///|
/// The name a scope makes a component by: the nearest registration of it
/// that nothing nearer hides.
fn Scope::name_of(self : Scope, spec : Spec) -> String? {
  let mut at : Scope? = Some(self)
  while at is Some(s) {
    for name, registered in s.specs {
      if registered.n == spec.n &&
        self.lookup_spec(name) is Some(found) &&
        found.n == spec.n {
        return Some(name)
      }
    }
    at = s.parent
  }
  None
}

///|
/// A value as what makes it again: each component { "$make": the name its
/// scope makes it by, "fields" } with the fields that are kept, the rest
/// as it is.
fn capture(v : Val) -> Json raise Fault {
  match kind(v) {
    List => Json::array(items(v).map(x => capture(x)))
    Obj =>
      match world.scope.spec_of(v) {
        Some(spec) => {
          guard scope_of(v).name_of(spec) is Some(name) else {
            raise fault("No name makes a \{spec.name} from its scope")
          }
          let fields : Map[String, Json] = Map([])
          for f in spec.fields {
            if !spec.unsynced.contains(f.0) {
              fields[f.0] = capture(get(v, f.0))
            }
          }
          { "$make": Json::string(name), "fields": Json::object(fields) }
        }
        None => {
          let out : Map[String, Json] = Map([])
          for k in keys(v) {
            out[k] = capture(obj_get(v, k))
          }
          Json::object(out)
        }
      }
    _ => to_json(v)
  }
}

///|
/// What a path selects, as what makes it again (JSON): { "ok": tree }, or
/// { "err": why }.
pub fn tw_capture(to : String) -> String {
  let out : Json = match instance_at(to) {
    Some((v, _)) =>
      try capture(v) catch {
        Fault(message, ..) => { "err": Json::string(message) }
      } noraise {
        tree => { "ok": tree }
      }
    None => { "err": "there is no root" }
  }
  out.stringify()
}

///|
/// The name a component is made by in its scope; "" for what isn't one or
/// has none.
pub fn tw_name_of(v : Val) -> String {
  match world.scope.spec_of(v) {
    Some(spec) => scope_of(v).name_of(spec).unwrap_or("")
    None => ""
  }
}
