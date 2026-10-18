// <tutuca-app app-key="...">: an isolated tutuca app inside another, as JS's element.js. The
// element asks its ancestors for an app with a bubbling `tutucarequest` event, on connect and
// when its app-key changes; a listener (`on_app_request`) mounts one on the request's root,
// in the element's shadow root, which the outer render never morphs. Events leaving it are
// retargeted to the element, where the outer host stops. The app tells the page what it
// wants with `emit`: a bubbling `tutucareport` event, detail {key, type, data}, sent in a
// microtask, in order, and dropped once the element asked again. A move keeps the app; a
// removal disposes it; no listener mounting one leaves "no app for KEY".

///|
extern "js" fn define_ffi(tag : String) -> Unit =
  #|(tagName) => {
  #|  const window = globalThis.window ?? globalThis;
  #|  if (window.customElements.get(tagName) !== undefined) return;
  #|  class TutucaApp extends window.HTMLElement {
  #|    static observedAttributes = ["app-key"];
  #|    controller = null;
  #|    mountedKey = null;
  #|    current = null;
  #|    get key() { return this.getAttribute("app-key"); }
  #|    connectedCallback() {
  #|      if (this.current === null || this.mountedKey !== this.key) this.request();
  #|    }
  #|    disconnectedCallback() {
  #|      queueMicrotask(() => { if (!this.isConnected) this.dispose(); });
  #|    }
  #|    attributeChangedCallback() { if (this.isConnected) this.request(); }
  #|    request() {
  #|      this.dispose();
  #|      const doc = this.ownerDocument;
  #|      const { CustomEvent } = doc.defaultView;
  #|      const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
  #|      const rootNode = doc.createElement("div");
  #|      shadow.replaceChildren(rootNode);
  #|      // Events from inside reach the page retargeted here: the outer host stops at it.
  #|      this.setAttribute("data-tutuca-host", "app");
  #|      const key = this.key;
  #|      let controller = null;
  #|      const detail = {
  #|        key, element: this, rootNode, document: doc,
  #|        adoptCss: (text) => {
  #|          const style = doc.createElement("style");
  #|          style.textContent = text;
  #|          shadow.insertBefore(style, rootNode);
  #|          return style;
  #|        },
  #|        adoptLink: (href) => {
  #|          const link = doc.createElement("link");
  #|          link.rel = "stylesheet";
  #|          link.href = href;
  #|          shadow.insertBefore(link, rootNode);
  #|        },
  #|        emit: (type, data) => queueMicrotask(() => {
  #|          if (this.current !== detail) return;
  #|          const init = { bubbles: true, detail: { key, type, data } };
  #|          this.dispatchEvent(new CustomEvent("tutucareport", init));
  #|        }),
  #|        mount: (c) => { controller = c; },
  #|      };
  #|      this.current = detail;
  #|      this.mountedKey = key;
  #|      this.dispatchEvent(new CustomEvent("tutucarequest", { bubbles: true, detail }));
  #|      if (controller === null) rootNode.textContent = `no app for ${key}`;
  #|      this.controller = controller;
  #|    }
  #|    dispose() {
  #|      const { controller } = this;
  #|      this.controller = null;
  #|      this.current = null;
  #|      this.mountedKey = null;
  #|      controller?.dispose();
  #|    }
  #|  }
  #|  window.customElements.define(tagName, TutucaApp);
  #|}

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
pub extern "js" fn AppRequest::key(self : AppRequest) -> String =
  #|(d) => d.key ?? ""

///|
pub extern "js" fn AppRequest::element(self : AppRequest) -> JsNode =
  #|(d) => d.element

///|
/// Where the app renders, in the element's shadow root.
pub extern "js" fn AppRequest::root(self : AppRequest) -> JsNode =
  #|(d) => d.rootNode

///|
/// Adds a <style> with `css` before the app's root; returns it, to update as the app needs.
pub extern "js" fn AppRequest::adopt_css(
  self : AppRequest,
  css : String,
) -> JsNode =
  #|(d, css) => d.adoptCss(css)

///|
/// Links a stylesheet before the app's root.
pub extern "js" fn AppRequest::adopt_link(
  self : AppRequest,
  href : String,
) -> Unit =
  #|(d, href) => d.adoptLink(href)

///|
extern "js" fn emit_ffi(d : AppRequest, type_ : String, json : String) -> Unit =
  #|(d, type, json) => d.emit(type, JSON.parse(json))

///|
/// Tells the page `data` as a `type` report on the element.
pub fn AppRequest::emit(self : AppRequest, type_ : String, data : Json) -> Unit {
  emit_ffi(self, type_, data.stringify())
}

///|
/// Answers the request: the element calls `dispose` when its app goes.
pub extern "js" fn AppRequest::mount(
  self : AppRequest,
  dispose : () -> Unit,
) -> Unit =
  #|(d, dispose) => d.mount({ dispose })

///|
/// Whether two requests are the same one.
pub extern "js" fn AppRequest::is_same(
  self : AppRequest,
  other : AppRequest,
) -> Bool =
  #|(a, b) => a === b

///|
extern "js" fn on_request_ffi(
  target : JsNode,
  f : (AppRequest) -> Unit,
) -> Unit =
  #|(target, f) => target.addEventListener("tutucarequest", (e) => f(e.detail))

///|
/// Hears the requests of the <tutuca-app>s under `target`.
pub fn on_app_request(target : JsNode, f : (AppRequest) -> Unit) -> Unit {
  on_request_ffi(target, f)
}

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
