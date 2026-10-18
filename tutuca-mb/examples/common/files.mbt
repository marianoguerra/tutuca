///|
/// A file to save: `kind` comes back as the reply, telling the asker which of its saves
/// finished; `mime` is the type, JSON by default.
pub(all) struct SaveFile {
  name : String
  text : String
  mime : String
  kind : String
} derive(Eq, Debug)

///|
pub fn SaveFile::new(
  name : String,
  text : String,
  mime~ : String = "application/json",
  kind? : String,
) -> SaveFile {
  { name, text, mime, kind: kind.unwrap_or(name), }
}

///|
/// Saves a file (a download in a browser) and replies its kind.
pub let save_file : @tutuca.Ask[SaveFile, String] = @tutuca.Ask::new("saveFile")

///|
/// Reads a picked file's text.
pub let read_text : @tutuca.Ask[@tutuca.FileRef, String] = @tutuca.Ask::new(
  "readText",
)

///|
/// Handlers for tests: saves are kept in `saved`, reads come from `files` by name.
pub fn handle_in_memory(
  scope : @tutuca.Scope,
  saved : Array[SaveFile],
  files~ : Map[String, String] = Map([]),
) -> Unit {
  scope.answer(save_file, f => {
    saved.push(f)
    f.kind
  })
  scope.handle(read_text, (file, reply) => {
    match files.get(file.name) {
      Some(text) => reply(Ok(text))
      None => reply(Err("no file \{file.name}"))
    }
  })
}
