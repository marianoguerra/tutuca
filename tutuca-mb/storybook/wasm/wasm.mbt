// The storybook in a browser, on wasm-gc (storybook/web's twin through @wasm). Each preview is a <tutuca-app app-key="[prefix]id[@seed]">
// (@browser's element): the storybook answers its request by running the story in the
// element's shadow root, with the page's CSS adopted there, and reports the story's state to
// the page as `state` reports. A key no story answers says so.

///|
/// Starts the storybook UI on `root` for `books`: each story's preview is a <tutuca-app> that
/// runs it live, and the UI steps through it, stress tests it and shows its state. `css` and
/// `links` style the previews; `compile`, given the class names the previews use so far,
/// gives the CSS for them, as JS's `compile` (a margaui or Tailwind build); `prefix` starts
/// the keys this storybook answers; the UI's own CSS goes in the <style id=`style_id`>, so a
/// page running many storybooks gives each its own.
pub fn start(
  root : @tw.JsNode,
  books : Array[@storybook.Book[@tw.JsNode]],
  selected~ : String = "",
  css~ : String = "",
  links~ : Array[String] = [],
  compile? : (Array[String], (String) -> Unit) -> Unit,
  known~ : Array[String] = [],
  prefix~ : String = "",
  style_id~ : String = "margaui",
) -> @tutuca.App[@storybook.Storybook, @storybook.StorybookMsg] {
  let registry = @storybook.Registry::new(books)
  let scope = @tutuca.Scope::new()
  registry.serve(scope)
  scope.answer(@storybook.scroll_to_top, _ => scroll_top(root))
  scope.handle(@storybook.delay, (ms, reply) => {
    @tw.set_timeout(() => reply(Ok(())), ms)
  })
  let changed = @previews.bind_previews(
    registry,
    @tw.document(),
    listen=f => {
      @tw.on_app_request(root, req => {
        f({
          key: req.key(),
          root: req.root(),
          adopt_css: css => req.adopt_css(css),
          adopt_link: href => req.adopt_link(href),
          emit: (kind, data) => req.emit(kind, data),
          mount: dispose => req.mount(dispose),
        })
      })
    },
    schedule=f => @tw.set_timeout(f, 0),
    connect=@tw.delegate,
    set_text=@tw.set_text,
    css~,
    links~,
    compile?,
    known~,
    prefix~,
  )
  // After the listener: elements already on the page ask as they upgrade.
  @tw.define_app_element()
  @tw.install_formatters()
  let (_, app) = @tw.mount(
    root,
    @storybook.storybook,
    @storybook.Storybook::of(books, selected~, prefix~),
    dev=true,
    scope~,
    on_report=@tw.compile_styles(
      root,
      style_id~,
      compile=compile.unwrap_or(no_compile),
    ),
  )
  registry.set_on_change(id => {
    changed(id)
    app.send(Refresh)
  })
  app
}

///|
fn no_compile(_ : Array[String], _ : (String) -> Unit) -> Unit {

}

///|
extern "wasm" fn scroll_top(root : @tw.JsNode) -> Unit = "tdom" "scroll_top"
