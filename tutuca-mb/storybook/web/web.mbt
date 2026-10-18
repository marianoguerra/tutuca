// The storybook in a browser. Each preview is a <tutuca-app app-key="[prefix]id[@seed]">
// (@browser's element): the storybook answers its request by running the story in the
// element's shadow root, with the page's CSS adopted there, and reports the story's state to
// the page as `state` reports. A key no story answers says so.

///|
extern "js" fn set_text(el : @browser.JsNode, text : String) -> Unit =
  #|(el, text) => { el.textContent = text; }

///|
extern "js" fn set_timeout(f : () -> Unit) -> Unit =
  #|(f) => { setTimeout(f, 0); }

///|
extern "js" fn set_timeout_ms(f : () -> Unit, ms : Int32) -> Unit =
  #|(f, ms) => { setTimeout(f, ms); }

///|
/// Starts the storybook UI on `root` for `books`: each story's preview is a <tutuca-app> that
/// runs it live, and the UI steps through it, stress tests it and shows its state. `css` and
/// `links` style the previews; `compile`, given the class names the previews use so far,
/// gives the CSS for them, as JS's `compile` (a margaui or Tailwind build); `prefix` starts
/// the keys this storybook answers; the UI's own CSS goes in the <style id=`style_id`>, so a
/// page running many storybooks gives each its own.
pub fn start(
  root : @browser.JsNode,
  books : Array[@storybook.Book[@browser.JsNode]],
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
    set_timeout_ms(() => reply(Ok(())), ms)
  })
  let changed = @previews.bind_previews(
    registry,
    @browser.document(),
    listen=f => {
      @browser.on_app_request(root, req => {
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
    schedule=set_timeout,
    connect=@browser.delegate,
    set_text~,
    css~,
    links~,
    compile?,
    known~,
    prefix~,
  )
  // After the listener: elements already on the page ask as they upgrade.
  @browser.define_app_element()
  @browser.install_formatters()
  let (_, app) = @browser.mount(
    root,
    @storybook.storybook,
    @storybook.Storybook::of(books, selected~, prefix~),
    dev=true,
    scope~,
    on_report=@browser.compile_styles(
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
extern "js" fn scroll_top(root : @browser.JsNode) -> Unit =
  #|(root) => {
  #|  for (const node of [root.querySelector("[data-story-main]"), document.scrollingElement]) {
  #|    if (node) node.scrollTop = 0;
  #|  }
  #|}
