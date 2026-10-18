// CSS for the classes an app uses, compiled as they show up: what JS pages do with margaui's
// `compile` and a ClassCompiler. The page maps "margaui" in its import map.

///|
extern "js" fn margaui_ffi(classes : String, done : (String) -> Unit) -> Unit =
  #|(classes, done) => import("margaui")
  #|  .then((m) => m.compile(classes.split(" ").filter((c) => c !== "")))
  #|  .then(done, (error) => console.error("margaui compile failed", error))

///|
/// Compiles `classes` with margaui, then calls `done` with the CSS.
pub fn margaui(classes : Array[String], done : (String) -> Unit) -> Unit {
  margaui_ffi(classes.join(" "), done)
}

///|
extern "js" fn style_node(id : String) -> JsNode =
  #|(id) => document.getElementById(id)

///|
extern "js" fn set_text(node : JsNode, text : String) -> Unit =
  #|(node, text) => { node.textContent = text; }

///|
/// A report handler that keeps the <style id=`style_id`> holding the CSS for every class under
/// `root`: after each render it scans for new ones and compiles them all again with `compile`.
/// Other reports go to `log_problems`, and only they when the page has no such style, as JS's
/// demos compile only on a page that has one.
pub fn compile_styles(
  root : JsNode,
  style_id~ : String = "margaui",
  compile~ : (Array[String], (String) -> Unit) -> Unit = margaui,
  known~ : Array[String] = [],
) -> (@tutuca.Report) -> Unit {
  let style = style_node(style_id)
  guard !is_null(style) else { return log_problems }
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
