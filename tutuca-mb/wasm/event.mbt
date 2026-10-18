// DOM events, picked files and downloads, read through the loader.

///|
extern "wasm" fn event_target(e : JsNode) -> JsNode = "tdom" "event_target"

///|
extern "wasm" fn event_type(e : JsNode) -> String = "tdom" "event_type"

///|
extern "wasm" fn event_key(e : JsNode) -> String = "tdom" "event_key"

///|
extern "wasm" fn event_num(e : JsNode, name : String) -> Double = "tdom" "event_num"

///|
extern "wasm" fn event_flag(e : JsNode, name : String) -> Bool = "tdom" "event_flag"

///|
/// Whether the event is over an SVG; then svg_x/svg_y give the pointer in its viewBox.
extern "wasm" fn has_svg_point(e : JsNode) -> Bool = "tdom" "has_svg_point"

///|
extern "wasm" fn svg_x(e : JsNode) -> Double = "tdom" "svg_x"

///|
extern "wasm" fn svg_y(e : JsNode) -> Double = "tdom" "svg_y"

///|
extern "wasm" fn prevent_ffi(e : JsNode) -> Unit = "tdom" "prevent_default"

///|
extern "wasm" fn capture_ffi(e : JsNode) -> Unit = "tdom" "capture_pointer"

///|
extern "wasm" fn file_count(e : JsNode) -> Int32 = "tdom" "file_count"

///|
/// Keeps the event's i-th file for `read_file`, returning its id.
extern "wasm" fn keep_file(e : JsNode, i : Int32) -> Int32 = "tdom" "keep_file"

///|
extern "wasm" fn file_name(id : Int32) -> String = "tdom" "file_name"

///|
fn event_files(e : JsNode) -> Array[@tutuca.FileRef] {
  Array::makei(file_count(e), i => {
    let id = keep_file(e, i)
    { id, name: file_name(id), }
  })
}

///|
/// What the host needs of a DOM event.
fn event_info(e : JsNode) -> @tutuca.EventInfo {
  @tutuca.EventInfo::new(
    key=event_key(e),
    client_x=event_num(e, "clientX"),
    client_y=event_num(e, "clientY"),
    point?=if has_svg_point(e) { Some((svg_x(e), svg_y(e))) } else { None },
    button=event_num(e, "button").to_int(),
    ctrl_key=event_flag(e, "ctrlKey"),
    meta_key=event_flag(e, "metaKey"),
    shift_key=event_flag(e, "shiftKey"),
    alt_key=event_flag(e, "altKey"),
    files=event_files(e),
    prevent=() => prevent_ffi(e),
    capture=() => capture_ffi(e),
  )
}

///|
extern "wasm" fn read_file_ffi(file : Int32, id : Int32) -> Unit = "tdom" "read_file"

///|
/// Reads a picked file's text, later.
pub fn read_file(
  file : @tutuca.FileRef,
  reply : (@tutuca.AskResult[String]) -> Unit,
) -> Unit {
  let id = callback(once=true, (status, _, text) => {
    reply(if status == 0 { Ok(text) } else { Err(text) })
  })
  read_file_ffi(file.id, id)
}

///|
extern "wasm" fn download_ffi(
  filename : String,
  text : String,
  mime : String,
) -> Unit = "tdom" "download"

///|
/// Downloads `text` as `filename`; without a DOM it does nothing.
pub fn download(filename : String, text : String, mime : String) -> Unit {
  download_ffi(filename, text, mime)
}

///|
/// The local offset from UTC in minutes at `now` (epoch ms), east positive.
pub extern "wasm" fn local_offset(now : Double) -> Int32 = "tdom" "local_offset"
