// CSS for the classes an app uses, compiled as they show up, as @browser's css.mbt: the
// loader imports margaui's `compile` ("margaui" in the page's import map).

///|
extern "wasm" fn margaui_ffi(classes : String, id : Int32) -> Unit = "tdom" "margaui"

///|
/// Compiles `classes` with margaui, then calls `done` with the CSS.
pub fn margaui(classes : Array[String], done : (String) -> Unit) -> Unit {
  margaui_ffi(classes.join(" "), callback(once=true, (_, _, css) => done(css)))
}

///|
extern "wasm" fn element_by_id_ffi(id : String) -> JsNode = "tdom" "element_by_id"

///|
/// The element with `id` in the document.
pub fn element_by_id(id : String) -> JsNode? {
  opt(element_by_id_ffi(id))
}

///|
/// Sets a node's text content.
pub extern "wasm" fn set_text(node : JsNode, text : String) -> Unit = "tdom" "set_text"

///|
/// A report handler that keeps the <style id=`style_id`> holding the CSS for every class under
/// `root`: after each render it scans for new ones and compiles them all again with `compile`.
/// Other reports go to `log_problems`, and only they when the page has no such style.
pub fn compile_styles(
  root : JsNode,
  style_id~ : String = "margaui",
  compile~ : (Array[String], (String) -> Unit) -> Unit = margaui,
  known~ : Array[String] = [],
) -> (@tutuca.Report) -> Unit {
  guard element_by_id(style_id) is Some(style) else { return log_problems }
  let all = [..known]
  let classes = @dev.ClassCollector::new(known~, fresh => {
    all.append(fresh)
    compile(all.copy(), css => set_text(style, css))
  })
  r => {
    match r {
      Rendered => classes.scan(root)
      _ => log_problems(r)
    }
  }
}
