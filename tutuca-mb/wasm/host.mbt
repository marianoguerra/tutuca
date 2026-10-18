// Hosts on wasm-gc. JS can't be handed a closure, so callbacks are registered by number: the
// loader's listeners, timeouts and promises call the exported `on_call` with it, and an
// executable re-exports that (with its `start`).

///|
priv struct Callback {
  f : (Int32, JsNode, String) -> Unit
  once : Bool
}

///|
let callbacks : Map[Int32, Callback] = Map([])

///|
let next_callback : Ref[Int32] = Ref(0)

///|
/// Registers `f` for JS to call by the number this returns, with a status, a JS value and a
/// string; a `once` callback is forgotten when called.
pub fn callback(
  f : (Int32, JsNode, String) -> Unit,
  once~ : Bool = false,
) -> Int32 {
  next_callback.val += 1
  callbacks[next_callback.val] = { f, once, }
  next_callback.val
}

///|
/// Forgets callback `id`.
pub fn release(id : Int32) -> Unit {
  callbacks.remove(id)
}

///|
/// What the loader calls back: callback `id` with `status`, `arg` and `text`; status -1
/// releases it (a collected JS value that held it). An executable re-exports it.
pub fn on_call(id : Int32, status : Int32, arg : JsNode, text : String) -> Unit {
  if status == -1 {
    release(id)
    return
  }
  guard callbacks.get(id) is Some(cb) else { return }
  if cb.once {
    release(id)
  }
  (cb.f)(status, arg, text)
}

///|
extern "wasm" fn listen_ffi(root : JsNode, name : String, id : Int32) -> Unit = "tdom" "listen"

///|
extern "wasm" fn set_timeout_ffi(id : Int32, ms : Int32) -> Unit = "tdom" "set_timeout"

///|
extern "wasm" fn now_ffi() -> Double = "tdom" "now"

///|
extern "wasm" fn log_ffi(text : String) -> Unit = "tdom" "log_error"

///|
/// The browser's clock, in epoch ms.
pub fn now() -> Double {
  now_ffi()
}

///|
/// Calls `f` after `ms` milliseconds.
pub fn set_timeout(f : () -> Unit, ms : Int32) -> Unit {
  set_timeout_ffi(callback(once=true, (_, _, _) => f()), ms)
}

///|
/// Today's local date as YYYY-MM-DD.
pub extern "wasm" fn iso_today() -> String = "tdom" "iso_today"

///|
/// Calls `f` with each `name` event on `node`.
pub fn add_listener(node : JsNode, name : String, f : (JsNode) -> Unit) -> Unit {
  listen_ffi(node, name, callback((_, e, _) => f(e)))
}

///|
/// Delegates DOM events on the host's root to it: a listener per event name its components
/// handle.
pub fn delegate(h : @tutuca.Host[JsNode]) -> Unit {
  h.set_listen(name => {
    add_listener(h.root_node, name, e => {
      ignore(h.handle_event(event_target(e), event_type(e), info=event_info(e)))
    })
  })
}

///|
fn schedule(f : () -> Unit) -> Unit {
  set_timeout(f, 0)
}

///|
/// A host on `root`: tasks run on a zero timeout and DOM events are delegated to `root`.
pub fn host(
  root : JsNode,
  doc~ : JsNode = document(),
  dev~ : Bool = false,
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
) -> @tutuca.Host[JsNode] {
  let h = @tutuca.Host::new(doc, root, dev~, scope~, schedule~, now~)
  delegate(h)
  h
}

///|
/// Mounts `comp` with `state` on `root` and starts it.
pub fn[R, M] mount(
  root : JsNode,
  comp : @tutuca.Component[R, M],
  state : R,
  dev~ : Bool = false,
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
  on_report? : (@tutuca.Report) -> Unit,
) -> (@tutuca.Host[JsNode], @tutuca.App[R, M]) {
  let h = host(root, dev~, scope~)
  if on_report is Some(f) {
    h.set_on_report(f)
  }
  (h, h.start(comp, state))
}

///|
/// Logs problems to the console: what demos use as `on_report`.
pub fn log_problems(r : @tutuca.Report) -> Unit {
  match r {
    TaskFailed(t, e) =>
      log_ffi("taskFailed \{t.label} at \{t.path.to_string()}: \{e}")
    StateInvalid(issues) =>
      log_ffi("stateInvalid " + issues.map(i => i.to_string()).join("; "))
    MessageInvalid(t, issues) =>
      log_ffi("messageInvalid \{t.label}: \{issues.join(", ")}")
    RenderFailed(e) => log_ffi("renderFailed \{e}")
    Rendered | TaskHandled(_) => ()
  }
}
