///|
/// Answers `save_file` with a download and `read_text` with the picked file's text.
pub fn handle_files(scope : @tutuca.Scope) -> Unit {
  scope.answer(@common.save_file, f => {
    @tw.download(f.name, f.text, f.mime)
    f.kind
  })
  scope.handle(@common.read_text, (file, reply) => @tw.read_file(file, reply))
}

///|
/// Answers `now` with the browser's clock and `wait` with a timer.
pub fn handle_clock(scope : @tutuca.Scope) -> Unit {
  scope.answer(@common.now, _ => @tw.now())
  scope.handle(@common.wait, (ms, reply) => {
    @tw.set_timeout(() => reply(Ok(())), ms)
  })
}
