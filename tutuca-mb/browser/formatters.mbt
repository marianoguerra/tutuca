// DevTools custom formatters (Chrome/Firefox: Settings → Preferences → Console → "Enable
// custom formatters"), as JS's installFormatters: @dev's descriptions as JsonML. MoonBit values
// have no class to recognize, so what the console shows is a described value: `inspect`
// logs one, and `expose` puts an app's state, vdom and component lookup on `globalThis.tutuca`.

///|
#external
priv type JsValue

///|
extern "js" fn js_array() -> JsValue =
  #|() => []

///|
extern "js" fn js_push(a : JsValue, v : JsValue) -> Unit =
  #|(a, v) => { a.push(v); }

///|
extern "js" fn js_text(s : String) -> JsValue =
  #|(s) => s

///|
extern "js" fn js_span(style : String, parts : JsValue) -> JsValue =
  #|(style, parts) => ["span", { style }, ...parts]

///|
extern "js" fn js_li(
  label : String,
  has_label : Bool,
  part : JsValue,
) -> JsValue =
  #|(label, hasLabel, part) => hasLabel
  #|  ? ["li", {}, ["span", { style: "color:#8b5cf6" }, label], ": ", part]
  #|  : ["li", {}, part]

///|
/// A value the formatter shows: its header and its rows, made when asked for.
extern "js" fn js_described(
  header : () -> JsValue,
  rows : () -> JsValue,
) -> JsValue =
  #|(header, rows) => ({ __tutucaDescribed: true, header, rows })

///|
extern "js" fn js_ref(v : JsValue) -> JsValue =
  #|(v) => ["object", { object: v }]

///|
extern "js" fn install_ffi() -> Unit =
  #|() => {
  #|  const target = globalThis;
  #|  target.devtoolsFormatters ??= [];
  #|  if (target.devtoolsFormatters.some((f) => f.tutuca)) return;
  #|  const is = (v) => v !== null && typeof v === "object" && v.__tutucaDescribed === true;
  #|  target.devtoolsFormatters.push({
  #|    tutuca: true,
  #|    header: (v) => (is(v) ? ["span", {}, ...v.header()] : null),
  #|    hasBody: (v) => is(v) && v.rows().length > 0,
  #|    body: (v) => ["ol", { style: "list-style:none;margin:0;padding-left:14px" }, ...v.rows()],
  #|  });
  #|}

///|
extern "js" fn console_log(v : JsValue) -> Unit =
  #|(v) => console.log(v)

///|
fn parts(ps : Array[@dev.Ml]) -> JsValue {
  let a = js_array()
  for p in ps {
    js_push(a, ml(p))
  }
  a
}

///|
fn ml(p : @dev.Ml) -> JsValue {
  match p {
    Text(s) => js_text(s)
    Span(style, ps) => js_span(style, parts(ps))
    Ref(d) => js_ref(described(d))
  }
}

///|
fn described(d : @dev.Described) -> JsValue {
  js_described(() => parts(d.header), () => {
    let a = js_array()
    for row in (d.rows)() {
      js_push(a, js_li(row.0.unwrap_or(""), row.0 is Some(_), ml(row.1)))
    }
    a
  })
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
extern "js" fn expose_ffi(
  name : String,
  state : () -> JsValue,
  vdom : () -> JsValue,
  component : () -> JsValue,
  component_at : (JsNode) -> String,
) -> Unit =
  #|(name, state, vdom, component, componentAt) => {
  #|  globalThis.tutuca ??= {};
  #|  globalThis.tutuca[name] = Object.defineProperties({ componentAt }, {
  #|    state: { get: state, enumerable: true },
  #|    vdom: { get: vdom, enumerable: true },
  #|    component: { get: component, enumerable: true },
  #|  });
  #|}

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
  expose_ffi(
    name,
    () => described(@dev.describe_json(app.state().to_json())),
    () => described(@dev.describe_vnodes(host.vnodes())),
    () => described(@dev.describe_component(comp)),
    node => {
      match host.component_at(node) {
        Some((n, path)) => "\{n} at \{path}"
        None => ""
      }
    },
  )
}
