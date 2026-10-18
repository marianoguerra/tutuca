///|
/// Answers `save_file` with a download and `read_text` with the picked file's text.
pub fn handle_files(scope : @tutuca.Scope) -> Unit {
  scope.answer(@common.save_file, f => {
    @browser.download(f.name, f.text, f.mime)
    f.kind
  })
  scope.handle(@common.read_text, (file, reply) => {
    @browser.read_file(file, reply)
  })
}
