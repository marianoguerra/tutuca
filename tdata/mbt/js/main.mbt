///|
pub fn tq_parse(query : String) -> String {
  @ffi.tq_parse(query)
}

///|
pub fn tq_match(query : String, message_json : String) -> String {
  @ffi.tq_match(query, message_json)
}

///|
pub fn tq_match_all(query : String, message_json : String) -> String {
  @ffi.tq_match_all(query, message_json)
}

///|
pub fn tq_run(query : String, message_json : String) -> String {
  @ffi.tq_run(query, message_json)
}

///|
pub fn tq_canon(message_json : String) -> String {
  @ffi.tq_canon(message_json)
}

///|
fn main {

}
