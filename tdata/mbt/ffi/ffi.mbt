///|
/// `{"ok":true}`, or `{"ok":false,"error":"…"}` when the query doesn't parse.
pub fn tq_parse(query : String) -> String {
  match parse(query) {
    Ok(_) => "{\"ok\":true}"
    Err(e) => error_text(e)
  }
}

///|
/// The first matching output: `{"ok":true,"value":J,"bindings":{name:J}}`, `{"ok":false}`
/// when nothing matches, `{"ok":false,"error":"…"}` when the query or the message doesn't
/// parse.
pub fn tq_match(query : String, message_json : String) -> String {
  match prepare(query, message_json) {
    Err(e) => error_text(e)
    Ok((q, m)) =>
      match @query.match_first(q, M(m)) {
        Some(s) => {
          let o = solution_object(s)
          o.keys.insert(0, "ok")
          o.vals.insert(0, Bool(true))
          encode(Object(o))
        }
        None => "{\"ok\":false}"
      }
  }
}

///|
/// Every matching output: `{"ok":true,"solutions":[[{value,bindings}…]]}`.
pub fn tq_match_all(query : String, message_json : String) -> String {
  match prepare(query, message_json) {
    Err(e) => error_text(e)
    Ok((q, m)) => solutions_text(@query.match_all(q, M(m)))
  }
}

///|
/// Every output, truthy or not, as jq would give them: `{"ok":true,"solutions":[[…]]}`.
pub fn tq_run(query : String, message_json : String) -> String {
  match prepare(query, message_json) {
    Err(e) => error_text(e)
    Ok((q, m)) => solutions_text(@query.run(q, M(m)))
  }
}

///|
/// The canonical JSON of a message: `{"ok":true,"json":"…"}` or the error.
pub fn tq_canon(message_json : String) -> String {
  let m = @json.decode_message(message_json) catch {
    e => return error_text(e.message())
  }
  let text = @json.encode_message(m) catch {
    _ => return error_text("the message can't be encoded")
  }
  let o = @model.OMap::new()
  o.push("ok", Bool(true))
  o.push("json", String(text))
  encode(Object(o))
}

///|
fn parse(query : String) -> Result[@query.Expr, String] {
  Ok(@query.parse(query)) catch {
    e => Err("the query: " + e.message())
  }
}

///|
fn prepare(
  query : String,
  message_json : String,
) -> Result[(@query.Expr, @model.Message), String] {
  let q = match parse(query) {
    Ok(q) => q
    Err(e) => return Err(e)
  }
  let m = @json.decode_message(message_json) catch {
    e => return Err("the message: " + e.message())
  }
  Ok((q, m))
}

///|
fn solution_object(s : @query.Solution) -> @model.OMap {
  let o = @model.OMap::new()
  o.push("value", s.value.to_value())
  let b = @model.OMap::new()
  for pair in s.bindings {
    b.push(pair.0, pair.1.to_value())
  }
  o.push("bindings", Object(b))
  o
}

///|
fn solutions_text(sols : Array[@query.Solution]) -> String {
  let o = @model.OMap::new()
  o.push("ok", Bool(true))
  o.push("solutions", Array(sols.map(s => Object(solution_object(s)))))
  encode(Object(o))
}

///|
fn error_text(reason : String) -> String {
  let o = @model.OMap::new()
  o.push("ok", Bool(false))
  o.push("error", String(reason))
  encode(Object(o))
}

///|
fn encode(v : @model.Value) -> String {
  @json.encode_value(v) catch {
    // Unreachable: every string came from decoded text, so none has a lone surrogate.
    _ => "{\"ok\":false,\"error\":\"the result can't be encoded\"}"
  }
}
