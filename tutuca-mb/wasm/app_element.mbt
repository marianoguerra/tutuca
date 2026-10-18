// <tutuca-app app-key="...">, as @browser's app_element.mbt: the element is defined by the
// loader (`defineAppElement`, the same protocol), and requests reach the module through a
// callback. A request is the element's JS detail object.

///|
extern "wasm" fn define_ffi(tag : String) -> Unit = "tdom" "define_app_element"

///|
/// Defines <tutuca-app> (or `tag`) once per window.
pub fn define_app_element(tag~ : String = "tutuca-app") -> Unit {
  define_ffi(tag)
}

///|
/// A request from a <tutuca-app> for an app to mount.
#external
pub type AppRequest

///|
/// The element's app-key.
pub extern "wasm" fn AppRequest::key(self : AppRequest) -> String = "tdom" "req_key"

///|
pub extern "wasm" fn AppRequest::element(self : AppRequest) -> JsNode = "tdom" "req_element"

///|
/// Where the app renders, in the element's shadow root.
pub extern "wasm" fn AppRequest::root(self : AppRequest) -> JsNode = "tdom" "req_root"

///|
/// Adds a <style> with `css` before the app's root; returns it, to update as the app needs.
pub extern "wasm" fn AppRequest::adopt_css(
  self : AppRequest,
  css : String,
) -> JsNode = "tdom" "req_adopt_css"

///|
/// Links a stylesheet before the app's root.
pub extern "wasm" fn AppRequest::adopt_link(
  self : AppRequest,
  href : String,
) -> Unit = "tdom" "req_adopt_link"

///|
extern "wasm" fn emit_ffi(
  d : AppRequest,
  type_ : String,
  json : String,
) -> Unit = "tdom" "req_emit"

///|
/// Tells the page `data` as a `type` report on the element.
pub fn AppRequest::emit(self : AppRequest, type_ : String, data : Json) -> Unit {
  emit_ffi(self, type_, data.stringify())
}

///|
extern "wasm" fn req_mount_ffi(d : AppRequest, id : Int32) -> Unit = "tdom" "req_mount"

///|
/// Answers the request: the element calls `dispose` when its app goes.
pub fn AppRequest::mount(self : AppRequest, dispose : () -> Unit) -> Unit {
  req_mount_ffi(self, callback(once=true, (_, _, _) => dispose()))
}

///|
extern "wasm" fn req_same_ffi(a : AppRequest, b : AppRequest) -> Bool = "tdom" "same"

///|
/// Whether two requests are the same one.
pub fn AppRequest::is_same(self : AppRequest, other : AppRequest) -> Bool {
  req_same_ffi(self, other)
}

///|
extern "wasm" fn as_request(v : JsNode) -> AppRequest = "tdom" "identity"

///|
/// Hears the requests of the <tutuca-app>s under `target`.
pub fn on_app_request(target : JsNode, f : (AppRequest) -> Unit) -> Unit {
  add_listener(target, "tutucarequest", e => f(as_request(event_detail(e))))
}

///|
extern "wasm" fn event_detail(e : JsNode) -> JsNode = "tdom" "event_detail"

///|
/// Mounts a plain host for `req`, as JS's mountTutucaApp: `comp` from `state` on the
/// request's root, stopped when the element lets go.
pub fn[R, M] mount_app(
  req : AppRequest,
  comp : @tutuca.Component[R, M],
  state : R,
  dev~ : Bool = false,
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
  on_report? : (@tutuca.Report) -> Unit,
) -> (@tutuca.Host[JsNode], @tutuca.App[R, M]) {
  let (h, app) = mount(req.root(), comp, state, dev~, scope~, on_report?)
  req.mount(() => h.stop())
  (h, app)
}
