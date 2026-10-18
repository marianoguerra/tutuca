///|
/// A DOM event as the listener gets it.
#external
pub type JsEvent

///|
extern "js" fn event_type(e : JsEvent) -> String =
  #|(e) => e.type

///|
extern "js" fn event_target(e : JsEvent) -> JsNode =
  #|(e) => e.target

///|
extern "js" fn event_key(e : JsEvent) -> String =
  #|(e) => e.key ?? ""

///|
extern "js" fn prevent_default(e : JsEvent) -> Unit =
  #|(e) => { e.preventDefault(); }

///|
extern "js" fn event_num(e : JsEvent, name : String) -> Double =
  #|(e, name) => typeof e[name] === "number" ? e[name] : 0

///|
extern "js" fn event_flag(e : JsEvent, name : String) -> Bool =
  #|(e, name) => Boolean(e[name])

///|
/// Whether the event is over an SVG; then svg_x/svg_y give the pointer in its viewBox.
extern "js" fn has_svg_point(e : JsEvent) -> Bool =
  #|(e) => {
  #|  const t = e.target;
  #|  if (!t || typeof e.clientX !== "number") return false;
  #|  const svg = t.tagName?.toLowerCase() === "svg" ? t : (t.ownerSVGElement ?? t.closest?.("svg"));
  #|  if (!svg) return false;
  #|  const ctm = svg.getScreenCTM?.();
  #|  let x, y;
  #|  if (ctm && typeof DOMPoint === "function") {
  #|    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  #|    x = p.x; y = p.y;
  #|  } else {
  #|    const box = svg.getBoundingClientRect();
  #|    x = e.clientX - box.left; y = e.clientY - box.top;
  #|  }
  #|  e.__tutucaPoint = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  #|  return true;
  #|}

///|
extern "js" fn svg_x(e : JsEvent) -> Double =
  #|(e) => e.__tutucaPoint[0]

///|
extern "js" fn svg_y(e : JsEvent) -> Double =
  #|(e) => e.__tutucaPoint[1]

///|
extern "js" fn capture_pointer(e : JsEvent) -> Unit =
  #|(e) => { try { e.target?.closest?.("svg")?.setPointerCapture?.(e.pointerId); } catch {} }

///|
extern "js" fn file_count(e : JsEvent) -> Int32 =
  #|(e) => e.target?.files?.length ?? 0

///|
/// Keeps the event's i-th file for `read_file`, returning its id.
extern "js" fn keep_file(e : JsEvent, i : Int32) -> Int32 =
  #|(e, i) => {
  #|  const files = (globalThis.__tutucaFiles ??= { next: 1, byId: new Map() });
  #|  const id = files.next++;
  #|  files.byId.set(id, e.target.files[i]);
  #|  return id;
  #|}

///|
extern "js" fn file_name(id : Int32) -> String =
  #|(id) => globalThis.__tutucaFiles?.byId.get(id)?.name ?? ""

///|
fn event_files(e : JsEvent) -> Array[@tutuca.FileRef] {
  Array::makei(file_count(e), i => {
    let id = keep_file(e, i)
    { id, name: file_name(id), }
  })
}

///|
extern "js" fn read_file_ffi(
  id : Int32,
  ok : (String) -> Unit,
  fail : (String) -> Unit,
) -> Unit =
  #|(id, ok, fail) => {
  #|  const file = globalThis.__tutucaFiles?.byId.get(id);
  #|  if (file === undefined) { fail(`no file ${id}`); return; }
  #|  file.text().then(ok, (e) => fail(String(e?.message ?? e)));
  #|}

///|
/// Reads a picked file's text, later.
pub fn read_file(
  file : @tutuca.FileRef,
  reply : (@tutuca.AskResult[String]) -> Unit,
) -> Unit {
  read_file_ffi(file.id, text => reply(Ok(text)), e => reply(Err(e)))
}

///|
extern "js" fn download_ffi(
  filename : String,
  text : String,
  mime : String,
) -> Unit =
  #|(filename, text, type) => {
  #|  const doc = globalThis.document;
  #|  if (doc?.createElement === undefined || globalThis.URL?.createObjectURL === undefined) return;
  #|  const url = URL.createObjectURL(new Blob([text], { type }));
  #|  Object.assign(doc.createElement("a"), { href: url, download: filename }).click();
  #|  setTimeout(() => URL.revokeObjectURL(url), 0);
  #|}

///|
/// Downloads `text` as `filename`; without a DOM it does nothing.
pub fn download(filename : String, text : String, mime : String) -> Unit {
  download_ffi(filename, text, mime)
}

///|
/// What the host needs of a DOM event.
fn event_info(e : JsEvent) -> @tutuca.EventInfo {
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
    prevent=() => prevent_default(e),
    capture=() => capture_pointer(e),
  )
}

///|
extern "js" fn add_listener(
  node : JsNode,
  name : String,
  f : (JsEvent) -> Unit,
) -> () -> Unit =
  #|(node, name, f) => { node.addEventListener(name, f); return () => node.removeEventListener(name, f); }

///|
extern "js" fn set_timeout(f : () -> Unit, ms : Int32) -> Unit =
  #|(f, ms) => { setTimeout(f, ms); }

///|
extern "js" fn now() -> Double =
  #|() => Date.now()

///|
/// Delegates DOM events on the host's root to it: a listener per event name its components
/// handle.
pub fn delegate(h : @tutuca.Host[JsNode]) -> Unit {
  h.set_listen(name => {
    let remove = add_listener(h.root_node, name, e => {
      ignore(h.handle_event(event_target(e), event_type(e), info=event_info(e)))
    })
    h.on_stop(remove)
  })
}

///|
/// A host on `root`: tasks run on a zero timeout and DOM events are delegated to `root`.
pub fn host(
  root : JsNode,
  doc~ : JsNode = document(),
  dev~ : Bool = false,
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
) -> @tutuca.Host[JsNode] {
  let h = @tutuca.Host::new(
    doc,
    root,
    dev~,
    scope~,
    schedule=f => set_timeout(f, 0),
    now~,
  )
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
      console_error("taskFailed \{t.label} at \{t.path.to_string()}: \{e}")
    StateInvalid(issues) =>
      console_error("stateInvalid " + issues.map(i => i.to_string()).join("; "))
    MessageInvalid(t, issues) =>
      console_error("messageInvalid \{t.label}: \{issues.join(", ")}")
    RenderFailed(e) => console_error("renderFailed \{e}")
    Rendered | TaskHandled(_) => ()
  }
}

///|
extern "js" fn console_error(s : String) -> Unit =
  #|(s) => console.error(s)

///|
/// Today's local date as YYYY-MM-DD.
pub extern "js" fn iso_today() -> String =
  #|() => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
