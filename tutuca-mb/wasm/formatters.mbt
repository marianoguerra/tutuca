// DevTools custom formatters, as @browser's formatters.mbt: @dev's descriptions as JsonML.
// A described value's header and rows are made when the console asks, through a callback that
// answers in the loader's return slot; the loader releases it when the value is collected.

///|
extern "wasm" fn js_array() -> JsNode = "tdom" "ml_array"

///|
extern "wasm" fn js_push(a : JsNode, v : JsNode) -> Unit = "tdom" "ml_push"

///|
extern "wasm" fn js_text(s : String) -> JsNode = "tdom" "identity"

///|
extern "wasm" fn js_span(style : String, parts : JsNode) -> JsNode = "tdom" "ml_span"

///|
extern "wasm" fn js_li(
  label : String,
  has_label : Bool,
  part : JsNode,
) -> JsNode = "tdom" "ml_li"

///|
extern "wasm" fn js_ref(v : JsNode) -> JsNode = "tdom" "ml_ref"

///|
/// A value the formatter shows; status 0 of callback `id` makes its header, 1 its rows.
extern "wasm" fn js_described(id : Int32) -> JsNode = "tdom" "described"

///|
extern "wasm" fn ret(v : JsNode) -> Unit = "tdom" "ret"

///|
extern "wasm" fn ret_str(s : String) -> Unit = "tdom" "ret"

///|
extern "wasm" fn install_ffi() -> Unit = "tdom" "install_formatters"

///|
extern "wasm" fn console_log(v : JsNode) -> Unit = "tdom" "console_log"

///|
fn parts(ps : Array[@dev.Ml]) -> JsNode {
  let a = js_array()
  for p in ps {
    js_push(a, ml(p))
  }
  a
}

///|
fn ml(p : @dev.Ml) -> JsNode {
  match p {
    Text(s) => js_text(s)
    Span(style, ps) => js_span(style, parts(ps))
    Ref(d) => js_ref(described(d))
  }
}

///|
fn rows(d : @dev.Described) -> JsNode {
  let a = js_array()
  for row in (d.rows)() {
    js_push(a, js_li(row.0.unwrap_or(""), row.0 is Some(_), ml(row.1)))
  }
  a
}

///|
fn described(d : @dev.Described) -> JsNode {
  js_described(
    callback((status, _, _) => {
      ret(if status == 0 { parts(d.header) } else { rows(d) })
    }),
  )
}

///|
/// Installs the formatter once per page.
pub fn install_formatters() -> Unit {
  install_ffi()
}

///|
/// Logs `d` for the console's formatter to show.
pub fn inspect(d : @dev.Described) -> Unit {
  install_ffi()
  console_log(described(d))
}

///|
extern "wasm" fn expose_ffi(name : String, id : Int32) -> Unit = "tdom" "expose"

///|
/// Puts the app at `globalThis.tutuca[name]`: `state` (as JSON), `vdom` (the last render),
/// `component` (the root's spec), all shown by the formatter, and `componentAt(node)`, the
/// component a DOM node was rendered in, as "Name at path".
pub fn[R : ToJson, M] expose(
  name : String,
  host : @tutuca.Host[JsNode],
  app : @tutuca.App[R, M],
  comp : @tutuca.Component[R, M],
) -> Unit {
  install_ffi()
  let id = callback((status, node, _) => {
    match status {
      0 => ret(described(@dev.describe_json(app.state().to_json())))
      1 => ret(described(@dev.describe_vnodes(host.vnodes())))
      2 => ret(described(@dev.describe_component(comp)))
      _ =>
        ret_str(
          match host.component_at(node) {
            Some((n, path)) => "\{n} at \{path}"
            None => ""
          },
        )
    }
  })
  expose_ffi(name, id)
}
